import pytest
from app.core.models import SourceDocument, DocumentChunk
from app.adapters.sqlite_store import SQLiteDocumentStore


@pytest.fixture
def store():
    # Use in-memory SQLite for fast, isolated tests
    return SQLiteDocumentStore(db_path=":memory:")


def test_add_and_list_documents(store):
    doc1 = SourceDocument(id="doc_1", filename="file1.md", raw_markdown="# Heading 1\nSome text here.")
    chunks1 = [
        DocumentChunk(id="doc_1#c0", source_id="doc_1", start_char=0, end_char=26, content="# Heading 1\nSome text here.")
    ]
    store.add_document(doc1, chunks1)

    docs = store.list_documents()
    assert len(docs) == 1
    assert docs[0].id == "doc_1"
    assert docs[0].filename == "file1.md"


def test_get_and_delete_document(store):
    doc1 = SourceDocument(id="doc_1", filename="file1.md", raw_markdown="Content 1")
    chunks1 = [DocumentChunk(id="doc_1#c0", source_id="doc_1", start_char=0, end_char=9, content="Content 1")]
    store.add_document(doc1, chunks1)

    retrieved = store.get_document("doc_1")
    assert retrieved is not None
    assert retrieved.id == "doc_1"

    deleted = store.delete_document("doc_1")
    assert deleted is True
    assert store.get_document("doc_1") is None
    assert len(store.list_documents()) == 0


def test_search_strictly_respects_active_source_ids(store):
    doc1 = SourceDocument(id="doc_1", filename="auth.md", raw_markdown="OAuth2 authentication and JWT token security.")
    chunks1 = [
        DocumentChunk(id="doc_1#c0", source_id="doc_1", start_char=0, end_char=46, content="OAuth2 authentication and JWT token security.")
    ]

    doc2 = SourceDocument(id="doc_2", filename="billing.md", raw_markdown="Stripe payment gateway integration and invoices.")
    chunks2 = [
        DocumentChunk(id="doc_2#c0", source_id="doc_2", start_char=0, end_char=48, content="Stripe payment gateway integration and invoices.")
    ]

    store.add_document(doc1, chunks1)
    store.add_document(doc2, chunks2)

    # When querying for "token" with ONLY doc_2 active -> MUST RETURN EMPTY (zero leakage!)
    results_doc2_only = store.search_chunks(query="token", active_source_ids=["doc_2"], top_k=5)
    assert len(results_doc2_only) == 0

    # When querying for "token" with doc_1 active -> MUST RETURN doc_1#c0
    results_doc1 = store.search_chunks(query="token", active_source_ids=["doc_1"], top_k=5)
    assert len(results_doc1) == 1
    assert results_doc1[0].id == "doc_1#c0"

    # When active_source_ids is empty -> MUST RETURN EMPTY
    results_empty = store.search_chunks(query="token", active_source_ids=[], top_k=5)
    assert len(results_empty) == 0


def test_search_filters_stopwords_in_natural_language_query(store):
    doc = SourceDocument(id="doc_story", filename="story.md", raw_markdown="Text")
    chunk_noise = DocumentChunk(
        id="doc_story#c1",
        source_id="doc_story",
        start_char=0,
        end_char=50,
        content="Esta es una cosa y que es muy común en todas partes."
    )
    chunk_target = DocumentChunk(
        id="doc_story#c2",
        source_id="doc_story",
        start_char=51,
        end_char=100,
        content="Daduic es una ciudad mágica e invertida en los mapas."
    )
    store.add_document(doc, [chunk_noise, chunk_target])

    # Query with stopwords: "¿qué es Daduic?"
    results = store.search_chunks("¿qué es Daduic?", ["doc_story"], top_k=1)
    assert len(results) == 1
    assert results[0].id == "doc_story#c2"
    assert "Daduic" in results[0].content
