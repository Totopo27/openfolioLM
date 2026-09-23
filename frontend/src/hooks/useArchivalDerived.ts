import { useMemo } from 'react';
import { SourceDocument } from '../types';
import { ArchivalDocument } from '../components/archival/ArchivalIndex';
import { DocumentSourceChunk } from '../components/archival/ArchivalSplitViewer';

export function useArchivalDerived(
  sources: SourceDocument[],
  selectedDoc: SourceDocument | null
) {
  const archivalDocuments: ArchivalDocument[] = useMemo(() => {
    return sources.map((s) => {
      const meta = s.metadata || {};
      const authors = meta.author
        ? [meta.author]
        : (meta.authors || ['Autor no especificado']);
      let year = new Date(s.created_at || Date.now()).getFullYear();
      if (meta.year_or_era) {
        const parsed = parseInt(meta.year_or_era, 10);
        if (!isNaN(parsed)) year = parsed;
      }
      const fileSize = s.char_count
        ? `${(s.char_count / 1024).toFixed(1)} KB`
        : 'N/A';

      return {
        id: s.id,
        title: meta.title || s.filename || 'Documento sin título',
        authors: Array.isArray(authors) ? authors : [String(authors)],
        year,
        doi: meta.doi || undefined,
        openAccess: Boolean(meta.source_url || meta.doi || meta.is_open_access),
        status: 'indexed' as const,
        chunkCount: Math.max(1, Math.ceil((s.char_count || 1000) / 1200)),
        fileSize,
        addedAt: s.created_at
          ? new Date(s.created_at).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0],
        category: meta.category || undefined,
        tags: Array.isArray(meta.tags) ? meta.tags : undefined,
        isAudio: Boolean(meta.is_audio || s.mime_type?.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(s.filename)),
        isYouTube: Boolean(meta.is_youtube),
        isCode: Boolean(meta.is_code || meta.is_repo),
        rawSource: s,
      };
    });
  }, [sources]);

  const archivalChunks: DocumentSourceChunk[] = useMemo(() => {
    if (!selectedDoc || !selectedDoc.raw_markdown) return [];
    const raw = selectedDoc.raw_markdown;
    const paragraphs = raw.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    if (paragraphs.length === 0) {
      return [
        {
          id: `${selectedDoc.id}-1`,
          chunkIndex: 1,
          pageNumber: 1,
          content: raw,
        },
      ];
    }
    return paragraphs.map((p, idx) => {
      const headingMatch = p.match(/^#{1,4}\s+(.+)$/m);
      const heading = headingMatch ? [headingMatch[1]] : undefined;
      const pageMatch = p.match(/<!-- PAGE: (\d+) -->/);
      const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : Math.floor(idx / 4) + 1;
      const cleanContent = p.replace(/<!-- PAGE: \d+ -->/g, '').trim();

      return {
        id: `${selectedDoc.id}-${idx + 1}`,
        chunkIndex: idx + 1,
        pageNumber: pageNum,
        headingPath: heading,
        content: cleanContent,
      };
    });
  }, [selectedDoc]);

  const selectedDocAuthors = useMemo(() => {
    if (!selectedDoc?.metadata) return ['Autor no especificado'];
    if (selectedDoc.metadata.author) return [selectedDoc.metadata.author];
    if (Array.isArray(selectedDoc.metadata.authors)) return selectedDoc.metadata.authors;
    return ['Autor no especificado'];
  }, [selectedDoc]);

  return {
    archivalDocuments,
    archivalChunks,
    selectedDocAuthors,
  };
}
