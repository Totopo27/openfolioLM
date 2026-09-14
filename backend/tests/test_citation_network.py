import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from app.core.models import SourceDocument
from app.adapters.project_manager import ProjectManager
from app.adapters.citation_network import CitationNetworkBuilder
from app.api.routes_projects import create_projects_router


def test_empty_project_network(tmp_path):
    pm = ProjectManager(projects_root=str(tmp_path / "projects"))
    proj = pm.create_project(name="Proyecto Vacio")

    builder = CitationNetworkBuilder(pm)
    graph = builder.build_project_network(proj.id)

    assert graph.nodes == []
    assert graph.edges == []
    assert graph.metrics.node_count == 0


def test_network_with_citations_and_coauthorship(tmp_path):
    pm = ProjectManager(projects_root=str(tmp_path / "projects"))
    proj = pm.create_project(name="Red de Papers")
    store = pm.get_store(proj.id)

    now = datetime.now(timezone.utc)
    current_year = now.year

    # Paper A: Landmark foundational
    doc_a = SourceDocument(
        id="doc_vaswani_2017",
        filename="Attention_Is_All_You_Need.pdf",
        raw_markdown="# Attention Is All You Need\nWe introduce the Transformer architecture.",
        metadata={
            "title": "Attention Is All You Need",
            "authors": ["Ashish Vaswani", "Noam Shazeer"],
            "publication_year": 2017,
            "citations_count": 85000,
            "doi": "10.48550/arXiv.1706.03762",
        }
    )

    # Paper B: Frontier recent work citing Paper A, sharing an author
    doc_b = SourceDocument(
        id="doc_frontier_2025",
        filename="Frontier_LLM_Scaling.pdf",
        raw_markdown="# Frontier LLM Scaling\nBuilding on Attention Is All You Need (10.48550/arXiv.1706.03762), we scale models further.",
        metadata={
            "title": "Frontier LLM Scaling",
            "authors": ["Ashish Vaswani", "New Researcher"],
            "publication_year": current_year,
            "citations_count": 15,
            "doi": "10.1000/frontier.2025",
        }
    )

    # Paper C: Cross-domain application
    doc_c = SourceDocument(
        id="doc_biomed_2024",
        filename="Biomedical_Transformers.pdf",
        raw_markdown="# Biomedical Transformers\nWe apply models based on Attention Is All You Need in clinical genetics.",
        metadata={
            "title": "Biomedical Transformers in Genetics",
            "authors": ["Dr. House", "Dr. Wilson"],
            "publication_year": current_year - 1,
            "citations_count": 5,
        }
    )

    store.add_document(doc_a, [])
    store.add_document(doc_b, [])
    store.add_document(doc_c, [])

    builder = CitationNetworkBuilder(pm)
    graph = builder.build_project_network(proj.id, min_similarity=0.4)

    assert len(graph.nodes) == 3
    assert graph.metrics.node_count == 3
    assert graph.metrics.edge_count >= 2

    # Verify roles
    node_a = next(n for n in graph.nodes if n.id == "doc_vaswani_2017")
    node_b = next(n for n in graph.nodes if n.id == "doc_frontier_2025")

    assert node_a.role == "foundation"
    assert node_b.role == "frontier"

    # Verify edges
    edge_types = [e.type for e in graph.edges]
    assert "citation" in edge_types
    assert "co_authorship" in edge_types


def test_api_network_endpoint(tmp_path):
    pm = ProjectManager(projects_root=str(tmp_path / "projects"))
    proj = pm.create_project(name="Proyecto API Network")
    store = pm.get_store(proj.id)

    doc = SourceDocument(
        id="doc-1",
        filename="Survey.pdf",
        raw_markdown="A survey on machine learning",
        metadata={"title": "Survey on ML", "authors": ["Alice"], "year": 2024}
    )
    store.add_document(doc, [])

    from unittest.mock import MagicMock
    from app.ports.ingester import IngestionPort
    from app.ports.chunker import ChunkerPort
    from app.ports.synthesizer import SynthesizerPort

    router = create_projects_router(
        project_manager=pm,
        ingester=MagicMock(spec=IngestionPort),
        chunker=MagicMock(spec=ChunkerPort),
        synthesizer=MagicMock(spec=SynthesizerPort),
    )

    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    res = client.get(f"/api/projects/{proj.id}/network?min_similarity=0.5")
    assert res.status_code == 200
    data = res.json()
    assert "nodes" in data
    assert "edges" in data
    assert "metrics" in data
    assert len(data["nodes"]) == 1
    assert data["nodes"][0]["title"] == "Survey on ML"
