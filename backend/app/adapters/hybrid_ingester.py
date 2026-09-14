"""Hybrid composite document ingester combining IBM Docling and Microsoft MarkItDown."""

import os
from typing import Optional
from app.core.config import settings
from app.core.models import SourceDocument
from app.ports.ingester import IngestionPort
from app.adapters.docling_adapter import DoclingAdapter
from app.adapters.markitdown_adapter import MarkItDownAdapter


DOCLING_EXTENSIONS = {".pdf", ".docx"}


class HybridDocumentIngester(IngestionPort):
    """
    Composite ingester routing rich multi-column documents (PDF, DOCX) through IBM Docling
    while routing web URLs, plain text, and code through MarkItDown.
    """

    def __init__(
        self,
        docling_adapter: Optional[DoclingAdapter] = None,
        markitdown_adapter: Optional[MarkItDownAdapter] = None,
        enable_docling: Optional[bool] = None
    ):
        self._markitdown = markitdown_adapter or MarkItDownAdapter()
        self._docling = docling_adapter or DoclingAdapter(fallback_ingester=self._markitdown)
        self.enable_docling = enable_docling if enable_docling is not None else settings.enable_docling

    def convert(
        self,
        file_path: str,
        filename: str,
        source_id: Optional[str] = None
    ) -> SourceDocument:
        ext = os.path.splitext(filename)[1].lower()
        if self.enable_docling and ext in DOCLING_EXTENSIONS:
            return self._docling.convert(file_path, filename, source_id)
        return self._markitdown.convert(file_path, filename, source_id)

    def ingest_url(
        self,
        url: str,
        source_id: Optional[str] = None,
        title_override: Optional[str] = None
    ) -> SourceDocument:
        return self._markitdown.ingest_url(url, source_id=source_id, title_override=title_override)
