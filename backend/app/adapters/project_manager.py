import os
import re
import json
import logging
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Any
from app.core.models import Project, SourceDocument
from app.adapters.sqlite_store import SQLiteDocumentStore
from app.adapters.lancedb_store import LanceDBVectorStore
from app.adapters.academic_resolver import normalize_doi

logger = logging.getLogger(__name__)
from app.adapters.task_manager import IngestionTaskManager

STOPWORDS = {
    "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for",
    "with", "by", "from", "as", "is", "that", "this", "it", "using", "based",
    "un", "una", "los", "las", "el", "la", "de", "en", "para", "por", "con"
}
PROJECT_ID_PATTERN = re.compile(r"^proj_[a-z0-9_]{1,64}$")


class InvalidProjectIdError(ValueError):
    """Raised when a project identifier could escape the projects root."""


def normalize_title(title: Optional[str]) -> str:
    if not title or not isinstance(title, str):
        return ""
    cleaned = re.sub(r"[^\w\s]", " ", title.lower())
    tokens = [w for w in cleaned.split() if w not in STOPWORDS and len(w) > 1]
    return " ".join(tokens)


def title_token_similarity(t1: str, t2: str) -> float:
    n1 = normalize_title(t1)
    n2 = normalize_title(t2)
    if not n1 or not n2:
        return 0.0
    if n1 == n2:
        return 1.0
    tokens1 = set(n1.split())
    tokens2 = set(n2.split())
    intersection = len(tokens1 & tokens2)
    union = len(tokens1 | tokens2)
    return intersection / union if union > 0 else 0.0


