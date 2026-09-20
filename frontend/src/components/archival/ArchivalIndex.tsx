import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  ExternalLink,
  CheckCircle2,
  Clock,
  ShieldAlert,
  Plus,
  ChevronDown,
  Upload,
  Headphones,
  Globe,
  BookOpen,
  FolderArchive,
  Tags,
  GraduationCap,
  Trash2,
  CheckSquare,
  Square,
  Sparkles,
  X,
  Loader2,
  FileText,
} from 'lucide-react';
import { SourceDocument, ActiveUploadTask } from '../../types';
import { autoclassifyAllSources } from '../../services/api';

export const YouTubeIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

export interface ArchivalDocument {
  id: string;
  title: string;
  authors: string[];
  year: number;
  doi?: string;
  openAccess: boolean;
  status: 'indexed' | 'processing' | 'error';
  chunkCount: number;
  fileSize: string;
  addedAt: string;
  category?: string;
  tags?: string[];
  isAudio?: boolean;
  isYouTube?: boolean;
  isCode?: boolean;
  rawSource?: SourceDocument;
}

interface ArchivalIndexProps {
  documents: ArchivalDocument[];
  selectedDocId?: string | null;
  activeSourceIds?: string[];
  projectId?: string;
  selectedEngine?: string;
  uploadTasks?: ActiveUploadTask[];
  onSelectDocument: (doc: ArchivalDocument, tab?: 'reading' | 'dossier' | 'taxonomy') => void;
  onOpenDossier?: (doc: ArchivalDocument) => void;
  onOpenTaxonomy?: (doc: ArchivalDocument) => void;
  onDeleteDocument?: (id: string) => Promise<void> | void;
  onUploadFile: (file: File) => Promise<void>;
  onIngestUrl?: (url: string, title?: string) => Promise<void>;
  onOpenDiscovery?: () => void;
  onSourcesAdded?: (newDocs: SourceDocument[]) => void;
  onAutoclassifyAll?: () => Promise<void>;
  onToggleActive?: (id: string) => void;
  onToggleAll?: () => void;
  onDismissUploadTask?: (taskId: string) => void;
  onRefreshSources?: () => Promise<void>;
}

