from typing import Protocol
from app.core.models import SourceDocument, DocumentChunk


class ChunkerPort(Protocol):
    """Port for splitting documents into chunks with coordinate traceability."""

    def chunk(
        self,
        document: SourceDocument,
        max_chunk_chars: int = 1200,
        min_chunk_chars: int = 150
    ) -> list[DocumentChunk]:
        """Split document into chunks preserving exact start_char and end_char in raw_markdown."""
        ...
