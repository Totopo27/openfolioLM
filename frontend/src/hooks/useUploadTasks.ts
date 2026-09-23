import { useState, useEffect, useCallback, useRef } from 'react';
import { ActiveUploadTask, BackendIngestionTask } from '../types';
import {
  uploadProjectSourceBackground,
  ingestProjectUrl,
  fetchProjectTasks,
  dismissProjectTask,
} from '../services/api';

interface UseUploadTasksOptions {
  projectId: string | undefined;
  selectedEngine: string;
  onTasksCompleted?: (projectId: string) => Promise<void> | void;
}

export function useUploadTasks({
  projectId,
  selectedEngine,
  onTasksCompleted,
}: UseUploadTasksOptions) {
  const [uploadTasks, setUploadTasks] = useState<ActiveUploadTask[]>([]);
  const onTasksCompletedRef = useRef(onTasksCompleted);
  onTasksCompletedRef.current = onTasksCompleted;

  // Polling loop for active background ingestion tasks with adaptive intervals
  useEffect(() => {
    if (!projectId) return;

    let isMounted = true;
    let timerId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const backendTasks = await fetchProjectTasks(projectId);
        if (!isMounted) return;

        let hasNewCompleted = false;

        setUploadTasks((prev) => {
          let hasChanges = false;
          const updated = [...prev];

          for (const bt of backendTasks) {
            const existingIdx = updated.findIndex((t) => t.id === bt.id);
            const mappedTask: ActiveUploadTask = {
              id: bt.id,
              name: bt.filename,
              size: bt.file_size,
              progress: bt.progress,
              stage: bt.stage,
              statusText: bt.status_text,
              error: bt.error || undefined,
              document_id: bt.document_id,
              startedAt: Math.round(bt.created_at * 1000),
            };

            if (existingIdx >= 0) {
              const prevTask = updated[existingIdx];
              if (prevTask.stage !== 'done' && bt.stage === 'done') {
                hasNewCompleted = true;
              }
              if (
                prevTask.progress !== bt.progress ||
                prevTask.stage !== bt.stage ||
                prevTask.statusText !== bt.status_text ||
                prevTask.error !== (bt.error || undefined)
              ) {
                hasChanges = true;
                updated[existingIdx] = {
                  ...prevTask,
                  ...mappedTask,
                };
              }
            } else {
              if (bt.stage !== 'done' || (bt.completed_at && Date.now() - bt.completed_at * 1000 < 8000)) {
                hasChanges = true;
                updated.push(mappedTask);
              }
            }
          }

          if (!hasChanges) {
            return prev;
          }
          return updated;
        });

        if (hasNewCompleted && onTasksCompletedRef.current) {
          await onTasksCompletedRef.current(projectId);
        }

        // Adaptive interval: 2.5s if active tasks, 15s when idle
        const hasActiveTasks = backendTasks.some(
          (t) => t.stage !== 'done' && t.stage !== 'error'
        );
        const nextInterval = hasActiveTasks ? 2500 : 15000;
        if (isMounted) {
          timerId = setTimeout(poll, nextInterval);
        }
      } catch (err) {
        if (isMounted) {
          timerId = setTimeout(poll, 15000);
        }
      }
    };

    poll();

    return () => {
      isMounted = false;
      clearTimeout(timerId);
    };
  }, [projectId]);

  const handleUpload = useCallback(async (file: File) => {
    if (!projectId) return;
    const tempTaskId = `task_temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newTask: ActiveUploadTask = {
      id: tempTaskId,
      name: file.name,
      size: file.size,
      progress: 5,
      stage: 'uploading',
      statusText: 'Iniciando transferencia...',
      startedAt: Date.now(),
    };

    setUploadTasks((prev) => [newTask, ...prev]);

    try {
      const backendTask = await uploadProjectSourceBackground(
        projectId,
        file,
        (percent, loaded, total) => {
          const loadedMb = (loaded / (1024 * 1024)).toFixed(1);
          const totalMb = (total / (1024 * 1024)).toFixed(1);
          setUploadTasks((prev) =>
            prev.map((t) =>
              t.id === tempTaskId
                ? {
                    ...t,
                    progress: Math.min(100, Math.max(1, percent)),
                    statusText: `Transfiriendo archivo: ${loadedMb} / ${totalMb} MB (${percent}%)`,
                  }
                : t
            )
          );
        },
        selectedEngine
      );

      setUploadTasks((prev) =>
        prev.map((t) =>
          t.id === tempTaskId
            ? {
                ...t,
                id: backendTask.id,
                progress: backendTask.progress,
                stage: backendTask.stage,
                statusText: backendTask.status_text,
                error: backendTask.error || undefined,
              }
            : t
        )
      );
    } catch (err: any) {
      console.error('Upload error:', err);
      setUploadTasks((prev) =>
        prev.map((t) =>
          t.id === tempTaskId
            ? { ...t, stage: 'error', error: err.message || 'Error al subir el archivo' }
            : t
        )
      );
    }
  }, [projectId, selectedEngine]);

  const handleIngestUrl = useCallback(async (url: string, title?: string) => {
    if (!projectId) return;
    const tempTaskId = `task_url_${Date.now()}`;
    const newTask: ActiveUploadTask = {
      id: tempTaskId,
      name: title || url,
      size: 0,
      progress: 10,
      stage: 'extracting',
      statusText: 'Iniciando descarga y análisis...',
      startedAt: Date.now(),
    };

    setUploadTasks((prev) => [newTask, ...prev]);

    try {
      const result = await ingestProjectUrl(projectId, url, title, selectedEngine, true);
      if ('stage' in result) {
        setUploadTasks((prev) =>
          prev.map((t) =>
            t.id === tempTaskId
              ? {
                  ...t,
                  id: result.id,
                  progress: result.progress,
                  stage: result.stage,
                  statusText: result.status_text,
                  error: result.error || undefined,
                }
              : t
          )
        );
      }
    } catch (err: any) {
      console.error('URL ingestion error:', err);
      setUploadTasks((prev) =>
        prev.map((t) =>
          t.id === tempTaskId
            ? { ...t, stage: 'error', error: err.message || 'Error al procesar la fuente remota' }
            : t
        )
      );
    }
  }, [projectId, selectedEngine]);

  const handleDismissUploadTask = useCallback(async (taskId: string) => {
    if (projectId && !taskId.startsWith('task_temp_')) {
      try {
        await dismissProjectTask(projectId, taskId);
      } catch (err) {
        console.error('Error dismissing task from backend:', err);
      }
    }
    setUploadTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, [projectId]);

  const initTasks = useCallback(async (tasks: BackendIngestionTask[]) => {
    if (tasks.length === 0) return;
    const mapped: ActiveUploadTask[] = tasks
      .filter((t) => t.stage !== 'done' || (t.completed_at && Date.now() - t.completed_at * 1000 < 8000))
      .map((t) => ({
        id: t.id,
        name: t.filename,
        size: t.file_size,
        progress: t.progress,
        stage: t.stage,
        statusText: t.status_text,
        error: t.error || undefined,
        document_id: t.document_id,
        startedAt: Math.round(t.created_at * 1000),
      }));
    setUploadTasks(mapped);
  }, []);

  const clearTasks = useCallback(() => {
    setUploadTasks([]);
  }, []);

  return {
    uploadTasks,
    handleUpload,
    handleIngestUrl,
    handleDismissUploadTask,
    initTasks,
    clearTasks,
  };
}
