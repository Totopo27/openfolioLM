import os
import shutil
import tempfile
import pytest
from app.adapters.project_manager import ProjectManager


@pytest.fixture
def temp_manager():
    temp_dir = tempfile.mkdtemp()
    mgr = ProjectManager(projects_root=temp_dir)
    yield mgr
    shutil.rmtree(temp_dir, ignore_errors=True)


def test_create_and_list_projects(temp_manager):
    p1 = temp_manager.create_project(name="Literatura Tica", description="Estudios literarios")
    assert p1.id.startswith("proj_")
    assert p1.name == "Literatura Tica"

    projects = temp_manager.list_projects()
    assert len(projects) == 1
    assert projects[0].id == p1.id


def test_project_store_isolation(temp_manager):
    p1 = temp_manager.create_project(name="Proyecto 1")
    p2 = temp_manager.create_project(name="Proyecto 2")

    store1 = temp_manager.get_store(p1.id)
    store2 = temp_manager.get_store(p2.id)

    assert store1.db_path != store2.db_path
    assert os.path.exists(store1.db_path)
    assert os.path.exists(store2.db_path)


def test_delete_project_removes_directory(temp_manager):
    p1 = temp_manager.create_project(name="Para Borrar")
    proj_dir = os.path.join(temp_manager.projects_root, p1.id)
    assert os.path.exists(proj_dir)

    success = temp_manager.delete_project(p1.id)
    assert success is True
    assert not os.path.exists(proj_dir)
    assert len(temp_manager.list_projects()) == 0


def test_ensure_default_project_creates_one_if_empty(temp_manager):
    assert len(temp_manager.list_projects()) == 0
    default_proj = temp_manager.ensure_default_project()
    assert default_proj is not None
    assert len(temp_manager.list_projects()) == 1
    assert default_proj.name == "Proyecto Principal"
