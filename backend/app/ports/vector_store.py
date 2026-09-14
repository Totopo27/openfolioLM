from __future__ import annotations
from typing import Protocol
from app.core.models import DocumentChunk


class VectorStorePort(Protocol):
    """Port for dense vector indexing and semantic nearest-neighbor search."""

    def add_chunks(self, chunks: list[DocumentChunk]) -> None:
        """Embed and index document chunks in the vector store."""
        ...

    def delete_document_chunks(self, source_id: str) -> None:
        """Remove all chunks belonging to source_id from the vector store."""
        ...

    def search_vectors(
        self,
        query: str,
        active_source_ids: list[str],
        top_k: int = 15
    ) -> list[tuple[DocumentChunk, float]]:
        """
        Embed the query and retrieve top_k semantic nearest neighbors filtered by active_source_ids.
        Returns list of (DocumentChunk, distance_score).
        """
        ...
