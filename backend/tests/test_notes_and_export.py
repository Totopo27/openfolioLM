import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from app.core.models import (
    Project,
    SourceDocument,
    ProjectNote,
    DocumentDossier,
    DocumentTypeEnum,
    ThematicModule,
    StudyGuide,
    ChatMessageRecord,
)
from app.adapters.sqlite_store import SQLiteDocumentStore
from app.adapters.project_manager import ProjectManager
from app.core.exporter import export_project_bibtex, export_project_markdown
from app.api.routes_projects import create_projects_router


@pytest.fixture
def memory_store():
    store = SQLiteDocumentStore(":memory:")
    yield store
    store.close()


def test_sqlite_store_notes(memory_store):
    now = datetime.now(timezone.utc)
    note = ProjectNote(
        id="note-1",
        project_id="proj-a",
        title="Hallazgo sobre RAG",
        content="La recuperación híbrida supera a la densa pura.",
        source_citation_ids=["src-1#c0"],
        tags=["rag", "evaluacion"],
        origin_prompt="¿Cómo funciona la recuperación híbrida?",
        source_message_id="msg-101",
        created_at=now,
        updated_at=now,
    )

    # Save and retrieve
    memory_store.save_note(note)
    retrieved = memory_store.get_note("note-1")
    assert retrieved is not None
    assert retrieved.id == "note-1"
    assert retrieved.title == "Hallazgo sobre RAG"
    assert retrieved.tags == ["rag", "evaluacion"]
    assert retrieved.origin_prompt == "¿Cómo funciona la recuperación híbrida?"
    assert retrieved.source_message_id == "msg-101"

    # List notes
    all_notes = memory_store.list_notes(project_id="proj-a")
    assert len(all_notes) == 1
    assert all_notes[0].origin_prompt == "¿Cómo funciona la recuperación híbrida?"
    assert all_notes[0].source_message_id == "msg-101"

    # Update note
    note.title = "Hallazgo Actualizado"
    memory_store.save_note(note)
    updated = memory_store.get_note("note-1")
    assert updated.title == "Hallazgo Actualizado"

    # Delete note
    deleted = memory_store.delete_note("note-1")
    assert deleted is True
    assert memory_store.get_note("note-1") is None
    assert len(memory_store.list_notes("proj-a")) == 0


def test_exporter_bibtex():
    sources = [
        SourceDocument(
            id="src-openalex",
            filename="Lewis2020_RAG.pdf",
            raw_markdown="Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
            metadata={
                "title": "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
                "authors": ["Patrick Lewis", "Ethan Perez", "Aleksandra Piktus"],
                "publication_year": 2020,
                "doi": "10.48550/arXiv.2005.11401",
                "journal": "NeurIPS 2020",
                "url": "https://arxiv.org/abs/2005.11401",
            }
        ),
        SourceDocument(
            id="src-misc",
            filename="Manual_Usuario.md",
            raw_markdown="# Manual de Usuario",
            metadata={"title": "Manual de Usuario"}
        )
    ]

    bib = export_project_bibtex(sources)
    assert "@article{" in bib or "@misc{" in bib
    assert "Retrieval-Augmented Generation" in bib
    assert "Lewis" in bib
    assert "10.48550/arXiv.2005.11401" in bib
    assert "Manual de Usuario" in bib


