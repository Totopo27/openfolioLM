import os
import re
import json
import shutil
import uuid
from datetime import datetime, timezone
from typing import Optional, Any
from app.core.models import Project
from app.adapters.sqlite_store import SQLiteDocumentStore
from app.adapters.lancedb_store import LanceDBVectorStore


class ProjectManager:
    """Manages physically isolated project workspaces under data/projects/."""

    def __init__(
        self,
        projects_root: str = "data/projects",
        legacy_db_path: Optional[str] = "data/openfolio.db",
        embedding_model: Optional[Any] = None
    ):
        self.projects_root = os.path.abspath(projects_root)
        self.legacy_db_path = os.path.abspath(legacy_db_path) if legacy_db_path else None
        os.makedirs(self.projects_root, exist_ok=True)
        self._stores: dict[str, SQLiteDocumentStore] = {}
        self._vector_stores: dict[str, LanceDBVectorStore] = {}
        self._shared_embedding_model = embedding_model

    def _get_project_dir(self, project_id: str) -> str:
        return os.path.join(self.projects_root, project_id)

    def _get_meta_path(self, project_id: str) -> str:
        return os.path.join(self._get_project_dir(project_id), "project.json")

    def _get_db_path(self, project_id: str) -> str:
        return os.path.join(self._get_project_dir(project_id), "openfolio.db")

    def _get_uploads_dir(self, project_id: str) -> str:
        return os.path.join(self._get_project_dir(project_id), "uploads")

    def create_project(self, name: str, description: str = "") -> Project:
        slug = re.sub(r"[^a-zA-Z0-9_]", "_", name.lower().strip())
        slug = re.sub(r"_+", "_", slug).strip("_")[:20] or "workspace"
        project_id = f"proj_{slug}_{uuid.uuid4().hex[:6]}"

        proj_dir = self._get_project_dir(project_id)
        os.makedirs(proj_dir, exist_ok=True)
        os.makedirs(self._get_uploads_dir(project_id), exist_ok=True)

        now = datetime.now(timezone.utc)
        meta = {
            "id": project_id,
            "name": name.strip(),
            "description": description.strip(),
            "created_at": now.isoformat()
        }

        with open(self._get_meta_path(project_id), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

        # Initialize isolated SQLite database
        self.get_store(project_id)

        return Project(
            id=project_id,
            name=name.strip(),
            description=description.strip(),
            created_at=now,
            doc_count=0,
            message_count=0
        )

    def get_project(self, project_id: str) -> Optional[Project]:
        meta_path = self._get_meta_path(project_id)
        if not os.path.exists(meta_path):
            return None

        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            store = self.get_store(project_id)
            doc_count = store.count_documents()
            message_count = store.count_messages()

            return Project(
                id=data["id"],
                name=data["name"],
                description=data.get("description", ""),
                created_at=datetime.fromisoformat(data["created_at"]),
                doc_count=doc_count,
                message_count=message_count
            )
        except Exception:
            return None

    def list_projects(self) -> list[Project]:
        if not os.path.exists(self.projects_root):
            return []

        projects = []
        for entry in os.listdir(self.projects_root):
            proj_dir = os.path.join(self.projects_root, entry)
            if os.path.isdir(proj_dir):
                proj = self.get_project(entry)
                if proj:
                    projects.append(proj)

        projects.sort(key=lambda p: p.created_at, reverse=True)
        return projects

    def get_store(self, project_id: str) -> SQLiteDocumentStore:
        if project_id not in self._stores:
            db_path = self._get_db_path(project_id)
            self._stores[project_id] = SQLiteDocumentStore(db_path=db_path)
        return self._stores[project_id]

    def get_vector_store(self, project_id: str) -> LanceDBVectorStore:
        if project_id not in self._vector_stores:
            lance_dir = os.path.join(self._get_project_dir(project_id), "vectors.lance")
            v_store = LanceDBVectorStore(
                db_dir=lance_dir,
                embedding_model=self._shared_embedding_model
            )
            try:
                db = v_store._get_db()
                t_names = v_store._get_table_names(db)
                rebuild_needed = False
                if "chunks" not in t_names or len(db.open_table("chunks")) == 0:
                    rebuild_needed = True
                elif not v_store.check_dimension_match():
                    rebuild_needed = True

                if rebuild_needed:
                    sqlite_store = self.get_store(project_id)
                    existing_chunks = sqlite_store.get_all_chunks()
                    if existing_chunks:
                        v_store.rebuild_table_with_chunks(existing_chunks)
            except Exception:
                pass
            self._vector_stores[project_id] = v_store
        return self._vector_stores[project_id]

    def reindex_project_vectors(self, project_id: str) -> int:
        """Re-embeds all chunks from SQLite into LanceDB using the active embedding model."""
        sqlite_store = self.get_store(project_id)
        existing_chunks = sqlite_store.get_all_chunks()
        v_store = self.get_vector_store(project_id)
        v_store.rebuild_table_with_chunks(existing_chunks)
        return len(existing_chunks)

    def get_uploads_dir(self, project_id: str) -> str:
        d = self._get_uploads_dir(project_id)
        os.makedirs(d, exist_ok=True)
        return d

    def delete_project(self, project_id: str) -> bool:
        proj_dir = self._get_project_dir(project_id)
        if not os.path.exists(proj_dir):
            return False

        # Close database connection and evict from active stores cache
        if project_id in self._stores:
            self._stores[project_id].close()
            del self._stores[project_id]

        if project_id in self._vector_stores:
            del self._vector_stores[project_id]

        shutil.rmtree(proj_dir)
        return True

    def ensure_default_project(self) -> Project:
        projects = self.list_projects()
        if projects:
            return projects[0]

        # Check if legacy database exists to migrate it
        default_id = "proj_default"
        default_dir = self._get_project_dir(default_id)
        os.makedirs(default_dir, exist_ok=True)
        os.makedirs(self._get_uploads_dir(default_id), exist_ok=True)

        target_db = self._get_db_path(default_id)
        if self.legacy_db_path and os.path.exists(self.legacy_db_path):
            shutil.copy2(self.legacy_db_path, target_db)

        now = datetime.now(timezone.utc)
        meta = {
            "id": default_id,
            "name": "Proyecto Principal",
            "description": "Espacio de trabajo inicial",
            "created_at": now.isoformat()
        }
        with open(self._get_meta_path(default_id), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

        return self.get_project(default_id)