class ProjectManager:
    """Manages physically isolated project workspaces under data/projects/."""

    def __init__(
        self,
        projects_root: str = "data/projects",
        legacy_db_path: Optional[str] = "data/openfolio.db",
        embedding_model: Optional[Any] = None,
        task_manager: Optional[IngestionTaskManager] = None,
    ):
        self.projects_root = str(Path(projects_root).resolve())
        self.legacy_db_path = os.path.abspath(legacy_db_path) if legacy_db_path else None
        os.makedirs(self.projects_root, exist_ok=True)
        self._stores: dict[str, SQLiteDocumentStore] = {}
        self._vector_stores: dict[str, LanceDBVectorStore] = {}
        self._shared_embedding_model = embedding_model
        self.task_manager = task_manager or IngestionTaskManager()

    @staticmethod
    def validate_project_id(project_id: str) -> str:
        if not PROJECT_ID_PATTERN.fullmatch(project_id):
            raise InvalidProjectIdError("Invalid project identifier")
        return project_id

    def _get_project_dir(self, project_id: str) -> str:
        safe_id = self.validate_project_id(project_id)
        root = Path(self.projects_root).resolve()
        project_dir = (root / safe_id).resolve()
        if project_dir.parent != root:
            raise InvalidProjectIdError("Project path escapes the projects root")
        return str(project_dir)

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
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            logger.warning("Corrupt or invalid project metadata for '%s': %s", project_id, e)
            return None
        except OSError as e:
            logger.warning("Failed to read project '%s': %s", project_id, e)
            return None

    def list_projects(self) -> list[Project]:
        if not os.path.exists(self.projects_root):
            return []

        projects = []
        for entry in os.listdir(self.projects_root):
            try:
                self.validate_project_id(entry)
            except InvalidProjectIdError:
                continue
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
        if not os.path.isdir(proj_dir) or not os.path.isfile(self._get_meta_path(project_id)):
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

    def find_duplicate_document(
        self,
        project_id: str,
        doi: Optional[str] = None,
        title: Optional[str] = None,
        similarity_threshold: float = 0.85
    ) -> Optional[SourceDocument]:
        """Detects whether a paper or document already exists in the project using DOI or title overlap."""
        store = self.get_store(project_id)
        existing_docs = store.list_documents()

        target_doi = normalize_doi(doi) if doi else None

        for doc in existing_docs:
            doc_doi = normalize_doi(doc.metadata.get("doi")) if doc.metadata else None
            if target_doi and doc_doi and target_doi == doc_doi:
                return doc

            if title:
                sim = title_token_similarity(title, doc.filename)
                if sim >= similarity_threshold:
                    return doc

        return None

    def _get_shared_dir(self) -> str:
        d = os.path.join(self.projects_root, "shared_conversations")
        os.makedirs(d, exist_ok=True)
        return d

    def save_shared_conversation(
        self,
        project_id: str,
        title: Optional[str],
        messages: list[Any],
        project_name: str
    ) -> dict[str, Any]:
        share_id = f"share_{uuid.uuid4().hex[:12]}"
        now = datetime.now(timezone.utc).isoformat()
        clean_title = (title or "").strip()
        if not clean_title and messages:
            first_user_msg = next((m for m in messages if getattr(m, "sender", None) == "user" or (isinstance(m, dict) and m.get("sender") == "user")), None)
            if first_user_msg:
                t = getattr(first_user_msg, "text", None) or (first_user_msg.get("text") if isinstance(first_user_msg, dict) else "")
                clean_title = t[:60].strip() + ("..." if len(t) > 60 else "")
        if not clean_title:
            clean_title = f"Conversación de {project_name}"

        # Serialize messages
        serialized_messages = []
        source_ids = set()
        for m in messages:
            if hasattr(m, "model_dump"):
                m_dict = m.model_dump()
            elif isinstance(m, dict):
                m_dict = dict(m)
            else:
                m_dict = dict(m)

            if "id" not in m_dict or not m_dict["id"]:
                m_dict["id"] = f"msg_{uuid.uuid4().hex[:12]}"
            if "conversation_id" not in m_dict or not m_dict["conversation_id"]:
                m_dict["conversation_id"] = "default"
            if "created_at" not in m_dict or not m_dict["created_at"]:
                m_dict["created_at"] = now
            elif isinstance(m_dict["created_at"], datetime):
                m_dict["created_at"] = m_dict["created_at"].isoformat()
            if "sender" not in m_dict:
                m_dict["sender"] = "user"
            if "text" not in m_dict:
                m_dict["text"] = ""
            if "citations" not in m_dict or m_dict["citations"] is None:
                m_dict["citations"] = []

            serialized_messages.append(m_dict)
            for c in m_dict.get("citations", []):
                if isinstance(c, dict) and c.get("source_id"):
                    source_ids.add(c["source_id"])

        snapshot = {
            "share_id": share_id,
            "project_id": project_id,
            "project_name": project_name,
            "title": clean_title,
            "created_at": now,
            "messages": serialized_messages,
            "source_count": len(source_ids)
        }

        # 1. Save in standalone file for high-speed public access
        file_path = os.path.join(self._get_shared_dir(), f"{share_id}.json")
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, indent=2, ensure_ascii=False)

        # 2. Also persist in project's SQLite store
        try:
            store = self.get_store(project_id)
            store.save_shared_conversation(
                share_id=share_id,
                project_id=project_id,
                title=clean_title,
                snapshot_json=json.dumps(snapshot, ensure_ascii=False),
                created_at=now
            )
        except Exception as e:
            logger.warning("Failed to persist shared conversation '%s' to SQLite: %s", share_id, e)

        return snapshot

    def get_shared_conversation(self, share_id: str) -> Optional[dict[str, Any]]:
        # 1. Check standalone shared files
        file_path = os.path.join(self._get_shared_dir(), f"{share_id}.json")
        if os.path.exists(file_path):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("Failed to read shared conversation file '%s': %s", share_id, e)

        # 2. Fallback: check project stores
        for proj in self.list_projects():
            try:
                store = self.get_store(proj.id)
                found = store.get_shared_conversation(share_id)
                if found:
                    return found.get("snapshot")
            except Exception as e:
                logger.debug("Failed to check project '%s' for shared conversation '%s': %s", proj.id, share_id, e)
                continue

        return None
