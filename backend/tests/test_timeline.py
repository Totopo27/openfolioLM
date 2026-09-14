import asyncio
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, AsyncMock
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.models import SourceDocument, DocumentDossier, GroundedResponse
from app.adapters.project_manager import ProjectManager
from app.adapters.timeline_builder import TimelineBuilder
from app.api.routes_projects import create_projects_router
from app.ports.ingester import IngestionPort
from app.ports.chunker import ChunkerPort
from app.ports.synthesizer import SynthesizerPort


def test_empty_project_timeline(tmp_path):
    pm = ProjectManager(projects_root=str(tmp_path / "projects"))
    proj = pm.create_project(name="Proyecto Vacio")

    builder = TimelineBuilder(pm)
    timeline = builder.build_timeline(proj.id)

    assert timeline.project_id == proj.id
    assert timeline.total_events == 0
    assert timeline.year_span == (0, 0)
    assert timeline.eras == []


def test_timeline_chronological_ordering_and_lineage(tmp_path):
    pm = ProjectManager(projects_root=str(tmp_path / "projects"))
    proj = pm.create_project(name="Evolucion de LLMs")
    store = pm.get_store(proj.id)

    # 1. Landmark 2017
    doc_1 = SourceDocument(
        id="doc_vaswani_2017",
        filename="Attention_2017.pdf",
        raw_markdown="# Attention Is All You Need\nWe introduce the Transformer architecture.",
        metadata={
            "title": "Attention Is All You Need",
            "authors": ["Ashish Vaswani", "Noam Shazeer"],
            "publication_year": 2017,
            "citations_count": 90000,
            "doi": "10.48550/arXiv.1706.03762",
        }
    )

    # 2. GPT-3 2020 (Cites Vaswani)
    doc_2 = SourceDocument(
        id="doc_brown_2020",
        filename="Language_Models_Few_Shot_Learners_2020.pdf",
        raw_markdown="# Language Models are Few-Shot Learners\nBased on Attention Is All You Need (10.48550/arXiv.1706.03762), scaling up autoregressive models.",
        metadata={
            "title": "Language Models are Few-Shot Learners",
            "authors": ["Tom Brown", "Benjamin Mann"],
            "publication_year": 2020,
            "citations_count": 25000,
            "doi": "10.48550/arXiv.2005.14165",
        }
    )

    # 3. Frontier Reasoning 2025 (Cites Brown & Vaswani)
    doc_3 = SourceDocument(
        id="doc_reasoning_2025",
        filename="Reasoning_Frontier_2025.pdf",
        raw_markdown="# Deep Reasoning in LLMs\nExtending Language Models are Few-Shot Learners with reinforcement learning and Attention Is All You Need foundations.",
        metadata={
            "title": "Deep Reasoning in LLMs",
            "authors": ["Research Team"],
            "publication_year": 2025,
            "citations_count": 42,
        }
    )

    store.add_document(doc_1, [])
    store.add_document(doc_2, [])
    store.add_document(doc_3, [])

    builder = TimelineBuilder(pm)
    timeline = builder.build_timeline(proj.id)

    assert timeline.total_events == 3
    assert timeline.year_span == (2017, 2025)
    assert len(timeline.eras) == 3

    # Check era years are strictly sorted
    era_years = [era.year for era in timeline.eras]
    assert era_years == [2017, 2020, 2025]

    # Verify doc_2 lineage points back to doc_1
    era_2020 = next(e for e in timeline.eras if e.year == 2020)
    event_2020 = era_2020.events[0]
    assert event_2020.source_id == "doc_brown_2020"
    assert any(link.source_id == "doc_vaswani_2017" for link in event_2020.built_upon_sources)

    # Verify doc_3 lineage points back to doc_1 or doc_2
    era_2025 = next(e for e in timeline.eras if e.year == 2025)
    event_2025 = era_2025.events[0]
    built_targets = [link.source_id for link in event_2025.built_upon_sources]
    assert "doc_brown_2020" in built_targets or "doc_vaswani_2017" in built_targets


