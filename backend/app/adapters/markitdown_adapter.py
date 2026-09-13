import os
import uuid
import mimetypes
from typing import Optional
from markitdown import MarkItDown
from app.core.models import SourceDocument
from app.ports.ingester import IngestionPort


class MarkItDownAdapter(IngestionPort):
    """Adapter wrapping Microsoft MarkItDown for heterogeneous document ingestion."""

    def __init__(self, markitdown_instance: Optional[MarkItDown] = None):
        self._md = markitdown_instance or MarkItDown()

    def convert(
        self,
        file_path: str,
        filename: str,
        source_id: Optional[str] = None
    ) -> SourceDocument:
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Source file not found at: {file_path}")

        result = self._md.convert(file_path)
        markdown_text = result.text_content or ""

        doc_id = source_id or f"doc_{uuid.uuid4().hex[:12]}"
        mime_type, _ = mimetypes.guess_type(filename)

        return SourceDocument(
            id=doc_id,
            filename=filename,
            mime_type=mime_type or "application/octet-stream",
            raw_markdown=markdown_text,
            char_count=len(markdown_text),
            metadata={
                "original_file_path": file_path,
                "file_size_bytes": os.path.getsize(file_path)
            }
        )
