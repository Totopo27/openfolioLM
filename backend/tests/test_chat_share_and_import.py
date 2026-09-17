import os
import shutil
import tempfile
import pytest
from fastapi.testclient import TestClient
from app.adapters.project_manager import ProjectManager
from app.adapters.sqlite_store import SQLiteDocumentStore
from app.core.models import ChatMessageRecord, Citation
from app.main import create_app


@pytest.fixture
def temp_workspace():
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir, ignore_errors=True)


def test_chat_share_export_and_import(temp_workspace):
    pm = ProjectManager(projects_root=os.path.join(temp_workspace, "projects"))
    project = pm.create_project(name="Proyecto Compartido", description="Test sharing")
    store = pm.get_store(project.id)

    # Seed 2 messages
    store.save_message(
        ChatMessageRecord(
            id="msg_user_1",
            conversation_id="default",
            sender="user",
            text="¿Qué es el temperamento igual de 31 notas (31-EDO)?"
        )
    )
    store.save_message(
        ChatMessageRecord(
            id="msg_asst_1",
            conversation_id="default",
            sender="assistant",
            text="El 31-EDO es un sistema microtonal de temperamento igual [^1].",
            citations=[
                Citation(
                    index=1,
                    source_id="src_fokker",
                    chunk_id="chk_fokker_1",
                    source_filename="fokker_31edo.pdf",
                    quote_snippet="Adriaan Fokker promovió el sistema de 31 notas.",
                    start_char=0,
                    end_char=50
                )
            ],
            evidence_found=True,
            active_sources_consulted=["src_fokker"]
        )
    )

    app = create_app(project_manager=pm)
    client = TestClient(app)

    # 1. Share conversation
    share_res = client.post(
        f"/api/projects/{project.id}/chat/share",
        json={"title": "Discusión sobre 31-EDO"}
    )
    assert share_res.status_code == 200
    share_data = share_res.json()
    share_id = share_data["share_id"]
    assert share_id.startswith("share_")
    assert share_data["title"] == "Discusión sobre 31-EDO"
    assert len(share_data["messages"]) == 2

    # 2. Public lookup of shared conversation
    pub_res = client.get(f"/api/chat/shared/{share_id}")
    assert pub_res.status_code == 200
    pub_data = pub_res.json()
    assert pub_data["share_id"] == share_id
    assert pub_data["project_name"] == "Proyecto Compartido"
    assert pub_data["messages"][0]["text"] == "¿Qué es el temperamento igual de 31 notas (31-EDO)?"
    assert pub_data["messages"][1]["citations"][0]["index"] == 1

    # 3. Export conversation
    export_res = client.get(f"/api/projects/{project.id}/chat/export")
    assert export_res.status_code == 200
    export_data = export_res.json()
    assert export_data["message_count"] == 2
    assert len(export_data["messages"]) == 2

    # 4. Create a second project and import conversation into it
    project2 = pm.create_project(name="Segundo Proyecto", description="Import receiver")
    import_res = client.post(
        f"/api/projects/{project2.id}/chat/import",
        json={"messages": export_data["messages"]}
    )
    assert import_res.status_code == 200
    assert import_res.json()["status"] == "imported"
    assert import_res.json()["count"] == 2

    # Verify project2 now has the messages
    store2 = pm.get_store(project2.id)
    msgs2 = store2.get_messages("default")
    assert len(msgs2) == 2
    assert msgs2[0].text == "¿Qué es el temperamento igual de 31 notas (31-EDO)?"
    assert msgs2[1].citations[0].quote_snippet == "Adriaan Fokker promovió el sistema de 31 notas."
