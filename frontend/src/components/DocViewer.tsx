import React, { useEffect, useRef, useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  FileText,
  Bookmark,
  GraduationCap,
  Tags,
  X,
  ExternalLink,
  Play,
  Maximize2,
  Layout,
  AlignLeft,
  ChevronLeft,
  ChevronRight,
  BookOpen,
} from 'lucide-react';
import { SourceDocument, HighlightTarget } from '../types';
import { CodeViewer } from './CodeViewer';
import { DossierViewer } from './DossierViewer';
import { TaxonomyViewer } from './TaxonomyViewer';
import { YouTubeIcon } from './SourceManager';

export interface DocPage {
  pageNumber: number;
  content: string;
  startChar: number;
  endChar: number;
}

export function getDocPages(raw: string): DocPage[] {
  if (!raw) return [];
  const pageRegex = /<!-- PAGE: (\d+) -->/g;
  const matches = Array.from(raw.matchAll(pageRegex));
  if (matches.length > 1) {
    const pages: DocPage[] = [];
    for (let i = 0; i < matches.length; i++) {
      const pageNum = parseInt(matches[i][1], 10);
      const startChar = matches[i].index!;
      const endChar = i + 1 < matches.length ? matches[i + 1].index! : raw.length;
      pages.push({
        pageNumber: pageNum,
        content: raw.slice(startChar, endChar),
        startChar,
        endChar,
      });
    }
    return pages;
  }

  // Fallback for large documents (> 40,000 chars) without explicit PAGE tags
  if (raw.length > 40000) {
    const CHUNK_SIZE = 15000;
    const pages: DocPage[] = [];
    let start = 0;
    let pageIdx = 1;
    while (start < raw.length) {
      let end = Math.min(raw.length, start + CHUNK_SIZE);
      if (end < raw.length) {
        const nl = raw.lastIndexOf('\n', end);
        if (nl > start + 5000) end = nl + 1;
      }
      pages.push({
        pageNumber: pageIdx++,
        content: raw.slice(start, end),
        startChar: start,
        endChar: end,
      });
      start = end;
    }
    return pages;
  }

  return [
    {
      pageNumber: 1,
      content: raw,
      startChar: 0,
      endChar: raw.length,
    },
  ];
}

const parseTimestampSeconds = (text: string): number | null => {
  const match = /\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]/.exec(text);
  if (!match) return null;
  if (match[1] !== undefined) {
    const hours = parseInt(match[1], 10);
    const mins = parseInt(match[2], 10);
    const secs = parseInt(match[3], 10);
    return hours * 3600 + mins * 60 + secs;
  } else {
    const mins = parseInt(match[2], 10);
    const secs = parseInt(match[3], 10);
    return mins * 60 + secs;
  }
};

