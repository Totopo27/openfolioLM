from typing import Protocol
from app.core.models import SourceDocument


class IngestionPort(Protocol):
    """Port for converting heterogeneous files into normalized Markdown documents."""

    def convert(self, file_path: str, filename: str, source_id: str | None = None) -> SourceDocument:
        """Convert a local file (PDF, DOCX, XLSX, etc.) to a SourceDocument."""
        ...
