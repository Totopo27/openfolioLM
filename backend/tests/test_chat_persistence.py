import pytest
from app.core.models import ChatMessageRecord, Citation
from app.adapters.sqlite_store import SQLiteDocumentStore


@pytest.fixture
def store():
    return SQLiteDocumentStore(db_path=":memory:")


def test_save_and_retrieve_chat_messages(store):
    user_msg = ChatMessageRecord(
        id="msg_1",
        conversation_id="default",
        sender="user",
        text="¿Cuál es el autor del libro?"
    )
    store.save_message(user_msg)

    citation = Citation(
        index=1,
        chunk_id="doc_1#c0",
        source_id="doc_1",
        source_filename="libro.md",
        heading_path=["Capítulo 1"],
        start_char=10,
        end_char=50,
        quote_snippet="Rafael Ángel Herra"
    )
    assistant_msg = ChatMessageRecord(
        id="msg_2",
        conversation_id="default",
        sender="assistant",
        text="El autor es Rafael Ángel Herra [^1].",
        citations=[citation],
        evidence_found=True,
        active_sources_consulted=["doc_1"],
        factual_score=0.92,
        hallucination_risk="low"
    )
    store.save_message(assistant_msg)

    messages = store.get_messages(conversation_id="default")
    assert len(messages) == 2
    assert messages[0].id == "msg_1"
    assert messages[0].sender == "user"
    assert messages[1].id == "msg_2"
    assert messages[1].sender == "assistant"
    assert len(messages[1].citations) == 1
    assert messages[1].citations[0].chunk_id == "doc_1#c0"
    assert messages[1].citations[0].start_char == 10
    assert messages[1].evidence_found is True
    assert messages[1].factual_score == 0.92
    assert messages[1].hallucination_risk == "low"


def test_clear_chat_messages(store):
    msg = ChatMessageRecord(
        id="msg_1",
        conversation_id="default",
        sender="user",
        text="Hola"
    )
    store.save_message(msg)
    assert len(store.get_messages("default")) == 1

    store.clear_messages("default")
    assert len(store.get_messages("default")) == 0


def test_isolated_project_databases_do_not_leak_messages():
    store_proj_a = SQLiteDocumentStore(db_path=":memory:")
    store_proj_b = SQLiteDocumentStore(db_path=":memory:")

    msg_a = ChatMessageRecord(
        id="msg_a",
        conversation_id="default",
        sender="user",
        text="Pregunta para Proyecto A"
    )
    store_proj_a.save_message(msg_a)

    assert len(store_proj_a.get_messages("default")) == 1
    assert len(store_proj_b.get_messages("default")) == 0