def test_exporter_markdown():
    project = Project(
        id="proj-test",
        name="Proyecto de Inteligencia Artificial",
        description="Investigación sobre arquitecturas de agentes y RAG."
    )
    sources = [
        SourceDocument(
            id="src-1",
            filename="rag_survey.pdf",
            raw_markdown="Abstract: A comprehensive survey of RAG...",
            metadata={
                "title": "Survey of Retrieval-Augmented Generation",
                "authors": ["G. Vaswani", "A. Gomez"],
                "publication_year": 2024,
                "doi": "10.1000/182",
            }
        )
    ]
    notes = [
        ProjectNote(
            id="note-1",
            project_id="proj-test",
            title="Reflexión sobre BM25 + Vectores",
            content="El Reciprocal Rank Fusion (RRF) balancea precisión léxica y semántica.",
            tags=["rag", "fusion"],
            origin_prompt="¿Cómo balancear precisión léxica y semántica?",
            source_message_id="msg-orig-1"
        )
    ]
    dossiers = {
        "src-1": DocumentDossier(
            source_id="src-1",
            title="Survey of Retrieval-Augmented Generation",
            doc_type=DocumentTypeEnum.RESEARCH_PAPER,
            executive_summary="Revisión exhaustiva del estado del arte en RAG.",
            key_claims=["RAG reduce las alucinaciones en un 60%"],
            verdict="Documento fundamental para el estado del arte.",
            thematic_modules=[
                ThematicModule(
                    topic="Arquitecturas RAG Avanzadas",
                    summary="Integración de recuperación densa, dispersa y reranking.",
                    core_concepts=["Dense Retrieval", "RRF", "Cross-encoders"],
                    practical_applications=["Búsqueda semántica híbrida"]
                )
            ],
            study_guide=StudyGuide(
                target_audience="Investigadores e ingenieros en IA",
                prerequisites=["Embeddings", "Transformers", "Bases de datos vectoriales"],
                difficulty_level="Avanzado",
                key_takeaways=["Mitigación de alucinaciones y grounding estricto"],
                recommended_reading_path="Lectura secuencial desde fundamentos hasta RAG modular"
            )
        )
    }
    messages = [
        ChatMessageRecord(
            id="msg-1",
            sender="assistant",
            text="La arquitectura RAG mitiga alucinaciones combinando recuperación densa y dispersa.",
        )
    ]

    md = export_project_markdown(project, sources, notes, dossiers, messages)
    assert "# Dossier de Investigación: Proyecto de Inteligencia Artificial" in md
    assert "## 📌 Resumen del Proyecto" in md
    assert "Investigación sobre arquitecturas de agentes y RAG." in md
    assert "Survey of Retrieval-Augmented Generation" in md
    assert "Reflexión sobre BM25 + Vectores" in md
    assert "Pregunta de Origen:** _¿Cómo balancear precisión léxica y semántica?_" in md
    assert "Guía de Estudio Consolidada y Mapa Temático" in md
    assert "Mitigación de alucinaciones y grounding estricto" in md
    assert "La arquitectura RAG mitiga alucinaciones" in md


def test_api_notes_and_export(tmp_path):
    pm = ProjectManager(projects_root=str(tmp_path / "projects"))
    proj = pm.create_project(name="Proyecto Cuaderno", description="Testing notes API")

    from app.ports.ingester import IngestionPort
    from app.ports.chunker import ChunkerPort
    from app.ports.synthesizer import SynthesizerPort
    from unittest.mock import MagicMock

    mock_ingester = MagicMock(spec=IngestionPort)
    mock_chunker = MagicMock(spec=ChunkerPort)
    mock_synthesizer = MagicMock(spec=SynthesizerPort)

    router = create_projects_router(
        project_manager=pm,
        ingester=mock_ingester,
        chunker=mock_chunker,
        synthesizer=mock_synthesizer,
    )

    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    # 1. Create Note with origin prompt & message id
    res = client.post(
        f"/api/projects/{proj.id}/notes",
        json={
            "title": "Nota 1",
            "content": "Contenido de prueba",
            "source_citation_ids": [],
            "tags": ["sintesis"],
            "origin_prompt": "¿Qué es la síntesis?",
            "source_message_id": "msg-001"
        }
    )
    assert res.status_code == 200
    note_data = res.json()
    assert note_data["title"] == "Nota 1"
    assert note_data["origin_prompt"] == "¿Qué es la síntesis?"
    assert note_data["source_message_id"] == "msg-001"
    note_id = note_data["id"]

    # 2. List Notes
    res = client.get(f"/api/projects/{proj.id}/notes")
    assert res.status_code == 200
    notes_list = res.json()
    assert len(notes_list) == 1
    assert notes_list[0]["id"] == note_id
    assert notes_list[0]["origin_prompt"] == "¿Qué es la síntesis?"

    # 3. Update Note
    res = client.put(
        f"/api/projects/{proj.id}/notes/{note_id}",
        json={"title": "Nota 1 Modificada", "tags": ["sintesis", "v2"]}
    )
    assert res.status_code == 200
    assert res.json()["title"] == "Nota 1 Modificada"
    assert res.json()["origin_prompt"] == "¿Qué es la síntesis?"
    assert "v2" in res.json()["tags"]

    # 4. Export Markdown
    res = client.get(f"/api/projects/{proj.id}/export?format=markdown")
    assert res.status_code == 200
    assert "Nota 1 Modificada" in res.text
    assert "Proyecto Cuaderno" in res.text

    # 5. Export BibTeX
    res = client.get(f"/api/projects/{proj.id}/export?format=bibtex")
    assert res.status_code == 200
    assert "% OpenFolioLM BibTeX Export" in res.text

    # 6. Delete Note
    res = client.delete(f"/api/projects/{proj.id}/notes/{note_id}")
    assert res.status_code == 200
    assert res.json()["status"] == "deleted"

    res = client.get(f"/api/projects/{proj.id}/notes/{note_id}")
    assert res.status_code == 404
