import pytest
from app.core.models import DocumentChunk
from app.core.fusion import reciprocal_rank_fusion


def _make_chunk(chunk_id: str, source_id: str = "src1", content: str = "text") -> DocumentChunk:
    return DocumentChunk(
        id=chunk_id,
        source_id=source_id,
        heading_hierarchy=[],
        start_char=0,
        end_char=len(content),
        content=content,
        token_estimate=5
    )


def test_rrf_empty_lists():
    result = reciprocal_rank_fusion([], [])
    assert result == []


def test_rrf_single_list():
    c1 = _make_chunk("c1")
    c2 = _make_chunk("c2")
    result = reciprocal_rank_fusion([c1, c2], [])
    assert [c.id for c in result] == ["c1", "c2"]


def test_rrf_overlap_boosts_consensus():
    # c1 is #1 in fts, #3 in vec
    # c2 is #2 in fts, #1 in vec
    # c3 is #3 in fts only
    # c4 is #2 in vec only
    c1 = _make_chunk("c1")
    c2 = _make_chunk("c2")
    c3 = _make_chunk("c3")
    c4 = _make_chunk("c4")

    fts_list = [c1, c2, c3]
    vec_list = [c2, c4, c1]

    # c2: rank 2 in FTS (1/62), rank 1 in VEC (1/61) => ~0.03252
    # c1: rank 1 in FTS (1/61), rank 3 in VEC (1/63) => ~0.03226
    # c4: rank 2 in VEC (1/62) => ~0.01613
    # c3: rank 3 in FTS (1/63) => ~0.01587
    merged = reciprocal_rank_fusion(fts_list, vec_list, k=60)
    assert [c.id for c in merged] == ["c2", "c1", "c4", "c3"]


def test_rrf_top_k():
    chunks = [_make_chunk(f"c{i}") for i in range(10)]
    result = reciprocal_rank_fusion(chunks, [], top_k=3)
    assert len(result) == 3
    assert [c.id for c in result] == ["c0", "c1", "c2"]
