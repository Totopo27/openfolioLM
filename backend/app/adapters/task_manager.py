"""Background Task Manager for asynchronous document ingestion and vectorization."""

import os
import uuid
import time
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, asdict
from typing import Optional, Callable, Any
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


@dataclass
class IngestionTask:
    id: str
    project_id: str
    filename: str
    file_size: int
    stage: str = "queued"  # queued, extracting, vlm, embedding, indexing, done, error
    progress: int = 0      # 0 to 100
    status_text: str = "En cola de espera..."
    document_id: Optional[str] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    completed_at: Optional[float] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class IngestionTaskManager:
    """
    Coordinates asynchronous background document processing.
    Limits concurrent heavy AI & vector operations with a ThreadPoolExecutor
    to protect CPU and memory resources while maintaining responsive UI.
    """

    def __init__(self, max_workers: int = 2):
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="ingest-worker")
        self._tasks: dict[str, IngestionTask] = {}

    def create_task(self, project_id: str, filename: str, file_size: int) -> IngestionTask:
        task_id = f"task_{uuid.uuid4().hex[:12]}"
        task = IngestionTask(
            id=task_id,
            project_id=project_id,
            filename=filename,
            file_size=file_size,
            stage="queued",
            progress=5,
            status_text="Archivo recibido. Encolando procesamiento...",
        )
        self._tasks[task_id] = task
        logger.info("Created ingestion task %s for '%s' in project %s", task_id, filename, project_id)
        return task

    def get_task(self, task_id: str) -> Optional[IngestionTask]:
        return self._tasks.get(task_id)

    def list_project_tasks(self, project_id: str) -> list[IngestionTask]:
        # Return tasks sorted by creation time descending
        tasks = [t for t in self._tasks.values() if t.project_id == project_id]
        tasks.sort(key=lambda t: t.created_at, reverse=True)
        return tasks

    def update_task(
        self,
        task_id: str,
        progress: Optional[int] = None,
        stage: Optional[str] = None,
        status_text: Optional[str] = None,
        document_id: Optional[str] = None,
        error: Optional[str] = None,
    ) -> Optional[IngestionTask]:
        task = self._tasks.get(task_id)
        if not task:
            return None

        if progress is not None:
            task.progress = min(100, max(0, progress))
        if stage is not None:
            task.stage = stage
        if status_text is not None:
            task.status_text = status_text
        if document_id is not None:
            task.document_id = document_id
        if error is not None:
            task.error = error
            task.stage = "error"
            task.completed_at = time.time()
        elif stage == "done":
            task.progress = 100
            task.completed_at = time.time()

        return task

    def dismiss_task(self, task_id: str) -> bool:
        if task_id in self._tasks:
            del self._tasks[task_id]
            return True
        return False

    def cancel_project_tasks(self, project_id: str) -> int:
        """Mark all in-flight tasks for a project as cancelled.

        Returns the count of tasks that were cancelled.  Workers check
        their task stage before writing results, so this prevents
        orphaned writes to a deleted project.
        """
        cancelled = 0
        for task in self._tasks.values():
            if task.project_id == project_id and task.stage not in ("done", "error"):
                task.stage = "error"
                task.error = "Project deleted while task was in progress"
                task.status_text = "Cancelado: proyecto eliminado"
                task.completed_at = time.time()
                cancelled += 1
        if cancelled:
            logger.info(
                "Cancelled %d in-flight task(s) for deleted project %s",
                cancelled, project_id,
            )
        return cancelled

    def submit_ingestion(
        self,
        task_id: str,
        ingest_fn: Callable[[Callable[[int, str, str], None]], Any],
        on_success: Optional[Callable[[Any], None]] = None,
        on_failure: Optional[Callable[[Exception], None]] = None,
    ) -> None:
        """Submits an ingestion job to the background thread pool with live progress telemetry."""

        def _worker():
            task = self.get_task(task_id)
            if not task:
                return

            def progress_reporter(pct: int, stg: str, msg: str):
                self.update_task(task_id, progress=pct, stage=stg, status_text=msg)

            try:
                progress_reporter(10, "extracting", f"Iniciando extracción de '{task.filename}'...")
                doc = ingest_fn(progress_reporter)
                # Guard: if the task was cancelled (e.g. project deleted
                # while ingestion was running), skip the success path to
                # avoid writing to a torn-down store.
                if task.stage == "error":
                    logger.info("Task %s was cancelled mid-flight, discarding result", task_id)
                    return
                self.update_task(
                    task_id,
                    progress=100,
                    stage="done",
                    status_text="¡Libro indexado y listo!",
                    document_id=getattr(doc, "id", None),
                )
                if on_success:
                    on_success(doc)
            except Exception as exc:
                logger.exception("Ingestion task %s failed for '%s'", task_id, task.filename)
                err_str = str(exc).strip() or "Error interno durante la indexación"
                self.update_task(task_id, error=err_str, status_text=f"Error: {err_str}")
                if on_failure:
                    on_failure(exc)

        self._executor.submit(_worker)
