"""Port interface for semantic candidate chunk rerankers."""

from abc import ABC, abstractmethod
from typing import Sequence
from app.core.models import DocumentChunk


class RerankerPort(ABC):
    """Abstract port for neural cross-encoder candidate chunk rerankers."""

    @abstractmethod
    def rerank(
        self,
        query: str,
        chunks: Sequence[DocumentChunk],
        top_k: int = 4
    ) -> list[DocumentChunk]:
        """
        Reranks a sequence of candidate DocumentChunks by deep semantic relevance
        to the query, returning the top_k highest-scoring chunks with exact coordinate
        and source traceability intact.
        """
        pass
