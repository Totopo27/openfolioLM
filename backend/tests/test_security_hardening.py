from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.adapters.project_manager import ProjectManager
from app.adapters.sqlite_store import SQLiteDocumentStore
from app.api.routes_projects import (
    DocumentPersistenceError,
    _persist_document_with_rollback,
    _safe_upload_filename,
)
from app.core.models import DocumentChunk, SourceDocument
from app.main import create_app


class InMemoryVectorStore:
    def __init__(self, fail_adds: int = 0):
        self.fail_adds = fail_adds
        self.chunks: dict[str, list[DocumentChunk]] = {}

    def delete_document_chunks(self, source_id: str) -> None:
        self.chunks.pop(source_id, None)

    def add_chunks(self, chunks: list[DocumentChunk]) -> None:
        if self.fail_adds:
            self.fail_adds -= 1
            raise RuntimeError("synthetic vector failure")
        for chunk in chunks:
            self.chunks.setdefault(chunk.source_id, []).append(chunk)


class StubProjectManager(ProjectManager):
    def __init__(self, projects_root: str):
        super().__init__(projects_root=projects_root, legacy_db_path=None)
        self.test_vector_store = InMemoryVectorStore()

    def get_vector_store(self, project_id: str) -> InMemoryVectorStore:
        self.validate_project_id(project_id)
        return self.test_vector_store


def _document(content: str) -> tuple[SourceDocument, list[DocumentChunk]]:
    document = SourceDocument(id="doc_atomic", filename="atomic.md", raw_markdown=content)
    chunk = DocumentChunk(
        id="doc_atomic#c0",
        source_id=document.id,
        start_char=0,
        end_char=len(content),
        content=content,
    )
    return document, [chunk]


@pytest.mark.parametrize(
    ("untrusted", "expected"),
    [
        ("../escape.txt", "escape.txt"),
        (r"..\escape.txt", "escape.txt"),
        ("folder/document.pdf", "document.pdf"),
    ],
)
def test_upload_filename_is_reduced_to_a_basename(untrusted, expected):
    assert _safe_upload_filename(untrusted) == expected


def test_failed_vector_write_restores_previous_sqlite_document():
    store = SQLiteDocumentStore(":memory:")
    old_document, old_chunks = _document("old content")
    new_document, new_chunks = _document("new content")
    store.add_document(old_document, old_chunks)

    vector_store = InMemoryVectorStore(fail_adds=1)
    with pytest.raises(DocumentPersistenceError):
        _persist_document_with_rollback(store, vector_store, new_document, new_chunks)

    restored = store.get_document(old_document.id)
    assert restored is not None
    assert restored.raw_markdown == "old content"
    assert [chunk.content for chunk in store.get_document_chunks(old_document.id)] == [
        "old content"
    ]
    assert [chunk.content for chunk in vector_store.chunks[old_document.id]] == [
        "old content"
    ]


def test_upload_cannot_write_outside_project_uploads(tmp_path):
    manager = StubProjectManager(str(tmp_path / "projects"))
    client = TestClient(create_app(project_manager=manager))
    project = client.post("/api/projects", json={"name": "Secure Upload"}).json()

    response = client.post(
        f"/api/projects/{project['id']}/sources/upload",
        files={"file": ("../escape.txt", b"safe content", "text/plain")},
    )

    assert response.status_code == 200
    assert response.json()["filename"] == "escape.txt"
    assert not (tmp_path / "escape.txt").exists()
    uploads = Path(manager.get_uploads_dir(project["id"]))
    assert len(list(uploads.iterdir())) == 1


def test_cors_allows_local_frontend_and_rejects_untrusted_origin(tmp_path):
    manager = StubProjectManager(str(tmp_path / "projects"))
    client = TestClient(create_app(project_manager=manager))
    preflight_headers = {"Access-Control-Request-Method": "POST"}

    allowed = client.options(
        "/api/projects",
        headers={"Origin": "http://localhost:5173", **preflight_headers},
    )
    rejected = client.options(
        "/api/projects",
        headers={"Origin": "https://attacker.example", **preflight_headers},
    )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "access-control-allow-origin" not in rejected.headers


def test_invalid_project_identifier_returns_not_found(tmp_path):
    manager = StubProjectManager(str(tmp_path / "projects"))
    client = TestClient(create_app(project_manager=manager))

    response = client.get("/api/projects/not_a_project")

    assert response.status_code == 404
