import os
import time
import pytest
from fastapi.testclient import TestClient
from app.adapters.task_manager import IngestionTaskManager, IngestionTask
from app.adapters.project_manager import ProjectManager
from app.api.routes_projects import create_projects_router
from app.ports.ingester import IngestionPort
from app.ports.chunker import ChunkerPort
from app.ports.synthesizer import SynthesizerPort
from app.core.models import SourceDocument, DocumentChunk, Project


class DummyIngester(IngestionPort):
    def convert(self, file_path: str, filename: str, source_id: str | None = None) -> SourceDocument:
        return SourceDocument(
            id=source_id or "doc_dummy123",
            filename=filename,
            mime_type="application/pdf",
            raw_markdown="# Dummy Content\nSome extracted text here.",
            char_count=35,
        )

    def ingest_url(self, url: str, source_id: str | None = None, title_override: str | None = None) -> SourceDocument:
        return SourceDocument(
            id=source_id or "doc_dummy_url",
            filename=title_override or "dummy_url.md",
            mime_type="text/markdown",
            raw_markdown="# Dummy URL",
            char_count=11,
        )


class DummyChunker(ChunkerPort):
    def chunk(self, doc: SourceDocument) -> list[DocumentChunk]:
        return [
            DocumentChunk(
                id=f"{doc.id}_chunk_0",
                source_id=doc.id,
                source_filename=doc.filename,
                content="Some extracted text here.",
                start_char=0,
                end_char=25,
            )
        ]


class DummySynthesizer(SynthesizerPort):
    def synthesize(self, query: str, context_chunks: list[DocumentChunk]) -> str:
        return "Dummy answer"


def test_task_manager_lifecycle():
    manager = IngestionTaskManager(max_workers=1)
    task = manager.create_task("proj_test1", "book.pdf", 1024)
    assert task.id.startswith("task_")
    assert task.filename == "book.pdf"
    assert task.stage == "queued"
    assert task.progress == 5

    # Check listing
    tasks = manager.list_project_tasks("proj_test1")
    assert len(tasks) == 1
    assert tasks[0].id == task.id

    # Check update
    updated = manager.update_task(task.id, progress=50, stage="embedding", status_text="Calculando vectores...")
    assert updated is not None
    assert updated.progress == 50
    assert updated.stage == "embedding"
    assert updated.status_text == "Calculando vectores..."

    # Check dismissal
    assert manager.dismiss_task(task.id) is True
    assert manager.get_task(task.id) is None
    assert len(manager.list_project_tasks("proj_test1")) == 0


def test_task_manager_async_execution():
    manager = IngestionTaskManager(max_workers=1)
    task = manager.create_task("proj_test2", "manual.pdf", 2048)

    done_flag = []

    def mock_job(reporter):
        reporter(30, "extracting", "Extrayendo...")
        time.sleep(0.05)
        reporter(80, "embedding", "Vectores...")
        return "done_doc"

    manager.submit_ingestion(
        task_id=task.id,
        ingest_fn=mock_job,
        on_success=lambda doc: done_flag.append(doc),
    )

    # Wait for completion
    timeout = 3.0
    start = time.time()
    while time.time() - start < timeout:
        t = manager.get_task(task.id)
        if t and t.stage == "done":
            break
        time.sleep(0.05)

    final_task = manager.get_task(task.id)
    assert final_task is not None
    assert final_task.stage == "done"
    assert final_task.progress == 100
    assert len(done_flag) == 1


def test_background_upload_route(tmp_path):
    projects_dir = tmp_path / "projects"
    project_manager = ProjectManager(projects_root=str(projects_dir))
    proj = project_manager.create_project("Test Background Upload")

    ingester = DummyIngester()
    chunker = DummyChunker()
    synthesizer = DummySynthesizer()

    from fastapi import FastAPI
    app = FastAPI()
    router = create_projects_router(
        project_manager=project_manager,
        ingester=ingester,
        chunker=chunker,
        synthesizer=synthesizer,
    )
    app.include_router(router)
    client = TestClient(app)

    # 1. Upload in background mode
    file_content = b"%PDF-1.4 dummy pdf content for testing background indexing"
    resp = client.post(
        f"/api/projects/{proj.id}/sources/upload?background=true",
        files={"file": ("test_doc.pdf", file_content, "application/pdf")},
    )
    assert resp.status_code == 202
    data = resp.json()
    assert "id" in data
    assert data["filename"] == "test_doc.pdf"
    assert data["stage"] in ("queued", "extracting", "done")
    task_id = data["id"]

    # 2. List tasks
    list_resp = client.get(f"/api/projects/{proj.id}/tasks")
    assert list_resp.status_code == 200
    tasks = list_resp.json()
    assert any(t["id"] == task_id for t in tasks)

    # 3. Poll until done
    timeout = 5.0
    start = time.time()
    completed = False
    while time.time() - start < timeout:
        get_resp = client.get(f"/api/projects/{proj.id}/tasks/{task_id}")
        assert get_resp.status_code == 200
        t_data = get_resp.json()
        if t_data["stage"] == "done":
            completed = True
            break
        time.sleep(0.05)

    assert completed, f"Task did not complete in time, state: {t_data}"

    # 4. Verify document now exists in project sources
    sources_resp = client.get(f"/api/projects/{proj.id}/sources")
    assert sources_resp.status_code == 200
    sources = sources_resp.json()
    assert len(sources) == 1
    assert sources[0]["filename"] == "test_doc.pdf"

    # 5. Dismiss task
    del_resp = client.delete(f"/api/projects/{proj.id}/tasks/{task_id}")
    assert del_resp.status_code == 200
    assert del_resp.json()["status"] == "dismissed"

    # Task should now not be listed
    list_after = client.get(f"/api/projects/{proj.id}/tasks").json()
    assert not any(t["id"] == task_id for t in list_after)