def test_timeline_dossier_enrichment(tmp_path):
    pm = ProjectManager(projects_root=str(tmp_path / "projects"))
    proj = pm.create_project(name="Proyecto con Dossier")
    store = pm.get_store(proj.id)

    doc = SourceDocument(
        id="doc_quantum_2022",
        filename="Quantum_Error_Correction_2022.pdf",
        raw_markdown="# Quantum Error Correction\nSurface codes under realistic noise.",
        metadata={
            "title": "Surface Codes for Quantum Computing",
            "authors": ["Dr. Alice Quantum"],
            "publication_year": 2022,
        }
    )
    store.add_document(doc, [])

    dossier = DocumentDossier(
        source_id=doc.id,
        title="Surface Codes for Quantum Computing",
        executive_summary="Demuestra un umbral de fallo cuantico inferior al 1% bajo ruido real.",
        methodology_or_approach="Simulacion numerica Monte Carlo con decoherencia espin.",
        key_claims=["Umbral del 1% alcanzado en simulacion", "Escalabilidad a 100 qubits"],
        limitations=["Requiere temperaturas criogenicas estrictas"],
        verdict="Avance solido en correccion de errores topologicos.",
    )
    store.save_dossier(dossier)

    builder = TimelineBuilder(pm)
    timeline = builder.build_timeline(proj.id)

    assert timeline.total_events == 1
    event = timeline.eras[0].events[0]
    assert event.headline == "Umbral del 1% alcanzado en simulacion"
    assert "Demuestra un umbral de fallo" in event.summary
    assert "Monte Carlo" in event.methodology


def test_timeline_narrative_synthesis(tmp_path):
    pm = ProjectManager(projects_root=str(tmp_path / "projects"))
    proj = pm.create_project(name="Proyecto Narrativa")
    store = pm.get_store(proj.id)

    doc = SourceDocument(
        id="doc_1998",
        filename="LeNet_1998.pdf",
        raw_markdown="# LeNet\nGradient-based learning applied to document recognition.",
        metadata={"title": "Gradient-Based Learning", "year": 1998}
    )
    store.add_document(doc, [])

    # Test deterministic fallback synthesis (when no synthesizer or LLM fails)
    builder_fallback = TimelineBuilder(pm, synthesizer=None)
    fallback_narrative = asyncio.run(builder_fallback.synthesize_narrative(proj.id))
    assert "Trayectoria Intelectual" in fallback_narrative
    assert "1998" in fallback_narrative

    # Test LLM synthesizer synthesis
    mock_synth = MagicMock(spec=SynthesizerPort)
    mock_synth.generate_grounded_answer = AsyncMock(
        return_value=GroundedResponse(
            answer="La era de 1998 inicio la revolucion conexionista con LeNet...",
            citations=[],
            has_hallucinations=False
        )
    )
    builder_llm = TimelineBuilder(pm, synthesizer=mock_synth)
    llm_narrative = asyncio.run(builder_llm.synthesize_narrative(proj.id))
    assert "revolucion conexionista" in llm_narrative


def test_api_timeline_endpoints(tmp_path):
    pm = ProjectManager(projects_root=str(tmp_path / "projects"))
    proj = pm.create_project(name="API Timeline Project")
    store = pm.get_store(proj.id)

    doc = SourceDocument(
        id="doc_api_2023",
        filename="Agentic_AI_2023.pdf",
        raw_markdown="Autonomous agent architectures.",
        metadata={"title": "Agentic AI Architectures", "publication_year": 2023}
    )
    store.add_document(doc, [])

    router = create_projects_router(
        project_manager=pm,
        ingester=MagicMock(spec=IngestionPort),
        chunker=MagicMock(spec=ChunkerPort),
        synthesizer=MagicMock(spec=SynthesizerPort),
    )

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    # 1. GET Timeline
    res = client.get(f"/api/projects/{proj.id}/timeline")
    assert res.status_code == 200
    data = res.json()
    assert data["project_id"] == proj.id
    assert data["total_events"] == 1
    assert data["year_span"] == [2023, 2023]
    assert len(data["eras"]) == 1
    assert data["eras"][0]["events"][0]["title"] == "Agentic AI Architectures"

    # 2. POST Narrative
    res_narrative = client.post(f"/api/projects/{proj.id}/timeline/narrative")
    assert res_narrative.status_code == 200
    narrative_data = res_narrative.json()
    assert "narrative_arc" in narrative_data
    assert len(narrative_data["narrative_arc"]) > 0
