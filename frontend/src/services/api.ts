import {
  SourceDocument,
  GroundedResponse,
  Project,
  ChatMessage,
  ModelEngine,
  DocumentDossier,
  ProjectNote,
  NetworkGraph,
  ProjectTimeline,
  SuggestedTopic,
  ProjectTaxonomySummary,
  TaxonomyClassificationResult,
  SharedConversationSnapshot,
  BackendIngestionTask,
} from '../types';

const API_BASE = '/api';

// ================= Project APIs =================

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${API_BASE}/projects`);
  if (!res.ok) throw new Error('Failed to fetch projects');
  return res.json();
}

export async function createProject(name: string, description: string = ''): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to create project' }));
    throw new Error(err.detail || 'Failed to create project');
  }
  return res.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${projectId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete project: ${projectId}`);
}

// ================= Project-Scoped Source APIs =================

export async function fetchProjectSources(projectId: string): Promise<SourceDocument[]> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/sources`);
  if (!res.ok) throw new Error('Failed to fetch project sources');
  return res.json();
}

export async function fetchProjectSource(projectId: string, sourceId: string): Promise<SourceDocument> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/sources/${sourceId}`);
  if (!res.ok) throw new Error(`Failed to fetch source ${sourceId}`);
  return res.json();
}

export function uploadProjectSourceBackground(
  projectId: string,
  file: File,
  onProgress?: (percent: number, loadedBytes: number, totalBytes: number) => void,
  engine?: string
): Promise<BackendIngestionTask> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    const query = new URLSearchParams({ background: 'true' });
    if (engine) query.set('engine', engine);
    xhr.open('POST', `${API_BASE}/projects/${projectId}/sources/upload?${query.toString()}`);
    xhr.timeout = 180000; // 3 minutes network transfer timeout

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const fraction = event.loaded / event.total;
        const uploadPercent = Math.min(100, Math.max(1, Math.round(fraction * 100)));
        onProgress(uploadPercent, event.loaded, event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const task: BackendIngestionTask = JSON.parse(xhr.responseText);
          resolve(task);
        } catch {
          reject(new Error('Respuesta inválida del servidor'));
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.detail || `Error al subir archivo (${xhr.status})`));
        } catch {
          reject(new Error(`Error al subir archivo (${xhr.status})`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Error de red al transferir el archivo al servidor'));
    xhr.onabort = () => reject(new Error('Subida cancelada'));
    xhr.ontimeout = () => reject(new Error('Tiempo de espera agotado en la transferencia del archivo'));

    xhr.send(formData);
  });
}

export async function fetchProjectTasks(projectId: string): Promise<BackendIngestionTask[]> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/tasks`);
  if (!res.ok) throw new Error('Failed to fetch project tasks');
  return res.json();
}

export async function fetchProjectTask(projectId: string, taskId: string): Promise<BackendIngestionTask> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/tasks/${taskId}`);
  if (!res.ok) throw new Error(`Failed to fetch task: ${taskId}`);
  return res.json();
}

export async function dismissProjectTask(projectId: string, taskId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/tasks/${taskId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to dismiss task: ${taskId}`);
}

export function uploadProjectSource(
  projectId: string,
  file: File,
  onProgress?: (percent: number, stage: 'uploading' | 'processing', statusText?: string) => void,
  engine?: string
): Promise<SourceDocument> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    const query = new URLSearchParams();
    if (engine) query.set('engine', engine);
    const qs = query.toString() ? `?${query.toString()}` : '';
    xhr.open('POST', `${API_BASE}/projects/${projectId}/sources/upload${qs}`);
    xhr.timeout = 0; // Allow sufficient time for deep OCR, VLM transcriptions and LanceDB embedding

    // Byte transfer phase: represents 0% to 30% of total ingestion
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const fraction = event.loaded / event.total;
        const uploadPercent = Math.min(30, Math.max(1, Math.round(fraction * 30)));
        const loadedMb = (event.loaded / (1024 * 1024)).toFixed(1);
        const totalMb = (event.total / (1024 * 1024)).toFixed(1);
        onProgress(
          uploadPercent,
          'uploading',
          `Transfiriendo archivo: ${loadedMb} / ${totalMb} MB (${Math.round(fraction * 100)}%)`
        );
      }
    };

    // When network payload is completely received by the server
    xhr.upload.onload = () => {
      if (onProgress) {
        onProgress(32, 'processing', 'Archivo en servidor. Extrayendo páginas y tablas...');
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(100, 'processing', '¡Documento indexado con éxito!');
        try {
          const doc: SourceDocument = JSON.parse(xhr.responseText);
          resolve(doc);
        } catch {
          reject(new Error('Respuesta inválida del servidor'));
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.detail || `Error al subir archivo (${xhr.status})`));
        } catch {
          reject(new Error(`Error al subir archivo (${xhr.status})`));
        }
      }
    };

    xhr.onerror = () => {
      reject(new Error('Error de conexión de red al subir el archivo'));
    };

    xhr.onabort = () => {
      reject(new Error('Subida abortada'));
    };

    xhr.send(formData);
  });
}

export async function ingestProjectUrl(
  projectId: string,
  url: string,
  title?: string,
  engine?: string
): Promise<SourceDocument> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/sources/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, title: title || undefined, engine: engine || undefined }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Web ingestion failed' }));
    throw new Error(err.detail || 'Web ingestion failed');
  }

  return res.json();
}

export async function deleteProjectSource(projectId: string, sourceId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/sources/${sourceId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete source: ${sourceId}`);
}

