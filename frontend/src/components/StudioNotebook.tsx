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
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ProjectNote } from '../types';
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
  initialNewNote?: { title: string; content: string; source_citation_ids?: string[] } | null;
  onClearInitialNote?: () => void;
}

export const StudioNotebook: React.FC<StudioNotebookProps> = ({
  projectId,
  projectName,
  onNotesCountChange,
  initialNewNote,
  onClearInitialNote,
}) => {
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');

  // Form state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [sourceCitationIds, setSourceCitationIds] = useState<string[]>([]);

  // Status & loading
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);

  useEffect(() => {
    if (projectId) {
      loadNotes();
    }
  }, [projectId]);

  // Handle incoming note draft from chat or outside
  useEffect(() => {
    if (initialNewNote) {
      handleCreateNewDraft(
        initialNewNote.title,
        initialNewNote.content,
        initialNewNote.source_citation_ids || []
      );
      onClearInitialNote?.();
    }
  }, [initialNewNote]);

  const loadNotes = async () => {
    try {
      setIsLoading(true);
      const data = await fetchProjectNotes(projectId);
      setNotes(data);
      onNotesCountChange?.(data.length);
      if (data.length > 0 && !selectedNoteId) {
        selectNote(data[0]);
      } else if (data.length === 0) {
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
    setSaveSuccess(false);
  };

  const handleCreateNewDraft = (
    defaultTitle = 'Nueva Nota de Investigación',
    defaultContent = '',
    defaultCitations: string[] = []
  ) => {
    setSelectedNoteId(null);
    setTitle(defaultTitle);
    setContent(defaultContent);
    setTags(['síntesis']);
    setSourceCitationIds(defaultCitations);
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
        });
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      } else {
        // Create new note
        const created = await createProjectNote(projectId, {
          title: title.trim(),
          content: content.trim(),
          tags,
          source_citation_ids: sourceCitationIds,
        });
        setNotes((prev) => [created, ...prev]);
        setSelectedNoteId(created.id);
        onNotesCountChange?.(notes.length + 1);
      }
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
    <div className="flex-1 flex h-full bg-slate-950 text-slate-200 overflow-hidden">
      {/* Left Column: Notes List & Filter */}
      <div className="w-80 h-full border-r border-slate-800 flex flex-col bg-slate-900/40 shrink-0">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Cuaderno de Síntesis
            </h3>
          </div>
          <button
            type="button"
            onClick={() => handleCreateNewDraft()}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nota</span>
          </button>
        </div>

        {/* Search & Tags Filter */}
        <div className="p-3 border-b border-slate-800 space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Buscar en notas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {allTags.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-[11px]">
              <button
                type="button"
                onClick={() => setSelectedTag(null)}
                className={`px-2 py-0.5 rounded-full whitespace-nowrap transition cursor-pointer ${
                  selectedTag === null
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Todas
              </button>
              {allTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSelectedTag(selectedTag === t ? null : t)}
                  className={`px-2 py-0.5 rounded-full whitespace-nowrap transition cursor-pointer ${
                    selectedTag === t
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
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
            <div className="p-6 text-center text-xs text-slate-500">Cargando notas...</div>
          ) : filteredNotes.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 space-y-2">
              <Layers className="w-8 h-8 text-slate-600 mx-auto opacity-50" />
              <p>No hay notas que coincidan con la búsqueda.</p>
            </div>
          ) : (
            filteredNotes.map((note) => {
              const isSelected = selectedNoteId === note.id;
              return (
                <div
                  key={note.id}
                  onClick={() => selectNote(note)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer group relative ${
                    isSelected
                      ? 'bg-indigo-950/40 border-indigo-500/50 shadow-sm'
                      : 'bg-slate-900/30 border-slate-800/60 hover:bg-slate-800/40 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4
                      className={`text-xs font-semibold truncate ${
                        isSelected ? 'text-indigo-300' : 'text-slate-200'
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
                      className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 p-1 transition-opacity cursor-pointer"
                      title="Eliminar nota"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-400 line-clamp-2 mt-1 leading-relaxed">
                    {note.content.replace(/[#*`_]/g, '') || 'Nota sin contenido...'}
                  </p>

                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {note.tags?.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50"
                      >
                        #{t}
                      </span>
                    ))}
                    <span className="text-[9px] text-slate-500 ml-auto">
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
      <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden">
        {/* Top Control Bar */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-4 bg-slate-900/20">
          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('edit')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md transition cursor-pointer ${
                  viewMode === 'edit'
                    ? 'bg-indigo-600 text-white font-medium shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Editar</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('preview')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md transition cursor-pointer ${
                  viewMode === 'preview'
                    ? 'bg-indigo-600 text-white font-medium shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Vista Previa</span>
              </button>
            </div>

            {saveSuccess && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 animate-in fade-in">
                <Check className="w-3 h-3" /> Guardado
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Export Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
                disabled={isExporting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-indigo-400" />
                <span>Exportar Proyecto</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {isExportDropdownOpen && (
                <div className="absolute right-0 mt-1.5 w-60 bg-slate-900 border border-slate-800 rounded-xl shadow-xl z-30 py-1 text-xs animate-in fade-in">
                  <button
                    type="button"
                    onClick={() => handleExport('markdown')}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-start gap-2 text-slate-200 cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Dossier Ejecutivo (.md)</p>
                      <p className="text-[10px] text-slate-400">
                        Corpus, Guías de Estudio, Módulos y Notas
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport('bibtex')}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-start gap-2 text-slate-200 cursor-pointer border-t border-slate-800"
                  >
                    <BookOpen className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Bibliografía BibTeX (.bib)</p>
                      <p className="text-[10px] text-slate-400">
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
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow-sm transition cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Guardando...' : 'Guardar Nota'}</span>
            </button>
          </div>
        </div>

        {/* Note Title & Tags Bar */}
        <div className="px-6 pt-5 pb-3 border-b border-slate-900 space-y-3">
          <input
            type="text"
            placeholder="Título de la síntesis o hallazgo..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-transparent text-lg font-bold text-white placeholder-slate-600 focus:outline-none tracking-tight"
          />

          <div className="flex items-center gap-2 flex-wrap">
            <Tag className="w-3 h-3 text-slate-500 shrink-0" />
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-indigo-950/60 text-indigo-300 border border-indigo-500/30"
              >
                #{t}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(t)}
                  className="hover:text-rose-400 ml-0.5 cursor-pointer"
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
              className="bg-transparent text-xs text-slate-300 placeholder-slate-600 focus:outline-none w-44"
            />
          </div>
        </div>

        {/* Note Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {viewMode === 'edit' ? (
            <textarea
              placeholder="Escribe tu análisis, síntesis de evidencia, hipótesis de investigación o conclusiones en Markdown..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-full bg-transparent text-sm text-slate-200 placeholder-slate-600 font-mono leading-relaxed resize-none focus:outline-none focus:ring-0"
            />
          ) : (
            <div className="prose prose-invert prose-slate max-w-none text-sm leading-relaxed space-y-3">
              {content.trim() ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              ) : (
                <p className="text-slate-600 italic">No hay contenido para previsualizar...</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
