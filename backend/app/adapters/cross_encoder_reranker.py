"""Neural cross-encoder reranker adapter using ONNX models via fastembed."""

import logging
from typing import Optional, Sequence, Any
from app.core.models import DocumentChunk
from app.ports.reranker import RerankerPort

logger = logging.getLogger(__name__)


class CrossEncoderReranker(RerankerPort):
    """
    Neural Cross-Encoder reranker using ONNX models (e.g. BAAI/bge-reranker-base).
    Scores the deep cross-attention interaction between the user query and each candidate chunk,
    filtering out retrieval noise before grounded synthesis.
    """

    def __init__(
        self,
        model_name: str = "BAAI/bge-reranker-base",
        encoder_instance: Optional[Any] = None,
        lazy_load: bool = True
    ):
        self.model_name = model_name
        self._encoder = encoder_instance
        if not lazy_load and self._encoder is None:
            self._ensure_encoder()

    def _ensure_encoder(self) -> Optional[Any]:
        """Lazy load the fastembed TextCrossEncoder model on demand."""
        if self._encoder is not None:
            return self._encoder

        try:
            from fastembed.rerank.cross_encoder import TextCrossEncoder
            logger.info("Initializing neural cross-encoder model: %s", self.model_name)
            self._encoder = TextCrossEncoder(model_name=self.model_name)
            return self._encoder
        except Exception as e:
            logger.warning("Failed to initialize neural reranker '%s': %s. Falling back to rank order.", self.model_name, e)
            return None

    def rerank(
        self,
        query: str,
        chunks: Sequence[DocumentChunk],
        top_k: int = 4
    ) -> list[DocumentChunk]:
        """
        Reranks candidate chunks by cross-attention score against the query.
        Returns top_k highest-scoring chunks.
        """
        if not chunks:
            return []

        if len(chunks) <= 1:
            return list(chunks)[:top_k]

        encoder = self._ensure_encoder()
        if encoder is None:
            # Graceful fallback: return candidate chunks in their original search order
            return list(chunks)[:top_k]

        try:
            documents = [c.content for c in chunks]
            # fastembed.rerank returns an iterable of float relevance scores
            scores = list(encoder.rerank(query=query, documents=documents))

            # Pair score with chunk and sort descending by score
            scored_pairs = list(zip(scores, chunks))
            scored_pairs.sort(key=lambda pair: pair[0], reverse=True)

            ranked_chunks = [chunk for _, chunk in scored_pairs]
            return ranked_chunks[:top_k]
        except Exception as e:
            logger.warning("Error during cross-encoder reranking: %s. Using candidate order.", e)
            return list(chunks)[:top_k]
