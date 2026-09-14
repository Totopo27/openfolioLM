import pytest
from datetime import datetime, timezone
from app.core.models import (
    SourceDocument,
    DocumentChunk,
    DocumentDossier,
    DocumentTypeEnum,
    AreaAnalysis,
    FODAMatrix,
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
        multidimensional_analysis=[
            AreaAnalysis(
                area="Técnica / HPC",
                summary="Excelente rendimiento con baja latencia.",
                strengths=["InfiniBand optimizado"],
                weaknesses=["Cuello de botella I/O en disco"],
                risks=["Sobrecarga de memoria"]
            )
        ],
        foda=FODAMatrix(
            strengths=["Supercomputadora Kabré"],
            weaknesses=["Capacidad de almacenamiento"],
            opportunities=["Colaboración académica"],
            threats=["Costos de energía"]
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
    assert len(retrieved.multidimensional_analysis) == 1
    assert retrieved.multidimensional_analysis[0].area == "Técnica / HPC"
    assert retrieved.foda.strengths == ["Supercomputadora Kabré"]
    assert retrieved.confidence_score == 0.92

    # Verify deletion cascade
    store.delete_document("src_doc_42")
    assert store.get_dossier("src_doc_42") is None