// ================= Project-Scoped Chat & Persistence APIs =================

export async function fetchProjectMessages(projectId: string): Promise<ChatMessage[]> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/messages`);
  if (!res.ok) throw new Error('Failed to fetch project messages');
  const records = await res.json();
  return records.map((r: any) => ({
    id: r.id,
    sender: r.sender,
    text: r.text,
    citations: r.citations,
    evidence_found: r.evidence_found,
    active_sources_consulted: r.active_sources_consulted,
    timestamp: r.created_at
      ? new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '',
  }));
}

export async function clearProjectMessages(projectId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/messages`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to clear messages');
}

export async function sendProjectGroundedChat(
  projectId: string,
  query: string,
  activeSourceIds: string[],
  provider?: string
): Promise<GroundedResponse> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      active_source_ids: activeSourceIds,
      top_k: 5,
      strict_grounding: true,
      provider: provider || undefined,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Chat request failed' }));
    throw new Error(err.detail || 'Chat request failed');
  }

  return res.json();
}

// ================= Model Discovery APIs =================

export async function fetchAvailableModels(): Promise<ModelEngine[]> {
  const res = await fetch(`${API_BASE}/models`);
  if (!res.ok) throw new Error('Failed to fetch models');
  const data = await res.json();
  return data.models || [];
}

export async function fetchModelHealth(): Promise<Record<string, { status: string; latency_ms?: number; last_error?: string; in_cooldown?: boolean }>> {
  const res = await fetch(`${API_BASE}/models/health`);
  if (!res.ok) throw new Error('Failed to fetch model health');
  const data = await res.json();
  return data.statuses || {};
}

export async function pingModelEngine(modelId: string): Promise<{ status: string; latency_ms?: number; last_error?: string }> {
  const res = await fetch(`${API_BASE}/models/ping?model_id=${encodeURIComponent(modelId)}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to ping model');
  return res.json();
}

// ================= Structured Document Dossier APIs =================

export async function fetchProjectSourceDossier(
  projectId: string,
  sourceId: string
): Promise<DocumentDossier | null> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/sources/${sourceId}/dossier`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch document dossier');
  return res.json();
}

export async function generateProjectSourceDossier(
  projectId: string,
  sourceId: string,
  provider?: string
): Promise<DocumentDossier> {
  const url = provider
    ? `${API_BASE}/projects/${projectId}/sources/${sourceId}/analyze?provider=${encodeURIComponent(provider)}`
    : `${API_BASE}/projects/${projectId}/sources/${sourceId}/analyze`;

  const res = await fetch(url, {
    method: 'POST',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Analysis generation failed' }));
    throw new Error(err.detail || 'Analysis generation failed');
  }

  return res.json();
}

export async function updateProjectSourceDossier(
  projectId: string,
  sourceId: string,
  dossier: DocumentDossier
): Promise<DocumentDossier> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/sources/${sourceId}/dossier`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dossier),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to update dossier' }));
    throw new Error(err.detail || 'Failed to update dossier');
  }
  return res.json();
}

export async function fetchSuggestedTopics(projectId: string): Promise<SuggestedTopic[]> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/discovery/suggested-topics`);
  if (!res.ok) throw new Error('Failed to fetch suggested topics');
  return res.json();
}

// ================= Studio Notebook & Export APIs =================

export async function fetchProjectNotes(projectId: string): Promise<ProjectNote[]> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/notes`);
  if (!res.ok) throw new Error('Failed to fetch project notes');
  return res.json();
}

export async function createProjectNote(
  projectId: string,
  note: {
    title: string;
    content: string;
    source_citation_ids?: string[];
    tags?: string[];
    origin_prompt?: string;
    source_message_id?: string;
  }
): Promise<ProjectNote> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: note.title,
      content: note.content,
      source_citation_ids: note.source_citation_ids || [],
      tags: note.tags || [],
      origin_prompt: note.origin_prompt,
      source_message_id: note.source_message_id,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to create note' }));
    throw new Error(err.detail || 'Failed to create note');
  }
  return res.json();
}

export async function updateProjectNote(
  projectId: string,
  noteId: string,
  note: {
    title?: string;
    content?: string;
    source_citation_ids?: string[];
    tags?: string[];
    origin_prompt?: string;
    source_message_id?: string;
  }
): Promise<ProjectNote> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/notes/${noteId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to update note' }));
    throw new Error(err.detail || 'Failed to update note');
  }
  return res.json();
}

export async function deleteProjectNote(projectId: string, noteId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/notes/${noteId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete note');
}

export async function downloadProjectExport(
  projectId: string,
  projectName: string,
  format: 'markdown' | 'bibtex'
): Promise<void> {
  const url = `${API_BASE}/projects/${projectId}/export?format=${format}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to export project as ${format}`);

  const blob = await res.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  const cleanName = projectName.toLowerCase().replace(/\s+/g, '_');
  a.download = format === 'bibtex' ? `${cleanName}_references.bib` : `${cleanName}_dossier.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(downloadUrl);
}

