import { SourceDocument, GroundedResponse, Project, ChatMessage, ModelEngine, DocumentDossier } from '../types';

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

export async function uploadProjectSource(projectId: string, file: File): Promise<SourceDocument> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/projects/${projectId}/sources/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error(err.detail || 'Upload failed');
  }

  return res.json();
}

export async function ingestProjectUrl(
  projectId: string,
  url: string,
  title?: string
): Promise<SourceDocument> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/sources/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, title: title || undefined }),
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