export const ArchivalIndex: React.FC<ArchivalIndexProps> = ({
  documents,
  selectedDocId,
  activeSourceIds = [],
  projectId,
  selectedEngine,
  uploadTasks = [],
  onSelectDocument,
  onOpenDossier,
  onOpenTaxonomy,
  onDeleteDocument,
  onUploadFile,
  onIngestUrl,
  onOpenDiscovery,
  onAutoclassifyAll,
  onToggleActive,
  onToggleAll,
  onDismissUploadTask,
  onRefreshSources,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [filterOpenAccessOnly, setFilterOpenAccessOnly] = useState(false);
  const [sortField, setSortField] = useState<'year' | 'title' | 'addedAt'>('year');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // UI state for dropdown & modals
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isUrlModalOpen, setIsUrlModalOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [isIngestingUrl, setIsIngestingUrl] = useState(false);
  const [urlError, setUrlError] = useState('');

  // Autoclassify state
  const [isAutoclassifying, setIsAutoclassifying] = useState(false);
  const [autoclassifyFeedback, setAutoclassifyFeedback] = useState('');

  // Drag & drop state
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // File input refs
  const fileInputDocRef = useRef<HTMLInputElement>(null);
  const fileInputAudioRef = useRef<HTMLInputElement>(null);
  const fileInputCodeRef = useRef<HTMLInputElement>(null);
  const fileInputAllRef = useRef<HTMLInputElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Click outside add menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setIsAddMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Categories and tags aggregation
  const categoriesMap = new Map<string, number>();
  const tagsMap = new Map<string, number>();

  documents.forEach((d) => {
    if (d.category) {
      categoriesMap.set(d.category, (categoriesMap.get(d.category) || 0) + 1);
    }
    if (Array.isArray(d.tags)) {
      d.tags.forEach((t) => {
        if (t && t.trim()) {
          tagsMap.set(t.trim(), (tagsMap.get(t.trim()) || 0) + 1);
        }
      });
    }
  });

  const uniqueCategories = Array.from(categoriesMap.entries()).map(([name, count]) => ({ name, count }));
  const topTags = Array.from(tagsMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  // Filter and sort
  const filteredDocs = documents
    .filter((doc) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        doc.title.toLowerCase().includes(q) ||
        doc.authors.some((a) => a.toLowerCase().includes(q)) ||
        (doc.doi && doc.doi.toLowerCase().includes(q)) ||
        (doc.category && doc.category.toLowerCase().includes(q)) ||
        (doc.tags && doc.tags.some((t) => t.toLowerCase().includes(q)));

      const matchesOA = filterOpenAccessOnly ? doc.openAccess : true;
      const matchesCategory = !selectedCategory || doc.category === selectedCategory;
      const matchesTag = !selectedTag || (doc.tags && doc.tags.includes(selectedTag));

      return matchesSearch && matchesOA && matchesCategory && matchesTag;
    })
    .sort((a, b) => {
      const modifier = sortDirection === 'asc' ? 1 : -1;
      if (sortField === 'year') return (a.year - b.year) * modifier;
      if (sortField === 'title') return a.title.localeCompare(b.title) * modifier;
      return (new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()) * modifier;
    });

  const toggleSort = (field: 'year' | 'title' | 'addedAt') => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleProcessFiles = async (files: File[]) => {
    if (!files || files.length === 0) return;
    for (const f of files) {
      await onUploadFile(f);
    }
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || !onIngestUrl) return;

    let targetUrl = urlInput.trim();
    if (!/^https?:\/\//i.test(targetUrl) && !/^10\.\d{4,9}\//i.test(targetUrl)) {
      targetUrl = 'https://' + targetUrl;
    }

    try {
      setIsIngestingUrl(true);
      setUrlError('');
      await onIngestUrl(targetUrl, titleInput.trim() || undefined);
      setUrlInput('');
      setTitleInput('');
      setIsUrlModalOpen(false);
    } catch (err: any) {
      setUrlError(err.message || 'Error al procesar la fuente remota');
    } finally {
      setIsIngestingUrl(false);
    }
  };

  const handleRunAutoclassify = async () => {
    if (isAutoclassifying) return;
    if (onAutoclassifyAll) {
      try {
        setIsAutoclassifying(true);
        setAutoclassifyFeedback('Autoclasificando compendio con IA...');
        await onAutoclassifyAll();
        setAutoclassifyFeedback('¡Clasificación completada!');
        setTimeout(() => setAutoclassifyFeedback(''), 3500);
      } catch (err: any) {
        setAutoclassifyFeedback(err.message || 'Error al clasificar');
        setTimeout(() => setAutoclassifyFeedback(''), 3500);
      } finally {
        setIsAutoclassifying(false);
      }
      return;
    }

    if (!projectId) return;
    try {
      setIsAutoclassifying(true);
      setAutoclassifyFeedback('Analizando compendio con IA...');
      const res = await autoclassifyAllSources(projectId, selectedEngine);
      setAutoclassifyFeedback(`¡${res.classified_count} obras clasificadas!`);
      if (onRefreshSources) await onRefreshSources();
      setTimeout(() => setAutoclassifyFeedback(''), 3500);
    } catch (err: any) {
      setAutoclassifyFeedback(err.message || 'Error al clasificar');
      setTimeout(() => setAutoclassifyFeedback(''), 3500);
    } finally {
      setIsAutoclassifying(false);
    }
  };

  const allActive = documents.length > 0 && activeSourceIds.length === documents.length;

  return (
    <section
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounterRef.current += 1;
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounterRef.current -= 1;
        if (dragCounterRef.current <= 0) {
          setIsDragging(false);
          dragCounterRef.current = 0;
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault();
        setIsDragging(false);
        dragCounterRef.current = 0;
        const files = Array.from(e.dataTransfer.files || []);
        await handleProcessFiles(files);
      }}
      className="relative w-full h-full flex flex-col bg-[#F9F9F8] dark:bg-[#121214] text-[#1A1A1A] dark:text-[#EDEDED] font-sans antialiased select-none overflow-hidden"
      aria-label="Catálogo de Fuentes de Investigación"
    >
      {/* Hidden File Inputs for Different Modal Modalities */}
      <input
        type="file"
        multiple
        ref={fileInputAllRef}
        onChange={(e) => handleProcessFiles(Array.from(e.target.files || []))}
        className="hidden"
      />
      <input
        type="file"
        multiple
        ref={fileInputDocRef}
        accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.epub"
        onChange={(e) => handleProcessFiles(Array.from(e.target.files || []))}
        className="hidden"
      />
      <input
        type="file"
        multiple
        ref={fileInputAudioRef}
        accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac,.opus,.wma"
        onChange={(e) => handleProcessFiles(Array.from(e.target.files || []))}
        className="hidden"
      />
      <input
        type="file"
        multiple
        ref={fileInputCodeRef}
        accept=".zip,.tar,.gz,.tgz"
        onChange={(e) => handleProcessFiles(Array.from(e.target.files || []))}
        className="hidden"
      />

      {/* Drag & Drop Visual Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-[#F9F9F8]/90 dark:bg-[#121214]/90 border-2 border-dashed border-[#1A1A1A] dark:border-[#EDEDED] m-4 flex flex-col items-center justify-center pointer-events-none animate-in fade-in duration-150">
          <Upload className="w-8 h-8 text-[#1A1A1A] dark:text-[#EDEDED] mb-2 animate-bounce" />
          <p className="font-mono text-sm font-bold uppercase tracking-wider text-[#1A1A1A] dark:text-[#EDEDED]">
            Soltá los archivos aquí
          </p>
          <p className="font-sans text-xs text-[#666666] dark:text-[#888888] mt-1">
            Soporta PDF, DOCX, Audio (.mp3, .wav), Código (.zip) y Texto (.txt, .md)
          </p>
        </div>
      )}

      {/* Active Upload Tasks Strip */}
      {uploadTasks.length > 0 && (
        <div className="border-b border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#EBEBE8] dark:bg-[#1E1E22] px-4 py-2 flex flex-col gap-1.5 shrink-0">
          {uploadTasks
            .filter((t) => t.stage !== 'done')
            .map((task) => (
              <div key={task.id} className="flex items-center justify-between font-mono text-[11px] gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-[#1A56DB] animate-ping shrink-0" />
                  <span className="font-bold truncate text-[#1A1A1A] dark:text-[#EDEDED]">{task.name}</span>
                  <span className="text-[#666666] dark:text-[#888888]">({task.stage})</span>
                  <span className="text-[#666666] dark:text-[#888888] truncate">{task.statusText}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="w-24 h-1.5 bg-[#E0E0DC] dark:bg-[#2A2A2E] overflow-hidden">
                    <div
                      className="h-full bg-[#1A1A1A] dark:bg-[#EDEDED] transition-all duration-300"
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                  <span className="w-8 text-right tabular-nums">{task.progress}%</span>
                  {onDismissUploadTask && (
                    <button
                      type="button"
                      onClick={() => onDismissUploadTask(task.id)}
                      className="text-[#666666] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] p-0.5 cursor-pointer"
                      title="Descartar"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Header & Controls */}
      <header className="border-b border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214] shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between p-3.5 px-4 gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-xs uppercase tracking-widest text-[#666666] dark:text-[#888888] font-bold">
              Catálogo
            </span>
            <span aria-hidden="true" className="text-[#E0E0DC] dark:text-[#2A2A2E]">|</span>
            <h1 className="text-sm font-semibold tracking-tight font-sans">
              Fuentes de Investigación
            </h1>
            <span className="font-mono text-xs text-[#666666] dark:text-[#888888] tabular-nums bg-[#EBEBE8] dark:bg-[#222226] px-1.5 py-0.5 border border-[#E0E0DC] dark:border-[#2A2A2E]">
              {documents.length} {documents.length === 1 ? 'fuente' : 'fuentes'}
            </span>
            {activeSourceIds.length > 0 && (
              <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400 tabular-nums bg-emerald-500/10 px-1.5 py-0.5 border border-emerald-500/20">
                {activeSourceIds.length} en contexto activo
              </span>
            )}
            {autoclassifyFeedback && (
              <span className="font-mono text-xs text-[#1A56DB] dark:text-[#60A5FA] bg-[#1A56DB]/10 px-2 py-0.5 border border-[#1A56DB]/20 animate-fade-in">
                {autoclassifyFeedback}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Autoclassify Compendium Button */}
            <button
              type="button"
              onClick={handleRunAutoclassify}
              disabled={isAutoclassifying || documents.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#EBEBE8] hover:bg-[#E0E0DC] dark:bg-[#1E1E22] dark:hover:bg-[#2A2A2E] border border-[#E0E0DC] dark:border-[#2A2A2E] text-xs font-mono text-[#1A1A1A] dark:text-[#EDEDED] transition-colors cursor-pointer disabled:opacity-40"
              title="Analizar y clasificar todas las obras con IA"
            >
              {isAutoclassifying ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              )}
              <span>Autoclasificar Todo</span>
            </button>

            {/* Multi-modal "+ Agregar Fuente" Dropdown */}
            <div className="relative" ref={addMenuRef}>
              <button
                type="button"
                onClick={() => setIsAddMenuOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] text-xs font-mono font-medium tracking-wide uppercase transition-colors cursor-pointer"
                title="Desplegar modalidades de carga de fuentes"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Agregar Fuente</span>
                <ChevronDown className="w-3 h-3 ml-0.5 opacity-80" />
              </button>

              {isAddMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-64 bg-[#F9F9F8] dark:bg-[#121214] border border-[#E0E0DC] dark:border-[#2A2A2E] shadow-xl z-50 font-mono text-xs divide-y divide-[#E0E0DC] dark:divide-[#2A2A2E] animate-in fade-in duration-100">
                  {/* Option 1: Local Document */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      fileInputDocRef.current?.click();
                    }}
                    className="w-full flex items-start gap-2.5 p-2.5 hover:bg-[#EBEBE8] dark:hover:bg-[#1E1E22] transition-colors text-left cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-[#1A1A1A] dark:text-[#EDEDED] shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-[#1A1A1A] dark:text-[#EDEDED]">Documento Local</div>
                      <div className="text-[10px] text-[#666666] dark:text-[#888888] font-sans">
                        PDF, Word (.docx), TXT, Markdown, EPUB
                      </div>
                    </div>
                  </button>

                  {/* Option 2: Audio File */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      fileInputAudioRef.current?.click();
                    }}
                    className="w-full flex items-start gap-2.5 p-2.5 hover:bg-[#EBEBE8] dark:hover:bg-[#1E1E22] transition-colors text-left cursor-pointer"
                  >
                    <Headphones className="w-4 h-4 text-[#1A56DB] dark:text-[#60A5FA] shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-[#1A1A1A] dark:text-[#EDEDED]">Archivo de Audio</div>
                      <div className="text-[10px] text-[#666666] dark:text-[#888888] font-sans">
                        MP3, WAV, M4A, OGG con transcripción Whisper
                      </div>
                    </div>
                  </button>

                  {/* Option 3: Remote Link / DOI / YouTube */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      setUrlError('');
                      setIsUrlModalOpen(true);
                    }}
                    className="w-full flex items-start gap-2.5 p-2.5 hover:bg-[#EBEBE8] dark:hover:bg-[#1E1E22] transition-colors text-left cursor-pointer"
                  >
                    <Globe className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-[#1A1A1A] dark:text-[#EDEDED]">Enlace Web / DOI / YouTube</div>
                      <div className="text-[10px] text-[#666666] dark:text-[#888888] font-sans">
                        Artículos web, papers por DOI o videos YouTube
                      </div>
                    </div>
                  </button>

                  {/* Option 4: Literature Discovery */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      if (onOpenDiscovery) onOpenDiscovery();
                    }}
                    className="w-full flex items-start gap-2.5 p-2.5 hover:bg-[#EBEBE8] dark:hover:bg-[#1E1E22] transition-colors text-left cursor-pointer"
                  >
                    <BookOpen className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-[#1A1A1A] dark:text-[#EDEDED]">Literatura Científica</div>
                      <div className="text-[10px] text-[#666666] dark:text-[#888888] font-sans">
                        Búsqueda DOI y OpenAlex con indexación directa
                      </div>
                    </div>
                  </button>

                  {/* Option 5: Code Repository */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      fileInputCodeRef.current?.click();
                    }}
                    className="w-full flex items-start gap-2.5 p-2.5 hover:bg-[#EBEBE8] dark:hover:bg-[#1E1E22] transition-colors text-left cursor-pointer"
                  >
                    <FolderArchive className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-[#1A1A1A] dark:text-[#EDEDED]">Repositorio de Código</div>
                      <div className="text-[10px] text-[#666666] dark:text-[#888888] font-sans">
                        Paquete .ZIP para análisis AST y sintaxis
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Filter & Taxonomy Toolbar */}
        <div className="grid grid-cols-1 md:grid-cols-12 border-t border-[#E0E0DC] dark:border-[#2A2A2E] text-xs">
          {/* Search Box */}
          <div className="md:col-span-5 flex items-center px-3 py-2 border-b md:border-b-0 md:border-r border-[#E0E0DC] dark:border-[#2A2A2E]">
            <Search className="w-3.5 h-3.5 text-[#666666] dark:text-[#888888] mr-2 shrink-0" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por título, autor, DOI o categoría…"
              className="w-full bg-transparent border-none focus:outline-none text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] font-mono text-xs"
              aria-label="Buscar por título, autor, DOI o categoría"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-[#666666] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] p-0.5 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Category Filter Dropdown */}
          <div className="md:col-span-3 flex items-center px-3 py-2 border-b md:border-b-0 md:border-r border-[#E0E0DC] dark:border-[#2A2A2E] font-mono text-[11px]">
            <span className="text-[#666666] dark:text-[#888888] mr-2 shrink-0">CATEGORÍA:</span>
            <select
              value={selectedCategory || ''}
              onChange={(e) => setSelectedCategory(e.target.value || null)}
              className="w-full bg-transparent border-none focus:outline-none text-[#1A1A1A] dark:text-[#EDEDED] cursor-pointer truncate"
            >
              <option value="" className="bg-[#F9F9F8] dark:bg-[#121214]">TODAS ({documents.length})</option>
              {uniqueCategories.map((c) => (
                <option key={c.name} value={c.name} className="bg-[#F9F9F8] dark:bg-[#121214]">
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
          </div>

          {/* Open Access Toggle */}
          <div className="md:col-span-2 flex items-center px-3 py-2 border-b md:border-b-0 md:border-r border-[#E0E0DC] dark:border-[#2A2A2E]">
            <label className="flex items-center gap-2 cursor-pointer font-mono text-[11px] text-[#666666] dark:text-[#888888]">
              <input
                type="checkbox"
                checked={filterOpenAccessOnly}
                onChange={(e) => setFilterOpenAccessOnly(e.target.checked)}
                className="rounded-none border-[#E0E0DC] dark:border-[#2A2A2E] text-[#1A1A1A] focus:ring-0 cursor-pointer"
              />
              <span>ACCESO ABIERTO</span>
            </label>
          </div>

          {/* Sorting */}
          <div className="md:col-span-2 flex items-center justify-between px-3 py-2 font-mono text-[11px] text-[#666666] dark:text-[#888888]">
            <span className="uppercase">ORDEN:</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => toggleSort('year')}
                className={`hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] cursor-pointer ${
                  sortField === 'year' ? 'font-bold text-[#1A1A1A] dark:text-[#EDEDED] underline' : ''
                }`}
              >
                AÑO
              </button>
              <span>/</span>
              <button
                type="button"
                onClick={() => toggleSort('title')}
                className={`hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] cursor-pointer ${
                  sortField === 'title' ? 'font-bold text-[#1A1A1A] dark:text-[#EDEDED] underline' : ''
                }`}
              >
                TÍTULO
              </button>
            </div>
          </div>
        </div>

        {/* Top Tags Quick Filter Strip */}
        {topTags.length > 0 && (
          <div className="flex items-center gap-1.5 px-4 py-1.5 border-t border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#19191C] overflow-x-auto text-[10px] font-mono scrollbar-none">
            <span className="text-[#666666] dark:text-[#888888] uppercase shrink-0">Tags:</span>
            {selectedTag && (
              <button
                type="button"
                onClick={() => setSelectedTag(null)}
                className="px-1.5 py-0.5 bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] flex items-center gap-1 cursor-pointer shrink-0"
              >
                <span>Limpiar ({selectedTag})</span>
                <X className="w-2.5 h-2.5" />
              </button>
            )}
            {topTags.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => setSelectedTag(selectedTag === t.name ? null : t.name)}
                className={`px-1.5 py-0.5 border transition-colors cursor-pointer shrink-0 ${
                  selectedTag === t.name
                    ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] border-[#1A1A1A] dark:border-[#EDEDED]'
                    : 'bg-[#F9F9F8] dark:bg-[#121214] text-[#666666] dark:text-[#888888] border-[#E0E0DC] dark:border-[#2A2A2E] hover:border-[#1A1A1A] dark:hover:border-[#EDEDED]'
                }`}
              >
                #{t.name} ({t.count})
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Catalog Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse font-sans text-xs" role="table">
          <thead>
            <tr className="border-b border-[#E0E0DC] dark:border-[#2A2A2E] font-mono text-[11px] text-[#666666] dark:text-[#888888] uppercase bg-[#F2F2F0] dark:bg-[#19191C] sticky top-0 z-10">
              {/* Checkbox / N° */}
              <th scope="col" className="p-3 font-medium border-r border-[#E0E0DC] dark:border-[#2A2A2E] w-14 text-center">
                <div className="flex items-center justify-center gap-1">
                  {onToggleAll && (
                    <button
                      type="button"
                      onClick={onToggleAll}
                      className="text-[#666666] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] cursor-pointer"
                      title={allActive ? 'Desmarcar todas del contexto' : 'Marcar todas para contexto RAG'}
                    >
                      {allActive ? (
                        <CheckSquare className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Square className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                  <span>N°</span>
                </div>
              </th>

              <th scope="col" className="p-3 font-medium border-r border-[#E0E0DC] dark:border-[#2A2A2E]">
                Título, Autoría y Taxonomía
              </th>
              <th scope="col" className="p-3 font-medium border-r border-[#E0E0DC] dark:border-[#2A2A2E] w-20 text-center">
                Año
              </th>
              <th scope="col" className="p-3 font-medium border-r border-[#E0E0DC] dark:border-[#2A2A2E] w-48">
                DOI / Identificador
              </th>
              <th scope="col" className="p-3 font-medium border-r border-[#E0E0DC] dark:border-[#2A2A2E] w-24 text-right">
                Fragmentos
              </th>
              <th scope="col" className="p-3 font-medium border-r border-[#E0E0DC] dark:border-[#2A2A2E] w-28 text-center">
                Estado
              </th>
              <th scope="col" className="p-3 font-medium w-48 text-center">
                Acciones
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[#E0E0DC] dark:divide-[#2A2A2E]">
            {filteredDocs.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-12 text-center font-mono text-xs text-[#666666] dark:text-[#888888]">
                  [NO SE ENCONTRARON FUENTES QUE COINCIDAN CON LOS CRITERIOS]
                </td>
              </tr>
            ) : (
              filteredDocs.map((doc, idx) => {
                const isSelected = doc.id === selectedDocId;
                const isActive = activeSourceIds.includes(doc.id);

                return (
                  <tr
                    key={doc.id}
                    className={`group transition-colors ${
                      isSelected
                        ? 'bg-[#EBEBE8] dark:bg-[#222226] text-[#1A1A1A] dark:text-[#EDEDED]'
                        : 'hover:bg-[#F2F2F0] dark:hover:bg-[#19191C]'
                    }`}
                  >
                    {/* Active Checkbox + Index Number */}
                    <td className="p-3 border-r border-[#E0E0DC] dark:border-[#2A2A2E] font-mono text-[#666666] dark:text-[#888888] text-center tabular-nums">
                      <div className="flex items-center justify-center gap-1.5">
                        {onToggleActive && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleActive(doc.id);
                            }}
                            className="text-[#666666] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] cursor-pointer"
                            title={isActive ? 'Quitar del contexto RAG activo' : 'Incluir en contexto RAG activo'}
                          >
                            {isActive ? (
                              <CheckSquare className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <Square className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                        <span>{String(idx + 1).padStart(2, '0')}</span>
                      </div>
                    </td>

                    {/* Title, Authors & Tags */}
                    <td className="p-3 border-r border-[#E0E0DC] dark:border-[#2A2A2E] min-w-0">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => onSelectDocument(doc, 'reading')}
                            className="font-semibold text-sm leading-tight text-[#1A1A1A] dark:text-[#EDEDED] hover:underline text-left cursor-pointer truncate max-w-lg"
                            title={`Abrir ${doc.title}`}
                          >
                            {doc.title}
                          </button>
                          {doc.isYouTube && (
                            <span className="font-mono text-[9px] uppercase px-1 py-0.2 bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20 inline-flex items-center gap-1">
                              <YouTubeIcon className="w-2.5 h-2.5" /> YouTube
                            </span>
                          )}
                          {doc.isAudio && (
                            <span className="font-mono text-[9px] uppercase px-1 py-0.2 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-500/20 inline-flex items-center gap-1">
                              <Headphones className="w-2.5 h-2.5" /> Audio
                            </span>
                          )}
                          {doc.isCode && (
                            <span className="font-mono text-[9px] uppercase px-1 py-0.2 bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20 inline-flex items-center gap-1">
                              <FolderArchive className="w-2.5 h-2.5" /> Código
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-xs text-[#666666] dark:text-[#888888] font-sans truncate">
                          <span>{doc.authors.join(', ')}</span>
                          {doc.category && (
                            <>
                              <span>•</span>
                              <span className="font-mono text-[10px] text-[#1A56DB] dark:text-[#60A5FA]">
                                [{doc.category}]
                              </span>
                            </>
                          )}
                          {doc.tags && doc.tags.length > 0 && (
                            <>
                              <span>•</span>
                              <span className="font-mono text-[10px] text-[#888888]">
                                {doc.tags.slice(0, 3).map((t) => `#${t}`).join(' ')}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Year */}
                    <td className="p-3 border-r border-[#E0E0DC] dark:border-[#2A2A2E] font-mono tabular-nums text-[#1A1A1A] dark:text-[#EDEDED] text-center">
                      {doc.year}
                    </td>

                    {/* DOI / Access */}
                    <td className="p-3 border-r border-[#E0E0DC] dark:border-[#2A2A2E] font-mono text-[11px]">
                      <div className="flex flex-col gap-1">
                        {doc.doi ? (
                          <a
                            href={`https://doi.org/${doc.doi}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-[#1A56DB] dark:text-[#60A5FA] hover:underline truncate"
                            aria-label={`Abrir DOI ${doc.doi}`}
                          >
                            <span>{doc.doi}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                          </a>
                        ) : (
                          <span className="text-[#999999] dark:text-[#555555]">—</span>
                        )}
                        {doc.openAccess && (
                          <span className="font-mono text-[9px] uppercase px-1 py-0.2 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 w-max">
                            OPEN ACCESS
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Chunks */}
                    <td className="p-3 border-r border-[#E0E0DC] dark:border-[#2A2A2E] font-mono tabular-nums text-right text-[#666666] dark:text-[#888888]">
                      <div>{doc.chunkCount} chk</div>
                      <div className="text-[10px] text-[#999999] dark:text-[#555555]">{doc.fileSize}</div>
                    </td>

                    {/* Status */}
                    <td className="p-3 border-r border-[#E0E0DC] dark:border-[#2A2A2E] text-center font-mono text-[11px]">
                      {doc.status === 'indexed' && (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>INDEXADO</span>
                        </span>
                      )}
                      {doc.status === 'processing' && (
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 animate-pulse">
                          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>PROCESO</span>
                        </span>
                      )}
                      {doc.status === 'error' && (
                        <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400">
                          <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>ERROR</span>
                        </span>
                      )}
                    </td>

                    {/* Row Action Buttons: Lectura, Guía, Tags, Borrar */}
                    <td className="p-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {/* Lectura */}
                        <button
                          type="button"
                          onClick={() => onSelectDocument(doc, 'reading')}
                          className="p-1 px-1.5 bg-[#EBEBE8] hover:bg-[#E0E0DC] dark:bg-[#1E1E22] dark:hover:bg-[#2A2A2E] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[10px] font-mono text-[#1A1A1A] dark:text-[#EDEDED] inline-flex items-center gap-1 cursor-pointer transition-colors"
                          title="Abrir visor de lectura y citas"
                        >
                          <FileText className="w-3 h-3 text-[#1A56DB] dark:text-[#60A5FA]" />
                          <span>Lectura</span>
                        </button>

                        {/* Guía de Estudio */}
                        <button
                          type="button"
                          onClick={() => {
                            if (onOpenDossier) onOpenDossier(doc);
                            else onSelectDocument(doc, 'dossier');
                          }}
                          className="p-1 px-1.5 bg-[#EBEBE8] hover:bg-[#E0E0DC] dark:bg-[#1E1E22] dark:hover:bg-[#2A2A2E] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[10px] font-mono text-[#1A1A1A] dark:text-[#EDEDED] inline-flex items-center gap-1 cursor-pointer transition-colors"
                          title="Ver estructura y guía de estudio (Dossier)"
                        >
                          <GraduationCap className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                          <span>Guía</span>
                        </button>

                        {/* Categorías y Tags */}
                        <button
                          type="button"
                          onClick={() => {
                            if (onOpenTaxonomy) onOpenTaxonomy(doc);
                            else onSelectDocument(doc, 'taxonomy');
                          }}
                          className="p-1 px-1.5 bg-[#EBEBE8] hover:bg-[#E0E0DC] dark:bg-[#1E1E22] dark:hover:bg-[#2A2A2E] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[10px] font-mono text-[#1A1A1A] dark:text-[#EDEDED] inline-flex items-center gap-1 cursor-pointer transition-colors"
                          title="Gestionar taxonomía y etiquetas"
                        >
                          <Tags className="w-3 h-3 text-teal-600 dark:text-teal-400" />
                          <span>Tags</span>
                        </button>

                        {/* Borrar */}
                        {onDeleteDocument && (
                          <button
                            type="button"
                            onClick={() => onDeleteDocument(doc.id)}
                            className="p-1 px-1.5 bg-[#EBEBE8] hover:bg-rose-500/10 dark:bg-[#1E1E22] dark:hover:bg-rose-950/30 border border-[#E0E0DC] dark:border-[#2A2A2E] hover:border-rose-500/30 text-[10px] font-mono text-[#666666] hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer transition-colors"
                            title="Eliminar fuente de la investigación"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Info */}
      <footer className="border-t border-[#E0E0DC] dark:border-[#2A2A2E] p-2.5 px-4 font-mono text-[11px] text-[#666666] dark:text-[#888888] flex items-center justify-between bg-[#F2F2F0] dark:bg-[#19191C] shrink-0">
        <div>ESTADO: MOTOR DE GROUNDING ACTIVO</div>
        <div className="tabular-nums">TOTAL DE FRAGMENTOS: {documents.reduce((acc, d) => acc + d.chunkCount, 0)}</div>
      </footer>

      {/* URL / DOI / YouTube Ingestion Modal */}
      {isUrlModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-100">
          <div className="bg-[#F9F9F8] dark:bg-[#121214] border border-[#E0E0DC] dark:border-[#2A2A2E] shadow-2xl w-full max-w-md p-5 space-y-4 font-sans">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#E0E0DC] dark:border-[#2A2A2E] pb-3">
              <div className="flex items-center gap-2 text-[#1A1A1A] dark:text-[#EDEDED] font-semibold text-xs font-mono uppercase tracking-wider">
                <Globe className="w-4 h-4 text-[#1A56DB] dark:text-[#60A5FA]" />
                <span>Agregar Fuente Remota (Web / DOI / YouTube)</span>
              </div>
              <button
                type="button"
                onClick={() => !isIngestingUrl && setIsUrlModalOpen(false)}
                className="text-[#666666] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleUrlSubmit} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-[11px] font-bold text-[#666666] dark:text-[#888888] uppercase mb-1">
                  URL Web, DOI Académico o Enlace de YouTube *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  disabled={isIngestingUrl}
                  placeholder="https://... o 10.1353/pnm.2010.0009 o youtu.be/..."
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  className="w-full bg-[#EBEBE8] dark:bg-[#1E1E22] border border-[#E0E0DC] dark:border-[#2A2A2E] px-3 py-2 text-xs text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED]"
                />
                <p className="mt-1 text-[10px] text-[#666666] dark:text-[#888888] font-sans">
                  Detecta automáticamente páginas web, metadatos y PDF vía DOI (OpenAlex), y transcripciones con marcas de tiempo en videos de YouTube.
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#666666] dark:text-[#888888] uppercase mb-1">
                  Título Personalizado (Opcional)
                </label>
                <input
                  type="text"
                  disabled={isIngestingUrl}
                  placeholder="Dejar vacío para resolución automática"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  className="w-full bg-[#EBEBE8] dark:bg-[#1E1E22] border border-[#E0E0DC] dark:border-[#2A2A2E] px-3 py-2 text-xs text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED]"
                />
              </div>

              {urlError && (
                <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 text-[11px] font-mono">
                  {urlError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E0E0DC] dark:border-[#2A2A2E]">
                <button
                  type="button"
                  onClick={() => setIsUrlModalOpen(false)}
                  disabled={isIngestingUrl}
                  className="px-3 py-1.5 border border-[#E0E0DC] dark:border-[#2A2A2E] text-xs font-mono text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!urlInput.trim() || isIngestingUrl}
                  className="px-4 py-1.5 bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] text-xs font-mono font-medium tracking-wide uppercase transition-colors disabled:opacity-40 cursor-pointer inline-flex items-center gap-1.5"
                >
                  {isIngestingUrl && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isIngestingUrl ? 'Procesando...' : 'Indexar Fuente'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};

