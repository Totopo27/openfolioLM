from typing import Protocol
from app.core.models import SourceDocument


class IngestionPort(Protocol):
    """Port for converting heterogeneous files into normalized Markdown documents."""

    def convert(self, file_path: str, filename: str, source_id: str | None = None) -> SourceDocument:
        """Convert a local file (PDF, DOCX, XLSX, etc.) to a SourceDocument."""
        ...

    def ingest_url(self, url: str, source_id: str | None = None, title_override: str | None = None) -> SourceDocument:
        """Fetch a remote web URL and convert its HTML content to a SourceDocument."""
        ...
