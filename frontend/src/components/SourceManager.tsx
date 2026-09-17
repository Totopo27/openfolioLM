import React, { useEffect, useRef, useState } from 'react';
import {
  Upload,
  Trash2,
  CheckSquare,
  Square,
  Eye,
  Loader2,
  Globe,
  Link2,
  X,
  Package,
  Code2,
  BookOpen,
  Compass,
  FileText,
  Search,
  Sparkles,
  Tags,
  FolderTree,
  Hash,
  ChevronDown,
  ChevronUp,
  Plus,
  MessageSquare,
  ArrowRight,
} from 'lucide-react';
import { SourceDocument, ActiveUploadTask } from '../types';
import { LiteratureDiscoveryModal } from './LiteratureDiscoveryModal';
import { autoclassifyAllSources } from '../services/api';
import { CircularProgressRing } from './CircularProgressRing';

export const YouTubeIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

interface SourceManagerProps {
  projectId?: string;
  sources: SourceDocument[];
  activeSourceIds: string[];
  selectedDocId: string | null;
  onToggleActive: (id: string) => void;
  onToggleAll: () => void;
  onSelectDoc: (doc: SourceDocument) => void;
  onUpload: (file: File) => Promise<void>;
  onIngestUrl?: (url: string, title?: string) => Promise<void>;
  onSourcesAdded?: (newDocs: SourceDocument[]) => void;
  onOpenDossier?: (doc: SourceDocument) => void;
  onOpenDiscovery?: () => void;
  onDelete: (id: string) => Promise<void>;
  onOpenTaxonomy?: (doc: SourceDocument) => void;
  onRefreshSources?: () => Promise<void>;
  selectedEngine?: string;
  onToggleBatchActive?: (ids: string[], activate: boolean) => void;
  isFullView?: boolean;
  onNavigateToChat?: () => void;
  uploadTasks?: ActiveUploadTask[];
  onDismissUploadTask?: (taskId: string) => void;
  onOpenLogs?: () => void;
}

