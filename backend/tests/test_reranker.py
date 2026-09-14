"""Unit tests for CrossEncoderReranker adapter."""

from unittest.mock import MagicMock
import pytest
from app.core.models import DocumentChunk
from app.adapters.cross_encoder_reranker import CrossEncoderReranker


def _make_chunk(chunk_id: str, content: str) -> DocumentChunk:
    return DocumentChunk(
        id=chunk_id,
        source_id="doc_1",
        start_char=0,
        end_char=len(content),
        content=content
    )


def test_reranker_sorts_chunks_by_score():
    chunk_low = _make_chunk("c1", "Unrelated noise about weather")
    chunk_high = _make_chunk("c2", "The CEO's annual compensation was 2.5 million dollars")
    chunk_mid = _make_chunk("c3", "Executive board meetings occur quarterly")

    mock_encoder = MagicMock()
    # Return scores: c1 -> 0.1, c2 -> 0.95, c3 -> 0.4
    mock_encoder.rerank.return_value = [0.1, 0.95, 0.4]

    reranker = CrossEncoderReranker(encoder_instance=mock_encoder)
    ranked = reranker.rerank(
        query="What is the CEO salary?",
        chunks=[chunk_low, chunk_high, chunk_mid],
        top_k=2
    )

    assert len(ranked) == 2
    # Highest score (c2) should be first
    assert ranked[0].id == "c2"
    # Second highest (c3) should be second
    assert ranked[1].id == "c3"


def test_reranker_honors_top_k():
    chunks = [_make_chunk(f"c{i}", f"Paragraph content {i}") for i in range(10)]
    mock_encoder = MagicMock()
    mock_encoder.rerank.return_value = [float(i) for i in range(10)]

    reranker = CrossEncoderReranker(encoder_instance=mock_encoder)
    ranked = reranker.rerank(query="Test query", chunks=chunks, top_k=3)

    assert len(ranked) == 3
    assert ranked[0].id == "c9"
    assert ranked[1].id == "c8"
    assert ranked[2].id == "c7"


def test_reranker_empty_or_single_chunk():
    mock_encoder = MagicMock()
    reranker = CrossEncoderReranker(encoder_instance=mock_encoder)

    # Empty
    assert reranker.rerank("Query", [], top_k=4) == []
    assert not mock_encoder.rerank.called

    # Single chunk
    single = _make_chunk("c1", "Only one chunk")
    result = reranker.rerank("Query", [single], top_k=4)
    assert len(result) == 1
    assert result[0].id == "c1"
    # Should short-circuit without calling encoder
    assert not mock_encoder.rerank.called


def test_reranker_fallback_on_encoder_error():
    c1 = _make_chunk("c1", "First chunk")
    c2 = _make_chunk("c2", "Second chunk")

    mock_encoder = MagicMock()
    mock_encoder.rerank.side_effect = RuntimeError("ONNX inference failed")

    reranker = CrossEncoderReranker(encoder_instance=mock_encoder)
    result = reranker.rerank("Query", [c1, c2], top_k=2)

    # Should gracefully return original candidate order
    assert len(result) == 2
    assert result[0].id == "c1"
    assert result[1].id == "c2"


def test_reranker_fallback_when_encoder_is_none():
    c1 = _make_chunk("c1", "First chunk")
    c2 = _make_chunk("c2", "Second chunk")

    reranker = CrossEncoderReranker(encoder_instance=None)
    # Force _ensure_encoder to return None
    reranker._ensure_encoder = lambda: None

    result = reranker.rerank("Query", [c1, c2], top_k=1)
    assert len(result) == 1
    assert result[0].id == "c1"
