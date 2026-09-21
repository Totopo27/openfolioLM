import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Plus,
  Search,
  Tag,
  Trash2,
  Save,
  Download,
  Eye,
  Edit3,
  Check,
  Layers,
  ChevronDown,
  FileText,
  MessageSquare,
  HelpCircle,
  ExternalLink,
  Bookmark,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ProjectNote, ChatMessage, SourceDocument, Citation } from '../types';
import {
  fetchProjectNotes,
  createProjectNote,
  updateProjectNote,
  deleteProjectNote,
  downloadProjectExport,
} from '../services/api';

interface StudioNotebookProps {
  projectId: string;
  projectName: string;
  onNotesCountChange?: (count: number) => void;
  targetNoteId?: string | null;
  onClearTargetNote?: () => void;
  initialNewNote?: {
    title: string;
    content: string;
    source_citation_ids?: string[];
    origin_prompt?: string;
    source_message_id?: string;
  } | null;
  onClearInitialNote?: () => void;
  onNavigateToChat?: (sourceMessageId?: string) => void;
  onNavigateToSource?: (sourceCitationId?: string, citationIndex?: number) => void;
  messages?: ChatMessage[];
  sources?: SourceDocument[];
  onNavigateToCitation?: (citation: Citation) => void;
}

export const StudioNotebook: React.FC<StudioNotebookProps> = ({
  projectId,
  projectName,
  onNotesCountChange,
  targetNoteId,
  onClearTargetNote,
  initialNewNote,
  onClearInitialNote,
  onNavigateToChat,
  onNavigateToSource,
  messages = [],
  sources = [],
  onNavigateToCitation,
}) => {
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('preview');

  // Form state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [sourceCitationIds, setSourceCitationIds] = useState<string[]>([]);
  const [originPrompt, setOriginPrompt] = useState<string | null>(null);
  const [sourceMessageId, setSourceMessageId] = useState<string | null>(null);

  // Status & loading
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);

  useEffect(() => {
    if (projectId) {
      loadNotes(targetNoteId);
    }
  }, [projectId]);

  useEffect(() => {
    if (targetNoteId) {
      loadNotes(targetNoteId);
    }
  }, [targetNoteId]);

  // Handle incoming note draft from chat or outside
  useEffect(() => {
    if (initialNewNote) {
      handleCreateNewDraft(
        initialNewNote.title,
        initialNewNote.content,
        initialNewNote.source_citation_ids || [],
        initialNewNote.origin_prompt || null,
        initialNewNote.source_message_id || null
      );
      onClearInitialNote?.();
    }
  }, [initialNewNote]);

  const handleCitationClickFromNote = (cIndex: number, targetCId?: string) => {
    // 1. Try finding origin message
    if (sourceMessageId && messages && messages.length > 0) {
      const originMsg = messages.find((m) => m.id === sourceMessageId);
      if (originMsg?.citations && originMsg.citations.length > 0) {
        const matchedCit =
          originMsg.citations.find((c) => c.index === cIndex) ||
          (targetCId ? originMsg.citations.find((c) => c.chunk_id === targetCId) : undefined) ||
          originMsg.citations[cIndex - 1];
        if (matchedCit && onNavigateToCitation) {
          onNavigateToCitation(matchedCit);
          return;
        }
      }
    }

    // 2. Try searching in all messages' citations
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        if (msg.citations && msg.citations.length > 0) {
          const matchedCit =
            (targetCId ? msg.citations.find((c) => c.chunk_id === targetCId) : undefined) ||
            (originPrompt && msg.text.includes(originPrompt) ? msg.citations.find((c) => c.index === cIndex) : undefined);
          if (matchedCit && onNavigateToCitation) {
            onNavigateToCitation(matchedCit);
            return;
          }
        }
      }
    }

    // 3. Try matching targetCId in sources
    if (sources && sources.length > 0 && targetCId) {
      const matchedSource = sources.find((s) => s.id === targetCId);
      if (matchedSource && onNavigateToCitation) {
        onNavigateToCitation({
          index: cIndex,
          chunk_id: targetCId,
          source_id: matchedSource.id,
          source_filename: matchedSource.filename,
          heading_path: [],
          start_char: 0,
          end_char: 0,
          quote_snippet: '',
        });
        return;
      }
    }

    // 4. Fallback to onNavigateToSource / onNavigateToChat
    if (onNavigateToSource) {
      onNavigateToSource(targetCId, cIndex);
    } else if (onNavigateToChat) {
      onNavigateToChat(sourceMessageId || undefined);
    }
  };

  const renderTextWithFootnoteButtons = (childText: string) => {
    const parts = childText.split(/(\[\^?\d+\])/g);
    return parts.map((part, pIdx) => {
      const match = part.match(/\[\^?(\d+)\]/);
      if (match) {
        const cIndex = parseInt(match[1], 10);
        const targetCId = sourceCitationIds[cIndex - 1];
        return (
          <button
            key={pIdx}
            type="button"
            onClick={() => handleCitationClickFromNote(cIndex, targetCId)}
            className="inline-flex items-center justify-center px-1.5 py-0.2 mx-0.5 text-[10px] font-mono font-bold bg-[#EBEBE8] dark:bg-[#222226] text-[#1A56DB] dark:text-[#60A5FA] border border-[#E0E0DC] dark:border-[#2A2A2E] hover:bg-[#1A56DB] hover:text-white dark:hover:bg-[#1A56DB] dark:hover:text-white transition-colors cursor-pointer align-baseline select-none"
            title={`Ir a la referencia [${cIndex}] en el texto`}
          >
            [{cIndex}]
          </button>
        );
      }
      return part;
    });
  };

  const processNodeChildren = (children: React.ReactNode): React.ReactNode => {
    return React.Children.map(children, (child) => {
      if (typeof child === 'string') {
        return renderTextWithFootnoteButtons(child);
      }
      if (React.isValidElement(child) && (child.props as any)?.children) {
        return React.cloneElement(child, {
          ...(child.props as any),
          children: processNodeChildren((child.props as any).children),
        });
      }
      return child;
    });
  };

  const loadNotes = async (selectTargetId?: string | null) => {
    try {
      setIsLoading(true);
      const data = await fetchProjectNotes(projectId);
      setNotes(data);
      onNotesCountChange?.(data.length);

      const toSelectId = selectTargetId || targetNoteId;
      if (toSelectId) {
        const found = data.find((n) => n.id === toSelectId);
        if (found) {
          selectNote(found);
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 2500);
          onClearTargetNote?.();
          return;
        }
      }

      // If there is an unsaved initial draft, do not clobber it with data[0]
      if (initialNewNote) {
        return;
      }

      if (data.length > 0 && !selectedNoteId) {
        selectNote(data[0]);
      } else if (data.length === 0 && !selectedNoteId) {
        handleCreateNewDraft();
      }
    } catch (err) {
      console.error('Error loading notes:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const selectNote = (note: ProjectNote) => {
    setSelectedNoteId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setTags(note.tags || []);
    setSourceCitationIds(note.source_citation_ids || []);
    setOriginPrompt(note.origin_prompt || null);
    setSourceMessageId(note.source_message_id || null);
    setViewMode('preview');
    setSaveSuccess(false);
  };

  const handleCreateNewDraft = (
    defaultTitle = 'Nueva Nota de Investigación',
    defaultContent = '',
    defaultCitations: string[] = [],
    defaultOriginPrompt: string | null = null,
    defaultMessageId: string | null = null
  ) => {
    setSelectedNoteId(null);
    setTitle(defaultTitle);
    setContent(defaultContent);
    setTags(['síntesis']);
    setSourceCitationIds(defaultCitations);
    setOriginPrompt(defaultOriginPrompt);
    setSourceMessageId(defaultMessageId);
    setViewMode('edit');
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;

    try {
      setIsSaving(true);
      if (selectedNoteId) {
        // Update existing note
        const updated = await updateProjectNote(projectId, selectedNoteId, {
          title: title.trim(),
          content: content.trim(),
          tags,
          source_citation_ids: sourceCitationIds,
          origin_prompt: originPrompt || undefined,
          source_message_id: sourceMessageId || undefined,
        });
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      } else {
        // Create new note
        const created = await createProjectNote(projectId, {
          title: title.trim(),
          content: content.trim(),
          tags,
          source_citation_ids: sourceCitationIds,
          origin_prompt: originPrompt || undefined,
          source_message_id: sourceMessageId || undefined,
        });
        setNotes((prev) => [created, ...prev]);
        setSelectedNoteId(created.id);
        onNotesCountChange?.(notes.length + 1);
      }
      setViewMode('preview');
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error('Error saving note:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (noteId: string) => {
    if (!window.confirm('¿Seguro que deseas eliminar esta nota analítica?')) return;

    try {
      await deleteProjectNote(projectId, noteId);
      const remaining = notes.filter((n) => n.id !== noteId);
      setNotes(remaining);
      onNotesCountChange?.(remaining.length);

      if (selectedNoteId === noteId) {
        if (remaining.length > 0) {
          selectNote(remaining[0]);
        } else {
          handleCreateNewDraft();
        }
      }
    } catch (err) {
      console.error('Error deleting note:', err);
    }
  };

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const cleaned = tagInput.trim().replace(/^#/, '').toLowerCase();
      if (cleaned && !tags.includes(cleaned)) {
        setTags([...tags, cleaned]);
      }
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleExport = async (format: 'markdown' | 'bibtex') => {
    setIsExportDropdownOpen(false);
    try {
      setIsExporting(true);
      await downloadProjectExport(projectId, projectName, format);
    } catch (err) {
      console.error('Export error:', err);
      alert(`Error exportando proyecto: ${(err as Error).message}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Collect unique tags across all notes
  const allTags = Array.from(new Set(notes.flatMap((n) => n.tags || [])));

  // Filter notes
  const filteredNotes = notes.filter((n) => {
    const matchesSearch =
      n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTag = !selectedTag || (n.tags && n.tags.includes(selectedTag));
    return matchesSearch && matchesTag;
  });

  return (
    <div className="flex-1 flex h-full bg-[#F9F9F8] dark:bg-[#121214] text-[#1A1A1A] dark:text-[#EDEDED] overflow-hidden select-none">
      {/* Left Column: Notes List & Filter */}
      <div className="w-80 h-full border-r border-[#E0E0DC] dark:border-[#2A2A2E] flex flex-col bg-[#F9F9F8] dark:bg-[#121214] shrink-0">
        {/* Header */}
        <div className="p-3.5 border-b border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#19191C] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-[#1A56DB] dark:text-[#60A5FA]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider font-mono text-[#1A1A1A] dark:text-[#EDEDED]">
              Cuaderno de Síntesis
            </h3>
          </div>
          <button
            type="button"
            onClick={() => handleCreateNewDraft()}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-mono font-medium bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nueva Nota</span>
          </button>
        </div>

        {/* Search & Tags Filter */}
        <div className="p-3 border-b border-[#E0E0DC] dark:border-[#2A2A2E] space-y-2 bg-[#F9F9F8] dark:bg-[#121214]">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#666666] dark:text-[#888888] absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Buscar en notas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#F2F2F0] dark:bg-[#19191C] border border-[#E0E0DC] dark:border-[#2A2A2E] pl-8 pr-3 py-1.5 text-xs text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] font-mono focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED]"
            />
          </div>

          {allTags.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none font-mono text-[10px]">
              <button
                type="button"
                onClick={() => setSelectedTag(null)}
                className={`px-2 py-0.5 border transition cursor-pointer ${
                  selectedTag === null
                    ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] border-[#1A1A1A] dark:border-[#EDEDED]'
                    : 'bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#666666] dark:text-[#888888] border-[#E0E0DC] dark:border-[#2A2A2E]'
                }`}
              >
                Todas
              </button>
              {allTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSelectedTag(selectedTag === t ? null : t)}
                  className={`px-2 py-0.5 border transition cursor-pointer ${
                    selectedTag === t
                      ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] border-[#1A1A1A] dark:border-[#EDEDED]'
                      : 'bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#666666] dark:text-[#888888] border-[#E0E0DC] dark:border-[#2A2A2E]'
                  }`}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Notes Scroll List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {isLoading ? (
            <div className="p-6 text-center text-xs font-mono text-[#666666] dark:text-[#888888]">Cargando notas...</div>
          ) : filteredNotes.length === 0 ? (
            <div className="p-6 text-center text-xs font-mono text-[#666666] dark:text-[#888888] space-y-2">
              <Layers className="w-8 h-8 text-[#999999] dark:text-[#555555] mx-auto opacity-50" />
              <p>No hay notas que coincidan con la búsqueda.</p>
            </div>
          ) : (
            filteredNotes.map((note) => {
              const isSelected = selectedNoteId === note.id;
              return (
                <div
                  key={note.id}
                  onClick={() => selectNote(note)}
                  className={`p-3 border transition-all cursor-pointer group relative ${
                    isSelected
                      ? 'bg-[#EBEBE8] dark:bg-[#222226] border-[#1A1A1A] dark:border-[#EDEDED] border-l-4 border-l-[#1A56DB] dark:border-l-[#60A5FA]'
                      : 'bg-[#FFFFFF] dark:bg-[#18181B] border-[#E0E0DC] dark:border-[#2A2A2E] hover:bg-[#F2F2F0] dark:hover:bg-[#1E1E22]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4
                      className={`text-xs font-semibold truncate ${
                        isSelected ? 'text-[#1A56DB] dark:text-[#60A5FA]' : 'text-[#1A1A1A] dark:text-[#EDEDED]'
                      }`}
                    >
                      {note.title}
                    </h4>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(note.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-[#999999] hover:text-rose-600 p-1 transition-opacity cursor-pointer"
                      title="Eliminar nota"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <p className="text-[11px] text-[#666666] dark:text-[#888888] line-clamp-2 mt-1 leading-relaxed font-sans">
                    {note.content.replace(/[#*`_]/g, '') || 'Nota sin contenido...'}
                  </p>

                  <div className="flex items-center gap-1.5 mt-2 flex-wrap font-mono text-[9px]">
                    {note.origin_prompt && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A56DB] dark:text-[#60A5FA] border border-[#E0E0DC] dark:border-[#2A2A2E] font-medium"
                        title="Nota generada desde el Chat"
                      >
                        <MessageSquare className="w-2.5 h-2.5" />
                        Chat
                      </span>
                    )}
                    {note.tags?.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center px-1.5 py-0.5 bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#666666] dark:text-[#888888] border border-[#E0E0DC] dark:border-[#2A2A2E]"
                      >
                        #{t}
                      </span>
                    ))}
                    <span className="text-[9px] text-[#999999] dark:text-[#666666] ml-auto tabular-nums">
                      {new Date(note.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Column: Active Note Editor & Exporter */}
      <div className="flex-1 flex flex-col h-full bg-[#F9F9F8] dark:bg-[#121214] overflow-hidden">
        {/* Top Control Bar */}
        <div className="p-3.5 border-b border-[#E0E0DC] dark:border-[#2A2A2E] flex items-center justify-between gap-4 bg-[#F2F2F0] dark:bg-[#19191C]">
          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#EBEBE8] dark:bg-[#1E1E22] text-xs font-mono">
              <button
                type="button"
                onClick={() => setViewMode('preview')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 transition cursor-pointer ${
                  viewMode === 'preview'
                    ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] font-bold'
                    : 'text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED]'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Vista Previa</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('edit')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 border-l border-[#E0E0DC] dark:border-[#2A2A2E] transition cursor-pointer ${
                  viewMode === 'edit'
                    ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] font-bold'
                    : 'text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED]'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Editar</span>
              </button>
            </div>

            {saveSuccess && (
              <span className="inline-flex items-center gap-1 text-xs font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-1 border border-emerald-500/20">
                <Check className="w-3 h-3" /> Guardado
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Export Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
                disabled={isExporting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#EBEBE8] hover:bg-[#E0E0DC] dark:bg-[#1E1E22] dark:hover:bg-[#2A2A2E] text-[#1A1A1A] dark:text-[#EDEDED] text-xs font-mono font-medium border border-[#E0E0DC] dark:border-[#2A2A2E] transition cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-[#1A56DB] dark:text-[#60A5FA]" />
                <span>Exportar Proyecto</span>
                <ChevronDown className="w-3 h-3 text-[#666666] dark:text-[#888888]" />
              </button>

              {isExportDropdownOpen && (
                <div className="absolute right-0 mt-1.5 w-60 bg-[#F9F9F8] dark:bg-[#121214] border border-[#E0E0DC] dark:border-[#2A2A2E] shadow-xl z-30 py-1 text-xs font-mono">
                  <button
                    type="button"
                    onClick={() => handleExport('markdown')}
                    className="w-full text-left px-3 py-2 hover:bg-[#EBEBE8] dark:hover:bg-[#1E1E22] flex items-start gap-2 text-[#1A1A1A] dark:text-[#EDEDED] cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-[#1A56DB] shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Dossier Ejecutivo (.md)</p>
                      <p className="text-[10px] text-[#666666] dark:text-[#888888]">
                        Corpus, Guías de Estudio, Módulos y Notas
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport('bibtex')}
                    className="w-full text-left px-3 py-2 hover:bg-[#EBEBE8] dark:hover:bg-[#1E1E22] flex items-start gap-2 text-[#1A1A1A] dark:text-[#EDEDED] cursor-pointer border-t border-[#E0E0DC] dark:border-[#2A2A2E]"
                  >
                    <BookOpen className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Bibliografía BibTeX (.bib)</p>
                      <p className="text-[10px] text-[#666666] dark:text-[#888888]">
                        Citas estándar con DOI y metadatos
                      </p>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Save Button */}
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !title.trim()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] text-xs font-mono font-medium tracking-wide uppercase transition cursor-pointer disabled:opacity-40"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Guardando...' : 'Guardar Nota'}</span>
            </button>
          </div>
        </div>

        {/* Note Title & Tags Bar */}
        <div className="px-6 pt-4 pb-3 border-b border-[#E0E0DC] dark:border-[#2A2A2E] space-y-2.5 bg-[#F9F9F8] dark:bg-[#121214]">
          <input
            type="text"
            placeholder="Título de la síntesis o hallazgo..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-transparent text-lg font-bold text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none tracking-tight font-sans"
          />

          <div className="flex items-center gap-2 flex-wrap font-mono text-xs">
            <Tag className="w-3 h-3 text-[#666666] dark:text-[#888888] shrink-0" />
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A1A1A] dark:text-[#EDEDED] border border-[#E0E0DC] dark:border-[#2A2A2E]"
              >
                #{t}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(t)}
                  className="hover:text-rose-600 ml-0.5 cursor-pointer"
                >
                  ×
                </button>
              </span>
            ))}
            <input
              type="text"
              placeholder="+ Añadir etiqueta (Enter)..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleAddTag}
              className="bg-transparent text-xs text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none w-44 font-mono"
            />
          </div>
        </div>

        {/* Origin Prompt Context Card */}
        {originPrompt && (
          <div className="mx-6 mt-4 p-3 bg-[#F2F2F0] dark:bg-[#19191C] border border-[#E0E0DC] dark:border-[#2A2A2E] flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold font-mono text-[#1A56DB] dark:text-[#60A5FA]">
                <HelpCircle className="w-3.5 h-3.5" />
                Consulta de Origen (Chat)
              </span>
              {onNavigateToChat && (
                <button
                  type="button"
                  onClick={() => onNavigateToChat(sourceMessageId || undefined)}
                  className="inline-flex items-center gap-1.5 text-xs font-mono text-[#1A1A1A] dark:text-[#EDEDED] bg-[#EBEBE8] dark:bg-[#1E1E22] hover:bg-[#E0E0DC] dark:hover:bg-[#2A2A2E] px-2.5 py-1 border border-[#E0E0DC] dark:border-[#2A2A2E] transition-all font-medium cursor-pointer"
                  title="Regresar a la conversación del chat donde se generó esta respuesta"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-[#1A56DB] dark:text-[#60A5FA]" />
                  <span>Ver en Chat</span>
                  <ExternalLink className="w-3 h-3 text-[#666666] dark:text-[#888888]" />
                </button>
              )}
            </div>
            <p className="text-xs text-[#1A1A1A] dark:text-[#EDEDED] italic font-sans leading-relaxed pl-3 border-l-2 border-[#1A56DB] dark:border-[#60A5FA]">
              "{originPrompt}"
            </p>
          </div>
        )}

        {!originPrompt && tags.includes('chat') && onNavigateToChat && (
          <div className="mx-6 mt-3 flex items-center justify-end shrink-0">
            <button
              type="button"
              onClick={() => onNavigateToChat(sourceMessageId || undefined)}
              className="inline-flex items-center gap-1 text-[11px] font-mono text-[#1A56DB] dark:text-[#60A5FA] bg-[#EBEBE8] dark:bg-[#1E1E22] px-2.5 py-1 border border-[#E0E0DC] dark:border-[#2A2A2E] transition-all font-medium cursor-pointer"
              title="Regresar al chat"
            >
              <MessageSquare className="w-3 h-3" />
              <span>Ver en Chat</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Grounded Citations Bar */}
        {sourceCitationIds && sourceCitationIds.length > 0 && (
          <div className="mx-6 mt-3 p-3 bg-[#F2F2F0] dark:bg-[#19191C] border border-[#E0E0DC] dark:border-[#2A2A2E] flex items-center justify-between gap-3 shrink-0 flex-wrap">
            <div className="flex items-center gap-2">
              <Bookmark className="w-3.5 h-3.5 text-[#1A56DB] dark:text-[#60A5FA]" />
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-[#1A1A1A] dark:text-[#EDEDED]">
                Referencias Fundamentadas ({sourceCitationIds.length}):
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {sourceCitationIds.map((cId, idx) => {
                const cIndex = idx + 1;
                const originMsg = sourceMessageId ? messages?.find((m) => m.id === sourceMessageId) : null;
                const citDetail = originMsg?.citations?.find((c) => c.index === cIndex || c.chunk_id === cId);
                const label = citDetail?.source_filename
                  ? `[${cIndex}] ${citDetail.source_filename}${citDetail.page_number ? ` (P${citDetail.page_number})` : ''}`
                  : `[${cIndex}] Ver en Texto`;

                return (
                  <button
                    key={cId || idx}
                    type="button"
                    onClick={() => handleCitationClickFromNote(cIndex, cId)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono font-medium bg-[#EBEBE8] dark:bg-[#1E1E22] hover:bg-[#1A56DB] hover:text-white dark:hover:bg-[#1A56DB] dark:hover:text-white text-[#1A56DB] dark:text-[#60A5FA] border border-[#E0E0DC] dark:border-[#2A2A2E] transition-colors cursor-pointer"
                    title={citDetail?.quote_snippet ? `"${citDetail.quote_snippet.slice(0, 80)}..."` : `Ir a la referencia #${cIndex}`}
                  >
                    <span>{label}</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Note Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-[#F9F9F8] dark:bg-[#121214]">
          {viewMode === 'edit' ? (
            <textarea
              placeholder="Escribe tu análisis, síntesis de evidencia, hipótesis de investigación o conclusiones en Markdown..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-full bg-transparent text-xs text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] font-mono leading-relaxed resize-none focus:outline-none focus:ring-0"
            />
          ) : (
            <div className="prose dark:prose-invert max-w-none text-xs leading-relaxed space-y-3 font-sans text-[#1A1A1A] dark:text-[#EDEDED]">
              {content.trim() ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ node, children, ...props }) => (
                      <p {...props} className="leading-relaxed mb-3">
                        {processNodeChildren(children)}
                      </p>
                    ),
                    li: ({ node, children, ...props }) => (
                      <li {...props} className="leading-relaxed">
                        {processNodeChildren(children)}
                      </li>
                    ),
                    blockquote: ({ node, children, ...props }) => (
                      <blockquote {...props} className="border-l-2 border-[#1A56DB] pl-3 italic">
                        {processNodeChildren(children)}
                      </blockquote>
                    ),
                    sup: ({ node, children, ...props }) => (
                      <sup {...props}>
                        {processNodeChildren(children)}
                      </sup>
                    ),
                    a: ({ node, children, href, ...props }) => {
                      const isFootnote = href?.startsWith('#fn') || href?.startsWith('#user-content-fn');
                      if (isFootnote) {
                        const numMatch = href?.match(/\d+$/);
                        if (numMatch) {
                          const cIndex = parseInt(numMatch[0], 10);
                          const targetCId = sourceCitationIds[cIndex - 1];
                          return (
                            <button
                              type="button"
                              onClick={() => handleCitationClickFromNote(cIndex, targetCId)}
                              className="inline-flex items-center justify-center px-1.5 py-0.2 mx-0.5 text-[10px] font-mono font-bold bg-[#EBEBE8] dark:bg-[#222226] text-[#1A56DB] dark:text-[#60A5FA] border border-[#E0E0DC] dark:border-[#2A2A2E] hover:bg-[#1A56DB] hover:text-white dark:hover:bg-[#1A56DB] dark:hover:text-white transition-colors cursor-pointer align-baseline select-none"
                              title={`Ir a la referencia [${cIndex}] en el texto`}
                            >
                              [{cIndex}]
                            </button>
                          );
                        }
                      }
                      return (
                        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                          {processNodeChildren(children)}
                        </a>
                      );
                    },
                  }}
                >
                  {content}
                </ReactMarkdown>
              ) : (
                <p className="text-[#999999] dark:text-[#555555] italic">No hay contenido para previsualizar...</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
