from __future__ import annotations
from typing import Protocol, Optional
from app.core.models import SourceDocument, DocumentChunk, DocumentDossier


class DocumentAnalyzerPort(Protocol):
    """Port for extracting structured analytical dossiers and study guides from documents."""

    def analyze_document(
        self,
        document: SourceDocument,
        chunks: list[DocumentChunk],
        provider: Optional[str] = None
    ) -> DocumentDossier:
        """Extract structured analytical dossier and study guide from document content."""
        ...
