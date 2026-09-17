import pytest
from datetime import datetime, timezone
from app.core.models import (
    SourceDocument,
    DocumentChunk,
    DocumentDossier,
    DocumentTypeEnum,
    ThematicModule,
    StudyGuide,
)
from app.adapters.sqlite_store import SQLiteDocumentStore


def test_dossier_save_and_retrieve():
    store = SQLiteDocumentStore(db_path=":memory:")

    doc = SourceDocument(
        id="src_doc_42",
        filename="cenat_paper.pdf",
        mime_type="application/pdf",
        raw_markdown="# Supercomputación CeNAT",
        char_count=25
    )
    chunks = [
        DocumentChunk(
            id="src_doc_42#c0",
            source_id="src_doc_42",
            heading_hierarchy=["# Supercomputación CeNAT"],
            start_char=0,
            end_char=25,
            content=doc.raw_markdown,
            token_estimate=5
        )
    ]
    store.add_document(doc, chunks)

    # Initially no dossier exists
    assert store.get_dossier("src_doc_42") is None

    # Save dossier
    dossier = DocumentDossier(
        source_id="src_doc_42",
        title="Supercomputación CeNAT",
        doc_type=DocumentTypeEnum.RESEARCH_PAPER,
        executive_summary="Estudio sobre computación de alto rendimiento.",
        authors_or_entities=["CeNAT", "MICITT"],
        key_claims=["Escalabilidad lineal en clusters MPI"],
        methodology_or_approach="Benchmarking en Slurm",
        thematic_modules=[
            ThematicModule(
                topic="Técnica / HPC",
                summary="Excelente rendimiento con baja latencia.",
                core_concepts=["InfiniBand", "MPI Clusters"],
                practical_applications=["Modelado climático en 64 nodos"]
            )
        ],
        study_guide=StudyGuide(
            target_audience="Investigadores en computación de alto rendimiento",
            prerequisites=["Linux avanzado", "C / MPI"],
            difficulty_level="Avanzado",
            key_takeaways=["Optimización de I/O en clusters distribuidos"],
            recommended_reading_path="Lectura secuencial de metodologías de benchmark"
        ),
        limitations=["Pruebas limitadas a 64 nodos"],
        verdict="Aporte significativo para la ciencia regional.",
        confidence_score=0.92
    )

    store.save_dossier(dossier)

    # Retrieve and verify all fields
    retrieved = store.get_dossier("src_doc_42")
    assert retrieved is not None
    assert retrieved.source_id == "src_doc_42"
    assert retrieved.title == "Supercomputación CeNAT"
    assert retrieved.doc_type == DocumentTypeEnum.RESEARCH_PAPER
    assert retrieved.authors_or_entities == ["CeNAT", "MICITT"]
    assert len(retrieved.thematic_modules) == 1
    assert retrieved.thematic_modules[0].topic == "Técnica / HPC"
    assert retrieved.thematic_modules[0].core_concepts == ["InfiniBand", "MPI Clusters"]
    assert retrieved.study_guide.difficulty_level == "Avanzado"
    assert retrieved.study_guide.prerequisites == ["Linux avanzado", "C / MPI"]
    assert retrieved.confidence_score == 0.92

    # Verify deletion cascade
    store.delete_document("src_doc_42")
    assert store.get_dossier("src_doc_42") is None


def test_document_upsert_preserves_existing_dossier():
    store = SQLiteDocumentStore(db_path=":memory:")
    document = SourceDocument(
        id="src_doc_upsert",
        filename="first.md",
        raw_markdown="Original content",
    )
    store.add_document(document, [])
    dossier = DocumentDossier(
        source_id=document.id,
        title="Persistent dossier",
        executive_summary="Summary",
        verdict="Keep this analysis",
    )
    store.save_dossier(dossier)

    updated = document.model_copy(
        update={"filename": "updated.md", "raw_markdown": "Updated content"}
    )
    store.add_document(updated, [])

    assert store.get_dossier(document.id) == dossier