export const SourceManager: React.FC<SourceManagerProps> = ({
  projectId,
  sources,
  activeSourceIds,
  selectedDocId,
  onToggleActive,
  onToggleAll,
  onSelectDoc,
  onUpload,
  onIngestUrl,
  onSourcesAdded,
  onOpenDossier,
  onOpenDiscovery,
  onDelete,
  onOpenTaxonomy,
  onRefreshSources,
  selectedEngine,
  onToggleBatchActive,
  isFullView = false,
  onNavigateToChat,
  uploadTasks = [],
  onDismissUploadTask,
  onOpenLogs,
}) => {
  const isUploading = uploadTasks.some((t) => t.stage === 'uploading' || t.stage === 'processing');
  const activeUploadTask = uploadTasks.find((t) => t.stage === 'uploading' || t.stage === 'processing');
  const [isDragging, setIsDragging] = useState(false);
  const [isUrlModalOpen, setIsUrlModalOpen] = useState(false);
  const [isDiscoveryOpen, setIsDiscoveryOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [isIngestingUrl, setIsIngestingUrl] = useState(false);
  const [urlError, setUrlError] = useState('');

  // Search & Taxonomy Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isAutoclassifyingAll, setIsAutoclassifyingAll] = useState(false);
  const [autoclassifyStatus, setAutoclassifyStatus] = useState('');

  // Collapsible drawer state & add menu state
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem('openfolio_sources_collapsed');
    return saved !== null ? saved === 'true' : false;
  });
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setIsAddMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('openfolio_sources_collapsed', String(next));
      return next;
    });
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || !onIngestUrl) return;

    let targetUrl = urlInput.trim();
    // Do not prepend https:// if it is a bare DOI (e.g. 10.1353/...)
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
      setUrlError(err.message || 'Error al procesar el enlace web');
    } finally {
      setIsIngestingUrl(false);
    }
  };

  const processFiles = (files: File[]) => {
    if (!files.length) return;
    for (const file of files) {
      onUpload(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    await processFiles(files);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      setIsDragging(false);
      dragCounterRef.current = 0;
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = Array.from(e.dataTransfer.files || []);
    await processFiles(files);
  };

  const allActive = sources.length > 0 && activeSourceIds.length === sources.length;

  // Extract categories with counts
  const categoriesMap = new Map<string, number>();
  let uncategorizedCount = 0;
  sources.forEach((s) => {
    const cat = s.metadata?.category?.trim();
    if (cat) {
      categoriesMap.set(cat, (categoriesMap.get(cat) || 0) + 1);
    } else {
      uncategorizedCount++;
    }
  });
  const uniqueCategories = Array.from(categoriesMap.entries()).map(([name, count]) => ({ name, count }));

  // Extract tags with counts
  const tagsMap = new Map<string, number>();
  sources.forEach((s) => {
    if (Array.isArray(s.metadata?.tags)) {
      s.metadata.tags.forEach((t: string) => {
        if (t && t.trim()) {
          const tag = t.trim();
          tagsMap.set(tag, (tagsMap.get(tag) || 0) + 1);
        }
      });
    }
  });
  const topTags = Array.from(tagsMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Filter sources by search query, category, and tag
  const filteredSources = sources.filter((doc) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = doc.filename.toLowerCase().includes(q);
      const matchCat = doc.metadata?.category?.toLowerCase().includes(q);
      const matchAuthor = doc.metadata?.author?.toLowerCase().includes(q);
      const matchTags = Array.isArray(doc.metadata?.tags) && doc.metadata.tags.some((t: string) => t.toLowerCase().includes(q));
      if (!matchName && !matchCat && !matchAuthor && !matchTags) return false;
    }
    if (selectedCategory !== null) {
      if (selectedCategory === '__uncategorized__') {
        if (doc.metadata?.category?.trim()) return false;
      } else {
        if (doc.metadata?.category?.trim() !== selectedCategory) return false;
      }
    }
    if (selectedTag !== null) {
      if (!Array.isArray(doc.metadata?.tags) || !doc.metadata.tags.includes(selectedTag)) return false;
    }
    return true;
  });

  const categoryDocIds = filteredSources.map((d) => d.id);
  const isCategoryFullyActive = categoryDocIds.length > 0 && categoryDocIds.every((id) => activeSourceIds.includes(id));

  const handleToggleCategoryContext = () => {
    if (onToggleBatchActive) {
      onToggleBatchActive(categoryDocIds, !isCategoryFullyActive);
    } else {
      categoryDocIds.forEach((id) => {
        if (isCategoryFullyActive && activeSourceIds.includes(id)) {
          onToggleActive(id);
        } else if (!isCategoryFullyActive && !activeSourceIds.includes(id)) {
          onToggleActive(id);
        }
      });
    }
  };

  const handleAutoclassifyAll = async () => {
    if (!projectId) return;
    try {
      setIsAutoclassifyingAll(true);
      setAutoclassifyStatus('Analizando y clasificando todo el compendio con IA...');
      const res = await autoclassifyAllSources(projectId, selectedEngine);
      setAutoclassifyStatus(`¡${res.classified_count} obras clasificadas con éxito!`);
      if (onRefreshSources) {
        await onRefreshSources();
      }
      setTimeout(() => setAutoclassifyStatus(''), 4000);
    } catch (err: any) {
      setAutoclassifyStatus(err.message || 'Error al autoclasificar compendio');
      setTimeout(() => setAutoclassifyStatus(''), 4000);
    } finally {
      setIsAutoclassifyingAll(false);
    }
  };

  const renderAddDropdown = () => (
    <div className="relative" ref={addMenuRef}>
      <button
        type="button"
        onClick={() => setIsAddMenuOpen((prev) => !prev)}
        disabled={isUploading || isIngestingUrl || isAutoclassifyingAll}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50 cursor-pointer shrink-0"
        title="Añadir nuevas fuentes al proyecto"
      >
        {isUploading && activeUploadTask ? (
          <>
            <CircularProgressRing
              progress={activeUploadTask.progress}
              stage={activeUploadTask.stage}
              size="xs"
            />
            <span className="truncate max-w-[120px] font-mono">
              {`${activeUploadTask.progress}%`}
            </span>
          </>
        ) : (
          <>
            <Plus className="w-3.5 h-3.5" />
            <span>Agregar</span>
            <ChevronDown className="w-3 h-3 ml-0.5 opacity-80" />
          </>
        )}
      </button>

      {isAddMenuOpen && (
        <div className="absolute right-0 top-full mt-1.5 w-60 bg-slate-900 border border-slate-750 rounded-xl shadow-2xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 divide-y divide-slate-800/60">
          <div className="p-1">
            <button
              type="button"
              onClick={() => {
                setIsAddMenuOpen(false);
                fileInputRef.current?.click();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800/80 rounded-lg transition cursor-pointer text-left"
            >
              <div className="p-1.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
                <Upload className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="font-medium text-slate-200">Subir Archivo Local</div>
                <div className="text-[10px] text-slate-400">PDF, Word, TXT, MD, ZIP, Código</div>
              </div>
            </button>

            {onIngestUrl && (
              <button
                type="button"
                onClick={() => {
                  setIsAddMenuOpen(false);
                  setUrlError('');
                  setIsUrlModalOpen(true);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800/80 rounded-lg transition cursor-pointer text-left"
              >
                <div className="p-1.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
                  <Globe className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="font-medium text-slate-200">Enlace Web / DOI / YouTube</div>
                  <div className="text-[10px] text-slate-400">Páginas web, papers DOI, charlas YouTube</div>
                </div>
              </button>
            )}

            {projectId && (onOpenDiscovery || onSourcesAdded) && (
              <button
                type="button"
                onClick={() => {
                  setIsAddMenuOpen(false);
                  onOpenDiscovery ? onOpenDiscovery() : setIsDiscoveryOpen(true);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-950/40 rounded-lg transition cursor-pointer text-left"
              >
                <div className="p-1.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                  <Compass className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="font-medium text-emerald-300">Explorar Literatura</div>
                  <div className="text-[10px] text-emerald-500/80">Buscar papers en OpenAlex</div>
                </div>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative ${
        isFullView
          ? 'flex-1 flex flex-col h-full bg-slate-950 overflow-hidden'
          : 'bg-slate-900/90 border-b border-slate-800 transition-colors shrink-0'
      }`}
    >
      {/* Hidden File Input accessible everywhere */}
      <input
        type="file"
        multiple
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.zip,.py,.ts,.tsx,.js,.jsx,.go,.rs,.java,.cpp,.c,.h,.cs,.sql,.html,.css,.json,.yaml,.yml"
      />

      {/* Drag overlay when dragging files over container with existing sources */}
      {isDragging && sources.length > 0 && (
        <div className="absolute inset-0 bg-indigo-950/90 border-2 border-dashed border-indigo-400 rounded-lg flex flex-col items-center justify-center z-30 backdrop-blur-sm pointer-events-none animate-in fade-in duration-100 m-2">
          <Upload className="w-6 h-6 text-indigo-300 animate-bounce mb-1" />
          <p className="text-xs font-semibold text-indigo-200">
            Soltá los archivos para subirlos a este proyecto
          </p>
          <p className="text-[10px] text-indigo-400">PDF, Word, PPTX, Excel, Markdown, TXT o Código (.zip, .py, .ts...)</p>
        </div>
      )}

      {/* COMPACT MODE (Collapsible Drawer for maximum Chat Real Estate) */}
      {!isFullView && isCollapsed && sources.length > 0 ? (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-slate-900/90">
          <div className="flex items-center gap-2 min-w-0 overflow-hidden">
            <button
              type="button"
              onClick={toggleCollapse}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-200 hover:text-indigo-300 transition cursor-pointer shrink-0"
              title="Clic para expandir filtros, categorías y gestión completa de fuentes"
            >
              <FolderTree className="w-3.5 h-3.5 text-indigo-400" />
              <span>Fuentes ({sources.length})</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                {activeSourceIds.length} activas
              </span>
            </button>

            {/* Quick horizontal active source pills with checkbox */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
              {sources.slice(0, 3).map((doc) => {
                const isActive = activeSourceIds.includes(doc.id);
                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => onToggleActive(doc.id)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition cursor-pointer shrink-0 max-w-[140px] truncate ${
                      isActive
                        ? 'bg-indigo-950/60 border-indigo-500/40 text-indigo-200'
                        : 'bg-slate-800/40 border-slate-800 text-slate-500 hover:text-slate-400'
                    }`}
                    title={`${doc.filename} - Clic para ${isActive ? 'desactivar del chat' : 'activar en el chat'}`}
                  >
                    {isActive ? (
                      <CheckSquare className="w-3 h-3 text-indigo-400 shrink-0" />
                    ) : (
                      <Square className="w-3 h-3 text-slate-600 shrink-0" />
                    )}
                    <span className="truncate">{doc.filename}</span>
                  </button>
                );
              })}
              {sources.length > 3 && (
                <button
                  type="button"
                  onClick={toggleCollapse}
                  className="text-[10px] text-slate-400 hover:text-indigo-300 shrink-0 cursor-pointer"
                  title="Ver todas las fuentes"
                >
                  +{sources.length - 3} más...
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {renderAddDropdown()}

            <button
              type="button"
              onClick={toggleCollapse}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 rounded-lg transition cursor-pointer"
              title="Expandir búsqueda, filtros por categoría y gestión de fuentes"
            >
              <Search className="w-3 h-3 text-indigo-400" />
              <span>Gestionar</span>
              <ChevronDown className="w-3 h-3 ml-0.5 text-slate-400" />
            </button>
          </div>
        </div>
      ) : (
        <div className={isFullView ? "flex-1 flex flex-col h-full p-4 overflow-hidden" : "p-3.5 space-y-2.5"}>
          {/* EXPANDED HEADER */}
          <div className="flex items-center justify-between flex-wrap gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <FolderTree className="w-4 h-4 text-indigo-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                {isFullView ? 'Compendio Bibliográfico' : 'Fuentes'} ({sources.length})
              </h3>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium font-mono">
                {activeSourceIds.length} Activas para Chat
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {onNavigateToChat && (
                <button
                  type="button"
                  onClick={onNavigateToChat}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition cursor-pointer"
                  title="Ir al chat con las fuentes activas"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Ir al Chat ({activeSourceIds.length})</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}

              {sources.length > 0 && (
                <button
                  onClick={onToggleAll}
                  className="text-xs text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 cursor-pointer"
                  title="Toggle all sources"
                >
                  {allActive ? (
                    <>
                      <CheckSquare className="w-3.5 h-3.5 text-indigo-400" /> Deseleccionar todo
                    </>
                  ) : (
                    <>
                      <Square className="w-3.5 h-3.5 text-slate-500" /> Seleccionar todo
                    </>
                  )}
                </button>
              )}

              {renderAddDropdown()}

              {!isFullView && sources.length > 0 && (
                <button
                  type="button"
                  onClick={toggleCollapse}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 rounded-lg transition cursor-pointer"
                  title="Contraer panel de fuentes para maximizar el espacio del chat"
                >
                  <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                  <span>Contraer</span>
                </button>
              )}
            </div>
          </div>

      {/* Real-time Search, Categories & Tags Toolbar */}
      {sources.length > 0 && (
        <div className="space-y-2 mb-3 pt-2 border-t border-slate-800/70">
          {/* Search Input Bar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar fuentes por título, autor, categoría o #etiqueta..."
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-950/80 border border-slate-750 focus:border-indigo-500 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-2 text-slate-400 hover:text-slate-200 p-0.5"
                  title="Limpiar búsqueda"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {(searchQuery || selectedCategory !== null || selectedTag !== null) && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory(null);
                  setSelectedTag(null);
                }}
                className="text-[11px] text-slate-400 hover:text-indigo-300 underline shrink-0 cursor-pointer"
              >
                Limpiar filtros ({filteredSources.length}/{sources.length})
              </button>
            )}
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-thin">
            <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider flex items-center gap-1 shrink-0 mr-1">
              <FolderTree className="w-3 h-3 text-indigo-400" /> Categorías:
            </span>

            <button
              type="button"
              onClick={() => setSelectedCategory(null)}
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition cursor-pointer shrink-0 border ${
                selectedCategory === null
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                  : 'bg-slate-800/80 hover:bg-slate-700 text-slate-400 border-slate-700'
              }`}
            >
              Todas ({sources.length})
            </button>

            {uniqueCategories.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => setSelectedCategory(selectedCategory === c.name ? null : c.name)}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition cursor-pointer shrink-0 border flex items-center gap-1.5 ${
                  selectedCategory === c.name
                    ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700'
                }`}
              >
                <span>{c.name}</span>
                <span className="text-[10px] px-1 py-0.2 rounded-full bg-slate-900/80 text-indigo-300 font-mono">
                  {c.count}
                </span>
              </button>
            ))}

            {uncategorizedCount > 0 && (
              <button
                type="button"
                onClick={() => setSelectedCategory(selectedCategory === '__uncategorized__' ? null : '__uncategorized__')}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition cursor-pointer shrink-0 border ${
                  selectedCategory === '__uncategorized__'
                    ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-400 border-slate-700'
                }`}
              >
                Sin categoría ({uncategorizedCount})
              </button>
            )}

            {/* Batch toggle for the selected category */}
            {selectedCategory !== null && categoryDocIds.length > 0 && (
              <button
                type="button"
                onClick={handleToggleCategoryContext}
                className="px-2 py-0.5 text-[11px] rounded bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 transition cursor-pointer flex items-center gap-1 shrink-0 font-medium"
                title={isCategoryFullyActive ? 'Quitar esta categoría del contexto del chat' : 'Activar toda esta categoría para el chat'}
              >
                {isCategoryFullyActive ? <CheckSquare className="w-3 h-3 text-indigo-400" /> : <Square className="w-3 h-3 text-slate-400" />}
                <span>{isCategoryFullyActive ? 'Desactivar del Chat' : 'Activar Categoría en Chat'}</span>
              </button>
            )}

            {/* Autoclassify all sources with IA button */}
            {projectId && sources.length > 0 && (
              <button
                type="button"
                onClick={handleAutoclassifyAll}
                disabled={isUploading || isIngestingUrl || isAutoclassifyingAll}
                className="ml-auto flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-medium bg-gradient-to-r from-teal-900/60 to-emerald-900/60 hover:from-teal-800/80 hover:to-emerald-800/80 text-teal-200 border border-teal-500/40 rounded-lg transition-all cursor-pointer disabled:opacity-50 shrink-0"
                title="Clasificar automáticamente con IA todos los libros por categoría y tags"
              >
                {isAutoclassifyingAll ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" /> Clasificando...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3 text-amber-300" /> Autoclasificar con IA
                  </>
                )}
              </button>
            )}
          </div>

          {/* Tags Filter Row */}
          {topTags.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs pt-0.5 scrollbar-thin">
              <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider flex items-center gap-1 shrink-0 mr-1">
                <Hash className="w-3 h-3 text-teal-400" /> Tags:
              </span>
              {topTags.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => setSelectedTag(selectedTag === t.name ? null : t.name)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-mono transition cursor-pointer shrink-0 border ${
                    selectedTag === t.name
                      ? 'bg-teal-600 text-white border-teal-500'
                      : 'bg-slate-900/60 hover:bg-slate-800 text-slate-400 border-slate-800 hover:text-slate-300'
                  }`}
                >
                  {t.name} ({t.count})
                </button>
              ))}
            </div>
          )}

          {autoclassifyStatus && (
            <div className="text-[11px] text-teal-300 bg-teal-500/10 border border-teal-500/20 px-2.5 py-1 rounded-lg flex items-center gap-1.5 animate-in fade-in">
              <Sparkles className="w-3 h-3 text-amber-300 shrink-0" />
              <span>{autoclassifyStatus}</span>
            </div>
          )}
        </div>
      )}

      {/* Sources horizontal / compact list */}
      {sources.length === 0 ? (
        <div
          onClick={() => !isUploading && fileInputRef.current?.click()}
          className={`p-6 border-2 border-dashed rounded-xl text-center text-xs transition-all cursor-pointer flex flex-col items-center justify-center gap-2 group ${
            isDragging
              ? 'border-indigo-400 bg-indigo-500/15 text-indigo-200 ring-2 ring-indigo-500/30 scale-[1.01]'
              : 'border-slate-800 hover:border-indigo-500/50 bg-slate-950/40 text-slate-400 hover:text-slate-300'
          }`}
        >
          <div className="p-3 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 group-hover:scale-110 transition-transform">
            {isUploading && activeUploadTask ? (
              <CircularProgressRing
                progress={activeUploadTask.progress}
                stage={activeUploadTask.stage}
                size="md"
                showText
              />
            ) : (
              <Upload className={`w-5 h-5 ${isDragging ? 'text-indigo-300 animate-bounce' : 'text-indigo-400'}`} />
            )}
          </div>
          <p className="font-semibold text-slate-200 text-sm">
            {isUploading && activeUploadTask
              ? activeUploadTask.statusText
                ? `${activeUploadTask.statusText} (${activeUploadTask.progress}%)`
                : activeUploadTask.stage === 'processing'
                ? `Procesando e indexando ${activeUploadTask.name} (${activeUploadTask.progress}%)...`
                : `Subiendo ${activeUploadTask.name} (${activeUploadTask.progress}%)...`
              : isDragging
              ? '¡Soltá los archivos acá para procesarlos!'
              : 'Arrastrá y soltá tus archivos aquí'}
          </p>
          <p className="text-[11px] text-slate-500 max-w-sm">
            o hacé clic para explorar desde tu equipo &bull; Soporta Documentos (PDF, Word, PPTX, Excel, Markdown, TXT) y Código (.zip, repositorios, .py, .ts, .go, .rs...)
          </p>
        </div>
      ) : filteredSources.length === 0 ? (
        <div className="p-4 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-400">
          No se encontraron fuentes con los filtros aplicados.
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory(null);
              setSelectedTag(null);
            }}
            className="text-indigo-400 hover:text-indigo-300 underline ml-2 cursor-pointer"
          >
            Restablecer filtros
          </button>
        </div>
      ) : (
        <div className={isFullView ? "flex-1 overflow-y-auto space-y-2 pr-1 min-h-[300px]" : "flex flex-wrap gap-2 max-h-36 overflow-y-auto pr-1"}>
          {/* Optimistic Active Upload Cards */}
          {uploadTasks && uploadTasks.map((task) => (
            <div
              key={task.id}
              className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs transition-all animate-in fade-in slide-in-from-top-2 ${
                task.stage === 'error'
                  ? 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                  : task.stage === 'done'
                  ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                  : 'bg-indigo-950/40 border-indigo-500/50 text-slate-200 shadow-md ring-1 ring-indigo-500/30'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <CircularProgressRing
                  progress={task.progress}
                  stage={task.stage}
                  size="md"
                  showText={task.stage === 'uploading' || task.stage === 'processing'}
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-100 truncate text-xs" title={task.name}>
                      {task.name}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 font-mono font-medium rounded ${
                      task.stage === 'error'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : task.stage === 'processing'
                        ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                        : task.stage === 'done'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    }`}>
                      {task.stage === 'error'
                        ? 'Error'
                        : task.stage === 'done'
                        ? 'Listo'
                        : `${task.progress}%`}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">
                    {task.stage === 'done'
                      ? 'Indexado exitosamente en la base de conocimiento'
                      : task.stage === 'error'
                      ? (task.error || 'Error en la carga')
                      : (task.statusText || (task.stage === 'processing' ? 'Extrayendo páginas, tablas y transcribiendo diagramas...' : `Subiendo libro a OpenFolioLM (${(task.size / (1024 * 1024)).toFixed(1)} MB)...`))}
                  </p>
                </div>
              </div>
              {task.stage === 'error' && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {onOpenLogs && (
                    <button
                      type="button"
                      onClick={onOpenLogs}
                      className="px-2 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/30 text-[10px] font-medium transition cursor-pointer"
                      title="Ver diagnóstico y logs del servidor"
                    >
                      Ver Logs
                    </button>
                  )}
                  {onDismissUploadTask && (
                    <button
                      type="button"
                      onClick={() => onDismissUploadTask(task.id)}
                      className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition cursor-pointer"
                      title="Descartar aviso de error"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
              {task.stage === 'processing' && onOpenLogs && (
                <button
                  type="button"
                  onClick={onOpenLogs}
                  className="px-2 py-1 rounded bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/30 text-[10px] font-medium transition cursor-pointer shrink-0"
                  title="Ver logs de extracción en vivo"
                >
                  Ver Logs
                </button>
              )}
            </div>
          ))}
          {filteredSources.map((doc) => {
            const isActive = activeSourceIds.includes(doc.id);
            const isSelected = selectedDocId === doc.id;

            if (isFullView) {
              return (
                <div
                  key={doc.id}
                  className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs transition-all ${
                    isActive
                      ? 'bg-slate-900/90 border-indigo-500/40 text-slate-200 shadow-sm'
                      : 'bg-slate-950/60 border-slate-800/80 text-slate-400 hover:text-slate-300'
                  } ${isSelected ? 'ring-2 ring-indigo-500/50' : ''}`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onToggleActive(doc.id)}
                      className="hover:scale-110 transition-transform cursor-pointer shrink-0"
                      title={isActive ? 'Desactivar de consultas RAG' : 'Activar en consultas RAG'}
                    >
                      {isActive ? (
                        <CheckSquare className="w-4 h-4 text-indigo-400" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-600" />
                      )}
                    </button>

                    <div className="shrink-0">
                      {doc.metadata?.is_youtube ? (
                        <YouTubeIcon className="w-4 h-4 text-red-500" />
                      ) : doc.metadata?.doi ? (
                        <BookOpen className="w-4 h-4 text-emerald-400" />
                      ) : doc.metadata?.is_repo ? (
                        <Package className="w-4 h-4 text-cyan-400" />
                      ) : doc.metadata?.is_code ? (
                        <Code2 className="w-4 h-4 text-cyan-400" />
                      ) : doc.metadata?.source_url || doc.mime_type === 'text/html' ? (
                        <Globe className="w-4 h-4 text-indigo-400" />
                      ) : (
                        <FileText className="w-4 h-4 text-indigo-300" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          onClick={() => onSelectDoc(doc)}
                          className="font-semibold text-slate-200 hover:text-indigo-300 cursor-pointer text-xs transition-colors"
                          title={doc.filename}
                        >
                          {doc.filename}
                        </span>
                        {doc.metadata?.category && (
                          <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0">
                            {doc.metadata.category}
                          </span>
                        )}
                        {Array.isArray(doc.metadata?.tags) && doc.metadata.tags.map((t: string) => (
                          <span key={t} className="px-1.5 py-0.2 text-[9px] rounded bg-slate-800 text-teal-300 border border-teal-500/20 font-mono">
                            {t.startsWith('#') ? t : `#${t}`}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-1 flex-wrap">
                        {doc.metadata?.author && <span className="text-slate-400 font-medium">{doc.metadata.author}</span>}
                        {doc.metadata?.page_count && <span>• {doc.metadata.page_count} páginas</span>}
                        <span>• {(doc.char_count || 0).toLocaleString()} caracteres</span>
                        {doc.metadata?.file_size_bytes && (
                          <span>• {(doc.metadata.file_size_bytes / (1024 * 1024)).toFixed(1)} MB</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onSelectDoc(doc)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/50 transition cursor-pointer flex items-center gap-1 font-medium"
                      title="Abrir y leer en el visor"
                    >
                      <Eye className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Leer</span>
                    </button>
                    {onOpenDossier && (
                      <button
                        type="button"
                        onClick={() => onOpenDossier(doc)}
                        className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 hover:text-amber-400 text-slate-400 border border-slate-700/60 transition cursor-pointer"
                        title="Estructura & Guía de Estudio"
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {onOpenTaxonomy && (
                      <button
                        type="button"
                        onClick={() => onOpenTaxonomy(doc)}
                        className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 hover:text-teal-400 text-slate-400 border border-slate-700/60 transition cursor-pointer"
                        title="Categorías & Etiquetas"
                      >
                        <Tags className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDelete(doc.id)}
                      className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-rose-950/40 hover:text-rose-400 text-slate-500 border border-slate-700/60 transition cursor-pointer"
                      title="Eliminar fuente"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={doc.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-all ${
                  isActive
                    ? 'bg-slate-800/90 border-indigo-500/40 text-slate-200'
                    : 'bg-slate-900/50 border-slate-800/80 text-slate-500 hover:text-slate-400'
                } ${isSelected ? 'ring-1 ring-indigo-400' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => onToggleActive(doc.id)}
                  className="hover:scale-110 transition-transform cursor-pointer"
                  title={isActive ? 'Desactivar del contexto' : 'Activar en contexto'}
                >
                  {isActive ? (
                    <CheckSquare className="w-4 h-4 text-indigo-400" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-600" />
                  )}
                </button>

                {doc.metadata?.is_youtube ? (
                  <span title={`Video de YouTube${doc.metadata.channel ? ` (${doc.metadata.channel})` : ''}`} className="flex items-center shrink-0">
                    <YouTubeIcon className="w-3.5 h-3.5 text-red-500" />
                  </span>
                ) : doc.metadata?.doi ? (
                  <span title={`Artículo Científico (DOI: ${doc.metadata.doi})`} className="flex items-center shrink-0">
                    <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
                  </span>
                ) : doc.metadata?.is_repo ? (
                  <span title="Repositorio de Código" className="flex items-center shrink-0">
                    <Package className="w-3.5 h-3.5 text-cyan-400" />
                  </span>
                ) : doc.metadata?.is_code ? (
                  <span title="Archivo de Código" className="flex items-center shrink-0">
                    <Code2 className="w-3.5 h-3.5 text-cyan-400" />
                  </span>
                ) : doc.metadata?.source_url || doc.mime_type === 'text/html' ? (
                  <span title="Enlace Web" className="flex items-center shrink-0">
                    <Globe className="w-3.5 h-3.5 text-indigo-400" />
                  </span>
                ) : null}

                <span
                  onClick={() => onSelectDoc(doc)}
                  className="cursor-pointer max-w-[130px] truncate font-medium hover:text-indigo-300"
                  title={`${doc.filename} (${doc.char_count.toLocaleString()} chars)${doc.metadata?.author ? ` - ${doc.metadata.author}` : ''}`}
                >
                  {doc.filename}
                </span>

                {/* Category Badge */}
                {doc.metadata?.category && (
                  <span
                    className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 truncate max-w-[85px] shrink-0"
                    title={`Categoría: ${doc.metadata.category}`}
                  >
                    {doc.metadata.category}
                  </span>
                )}

                {/* Tag Badge */}
                {Array.isArray(doc.metadata?.tags) && doc.metadata.tags.length > 0 && (
                  <span
                    className="px-1 py-0.2 text-[9px] font-mono rounded bg-slate-800 text-teal-300 border border-teal-500/20 truncate max-w-[65px] shrink-0"
                    title={`Tag: ${doc.metadata.tags[0]}`}
                  >
                    {doc.metadata.tags[0]}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => onSelectDoc(doc)}
                  className="p-1 hover:text-indigo-400 text-slate-400 transition-colors cursor-pointer"
                  title="Ver documento"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>

                {onOpenDossier && (
                  <button
                    type="button"
                    onClick={() => onOpenDossier(doc)}
                    className="p-1 hover:text-amber-400 text-slate-400 transition-colors cursor-pointer"
                    title="Estructura & Guía de Estudio"
                  >
                    <FileText className="w-3.5 h-3.5" />
                  </button>
                )}

                {onOpenTaxonomy && (
                  <button
                    type="button"
                    onClick={() => onOpenTaxonomy(doc)}
                    className="p-1 hover:text-teal-400 text-slate-400 transition-colors cursor-pointer"
                    title="Categorías & Etiquetas"
                  >
                    <Tags className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onDelete(doc.id)}
                  className="p-1 hover:text-rose-400 text-slate-500 transition-colors cursor-pointer"
                  title="Eliminar fuente"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
        </div>
      )}

      {/* Add Web URL / Academic DOI / YouTube Modal */}
      {isUrlModalOpen && (() => {
        const isDoi = /10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i.test(urlInput);
        const isYouTube = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\/.+/i.test(urlInput.trim());
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2 text-white font-semibold text-sm">
                  {isYouTube ? (
                    <YouTubeIcon className="w-4 h-4 text-red-500" />
                  ) : isDoi ? (
                    <BookOpen className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Globe className="w-4 h-4 text-indigo-400" />
                  )}
                  <span>
                    {isYouTube
                      ? 'Transcribir e Indexar Video de YouTube'
                      : isDoi
                      ? 'Resolver e Indexar Artículo por DOI'
                      : 'Agregar Fuente desde Enlace Web, DOI o YouTube'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => !isIngestingUrl && setIsUrlModalOpen(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleUrlSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    {isYouTube
                      ? 'Enlace del Video de YouTube'
                      : isDoi
                      ? 'Identificador DOI Académico'
                      : 'URL de la Página Web, DOI o YouTube'}{' '}
                    <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    {isYouTube ? (
                      <YouTubeIcon className="w-4 h-4 text-red-500 absolute left-3 top-3" />
                    ) : isDoi ? (
                      <BookOpen className="w-4 h-4 text-emerald-500 absolute left-3 top-3" />
                    ) : (
                      <Link2 className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                    )}
                    <input
                      type="text"
                      required
                      autoFocus
                      placeholder={
                        isYouTube
                          ? 'https://www.youtube.com/watch?v=... o youtu.be/...'
                          : 'https://... o DOI (ej: 10.1353/pnm.2010.0009)'
                      }
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      disabled={isIngestingUrl}
                      className={`w-full bg-slate-950 border rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none transition-all disabled:opacity-50 ${
                        isYouTube
                          ? 'border-red-500/50 focus:ring-2 focus:ring-red-500'
                          : isDoi
                          ? 'border-emerald-500/50 focus:ring-2 focus:ring-emerald-500'
                          : 'border-slate-800 focus:ring-2 focus:ring-indigo-500'
                      }`}
                    />
                  </div>
                  {isYouTube ? (
                    <p className="mt-1.5 text-[11px] text-red-400/90 flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                      Video de YouTube detectado: Se transcribirán charlas y clases con marcas de tiempo (timestamps) para citación y reproducción sincronizada.
                    </p>
                  ) : isDoi ? (
                    <p className="mt-1.5 text-[11px] text-emerald-400/90 flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                      DOI Académico detectado: Se resolverán metadatos y enlaces Open Access vía OpenAlex, Europe PMC y CrossRef.
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[10px] text-slate-500">
                      Podés ingresar una URL web, un video de YouTube o un DOI académico (ej. <code className="text-slate-400">10.1353/pnm.2010.0009</code>).
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Título personalizado (opcional)
                  </label>
                  <input
                    type="text"
                    placeholder="Dejar vacío para detectar el título automáticamente"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    disabled={isIngestingUrl}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all disabled:opacity-50"
                  />
                </div>

                {urlError && (
                  <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                    {urlError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsUrlModalOpen(false)}
                    disabled={isIngestingUrl}
                    className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={!urlInput.trim() || isIngestingUrl}
                    className={`flex items-center gap-1.5 px-4 py-2 text-white text-xs font-semibold rounded-xl transition-all shadow-md cursor-pointer disabled:opacity-50 ${
                      isYouTube
                        ? 'bg-red-600 hover:bg-red-500 shadow-red-900/30'
                        : isDoi
                        ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/30'
                        : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/30'
                    }`}
                  >
                    {isIngestingUrl ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />{' '}
                        {isYouTube
                          ? 'Transcribiendo Video...'
                          : isDoi
                          ? 'Resolviendo Paper...'
                          : 'Descargando y Extrayendo...'}
                      </>
                    ) : isYouTube ? (
                      'Transcribir e Indexar Video'
                    ) : isDoi ? (
                      'Resolver Paper DOI'
                    ) : (
                      'Agregar Fuente'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Literature Discovery Modal (Fallback if not handled by parent App) */}
      {!onOpenDiscovery && projectId && onSourcesAdded && (
        <LiteratureDiscoveryModal
          projectId={projectId}
          isOpen={isDiscoveryOpen}
          onClose={() => setIsDiscoveryOpen(false)}
          onSourcesAdded={onSourcesAdded}
        />
      )}
    </div>
  );
};
