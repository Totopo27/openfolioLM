import io
import shutil
import tempfile
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.adapters.project_manager import ProjectManager
from app.adapters.grounded_synthesizer import GroundedSynthesizer


class MockLLM:
    def generate(self, system_prompt: str, user_prompt: str) -> str:
        if "autor" in user_prompt.lower():
            return "El autor es Rafael Herra [^1]."
        return "The provided active documents do not contain information to answer this query."


@pytest.fixture
def client_and_manager():
    temp_dir = tempfile.mkdtemp()
    mgr = ProjectManager(projects_root=temp_dir, legacy_db_path=None)
    synthesizer = GroundedSynthesizer(llm_client=MockLLM())
    app = create_app(project_manager=mgr, synthesizer=synthesizer)
    client = TestClient(app)
    yield client, mgr
    shutil.rmtree(temp_dir, ignore_errors=True)


def test_project_crud_and_isolated_chat(client_and_manager):
    client, mgr = client_and_manager

    # 1. Create Project
    create_res = client.post("/api/projects", json={"name": "Novela Edipo", "description": "Estudio"})
    assert create_res.status_code == 200
    proj = create_res.json()
    proj_id = proj["id"]
    assert proj["name"] == "Novela Edipo"

    # 2. Upload file into Project
    file_content = b"# Novela\n\nEl autor de la obra es Rafael Herra."
    upload_res = client.post(
        f"/api/projects/{proj_id}/sources/upload",
        files={"file": ("novela.md", io.BytesIO(file_content), "text/markdown")}
    )
    assert upload_res.status_code == 200
    source_id = upload_res.json()["id"]

    # 3. Chat within Project
    chat_res = client.post(
        f"/api/projects/{proj_id}/chat",
        json={"query": "¿Quién es el autor?", "active_source_ids": [source_id]}
    )
    assert chat_res.status_code == 200
    ans = chat_res.json()
    assert ans["evidence_found"] is True
    assert "[^1]" in ans["answer"]

    # 4. Verify Persistent Messages were saved
    msg_res = client.get(f"/api/projects/{proj_id}/messages")
    assert msg_res.status_code == 200
    messages = msg_res.json()
    assert len(messages) == 2  # 1 user + 1 assistant
    assert messages[0]["sender"] == "user"
    assert messages[1]["sender"] == "assistant"
    assert len(messages[1]["citations"]) == 1

    # 5. Clear messages
    del_msg_res = client.delete(f"/api/projects/{proj_id}/messages")
    assert del_msg_res.status_code == 200
    assert len(client.get(f"/api/projects/{proj_id}/messages").json()) == 0

    # 6. Delete Project
    del_proj_res = client.delete(f"/api/projects/{proj_id}")
    assert del_proj_res.status_code == 200
    remaining_ids = [p["id"] for p in client.get("/api/projects").json()]
    assert proj_id not in remaining_ids


def test_upload_code_repository_and_chat(client_and_manager):
    import zipfile
    client, mgr = client_and_manager

    # 1. Create Project
    create_res = client.post("/api/projects", json={"name": "Software Repo", "description": "Backend API"})
    assert create_res.status_code == 200
    proj_id = create_res.json()["id"]

    # 2. Build in-memory zip
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w") as zf:
        zf.writestr("app/auth.py", "def verify_signature(token: str):\n    # Author: Rafael Herra\n    return token != ''\n")
        zf.writestr("README.md", "# Auth Service\nAuthentication documentation.")
    zip_bytes = zip_buf.getvalue()

    # 3. Upload zip to project
    upload_res = client.post(
        f"/api/projects/{proj_id}/sources/upload",
        files={"file": ("auth_service.zip", io.BytesIO(zip_bytes), "application/zip")}
    )
    assert upload_res.status_code == 200
    doc = upload_res.json()
    assert doc["metadata"]["is_repo"] is True
    assert doc["metadata"]["file_count"] == 2
    assert "app/auth.py" in doc["metadata"]["files"]

    # 4. Search and chat with the repository
    chat_res = client.post(
        f"/api/projects/{proj_id}/chat",
        json={"query": "¿Quién es el autor?", "active_source_ids": [doc["id"]]}
    )
    assert chat_res.status_code == 200
    ans = chat_res.json()
    assert ans["evidence_found"] is True
    assert "[^1]" in ans["answer"]
    assert len(ans["citations"]) >= 1
    assert "auth_service.zip" in ans["citations"][0]["source_filename"]


def test_project_chat_with_custom_reranker():
    from unittest.mock import MagicMock
    temp_dir = tempfile.mkdtemp()
    try:
        mgr = ProjectManager(projects_root=temp_dir, legacy_db_path=None)
        synthesizer = GroundedSynthesizer(llm_client=MockLLM())
        mock_reranker = MagicMock()
        mock_reranker.rerank.side_effect = lambda query, chunks, top_k: list(chunks)[:top_k]

        app = create_app(project_manager=mgr, synthesizer=synthesizer, reranker=mock_reranker)
        client = TestClient(app)

        proj = client.post("/api/projects", json={"name": "Reranker Test"}).json()
        doc = client.post(
            f"/api/projects/{proj['id']}/sources/upload",
            files={"file": ("doc.txt", io.BytesIO(b"El autor es Rafael Herra."), "text/plain")}
        ).json()

        chat_res = client.post(
            f"/api/projects/{proj['id']}/chat",
            json={"query": "autor", "active_source_ids": [doc["id"]]}
        )
        assert chat_res.status_code == 200
        # Verify reranker was invoked
        assert mock_reranker.rerank.called
        call_args = mock_reranker.rerank.call_args
        assert call_args[1]["query"] == "autor" or call_args[0][0] == "autor"
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


