import { SourceDocument, GroundedResponse } from '../types';

const API_BASE = '/api';

export async function fetchSources(): Promise<SourceDocument[]> {
  const res = await fetch(`${API_BASE}/sources`);
  if (!res.ok) throw new Error('Failed to fetch sources');
  return res.json();
}

export async function fetchSourceById(id: string): Promise<SourceDocument> {
  const res = await fetch(`${API_BASE}/sources/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch source: ${id}`);
  return res.json();
}

export async function uploadSource(file: File): Promise<SourceDocument> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/sources/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error(err.detail || 'Upload failed');
  }

  return res.json();
}

export async function deleteSource(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/sources/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete source: ${id}`);
}

export async function sendGroundedChat(
  query: string,
  activeSourceIds: string[]
): Promise<GroundedResponse> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      active_source_ids: activeSourceIds,
      top_k: 5,
      strict_grounding: true,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Chat request failed' }));
    throw new Error(err.detail || 'Chat request failed');
  }

  return res.json();
}
