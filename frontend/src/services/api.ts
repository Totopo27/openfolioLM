import { SourceDocument, GroundedResponse, Project, ChatMessage, ModelEngine, DocumentDossier, ProjectNote, NetworkGraph, ProjectTimeline, SuggestedTopic } from '../types';

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