const formatSeconds = (totalSecs: number): string => {
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

interface DocViewerProps {
  document: SourceDocument | null;
  highlightTarget: HighlightTarget | null;
  onClearHighlight?: () => void;
  projectId?: string;
  selectedEngine?: string;
  allSources?: SourceDocument[];
  activeTab?: 'reading' | 'dossier' | 'taxonomy';
  onTabChange?: (tab: 'reading' | 'dossier' | 'taxonomy') => void;
  onExploreTopic?: (query: string) => void;
  onMetadataUpdated?: (updatedDoc: SourceDocument) => void;
}

const DocViewerComponent: React.FC<DocViewerProps> = ({
  document,
  highlightTarget,
  onClearHighlight,
  projectId,
  selectedEngine,
  allSources = [],
  activeTab: controlledActiveTab,
  onTabChange,
  onExploreTopic,
  onMetadataUpdated,
}) => {
  const highlightRef = useRef<HTMLDivElement>(null);
  const [internalActiveTab, setInternalActiveTab] = useState<'reading' | 'dossier' | 'taxonomy'>('reading');
  const activeTab = controlledActiveTab !== undefined ? controlledActiveTab : internalActiveTab;
  const [activeSeekTime, setActiveSeekTime] = useState<number | null>(null);
  const [viewStyle, setViewStyle] = useState<'rich' | 'raw'>('rich');
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  const [isPaginated, setIsPaginated] = useState<boolean>(true);

  const pages = useMemo(() => {
    if (!document?.raw_markdown) return [];
    return getDocPages(document.raw_markdown);
  }, [document?.raw_markdown]);

  const handleTabSelect = (tab: 'reading' | 'dossier' | 'taxonomy') => {
    setInternalActiveTab(tab);
    onTabChange?.(tab);
  };

  // Reset seek time, page index, and image modal when changing document
  useEffect(() => {
    setCurrentPageIndex(0);
    setActiveSeekTime(null);
    setSelectedImageUrl(null);
  }, [document?.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedImageUrl) {
        setSelectedImageUrl(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImageUrl]);

  // When a citation highlight target is set, automatically switch to reading tab and jump to page
  useEffect(() => {
    if (highlightTarget && document && highlightTarget.source_id === document.id) {
      handleTabSelect('reading');

      if (pages.length > 1) {
        const targetPageIdx = pages.findIndex(
          (p) => highlightTarget.start_char >= p.startChar && highlightTarget.start_char < p.endChar
        );
        if (targetPageIdx >= 0) {
          setCurrentPageIndex(targetPageIdx);
        }
      }

      const timer = setTimeout(() => {
        highlightRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 100);

      // If YouTube source, seek to the citation's timestamp
      if (document.metadata?.is_youtube) {
        const snippet = document.raw_markdown.slice(
          Math.max(0, highlightTarget.start_char - 150),
          Math.min(document.raw_markdown.length, highlightTarget.end_char + 150)
        );
        const parsed = parseTimestampSeconds(snippet);
        if (parsed !== null) {
          setActiveSeekTime(parsed);
        }
      }

      return () => clearTimeout(timer);
    }
  }, [highlightTarget, document, pages]);

  const renderTextWithClickableTimestamps = (text: string) => {
    if (!document?.metadata?.is_youtube) {
      return text;
    }
    const parts = text.split(/(\*{0,2}\[(?:\d{1,2}:)?\d{1,2}:\d{2}\]\*{0,2})/g);
    return parts.map((part, idx) => {
      const tsSeconds = parseTimestampSeconds(part);
      if (tsSeconds !== null) {
        return (
          <button
            key={idx}
            type="button"
            onClick={() => setActiveSeekTime(tsSeconds)}
            title={`Reproducir video desde ${part.replace(/\*/g, '')}`}
            className="inline-flex items-center gap-1 font-mono text-red-400 hover:text-red-300 hover:bg-red-950/60 px-1 py-0.5 rounded cursor-pointer transition font-bold"
          >
            <Play className="w-2.5 h-2.5 fill-current" />
            {part.replace(/\*/g, '')}
          </button>
        );
      }
      return part;
    });
  };

  const markdownComponents = useMemo(
    () => ({
      table: ({ node, ...props }: any) => (
        <div className="overflow-x-auto my-4 rounded-xl border border-slate-700/80 bg-slate-950/80 shadow-md">
          <table className="min-w-full divide-y divide-slate-800 text-xs font-sans" {...props} />
        </div>
      ),
      thead: ({ node, ...props }: any) => (
        <thead className="bg-slate-800/90 text-slate-200 font-semibold uppercase tracking-wider text-[11px]" {...props} />
      ),
      tbody: ({ node, ...props }: any) => (
        <tbody className="divide-y divide-slate-800/60 text-slate-300" {...props} />
      ),
      tr: ({ node, ...props }: any) => (
        <tr className="hover:bg-slate-800/40 transition-colors" {...props} />
      ),
      th: ({ node, ...props }: any) => (
        <th className="px-3.5 py-2.5 text-left font-semibold text-slate-300" {...props} />
      ),
      td: ({ node, ...props }: any) => (
        <td className="px-3.5 py-2 text-[12px] whitespace-normal" {...props} />
      ),
      img: ({ node, src, alt, ...props }: any) => (
        <div className="my-5 flex flex-col items-center">
          <div
            className="rounded-xl overflow-hidden border border-slate-700/80 bg-slate-950 shadow-lg group relative cursor-pointer max-w-2xl"
            onClick={() => setSelectedImageUrl(src || '')}
            title="Clic para ampliar figura"
          >
            <img
              src={src}
              alt={alt || 'Figura'}
              className="w-full h-auto max-h-[480px] object-contain transition-transform group-hover:scale-[1.01]"
              loading="lazy"
              {...props}
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
              <span className="px-3 py-1.5 rounded-lg bg-slate-900/90 text-white text-xs shadow-lg border border-slate-700 flex items-center gap-1.5 font-medium">
                <Maximize2 className="w-3.5 h-3.5 text-indigo-400" /> Ampliar figura
              </span>
            </div>
          </div>
          {alt && (
            <span className="text-[11px] text-slate-400 mt-2 text-center max-w-lg italic font-sans">
              {alt}
            </span>
          )}
        </div>
      ),
      blockquote: ({ node, ...props }: any) => (
        <blockquote className="border-l-4 border-indigo-500/60 bg-indigo-950/20 px-4 py-2 my-3 rounded-r-lg text-slate-300 italic text-xs leading-relaxed" {...props} />
      ),
      a: ({ node, href, children, ...props }: any) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
          {...props}
        >
          {children}
        </a>
      ),
    }),
    []
  );

  if (!document) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-slate-500 bg-slate-900/40 border-r border-slate-800">
        <FileText className="w-16 h-16 mb-4 stroke-[1.5] text-slate-600" />
        <h3 className="text-lg font-medium text-slate-400">No source selected</h3>
        <p className="text-sm text-center mt-1 max-w-sm">
          Select a document from the source manager on the right or click a citation to inspect its grounding context.
        </p>
      </div>
    );
  }

  const isHighlightedForThisDoc =
    highlightTarget && highlightTarget.source_id === document.id;

  const raw = document.raw_markdown;
  const currentPage = pages.length > 0 ? pages[Math.min(currentPageIndex, pages.length - 1)] : null;
  const activeContent = isPaginated && currentPage ? currentPage.content : raw;
  const contentStartChar = isPaginated && currentPage ? currentPage.startChar : 0;
  const contentEndChar = isPaginated && currentPage ? currentPage.endChar : raw.length;

  let beforeText = activeContent;
  let highlightedText = '';
  let afterText = '';

  if (
    isHighlightedForThisDoc &&
    highlightTarget.start_char < contentEndChar &&
    highlightTarget.end_char > contentStartChar
  ) {
    const relStart = Math.max(0, highlightTarget.start_char - contentStartChar);
    const relEnd = Math.min(activeContent.length, Math.max(relStart, highlightTarget.end_char - contentStartChar));
    beforeText = activeContent.slice(0, relStart);
    highlightedText = activeContent.slice(relStart, relEnd);
    afterText = activeContent.slice(relEnd);
  }

  return (
    <div className="h-full flex flex-col bg-slate-900/60 border-r border-slate-800/80 overflow-hidden">
      {/* Document Header */}
      <div className="flex flex-wrap items-center justify-between px-3.5 py-2 border-b border-slate-800/80 bg-slate-900/90 backdrop-blur gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0 max-w-[42%]">
          <div className={`p-1.5 rounded-lg border shrink-0 ${
            document.metadata?.is_youtube
              ? 'bg-red-500/10 text-red-500 border-red-500/20'
              : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
          }`}>
            {document.metadata?.is_youtube ? (
              <YouTubeIcon className="w-3.5 h-3.5" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-xs font-semibold text-slate-200 truncate" title={document.filename}>
              {document.filename}
            </h2>
            <p className="text-[10px] text-slate-400 truncate">
              {document.metadata?.is_youtube ? (
                <>
                  <span className="text-red-400 font-medium">YouTube</span> &bull; {document.metadata.channel || 'Canal'} &bull; {document.char_count.toLocaleString()} chars
                </>
              ) : (
                <>
                  {document.metadata?.page_count ? `${document.metadata.page_count} págs • ` : ''}
                  {document.char_count.toLocaleString()} chars
                </>
              )}
            </p>
          </div>
        </div>

        {/* View Mode Switcher: Reading vs. Dossier vs. Taxonomy */}
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          <div className="flex items-center gap-1 bg-slate-800/80 p-0.5 rounded-lg border border-slate-700/60 shrink-0">
            <button
              onClick={() => handleTabSelect('reading')}
              title="Lectura del texto y fuentes indexadas"
              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                activeTab === 'reading'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Lectura</span>
            </button>
            <button
              onClick={() => handleTabSelect('dossier')}
              title="Estructura, Resumen y Guía de Estudio"
              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                activeTab === 'dossier'
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <GraduationCap className="w-3.5 h-3.5 text-amber-300" />
              <span>Guía de Estudio</span>
            </button>
            <button
              onClick={() => handleTabSelect('taxonomy')}
              title="Categorías, Etiquetas, Época y Metadatos"
              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                activeTab === 'taxonomy'
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Tags className="w-3.5 h-3.5 text-teal-300" />
              <span>Categorías & Tags</span>
            </button>
          </div>

          {/* View Style Switcher (Rich Markdown vs Raw Text) */}
          {activeTab === 'reading' && !document.metadata?.is_code && !document.metadata?.is_repo && (
            <div className="flex items-center bg-slate-800/80 p-0.5 rounded-lg border border-slate-700/60 shrink-0">
              <button
                onClick={() => setViewStyle('rich')}
                title="Vista Formateada (Tablas, Figuras y Markdown)"
                className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                  viewStyle === 'rich'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layout className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Formato</span>
              </button>
              <button
                onClick={() => setViewStyle('raw')}
                title="Texto Plano / Raw"
                className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                  viewStyle === 'raw'
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <AlignLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Texto</span>
              </button>
            </div>
          )}

          {isHighlightedForThisDoc && activeTab === 'reading' && (
            <button
              onClick={onClearHighlight}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition cursor-pointer shrink-0 shadow-sm"
              title="Cita activa en el texto. Clic para deseleccionar"
            >
              <Bookmark className="w-3 h-3 text-amber-400" />
              <span>Cita Activa</span>
              <X className="w-3 h-3 ml-0.5 text-amber-400/80 hover:text-white" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 overflow-hidden relative">
        <div className={`h-full ${activeTab === 'taxonomy' ? 'block' : 'hidden'}`}>
          <TaxonomyViewer
            projectId={projectId || 'default'}
            document={document}
            allSources={allSources}
            selectedEngine={selectedEngine}
            onMetadataUpdated={onMetadataUpdated}
          />
        </div>

        <div className={`h-full ${activeTab === 'dossier' ? 'block' : 'hidden'}`}>
          <DossierViewer
            projectId={projectId || 'default'}
            document={document}
            selectedEngine={selectedEngine}
            onExploreTopic={onExploreTopic}
          />
        </div>

        {document.metadata?.is_code || document.metadata?.is_repo ? (
          <div className={`h-full ${activeTab === 'reading' ? 'block' : 'hidden'}`}>
            <CodeViewer
              document={document}
              highlightTarget={highlightTarget}
              onClearHighlight={onClearHighlight}
            />
          </div>
        ) : (
          <div className={`h-full flex flex-col overflow-hidden ${activeTab === 'reading' ? 'block' : 'hidden'}`}>
            {/* Embedded YouTube Video Player Banner */}
            {document.metadata?.is_youtube && document.metadata?.video_id && (
              <div className="bg-slate-950/90 border-b border-slate-800 p-3 sm:p-4 shrink-0 shadow-inner">
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-start max-w-4xl mx-auto">
                  <div className="w-full sm:w-72 shrink-0 aspect-video rounded-xl overflow-hidden border border-slate-800 bg-black shadow-md relative">
                    <iframe
                      key={`yt-${document.metadata.video_id}-${activeSeekTime ?? 0}`}
                      className="w-full h-full"
                      src={`https://www.youtube-nocookie.com/embed/${document.metadata.video_id}?start=${activeSeekTime ?? 0}&autoplay=${activeSeekTime !== null ? 1 : 0}`}
                      title={document.filename}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-red-500/20 text-red-400 border border-red-500/30">
                        <YouTubeIcon className="w-3 h-3" /> Conferencia YouTube
                      </span>
                      {activeSeekTime !== null && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          <Play className="w-2.5 h-2.5 fill-current" /> Tiempo activo: {formatSeconds(activeSeekTime)}
                        </span>
                      )}
                    </div>
                    <h4 className="text-xs font-semibold text-slate-200 truncate">
                      {document.filename}
                    </h4>
                    {document.metadata?.channel && (
                      <p className="text-[11px] text-slate-400 truncate">
                        Canal: <span className="text-slate-300 font-medium">{document.metadata.channel}</span>
                      </p>
                    )}
                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      <a
                        href={activeSeekTime !== null ? `https://youtu.be/${document.metadata.video_id}?t=${activeSeekTime}` : `https://youtu.be/${document.metadata.video_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 hover:text-red-300 transition-colors cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Abrir en YouTube {activeSeekTime !== null ? `(${formatSeconds(activeSeekTime)})` : ''} ↗</span>
                      </a>
                      {activeSeekTime !== null && (
                        <button
                          type="button"
                          onClick={() => setActiveSeekTime(null)}
                          className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition cursor-pointer"
                        >
                          Reiniciar al inicio
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Pagination / Navigation Toolbar */}
            {pages.length > 1 && (
              <div className="flex items-center justify-between px-4 py-1.5 bg-slate-950/80 border-b border-slate-800/80 text-xs text-slate-300 shrink-0 select-none">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPageIndex((prev) => Math.max(0, prev - 1))}
                    disabled={currentPageIndex === 0}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-35 disabled:cursor-not-allowed text-slate-200 transition"
                    title="Página anterior"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Anterior</span>
                  </button>

                  <span className="font-medium text-slate-200 font-mono text-xs">
                    {currentPage?.pageNumber
                      ? `Pág. ${currentPage.pageNumber}`
                      : `Sección ${currentPageIndex + 1}`}
                    <span className="text-slate-500 font-sans"> de {pages.length}</span>
                  </span>

                  <button
                    onClick={() => setCurrentPageIndex((prev) => Math.min(pages.length - 1, prev + 1))}
                    disabled={currentPageIndex === pages.length - 1}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-35 disabled:cursor-not-allowed text-slate-200 transition"
                    title="Página siguiente"
                  >
                    <span className="hidden sm:inline">Siguiente</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-400 hidden sm:inline">Ir a pág:</span>
                    <input
                      type="number"
                      min={1}
                      max={pages.length}
                      value={currentPage?.pageNumber ?? currentPageIndex + 1}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val)) {
                          const matchIdx = pages.findIndex((p) => p.pageNumber === val);
                          if (matchIdx >= 0) {
                            setCurrentPageIndex(matchIdx);
                          } else {
                            setCurrentPageIndex(Math.max(0, Math.min(pages.length - 1, val - 1)));
                          }
                        }
                      }}
                      className="w-14 px-1.5 py-0.5 text-center font-mono text-xs rounded bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <button
                    onClick={() => setIsPaginated(!isPaginated)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition cursor-pointer ${
                      isPaginated
                        ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
                    }`}
                    title={
                      isPaginated
                        ? 'Modo paginado activo (rápido y fluido). Clic para ver continuo'
                        : 'Modo continuo activo. Clic para ver paginado'
                    }
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">{isPaginated ? 'Paginado' : 'Continuo'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Reading Content Pane */}
            <div className={`flex-1 overflow-y-auto px-8 py-6 text-sm leading-relaxed ${
              viewStyle === 'rich' ? 'text-slate-200 font-sans' : 'font-mono text-slate-300'
            }`}>
              {viewStyle === 'rich' ? (
                highlightedText ? (
                  <div className="space-y-4">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {beforeText}
                    </ReactMarkdown>
                    <div
                      ref={highlightRef}
                      id="active-citation-highlight"
                      className="bg-amber-400/20 border-l-4 border-amber-400 px-4 py-3 my-3 rounded-r-xl text-amber-100 ring-2 ring-amber-400/40 shadow-lg shadow-amber-950/40 transition-all duration-300 font-sans"
                    >
                      <div className="text-[10px] uppercase font-bold tracking-wider text-amber-400 mb-2 flex items-center gap-1">
                        <Bookmark className="w-3.5 h-3.5" /> Grounded Evidence Chunk
                      </div>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {highlightedText}
                      </ReactMarkdown>
                    </div>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {afterText}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {activeContent}
                    </ReactMarkdown>
                  </div>
                )
              ) : (
                highlightedText ? (
                  <div className="whitespace-pre-wrap">
                    <span>{renderTextWithClickableTimestamps(beforeText)}</span>
                    <div
                      ref={highlightRef}
                      id="active-citation-highlight"
                      className="bg-amber-400/20 border-l-4 border-amber-400 px-3 py-2 my-2 rounded-r-md text-amber-200 ring-2 ring-amber-400/40 shadow-lg shadow-amber-950/40 transition-all duration-300"
                    >
                      <div className="text-[10px] uppercase font-bold tracking-wider text-amber-400 mb-1 flex items-center gap-1">
                        <Bookmark className="w-3 h-3" /> Grounded Evidence Chunk
                      </div>
                      {renderTextWithClickableTimestamps(highlightedText)}
                    </div>
                    <span>{renderTextWithClickableTimestamps(afterText)}</span>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{renderTextWithClickableTimestamps(activeContent)}</div>
                )
              )}
            </div>
          </div>
        )}
      </div>

      {/* Lightbox modal for enlarged image preview */}
      {selectedImageUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedImageUrl(null)}
        >
          <div
            className="relative max-w-5xl max-h-[90vh] bg-slate-900 border border-slate-700/80 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/70">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 truncate">
                <FileText className="w-3.5 h-3.5 text-indigo-400" />
                <span>Figura extraída / Esquema</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={selectedImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
                  title="Abrir imagen original en nueva pestaña"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  onClick={() => setSelectedImageUrl(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
                  title="Cerrar (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 overflow-auto flex items-center justify-center bg-slate-950/40 min-h-[300px]">
              <img
                src={selectedImageUrl}
                alt="Figura ampliada"
                className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-md"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const DocViewer = React.memo(DocViewerComponent);
