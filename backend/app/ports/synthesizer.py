from typing import Protocol
from app.core.models import GroundedQuery, DocumentChunk, SourceDocument, GroundedResponse


class SynthesizerPort(Protocol):
    """Port for synthesizing grounded responses with citation extraction."""

    def synthesize(
        self,
        query: GroundedQuery,
        chunks: list[DocumentChunk],
        sources_map: dict[str, SourceDocument]
    ) -> GroundedResponse:
        """Generate response strictly grounded on provided chunks with verifiable citations."""
        ...
