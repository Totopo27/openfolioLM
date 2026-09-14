from __future__ import annotations
from typing import Protocol, Optional
from app.core.models import SourceDocument, DocumentChunk, DocumentDossier


class DocumentAnalyzerPort(Protocol):
    """Port for extracting structured analytical dossiers from documents."""

    def analyze_document(
        self,
        document: SourceDocument,
        chunks: list[DocumentChunk],
        provider: Optional[str] = None
    ) -> DocumentDossier:
        """Extract structured CeNAT/PASE analytical dossier from document content."""
        ...