// ================= Knowledge Graph & Network APIs =================

export async function fetchProjectNetwork(
  projectId: string,
  minSimilarity: number = 0.65
): Promise<NetworkGraph> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/network?min_similarity=${minSimilarity}`
  );
  if (!res.ok) throw new Error('Failed to fetch project citation network');
  return res.json();
}

// ================= Timeline & Evolutionary Chronology APIs =================

export async function fetchProjectTimeline(projectId: string): Promise<ProjectTimeline> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/timeline`);
  if (!res.ok) throw new Error('Failed to fetch project timeline');
  return res.json();
}

export async function generateTimelineNarrative(
  projectId: string,
  provider?: string
): Promise<string> {
  const url = provider
    ? `${API_BASE}/projects/${projectId}/timeline/narrative?provider=${encodeURIComponent(provider)}`
    : `${API_BASE}/projects/${projectId}/timeline/narrative`;

  const res = await fetch(url, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to synthesize timeline narrative' }));
    throw new Error(err.detail || 'Failed to synthesize timeline narrative');
  }
  const data = await res.json();
  return data.narrative_arc || '';
}

// ================= Source Taxonomy, Categories & Metadata APIs =================

export async function updateSourceMetadata(
  projectId: string,
  sourceId: string,
  metadata: {
    category?: string;
    tags?: string[];
    author?: string;
    year_or_era?: string;
    summary?: string;
  }
): Promise<SourceDocument> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/sources/${sourceId}/metadata`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to update metadata' }));
    throw new Error(err.detail || 'Failed to update metadata');
  }
  return res.json();
}

export async function autoclassifySource(
  projectId: string,
  sourceId: string,
  provider?: string
): Promise<TaxonomyClassificationResult> {
  const url = provider
    ? `${API_BASE}/projects/${projectId}/sources/${sourceId}/autoclassify?provider=${encodeURIComponent(provider)}`
    : `${API_BASE}/projects/${projectId}/sources/${sourceId}/autoclassify`;

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to autoclassify source' }));
    throw new Error(err.detail || 'Failed to autoclassify source');
  }
  return res.json();
}

export async function autoclassifyAllSources(
  projectId: string,
  provider?: string
): Promise<{ classified_count: number; results: any[] }> {
  const url = provider
    ? `${API_BASE}/projects/${projectId}/sources/autoclassify-all?provider=${encodeURIComponent(provider)}`
    : `${API_BASE}/projects/${projectId}/sources/autoclassify-all`;

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to autoclassify all sources' }));
    throw new Error(err.detail || 'Failed to autoclassify all sources');
  }
  return res.json();
}

export async function fetchProjectTaxonomy(projectId: string): Promise<ProjectTaxonomySummary> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/taxonomy`);
  if (!res.ok) throw new Error('Failed to fetch project taxonomy');
  return res.json();
}

// ================= Shared Conversations, Export & Import =================

export async function shareProjectChat(
  projectId: string,
  title?: string,
  messages?: any[]
): Promise<SharedConversationSnapshot> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${API_BASE}/projects/${projectId}/chat/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, messages }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to share chat' }));
      throw new Error(err.detail || 'Failed to share chat');
    }
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getSharedChat(shareId: string): Promise<SharedConversationSnapshot> {
  const res = await fetch(`${API_BASE}/chat/shared/${shareId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to load shared chat' }));
    throw new Error(err.detail || 'Shared conversation not found');
  }
  return res.json();
}

export async function importProjectChat(
  projectId: string,
  messages: any[]
): Promise<{ status: string; count: number; project_id: string }> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/chat/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to import chat' }));
    throw new Error(err.detail || 'Failed to import chat');
  }
  return res.json();
}

export async function exportProjectChat(projectId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/chat/export`);
  if (!res.ok) throw new Error('Failed to export chat');
  return res.json();
}

export interface SystemLogsResponse {
  lines: string[];
  log_file: string;
  total_lines?: number;
  status?: string;
}

export async function fetchSystemLogs(lines: number = 200): Promise<SystemLogsResponse> {
  const res = await fetch(`${API_BASE}/system/logs?lines=${lines}`);
  if (!res.ok) {
    throw new Error('Error al obtener los logs del servidor');
  }
  return res.json();
}




