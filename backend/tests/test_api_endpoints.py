import io
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.adapters.sqlite_store import SQLiteDocumentStore
from app.adapters.grounded_synthesizer import GroundedSynthesizer


class MockLLM:
    def generate(self, system_prompt: str, user_prompt: str) -> str:
        if "timeout" in user_prompt.lower():
            return "The session timeout is 15 minutes [^1]."
        return "The provided active documents do not contain information to answer this query."


@pytest.fixture
def client():
    # Setup app with in-memory DB and mock LLM
    test_store = SQLiteDocumentStore(db_path=":memory:")
    test_synthesizer = GroundedSynthesizer(llm_client=MockLLM())
    app = create_app(store=test_store, synthesizer=test_synthesizer)
    return TestClient(app)


def test_upload_and_list_sources(client):
    file_content = b"# Document Title\n\nThe session timeout is 15 minutes."
    response = client.post(
        "/api/sources/upload",
        files={"file": ("guide.md", io.BytesIO(file_content), "text/markdown")}
    )
    assert response.status_code == 200
    doc_data = response.json()
    assert doc_data["filename"] == "guide.md"
    assert "Document Title" in doc_data["raw_markdown"]
    source_id = doc_data["id"]

    # List sources
    list_res = client.get("/api/sources")
    assert list_res.status_code == 200
    sources = list_res.json()
    assert len(sources) == 1
    assert sources[0]["id"] == source_id

    # Get single source
    get_res = client.get(f"/api/sources/{source_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == source_id


def test_grounded_chat_flow(client):
    # Upload source
    file_content = b"# Security Spec\n\nThe session timeout is 15 minutes."
    upload_res = client.post(
        "/api/sources/upload",
        files={"file": ("spec.md", io.BytesIO(file_content), "text/markdown")}
    )
    source_id = upload_res.json()["id"]

    # Query with active source
    chat_res = client.post(
        "/api/chat",
        json={
            "query": "What is the timeout?",
            "active_source_ids": [source_id]
        }
    )
    assert chat_res.status_code == 200
    chat_data = chat_res.json()
    assert chat_data["evidence_found"] is True
    assert "[^1]" in chat_data["answer"]
    assert len(chat_data["citations"]) == 1
    assert chat_data["citations"][0]["source_id"] == source_id

    # Query with inactive source (empty active_source_ids)
    chat_res_empty = client.post(
        "/api/chat",
        json={
            "query": "What is the timeout?",
            "active_source_ids": []
        }
    )
    assert chat_res_empty.status_code == 200
    chat_data_empty = chat_res_empty.json()
    assert chat_data_empty["evidence_found"] is False
    assert len(chat_data_empty["citations"]) == 0
