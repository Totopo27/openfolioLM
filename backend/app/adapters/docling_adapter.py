"""IBM Docling adapter for high-fidelity document layout and table ingestion."""

import os
import uuid
import logging
import mimetypes
from typing import Optional, Any
from app.core.models import SourceDocument
from app.ports.ingester import IngestionPort
from app.adapters.markitdown_adapter import MarkItDownAdapter

logger = logging.getLogger(__name__)


class DoclingAdapter(IngestionPort):
    """
    Adapter wrapping IBM Docling (DS4SD/docling) for deep vision-based document layout parsing,
    unwrapping 2-column academic formats, tabular structures, and LaTeX formulas.
    Gracefully falls back to MarkItDown when docling is not installed or encounters an error.
    """

    def __init__(
        self,
        fallback_ingester: Optional[IngestionPort] = None,
        converter_instance: Optional[Any] = None
    ):
        self._fallback = fallback_ingester or MarkItDownAdapter()
        self._converter = converter_instance

    @staticmethod
    def is_available() -> bool:
        """Checks if docling package is installed in the current environment."""
        try:
            import docling
            return True
        except ImportError:
            return False

    def _get_converter(self) -> Any:
        if self._converter is None:
            try:
                from docling.document_converter import DocumentConverter
                self._converter = DocumentConverter()
            except Exception as e:
                logger.warning("Failed to initialize IBM Docling DocumentConverter: %s", e)
                return None
        return self._converter

    def convert(
        self,
        file_path: str,
        filename: str,
        source_id: Optional[str] = None,
        vision_transcriber: Optional[Any] = None,
    ) -> SourceDocument:
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Source file not found at: {file_path}")

        # If docling is available and file is PDF or DOCX, attempt Docling layout extraction
        ext = os.path.splitext(filename)[1].lower()
        if ext in (".pdf", ".docx") and (self.is_available() or self._converter is not None):
            converter = self._get_converter()
            if converter is not None:
                try:
                    logger.info("Parsing document with IBM Docling: %s", filename)
                    result = converter.convert(file_path)
                    markdown_text = result.document.export_to_markdown()
                    if markdown_text and markdown_text.strip():
                        doc_id = source_id or f"doc_{uuid.uuid4().hex[:12]}"
                        mime_type, _ = mimetypes.guess_type(filename)
                        return SourceDocument(
                            id=doc_id,
                            filename=filename,
                            mime_type=mime_type or "application/pdf",
                            raw_markdown=markdown_text,
                            char_count=len(markdown_text),
                            metadata={
                                "original_file_path": file_path,
                                "file_size_bytes": os.path.getsize(file_path),
                                "parser": "docling"
                            }
                        )
                except Exception as e:
                    logger.warning("Docling conversion failed for '%s': %s. Falling back to MarkItDown.", filename, e)

        # Fallback to MarkItDown
        try:
            return self._fallback.convert(file_path, filename, source_id, vision_transcriber=vision_transcriber)
        except TypeError:
            return self._fallback.convert(file_path, filename, source_id)

    def ingest_url(
        self,
        url: str,
        source_id: Optional[str] = None,
        title_override: Optional[str] = None,
        vision_transcriber: Optional[Any] = None,
    ) -> SourceDocument:
        try:
            return self._fallback.ingest_url(url, source_id=source_id, title_override=title_override, vision_transcriber=vision_transcriber)
        except TypeError:
            return self._fallback.ingest_url(url, source_id=source_id, title_override=title_override)
