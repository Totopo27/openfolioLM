from __future__ import annotations
from typing import Optional
from app.core.models import DocumentChunk


def reciprocal_rank_fusion(
    *ranking_lists: list[DocumentChunk],
    k: int = 60,
    top_k: Optional[int] = None
) -> list[DocumentChunk]:
    """
    Combines multiple rankings of DocumentChunks using Reciprocal Rank Fusion (RRF).

    Score formula for item d:
        RRF(d) = sum(1.0 / (k + rank_m(d))) for each list m where d appears,
        where rank is 1-based index (1, 2, 3, ...).

    Items appearing near the top of multiple modalities receive the highest consensus boost.
    """
    scores: dict[str, float] = {}
    chunk_map: dict[str, DocumentChunk] = {}

    for ranked_chunks in ranking_lists:
        for rank_idx, chunk in enumerate(ranked_chunks, start=1):
            if chunk.id not in chunk_map:
                chunk_map[chunk.id] = chunk
            rrf_val = 1.0 / (k + rank_idx)
            scores[chunk.id] = scores.get(chunk.id, 0.0) + rrf_val

    sorted_ids = sorted(scores.keys(), key=lambda cid: scores[cid], reverse=True)

    if top_k is not None:
        sorted_ids = sorted_ids[:top_k]

    return [chunk_map[cid] for cid in sorted_ids]
