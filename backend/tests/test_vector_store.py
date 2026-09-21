import os
import shutil
import pytest
from app.core.models import DocumentChunk
from app.adapters.lancedb_store import LanceDBVectorStore


class MockEmbeddingModel:
    """Deterministic embedding model for fast unit testing."""
    def __init__(self, dim: int = 4):
        self.dim = dim

    def embed(self, texts):
        for text in texts:
            # Deterministic vector based on content
            if "python" in text.lower():
                yield [1.0, 0.0, 0.0, 0.0]
            elif "rust" in text.lower():
                yield [0.0, 1.0, 0.0, 0.0]
            elif "javascript" in text.lower():
                yield [0.0, 0.0, 1.0, 0.0]
            else:
                yield [0.1, 0.1, 0.1, 0.1]


@pytest.fixture
def tmp_vector_dir(tmp_path):
    vec_dir = str(tmp_path / "test_vectors.lance")
    yield vec_dir
    if os.path.exists(vec_dir):
        shutil.rmtree(vec_dir, ignore_errors=True)


def _make_chunk(chunk_id: str, source_id: str, content: str) -> DocumentChunk:
    return DocumentChunk(
        id=chunk_id,
        source_id=source_id,
        heading_hierarchy=["# Section 1"],
        start_char=0,
        end_char=len(content),
        content=content,
        token_estimate=max(1, len(content) // 4)
    )


def test_empty_store_search(tmp_vector_dir):
    store = LanceDBVectorStore(db_dir=tmp_vector_dir, embedding_model=MockEmbeddingModel())
    results = store.search_vectors("python", active_source_ids=["doc1"])
    assert results == []


def test_add_and_search_vectors(tmp_vector_dir):
    store = LanceDBVectorStore(db_dir=tmp_vector_dir, embedding_model=MockEmbeddingModel())
    c1 = _make_chunk("doc1#c0", "doc1", "Python programming language and async asyncio")
    c2 = _make_chunk("doc2#c0", "doc2", "Rust language memory safety borrow checker")
    c3 = _make_chunk("doc3#c0", "doc3", "JavaScript React frontend development")

    store.add_chunks([c1, c2, c3])

    # Search for python across all sources
    results = store.search_vectors("python", active_source_ids=["doc1", "doc2", "doc3"], top_k=2)
    assert len(results) > 0
    top_chunk, dist = results[0]
    assert top_chunk.id == "doc1#c0"
    assert top_chunk.content == c1.content
    assert top_chunk.source_id == "doc1"
    assert top_chunk.heading_hierarchy == ["# Section 1"]


def test_search_source_filtering(tmp_vector_dir):
    store = LanceDBVectorStore(db_dir=tmp_vector_dir, embedding_model=MockEmbeddingModel())
    c1 = _make_chunk("doc1#c0", "doc1", "Python programming language")
    c2 = _make_chunk("doc2#c0", "doc2", "Python is also here in doc2")

    store.add_chunks([c1, c2])

    # Only doc1 is active
    results = store.search_vectors("python", active_source_ids=["doc1"], top_k=5)
    assert len(results) == 1
    assert results[0][0].id == "doc1#c0"


def test_delete_document_chunks(tmp_vector_dir):
    store = LanceDBVectorStore(db_dir=tmp_vector_dir, embedding_model=MockEmbeddingModel())
    c1 = _make_chunk("doc1#c0", "doc1", "Python programming language")
    c2 = _make_chunk("doc2#c0", "doc2", "Rust memory safety")

    store.add_chunks([c1, c2])

    # Delete doc1
    store.delete_document_chunks("doc1")

    results = store.search_vectors("python", active_source_ids=["doc1", "doc2"])
    # doc1 is deleted, so no doc1 chunks should remain
    assert all(chunk.source_id != "doc1" for chunk, _ in results)


def test_real_fastembed_integration(tmp_vector_dir):
    """Integration test with the real ONNX multilingual embedding model."""
    store = LanceDBVectorStore(db_dir=tmp_vector_dir)
    c1 = _make_chunk(
        "paper1#c0",
        "paper1",
        "El aprendizaje automático y los transformadores neuronales permiten analizar grandes colecciones de documentos."
    )
    c2 = _make_chunk(
        "paper2#c0",
        "paper2",
        "Recetas tradicionales de cocina italiana y preparación de pastas artesanales."
    )

    store.add_chunks([c1, c2])

    # Query in Spanish semantically related to machine learning
    results = store.search_vectors(
        query="inteligencia artificial y modelos de lenguaje",
        active_source_ids=["paper1", "paper2"],
        top_k=2
    )

    assert len(results) > 0
    top_chunk, dist = results[0]
    # The machine learning paper must be ranked #1
    assert top_chunk.source_id == "paper1"
    assert store.get_dimension() == 768


def test_dimension_mismatch_rejects_write(tmp_vector_dir):
    """Test that LanceDB rejects writes when embedding dimensions change instead of silently dropping data."""
    # Step 1: Create table with 4-dimensional mock model
    store_4d = LanceDBVectorStore(db_dir=tmp_vector_dir, embedding_model=MockEmbeddingModel(dim=4))
    c1 = _make_chunk("doc1#c0", "doc1", "Python code")
    store_4d.add_chunks([c1])
    assert store_4d.check_dimension_match() is True

    # Step 2: Attempt to add with 6-dimensional model -- must reject, not drop
    class Mock6D:
        def embed(self, texts):
            for _ in texts:
                yield [1.0, 0.0, 0.0, 0.0, 0.0, 0.0]

    store_6d = LanceDBVectorStore(db_dir=tmp_vector_dir, embedding_model=Mock6D())
    c2 = _make_chunk("doc2#c0", "doc2", "Rust code")
    import pytest
    with pytest.raises(ValueError, match="dimension mismatch"):
        store_6d.add_chunks([c2])

    # Original doc1 vectors must still exist (no silent data loss)
    results = store_4d.search_vectors("Python", active_source_ids=["doc1"])
    assert len(results) == 1
    assert results[0][0].id == "doc1#c0"


def test_rebuild_table_with_chunks(tmp_vector_dir):
    store = LanceDBVectorStore(db_dir=tmp_vector_dir, embedding_model=MockEmbeddingModel())
    c1 = _make_chunk("doc1#c0", "doc1", "Python code")
    store.add_chunks([c1])

    c2 = _make_chunk("doc2#c0", "doc2", "Rust code")
    store.rebuild_table_with_chunks([c2])

    # doc1 should be gone, doc2 should be present
    res_doc1 = store.search_vectors("python", active_source_ids=["doc1"])
    assert res_doc1 == []

    res_doc2 = store.search_vectors("rust", active_source_ids=["doc2"])
    assert len(res_doc2) == 1
    assert res_doc2[0][0].id == "doc2#c0"


def test_e5_prefix_formatting(tmp_vector_dir):
    store = LanceDBVectorStore(
        db_dir=tmp_vector_dir,
        embedding_model_name="intfloat/multilingual-e5-large",
        embedding_model=MockEmbeddingModel()
    )
    assert store._format_text("texto del documento", is_query=False) == "passage: texto del documento"
    assert store._format_text("consulta de usuario", is_query=True) == "query: consulta de usuario"
    # Should not duplicate prefix
    assert store._format_text("query: ya tiene prefijo", is_query=True) == "query: ya tiene prefijo"


def test_schema_evolution_page_number(tmp_vector_dir):
    import pyarrow as pa
    import lancedb

    # Manually create table with old schema (no page_number)
    db = lancedb.connect(tmp_vector_dir)
    old_schema = pa.schema([
        pa.field("chunk_id", pa.string()),
        pa.field("source_id", pa.string()),
        pa.field("heading_hierarchy_json", pa.string()),
        pa.field("start_char", pa.int64()),
        pa.field("end_char", pa.int64()),
        pa.field("content", pa.string()),
        pa.field("token_estimate", pa.int64()),
        pa.field("vector", pa.list_(pa.float32(), 4)),
    ])
    initial_data = [{
        "chunk_id": "old_1",
        "source_id": "doc_old",
        "heading_hierarchy_json": "[]",
        "start_char": 0,
        "end_char": 10,
        "content": "Python old",
        "token_estimate": 2,
        "vector": [1.0, 0.0, 0.0, 0.0]
    }]
    db.create_table("chunks", schema=old_schema, data=initial_data)

    store = LanceDBVectorStore(db_dir=tmp_vector_dir, embedding_model=MockEmbeddingModel())
    new_chunk = DocumentChunk(
        id="new_1",
        source_id="doc_new",
        heading_hierarchy=["# Page 5"],
        start_char=100,
        end_char=200,
        content="Python new content",
        token_estimate=5,
        page_number=5,
    )

    # This should seamlessly evolve schema and not crash
    store.add_chunks([new_chunk])

    res = store.search_vectors("Python", active_source_ids=["doc_new"])
    assert len(res) == 1
    assert res[0][0].id == "new_1"
    assert res[0][0].page_number == 5


