import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  FileText,
  Bookmark,
  Sparkles,
  ExternalLink,
  ChevronLeft,
  ShieldCheck,
  CornerDownLeft,
  GraduationCap,
  Tags,
  Share2,
  Upload,
  Trash2,
  X,
  Copy,
  Check,
  Layers,
  ChevronDown,
  AlertTriangle,
  Search,
} from 'lucide-react';
import { SourceDocument, ChatMessage, HighlightTarget } from '../../types';
import { DossierViewer } from '../DossierViewer';
import { TaxonomyViewer } from '../TaxonomyViewer';
import { CodeViewer } from '../CodeViewer';
import { ShareChatModal } from '../ShareChatModal';
import { ImportChatModal } from '../ImportChatModal';
import { YouTubeIcon } from './ArchivalIndex';
import { shareProjectChat } from '../../services/api';

export interface ChunkCitation {
  index: number;
  chunkId: string;
  sourceId?: string;
  sourceFilename: string;
  pageNumber?: number;
  snippet: string;
  startChar?: number;
  endChar?: number;
}

export interface GroundedChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  citations?: ChunkCitation[];
  factualScore?: number;
  timestamp: string;
}

export interface DocumentSourceChunk {
  id: string;
  chunkIndex: number;
  pageNumber?: number;
  headingPath?: string[];
  content: string;
  startChar?: number;
  endChar?: number;
}

const parseTimestampSeconds = (text: string): number | null => {
  if (!text) return null;
  const match = /(?:\[|\()?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\]|\))?/.exec(text);
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
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours.toString().padStart(2, '0')}:${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

interface ArchivalSplitViewerProps {
  document: SourceDocument;
  documentTitle: string;
  documentAuthors: string[];
  documentDoi?: string;
  chunks: DocumentSourceChunk[];
  messages: GroundedChatMessage[];
  rawMessages?: ChatMessage[];
  onSendMessage: (query: string) => Promise<void>;
  onBackToIndex?: () => void;
  isLoading?: boolean;
  projectId?: string;
  projectName?: string;
  selectedEngine?: string;
  allSources?: SourceDocument[];
  activeSourceIds?: string[];
  onToggleActiveSource?: (id: string) => void;
  onToggleAllSources?: () => void;
  onSetOnlyThisSourceActive?: (id: string) => void;
  onSetAllSourcesActive?: () => void;
  activeTab?: 'reading' | 'dossier' | 'taxonomy';
  onTabChange?: (tab: 'reading' | 'dossier' | 'taxonomy') => void;
  onExploreTopic?: (query: string) => void;
  onMetadataUpdated?: (updatedDoc: SourceDocument) => void;
  onClearChat?: () => void;
  onMessagesImported?: (newMsgs: ChatMessage[]) => void;
  onSaveToNotebook?: (
    text: string,
    title?: string,
    citationIds?: string[],
    originPrompt?: string,
    sourceMessageId?: string
  ) => void | Promise<void>;
  highlightTarget?: HighlightTarget | null;
  onClearHighlight?: () => void;
  onSelectDoc?: (doc: SourceDocument) => void;
  targetMessageId?: string | null;
  onClearTargetMessageId?: () => void;
}

export const ArchivalSplitViewer: React.FC<ArchivalSplitViewerProps> = ({
  document,
  documentTitle,
  documentAuthors,
  documentDoi,
  chunks,
  messages,
  rawMessages,
  onSendMessage,
  onBackToIndex,
  isLoading = false,
  projectId,
  projectName,
  selectedEngine,
  allSources = [],
  activeSourceIds = [],
  onToggleActiveSource,
  onToggleAllSources,
  onSetOnlyThisSourceActive,
  onSetAllSourcesActive,
  activeTab: controlledActiveTab,
  onTabChange,
  onExploreTopic,
  onMetadataUpdated,
  onClearChat,
  onMessagesImported,
  onSaveToNotebook,
  highlightTarget,
  onClearHighlight,
  onSelectDoc,
  targetMessageId,
  onClearTargetMessageId,
}) => {
  const [splitRatio, setSplitRatio] = useState<number>(50); // 50% / 50%
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [internalActiveTab, setInternalActiveTab] = useState<'reading' | 'dossier' | 'taxonomy'>('reading');
  const activeTab = controlledActiveTab !== undefined ? controlledActiveTab : internalActiveTab;

  const [activeCitationIndex, setActiveCitationIndex] = useState<number | null>(null);
  const [activeCitationSnippet, setActiveCitationSnippet] = useState<string | null>(null);
  const [inputQuery, setInputQuery] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);

  // Source selector state
  const [isSourcesDropdownOpen, setIsSourcesDropdownOpen] = useState<boolean>(false);
  const [sourceSearchQuery, setSourceSearchQuery] = useState<string>('');
  const sourcesDropdownRef = useRef<HTMLDivElement>(null);

  // Close sources dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        sourcesDropdownRef.current &&
        !sourcesDropdownRef.current.contains(e.target as Node)
      ) {
        setIsSourcesDropdownOpen(false);
      }
    };
    if (isSourcesDropdownOpen) {
      window.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSourcesDropdownOpen]);

  const currentActiveSourceIds = activeSourceIds || [];
  const activeCount = currentActiveSourceIds.length;
  const isAllActive = allSources.length > 0 && activeCount === allSources.length;
  const isOnlyCurrentDoc = activeCount === 1 && currentActiveSourceIds.includes(document.id);

  const filteredDropdownSources = allSources.filter((s) => {
    if (!sourceSearchQuery.trim()) return true;
    const q = sourceSearchQuery.toLowerCase();
    const title = (s.metadata?.title || s.filename || '').toLowerCase();
    const author = (s.metadata?.author || '').toLowerCase();
    return title.includes(q) || author.includes(q);
  });

  // Formatting & text sizing states
  const [viewStyle, setViewStyle] = useState<'raw' | 'rich'>('raw');
  const [fontSize, setFontSize] = useState<'xs' | 'sm' | 'base'>('sm');
  const [activeSeekTime, setActiveSeekTime] = useState<number | null>(null);

  // Chat sharing & importing states
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareModalData, setShareModalData] = useState<{ shareId: string; shareUrl: string } | null>(null);
  const [savingMsgId, setSavingMsgId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  // Internal highlight target to support local citation clicks as well as incoming prop
  const [internalHighlightTarget, setInternalHighlightTarget] = useState<HighlightTarget | null>(null);
  const activeHighlight = highlightTarget || internalHighlightTarget;

  const containerRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const chunkRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleTabSelect = (tab: 'reading' | 'dossier' | 'taxonomy') => {
    setInternalActiveTab(tab);
    if (onTabChange) onTabChange(tab);
  };

  // Sync incoming highlightTarget from parent (e.g. from notebook or catalog)
  useEffect(() => {
    if (highlightTarget && highlightTarget.source_id === document.id) {
      setInternalHighlightTarget(highlightTarget);
      if (activeTab !== 'reading') {
        handleTabSelect('reading');
      }

      // If YouTube source, seek to citation timestamp
      if (document.metadata?.is_youtube) {
        const snippet =
          highlightTarget.quote_snippet ||
          (document.raw_markdown
            ? document.raw_markdown.slice(
                Math.max(0, (highlightTarget.start_char || 0) - 150),
                Math.min(document.raw_markdown.length, (highlightTarget.end_char || 0) + 150)
              )
            : '');
        const parsed = parseTimestampSeconds(snippet);
        if (parsed !== null) {
          setActiveSeekTime(parsed);
        }
      }

      const timer = setTimeout(() => {
        if (viewStyle === 'rich' && highlightRef.current) {
          highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          let targetEl: HTMLDivElement | undefined;
          if (highlightTarget.start_char && highlightTarget.start_char > 0) {
            const matchIdx = chunks.findIndex(
              (c) =>
                c.startChar !== undefined &&
                c.endChar !== undefined &&
                highlightTarget.start_char >= c.startChar &&
                highlightTarget.start_char < c.endChar
            );
            if (matchIdx !== -1) {
              targetEl = chunkRefs.current.get(matchIdx + 1);
            }
          }
          if (!targetEl && highlightTarget.quote_snippet) {
            const norm = highlightTarget.quote_snippet.replace(/\s+/g, ' ').trim().toLowerCase();
            const matchIdx = chunks.findIndex((c) =>
              c.content.replace(/\s+/g, ' ').toLowerCase().includes(norm.slice(0, 30))
            );
            if (matchIdx !== -1) {
              targetEl = chunkRefs.current.get(matchIdx + 1);
            }
          }
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }, 150);

      return () => clearTimeout(timer);
    }
  }, [highlightTarget, document.id, activeTab, viewStyle, chunks]);

  // Handle incoming targetMessageId (e.g. from notebook "Ver en Chat")
  useEffect(() => {
    if (targetMessageId) {
      const timer = setTimeout(() => {
        const el = window.document.getElementById(`archival-msg-${targetMessageId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-[#1A56DB]', 'dark:ring-[#60A5FA]', 'transition-all');
          setTimeout(() => {
            el.classList.remove('ring-2', 'ring-[#1A56DB]', 'dark:ring-[#60A5FA]');
            onClearTargetMessageId?.();
          }, 2500);
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [targetMessageId, messages]);

  // Clickable timestamps for YouTube/Audio transcripts
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
            className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 font-mono text-[10px] font-bold bg-[#EBEBE8] dark:bg-[#222226] text-red-600 dark:text-red-400 hover:bg-red-600 hover:text-white dark:hover:bg-red-600 dark:hover:text-white border border-[#E0E0DC] dark:border-[#2A2A2E] transition-colors cursor-pointer align-baseline"
            title={`Saltar en video a ${formatSeconds(tsSeconds)}`}
          >
            ▶ {part.replace(/\*/g, '')}
          </button>
        );
      }
      return part;
    });
  };

  // Handle Resizable Splitter
  const handleMouseDown = () => setIsResizing(true);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newRatio = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitRatio(Math.min(Math.max(newRatio, 25), 75)); // Clamp between 25% and 75%
    };

    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Scroll to cited chunk and highlight exact passage on click
  const handleCitationClick = (
    citationIndex: number,
    snippet?: string,
    chunkId?: string,
    sourceId?: string,
    startChar?: number,
    endChar?: number
  ) => {
    // If the citation belongs to a different document, switch document first
    if (sourceId && sourceId !== document.id && onSelectDoc && allSources.length > 0) {
      const targetDoc = allSources.find((s) => s.id === sourceId);
      if (targetDoc) {
        onSelectDoc(targetDoc);
        setInternalHighlightTarget({
          source_id: sourceId,
          start_char: startChar ?? 0,
          end_char: endChar ?? 0,
          quote_snippet: snippet || '',
        });
        return;
      }
    }

    // Switch to reading mode so the user sees the highlighted chunk
    if (activeTab !== 'reading') {
      handleTabSelect('reading');
    }

    setActiveCitationIndex(citationIndex);
    setActiveCitationSnippet(snippet || null);

    let sChar = startChar ?? 0;
    let eChar = endChar ?? 0;
    if (sChar === 0 && eChar === 0 && snippet && document.raw_markdown) {
      const cleanSnippet = snippet.trim().toLowerCase();
      const foundIdx = document.raw_markdown.toLowerCase().indexOf(cleanSnippet.slice(0, 40));
      if (foundIdx !== -1) {
        sChar = foundIdx;
        eChar = foundIdx + snippet.length;
      }
    }

    setInternalHighlightTarget({
      source_id: document.id,
      start_char: sChar,
      end_char: eChar,
      quote_snippet: snippet || '',
    });

    // If YouTube source, seek to the timestamp
    if (document.metadata?.is_youtube) {
      const targetSnippet =
        snippet ||
        (document.raw_markdown
          ? document.raw_markdown.slice(
              Math.max(0, sChar - 150),
              Math.min(document.raw_markdown.length, eChar + 150)
            )
          : '');
      const parsed = parseTimestampSeconds(targetSnippet);
      if (parsed !== null) {
        setActiveSeekTime(parsed);
      }
    }

    setTimeout(() => {
      if (viewStyle === 'rich' && highlightRef.current) {
        highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      let targetEl: HTMLDivElement | undefined;
      if (sChar > 0) {
        const matchIdx = chunks.findIndex(
          (c) =>
            c.startChar !== undefined &&
            c.endChar !== undefined &&
            sChar >= c.startChar &&
            sChar < c.endChar
        );
        if (matchIdx !== -1) {
          targetEl = chunkRefs.current.get(matchIdx + 1);
        }
      }
      if (!targetEl && snippet && snippet.trim().length > 0) {
        const normSnippet = snippet.replace(/\s+/g, ' ').trim().toLowerCase();
        const matchIdx = chunks.findIndex((c) =>
          c.content.replace(/\s+/g, ' ').toLowerCase().includes(normSnippet.slice(0, 30))
        );
        if (matchIdx !== -1) {
          targetEl = chunkRefs.current.get(matchIdx + 1);
        }
      }
      if (!targetEl && chunkId) {
        const matchIdx = chunks.findIndex((c) => c.id === chunkId);
        if (matchIdx !== -1) {
          targetEl = chunkRefs.current.get(matchIdx + 1);
        }
      }
      if (!targetEl && chunkRefs.current.has(citationIndex)) {
        targetEl = chunkRefs.current.get(citationIndex);
      }
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);
  };

  const handleSend = async () => {
    if (!inputQuery.trim() || isSending) return;
    const queryToSend = inputQuery.trim();
    setInputQuery('');
    setIsSending(true);
    try {
      await onSendMessage(queryToSend);
    } finally {
      setIsSending(false);
    }
  };

  const handleOpenShare = async () => {
    if (messages.length === 0 || isSharing) return;
    setIsSharing(true);
    try {
      const firstUserMsg = messages.find((m) => m.sender === 'user');
      const title = firstUserMsg ? firstUserMsg.text.slice(0, 80) : 'Conversación de Investigación';

      let currentShareId = '';
      let currentShareUrl = '';

      if (projectId) {
        try {
          const snapshot = await shareProjectChat(projectId, title, rawMessages || messages);
          currentShareId = snapshot.share_id;
          currentShareUrl = `${window.location.origin}${window.location.pathname}?share=${snapshot.share_id}`;
        } catch (apiErr) {
          console.warn('Backend share error, using fallback:', apiErr);
          currentShareId = `share_${Date.now()}`;
          currentShareUrl = `${window.location.origin}${window.location.pathname}?share=${currentShareId}`;
        }
      } else {
        currentShareId = `share_${Date.now()}`;
        currentShareUrl = `${window.location.origin}${window.location.pathname}?share=${currentShareId}`;
      }

      setShareModalData({
        shareId: currentShareId,
        shareUrl: currentShareUrl,
      });
      setIsShareModalOpen(true);
    } catch (err: any) {
      alert(`No se pudo generar el enlace para compartir: ${err.message}`);
    } finally {
      setIsSharing(false);
    }
  };

  const handleSaveMessageToNotebook = async (msg: GroundedChatMessage, idx: number) => {
    if (!onSaveToNotebook) return;
    setSavingMsgId(msg.id);
    try {
      const firstLine = msg.text.replace(/\[\^?\d+\]/g, '').trim().split('\n')[0];
      const cleanTitle = firstLine.slice(0, 50).trim() + (firstLine.length > 50 ? '...' : '');
      const cIds = msg.citations?.map((c) => c.sourceId || c.chunkId) || [];

      let originPrompt: string | undefined = undefined;
      for (let i = idx - 1; i >= 0; i--) {
        if (messages[i].sender === 'user') {
          originPrompt = messages[i].text;
          break;
        }
      }

      await onSaveToNotebook(msg.text, cleanTitle || 'Hallazgo de Investigación', cIds, originPrompt, msg.id);
    } finally {
      setSavingMsgId(null);
    }
  };

  const renderMessageTextWithCitations = (text: string, citations?: ChunkCitation[]) => {
    if (!text) return null;
    const citationMap = new Map<number, ChunkCitation>();
    if (citations) {
      citations.forEach((c) => citationMap.set(c.index, c));
    }

    const parts = text.split(/(\[\^?\d+\])/g);

    return parts.map((part, i) => {
      const match = part.match(/\[\^?(\d+)\]/);
      if (match) {
        const citIndex = parseInt(match[1], 10);
        const cit = citationMap.get(citIndex);
        const isSelected = activeCitationIndex === citIndex;
        return (
          <button
            key={i}
            type="button"
            onClick={() =>
              handleCitationClick(
                citIndex,
                cit?.snippet,
                cit?.chunkId,
                cit?.sourceId,
                cit?.startChar,
                cit?.endChar
              )
            }
            onMouseEnter={() => {
              setActiveCitationIndex(citIndex);
              if (cit?.snippet) setActiveCitationSnippet(cit.snippet);
            }}
            onMouseLeave={() => {
              setActiveCitationIndex(null);
              setActiveCitationSnippet(null);
            }}
            className={`inline-flex items-center justify-center px-1.5 py-0.5 mx-0.5 text-[10px] font-mono font-bold transition-all cursor-pointer border select-none align-baseline ${
              isSelected
                ? 'bg-[#1A56DB] text-white border-[#1A56DB]'
                : 'bg-[#EBEBE8] dark:bg-[#222226] text-[#1A56DB] dark:text-[#60A5FA] border-[#E0E0DC] dark:border-[#2A2A2E] hover:bg-[#1A56DB] hover:text-white dark:hover:bg-[#1A56DB] dark:hover:text-white'
            }`}
            title={
              cit
                ? `Cita [${citIndex}] en ${cit.sourceFilename}${cit.pageNumber ? ` (Pág. ${cit.pageNumber})` : ''}: "${cit.snippet || ''}"`
                : `Ir a cita [${citIndex}] en texto fuente`
            }
          >
            [{citIndex}]
          </button>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  const handleCopyMessage = async (msgId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgId(msgId);
      setTimeout(() => setCopiedMsgId(null), 2000);
    } catch (err) {
      console.error('Failed to copy message:', err);
    }
  };

  // Font size class mapping
  const fontSizeClass =
    fontSize === 'xs'
      ? 'text-[11px] leading-relaxed'
      : fontSize === 'base'
      ? 'text-[14px] leading-relaxed'
      : 'text-[12px] leading-relaxed';

  return (
    <div
      ref={containerRef}
      className={`w-full h-full flex flex-col md:flex-row bg-[#F9F9F8] dark:bg-[#121214] text-[#1A1A1A] dark:text-[#EDEDED] font-sans overflow-hidden ${
        isResizing ? 'select-none' : ''
      }`}
    >
      {/* LEFT PANEL: Document Source Reader / Dossier / Taxonomy */}
      <section
        style={{ width: `${splitRatio}%` }}
        className="flex flex-col h-full border-r border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214] min-w-[280px]"
        aria-label="Visor de Documento Fuente"
      >
        {/* Document Header */}
        <header className="p-3 border-b border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#19191C] flex items-center justify-between shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {onBackToIndex && (
              <button
                type="button"
                onClick={onBackToIndex}
                className="p-1 hover:bg-[#EBEBE8] dark:hover:bg-[#222226] text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] transition-colors cursor-pointer"
                title="Volver al Catálogo de Fuentes"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
            <FileText className="w-4 h-4 text-[#666666] dark:text-[#888888] shrink-0" aria-hidden="true" />
            <div className="flex flex-col min-w-0">
              <h2 className="text-xs font-semibold tracking-tight truncate text-[#1A1A1A] dark:text-[#EDEDED]" title={documentTitle}>
                {documentTitle}
              </h2>
              <span className="text-[10px] text-[#666666] dark:text-[#888888] font-mono truncate">
                {documentAuthors.join(', ')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {documentDoi && (
              <a
                href={`https://doi.org/${documentDoi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-[#1A56DB] dark:text-[#60A5FA] hover:underline flex items-center gap-1"
                aria-label={`Ver DOI ${documentDoi}`}
              >
                <span>DOI</span>
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            )}
          </div>
        </header>

        {/* View Mode Switcher + Formatting Controls Toolbar */}
        <div className="flex flex-wrap items-center justify-between p-2 px-3 border-b border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214] gap-2 shrink-0 text-xs">
          {/* View Mode Switcher: 01 Lectura | 02 Guía de Estudio | 03 Categorías y Tags */}
          <div className="flex items-center bg-[#EBEBE8] dark:bg-[#1E1E22] p-0.5 border border-[#E0E0DC] dark:border-[#2A2A2E] font-mono text-[11px]">
            <button
              type="button"
              onClick={() => handleTabSelect('reading')}
              className={`px-2.5 py-0.5 transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                activeTab === 'reading'
                  ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] font-bold'
                  : 'text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED]'
              }`}
            >
              <FileText className="w-3 h-3" />
              <span>Lectura</span>
            </button>
            <button
              type="button"
              onClick={() => handleTabSelect('dossier')}
              className={`px-2.5 py-0.5 transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                activeTab === 'dossier'
                  ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] font-bold'
                  : 'text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED]'
              }`}
            >
              <GraduationCap className="w-3 h-3 text-amber-500" />
              <span>Guía de Estudio</span>
            </button>
            <button
              type="button"
              onClick={() => handleTabSelect('taxonomy')}
              className={`px-2.5 py-0.5 transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                activeTab === 'taxonomy'
                  ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] font-bold'
                  : 'text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED]'
              }`}
            >
              <Tags className="w-3 h-3 text-teal-500" />
              <span>Categorías & Tags</span>
            </button>
          </div>

          {/* Formatting Controls (Only shown in 'reading' mode and non-code docs) */}
          {activeTab === 'reading' && !document.metadata?.is_code && !document.metadata?.is_repo && (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Format / Raw Switcher */}
              <div className="flex items-center bg-[#EBEBE8] dark:bg-[#1E1E22] p-0.5 border border-[#E0E0DC] dark:border-[#2A2A2E] text-[10px] font-mono">
                <button
                  type="button"
                  onClick={() => setViewStyle('raw')}
                  className={`px-2 py-0.5 cursor-pointer transition-colors ${
                    viewStyle === 'raw'
                      ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] font-bold'
                      : 'text-[#666666] dark:text-[#888888]'
                  }`}
                  title="Vista de texto y fragmentos numerados"
                >
                  Texto
                </button>
                <button
                  type="button"
                  onClick={() => setViewStyle('rich')}
                  className={`px-2 py-0.5 cursor-pointer transition-colors ${
                    viewStyle === 'rich'
                      ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] font-bold'
                      : 'text-[#666666] dark:text-[#888888]'
                  }`}
                  title="Vista formateada en Markdown"
                >
                  Formato
                </button>
              </div>

              {/* Text Sizing Controls (A- / 100% / A+) */}
              <div className="flex items-center bg-[#EBEBE8] dark:bg-[#1E1E22] p-0.5 border border-[#E0E0DC] dark:border-[#2A2A2E] text-[10px] font-mono">
                <button
                  type="button"
                  onClick={() => setFontSize('xs')}
                  className={`px-1.5 py-0.5 cursor-pointer ${
                    fontSize === 'xs'
                      ? 'font-bold underline text-[#1A1A1A] dark:text-[#EDEDED]'
                      : 'text-[#666666] dark:text-[#888888]'
                  }`}
                  title="Tipografía compacta"
                >
                  A-
                </button>
                <button
                  type="button"
                  onClick={() => setFontSize('sm')}
                  className={`px-1.5 py-0.5 cursor-pointer ${
                    fontSize === 'sm'
                      ? 'font-bold underline text-[#1A1A1A] dark:text-[#EDEDED]'
                      : 'text-[#666666] dark:text-[#888888]'
                  }`}
                  title="Tipografía estándar"
                >
                  100%
                </button>
                <button
                  type="button"
                  onClick={() => setFontSize('base')}
                  className={`px-1.5 py-0.5 cursor-pointer ${
                    fontSize === 'base'
                      ? 'font-bold underline text-[#1A1A1A] dark:text-[#EDEDED]'
                      : 'text-[#666666] dark:text-[#888888]'
                  }`}
                  title="Tipografía ampliada"
                >
                  A+
                </button>
              </div>

              {/* Active Citation Chip */}
              {activeCitationIndex !== null && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveCitationIndex(null);
                    setActiveCitationSnippet(null);
                  }}
                  className="px-1.5 py-0.5 bg-amber-500/15 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-[10px] font-mono flex items-center gap-1 cursor-pointer"
                  title="Limpiar cita activa en texto"
                >
                  <span>Cita [{activeCitationIndex}]</span>
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Left Panel Body Content */}
        <div className="flex-1 overflow-hidden relative">
          {/* Tab 02: Dossier / Study Guide */}
          {activeTab === 'dossier' && (
            <div className="h-full overflow-auto">
              <DossierViewer
                projectId={projectId || 'default'}
                document={document}
                selectedEngine={selectedEngine}
                onExploreTopic={onExploreTopic}
              />
            </div>
          )}

          {/* Tab 03: Taxonomy & Tags */}
          {activeTab === 'taxonomy' && (
            <div className="h-full overflow-auto">
              <TaxonomyViewer
                projectId={projectId || 'default'}
                document={document}
                allSources={allSources}
                selectedEngine={selectedEngine}
                onMetadataUpdated={onMetadataUpdated}
              />
            </div>
          )}

          {/* Tab 01: Reading Mode */}
          {activeTab === 'reading' && (
            <div className="h-full flex flex-col overflow-hidden">
              {/* Code Viewer Mode */}
              {/* Code Viewer Mode */}
              {document.metadata?.is_code || document.metadata?.is_repo ? (
                <CodeViewer
                  document={document}
                  highlightTarget={
                    activeHighlight ||
                    (activeCitationSnippet
                      ? ({ quote_snippet: activeCitationSnippet } as HighlightTarget)
                      : null)
                  }
                  onClearHighlight={() => {
                    setInternalHighlightTarget(null);
                    setActiveCitationIndex(null);
                    setActiveCitationSnippet(null);
                    onClearHighlight?.();
                  }}
                />
              ) : (
                <>
                  {/* YouTube Embedded Player Banner */}
                  {document.metadata?.is_youtube && document.metadata?.video_id && (
                    <div className="bg-[#EBEBE8] dark:bg-[#19191C] border-b border-[#E0E0DC] dark:border-[#2A2A2E] p-3 shrink-0">
                      <div className="flex flex-col sm:flex-row gap-3 items-start max-w-2xl mx-auto">
                        <div className="w-full sm:w-64 shrink-0 aspect-video border border-[#E0E0DC] dark:border-[#2A2A2E] bg-black">
                          <iframe
                            key={`yt-${document.metadata.video_id}-${activeSeekTime ?? 0}`}
                            className="w-full h-full"
                            src={`https://www.youtube-nocookie.com/embed/${document.metadata.video_id}?start=${activeSeekTime ?? 0}&autoplay=${activeSeekTime !== null ? 1 : 0}`}
                            title={document.filename}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                          />
                        </div>
                        <div className="flex-1 min-w-0 space-y-1 font-mono text-xs">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-red-600 dark:text-red-400 uppercase inline-flex items-center gap-1">
                              <YouTubeIcon className="w-3 h-3" /> YouTube Video
                            </span>
                            {activeSeekTime !== null && (
                              <span className="text-amber-700 dark:text-amber-400 bg-amber-500/10 px-1 py-0.2 border border-amber-500/20">
                                Sincronizado: {formatSeconds(activeSeekTime)}
                              </span>
                            )}
                          </div>
                          <div className="font-sans font-semibold text-xs truncate text-[#1A1A1A] dark:text-[#EDEDED]">
                            {document.filename}
                          </div>
                          {document.metadata?.channel && (
                            <div className="text-[11px] text-[#666666] dark:text-[#888888] truncate">
                              Canal: {document.metadata.channel}
                            </div>
                          )}
                          <div className="pt-1 flex items-center gap-2">
                            <a
                              href={
                                activeSeekTime !== null
                                  ? `https://youtu.be/${document.metadata.video_id}?t=${activeSeekTime}`
                                  : `https://youtu.be/${document.metadata.video_id}`
                              }
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#1A56DB] dark:text-[#60A5FA] hover:underline inline-flex items-center gap-1 text-[11px]"
                            >
                              <span>Abrir en YouTube ↗</span>
                            </a>
                            {activeSeekTime !== null && (
                              <button
                                type="button"
                                onClick={() => setActiveSeekTime(null)}
                                className="text-[#666666] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] text-[10px] cursor-pointer"
                              >
                                Reiniciar
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Reading Content Pane */}
                  <div ref={leftPanelRef} className="flex-1 overflow-auto p-4 md:p-6 select-text">
                    {(() => {
                      const isHighlightedForThisDoc =
                        Boolean(activeHighlight && activeHighlight.source_id === document.id && document.raw_markdown);

                      let beforeText = document.raw_markdown || '';
                      let highlightedText = '';
                      let afterText = '';

                      if (isHighlightedForThisDoc && activeHighlight && document.raw_markdown) {
                        const raw = document.raw_markdown;
                        let sChar = activeHighlight.start_char ?? 0;
                        let eChar = activeHighlight.end_char ?? 0;

                        if (sChar === 0 && eChar === 0 && activeHighlight.quote_snippet) {
                          const cleanSnippet = activeHighlight.quote_snippet.trim().toLowerCase();
                          const matchIdx = raw.toLowerCase().indexOf(cleanSnippet.slice(0, 40));
                          if (matchIdx !== -1) {
                            sChar = matchIdx;
                            eChar = matchIdx + activeHighlight.quote_snippet.length;
                          }
                        }

                        if (sChar < raw.length && eChar > 0 && eChar > sChar) {
                          const relStart = Math.max(0, sChar);
                          const relEnd = Math.min(raw.length, Math.max(relStart, eChar));
                          beforeText = raw.slice(0, relStart);
                          highlightedText = raw.slice(relStart, relEnd);
                          afterText = raw.slice(relEnd);
                        }
                      }

                      if (viewStyle === 'rich') {
                        return (
                          <article className={`prose dark:prose-invert max-w-2xl mx-auto font-sans ${fontSizeClass}`}>
                            {highlightedText ? (
                              <div className="space-y-4">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {beforeText}
                                </ReactMarkdown>
                                <div
                                  ref={highlightRef}
                                  id="active-citation-highlight"
                                  className="bg-amber-500/15 border-l-4 border-amber-500 px-4 py-3 my-3 text-amber-900 dark:text-amber-200 ring-1 ring-amber-500/30 font-sans select-text animate-in fade-in"
                                >
                                  <div className="text-[10px] uppercase font-bold tracking-wider text-amber-600 dark:text-amber-400 mb-1.5 flex items-center justify-between font-mono select-none">
                                    <span className="flex items-center gap-1.5">
                                      <Bookmark className="w-3.5 h-3.5" /> Pasaje Citado en Documento Fuente
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setInternalHighlightTarget(null);
                                        setActiveCitationIndex(null);
                                        setActiveCitationSnippet(null);
                                        onClearHighlight?.();
                                      }}
                                      className="text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] cursor-pointer"
                                      title="Quitar resaltado"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {highlightedText}
                                  </ReactMarkdown>
                                </div>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {afterText}
                                </ReactMarkdown>
                              </div>
                            ) : (
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {document.raw_markdown || '*Documento sin contenido disponible.*'}
                              </ReactMarkdown>
                            )}
                          </article>
                        );
                      }

                      return (
                        /* Raw Synchronized Chunks with Coordinates */
                        <article className="space-y-5 max-w-2xl mx-auto font-sans">
                          {chunks.map((chunk, idx) => {
                            const chunkNum = idx + 1;
                            const matchesChar =
                              activeHighlight &&
                              activeHighlight.source_id === document.id &&
                              activeHighlight.start_char !== undefined &&
                              activeHighlight.start_char > 0 &&
                              chunk.startChar !== undefined &&
                              chunk.endChar !== undefined &&
                              activeHighlight.start_char >= chunk.startChar &&
                              activeHighlight.start_char < chunk.endChar;

                            const matchesSnippet =
                              Boolean(activeCitationSnippet) &&
                              chunk.content.toLowerCase().includes(activeCitationSnippet!.toLowerCase().slice(0, 30));

                            const isActive =
                              matchesChar ||
                              matchesSnippet ||
                              (activeCitationIndex === chunkNum && !activeHighlight?.start_char && !activeCitationSnippet);

                            return (
                              <div
                                key={chunk.id}
                                ref={(el) => {
                                  if (el) chunkRefs.current.set(chunkNum, el);
                                  else chunkRefs.current.delete(chunkNum);
                                }}
                                className={`group relative pl-10 pr-3 py-2.5 border-l-2 transition-all ${
                                  isActive
                                    ? 'border-[#1A56DB] bg-amber-500/15 dark:bg-[#1A56DB]/20 text-[#1A1A1A] dark:text-[#EDEDED] ring-1 ring-amber-500/30'
                                    : 'border-transparent hover:border-[#E0E0DC] dark:hover:border-[#2A2A2E]'
                                }`}
                              >
                                {/* Margin Coordinate Anchor */}
                                <div className="absolute left-0 top-2.5 font-mono text-[10px] text-[#999999] dark:text-[#555555] select-none flex items-center gap-1">
                                  <span className="font-bold text-[#666666] dark:text-[#888888]">
                                    [{String(chunkNum).padStart(2, '0')}]
                                  </span>
                                  {chunk.pageNumber && (
                                    <span className="text-[9px]">P{chunk.pageNumber}</span>
                                  )}
                                </div>

                                {/* Heading hierarchy context */}
                                {chunk.headingPath && chunk.headingPath.length > 0 && (
                                  <div className="font-mono text-[10px] uppercase text-[#666666] dark:text-[#888888] mb-1 font-semibold tracking-wider">
                                    § {chunk.headingPath.join(' › ')}
                                  </div>
                                )}

                                {/* Chunk Content with Clickable Timestamps */}
                                <p className={`whitespace-pre-wrap font-sans text-[#1A1A1A] dark:text-[#EDEDED] ${fontSizeClass}`}>
                                  {renderTextWithClickableTimestamps(chunk.content)}
                                </p>
                              </div>
                            );
                          })}
                        </article>
                      );
                    })()}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {/* RESIZER HANDLE */}
      <div
        role="slider"
        aria-label="Ajustar tamaño de paneles del visor"
        aria-valuenow={splitRatio}
        aria-valuemin={25}
        aria-valuemax={75}
        tabIndex={0}
        onMouseDown={handleMouseDown}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setSplitRatio((prev) => Math.max(25, prev - 5));
          if (e.key === 'ArrowRight') setSplitRatio((prev) => Math.min(75, prev + 5));
        }}
        className="w-1.5 hover:w-2 bg-[#E0E0DC] dark:bg-[#2A2A2E] hover:bg-[#1A56DB] dark:hover:bg-[#60A5FA] cursor-col-resize transition-all shrink-0 hidden md:block"
      />

      {/* RIGHT PANEL: Synthesis & Grounded Chat */}
      <section
        style={{ width: `${100 - splitRatio}%` }}
        className="flex flex-col h-full bg-[#F9F9F8] dark:bg-[#121214] min-w-[280px]"
        aria-label="Panel de Síntesis y Chat Científico"
      >
        {/* Right Header & Chat Actions Toolbar */}
        <header className="p-3 border-b border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#19191C] flex items-center justify-between shrink-0 gap-2 flex-wrap sm:flex-nowrap">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-3.5 h-3.5 text-[#1A56DB] dark:text-[#60A5FA] shrink-0" aria-hidden="true" />
            <h3 className="text-xs font-semibold tracking-tight font-sans text-[#1A1A1A] dark:text-[#EDEDED] truncate">
              Chat de Evidencia
            </h3>

            {/* Source Selector Button & Dropdown */}
            <div className="relative" ref={sourcesDropdownRef}>
              <button
                type="button"
                onClick={() => setIsSourcesDropdownOpen(!isSourcesDropdownOpen)}
                className={`px-2 py-0.5 text-[10px] font-mono border transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                  activeCount === 0
                    ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/25'
                    : isOnlyCurrentDoc
                    ? 'bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A56DB] dark:text-[#60A5FA] border-[#1A56DB]/40 dark:border-[#60A5FA]/40 font-bold'
                    : 'bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A1A1A] dark:text-[#EDEDED] border-[#E0E0DC] dark:border-[#2A2A2E] hover:bg-[#E0E0DC] dark:hover:bg-[#2A2A2E]'
                }`}
                title="Hacé clic para elegir con qué fuentes interactúa el modelo"
              >
                <Layers className="w-3 h-3 text-[#1A56DB] dark:text-[#60A5FA]" />
                <span className="truncate max-w-[120px] sm:max-w-[160px]">
                  {activeCount === 0
                    ? '0 fuentes (Sin grounding)'
                    : isOnlyCurrentDoc
                    ? 'Solo este documento'
                    : isAllActive
                    ? `Todo el corpus (${allSources.length})`
                    : `${activeCount} de ${allSources.length} activas`}
                </span>
                <ChevronDown className={`w-3 h-3 transition-transform ${isSourcesDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Source Selection Popover Dropdown */}
              {isSourcesDropdownOpen && (
                <div className="absolute left-0 mt-1.5 w-80 sm:w-96 bg-[#F9F9F8] dark:bg-[#19191C] border border-[#E0E0DC] dark:border-[#2A2A2E] shadow-2xl z-40 text-xs font-sans animate-in fade-in select-none">
                  {/* Dropdown Header */}
                  <div className="p-2.5 bg-[#F2F2F0] dark:bg-[#141416] border-b border-[#E0E0DC] dark:border-[#2A2A2E] flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-[#1A1A1A] dark:text-[#EDEDED] uppercase tracking-wider">
                      <Layers className="w-3.5 h-3.5 text-[#1A56DB] dark:text-[#60A5FA]" />
                      <span>Fuentes para Grounding RAG</span>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 bg-[#EBEBE8] dark:bg-[#222226] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[#666666] dark:text-[#888888] tabular-nums">
                      {activeCount} / {allSources.length} activas
                    </span>
                  </div>

                  {/* Preset Buttons Toolbar */}
                  <div className="p-2 bg-[#F9F9F8] dark:bg-[#19191C] border-b border-[#E0E0DC] dark:border-[#2A2A2E] flex items-center gap-1.5 flex-wrap font-mono text-[10px]">
                    <button
                      type="button"
                      onClick={() => onSetOnlyThisSourceActive && onSetOnlyThisSourceActive(document.id)}
                      className={`px-2 py-0.5 border transition cursor-pointer ${
                        isOnlyCurrentDoc
                          ? 'bg-[#1A56DB] text-white border-[#1A56DB]'
                          : 'bg-[#EBEBE8] dark:bg-[#222226] text-[#1A1A1A] dark:text-[#EDEDED] border-[#E0E0DC] dark:border-[#2A2A2E] hover:bg-[#E0E0DC]'
                      }`}
                      title="Activar únicamente el documento que estás leyendo en pantalla"
                    >
                      Solo este doc
                    </button>
                    <button
                      type="button"
                      onClick={() => onSetAllSourcesActive && onSetAllSourcesActive()}
                      className={`px-2 py-0.5 border transition cursor-pointer ${
                        isAllActive
                          ? 'bg-[#1A56DB] text-white border-[#1A56DB]'
                          : 'bg-[#EBEBE8] dark:bg-[#222226] text-[#1A1A1A] dark:text-[#EDEDED] border-[#E0E0DC] dark:border-[#2A2A2E] hover:bg-[#E0E0DC]'
                      }`}
                      title="Activar todos los documentos del proyecto"
                    >
                      Todo el corpus
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleAllSources && onToggleAllSources()}
                      className="px-2 py-0.5 border bg-[#EBEBE8] dark:bg-[#222226] text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] border-[#E0E0DC] dark:border-[#2A2A2E] transition cursor-pointer"
                      title="Invertir o limpiar selección activa"
                    >
                      {isAllActive ? 'Desactivar todas' : 'Invertir'}
                    </button>
                  </div>

                  {/* Filter Search Input */}
                  {allSources.length > 4 && (
                    <div className="p-2 border-b border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#141416]">
                      <div className="relative">
                        <Search className="w-3 h-3 text-[#666666] dark:text-[#888888] absolute left-2 top-2" />
                        <input
                          type="text"
                          placeholder="Filtrar fuentes..."
                          value={sourceSearchQuery}
                          onChange={(e) => setSourceSearchQuery(e.target.value)}
                          className="w-full bg-[#F9F9F8] dark:bg-[#19191C] border border-[#E0E0DC] dark:border-[#2A2A2E] pl-7 pr-2 py-1 text-[11px] font-mono text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED]"
                        />
                      </div>
                    </div>
                  )}

                  {/* Scrollable Sources List */}
                  <div className="max-h-56 overflow-y-auto divide-y divide-[#E0E0DC]/60 dark:divide-[#2A2A2E]/60 p-1">
                    {filteredDropdownSources.length === 0 ? (
                      <div className="p-4 text-center text-[#666666] dark:text-[#888888] text-[11px] font-mono">
                        No se encontraron fuentes con ese filtro.
                      </div>
                    ) : (
                      filteredDropdownSources.map((s) => {
                        const isSelected = currentActiveSourceIds.includes(s.id);
                        const isCurrent = s.id === document.id;
                        const sTitle = s.metadata?.title || s.filename;
                        const sAuthor = s.metadata?.author || (Array.isArray(s.metadata?.authors) ? s.metadata?.authors[0] : null);

                        return (
                          <div
                            key={s.id}
                            onClick={() => onToggleActiveSource && onToggleActiveSource(s.id)}
                            className={`p-2 flex items-start gap-2.5 cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-[#1A56DB]/5 dark:bg-[#1A56DB]/10'
                                : 'hover:bg-[#EBEBE8] dark:hover:bg-[#222226]'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}} // Handled by parent click
                              className="mt-0.5 accent-[#1A56DB] cursor-pointer"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                  className={`text-xs truncate font-medium ${
                                    isSelected
                                      ? 'text-[#1A1A1A] dark:text-[#EDEDED] font-semibold'
                                      : 'text-[#666666] dark:text-[#888888]'
                                  }`}
                                  title={sTitle}
                                >
                                  {sTitle}
                                </span>
                                {isCurrent && (
                                  <span className="px-1 py-0.2 text-[9px] font-mono uppercase bg-[#1A56DB] text-white">
                                    En Lectura
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 text-[10px] font-mono text-[#666666] dark:text-[#888888] truncate">
                                {sAuthor && <span>{sAuthor}</span>}
                                {s.metadata?.doi && <span>DOI: {s.metadata.doi}</span>}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Footer explanation */}
                  <div className="p-2 border-t border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#141416] text-[10px] text-[#666666] dark:text-[#888888] font-mono leading-tight">
                    El modelo solo recuperará citas y responderá en base a las fuentes marcadas arriba.
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Share Chat Button */}
            <button
              type="button"
              onClick={handleOpenShare}
              disabled={messages.length === 0 || isSharing}
              className="px-2 py-1 bg-[#EBEBE8] hover:bg-[#E0E0DC] dark:bg-[#1E1E22] dark:hover:bg-[#2A2A2E] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[10px] font-mono text-[#1A1A1A] dark:text-[#EDEDED] inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40"
              title="Compartir conversación de investigación"
            >
              <Share2 className="w-3 h-3 text-[#1A56DB] dark:text-[#60A5FA]" />
              <span className="hidden sm:inline">Compartir</span>
            </button>

            {/* Import Chat Button */}
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="px-2 py-1 bg-[#EBEBE8] hover:bg-[#E0E0DC] dark:bg-[#1E1E22] dark:hover:bg-[#2A2A2E] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[10px] font-mono text-[#1A1A1A] dark:text-[#EDEDED] inline-flex items-center gap-1 cursor-pointer transition-colors"
              title="Importar historial de chat"
            >
              <Upload className="w-3 h-3 text-purple-600 dark:text-purple-400" />
              <span className="hidden sm:inline">Importar</span>
            </button>

            {/* Clear Chat Button */}
            {messages.length > 0 && onClearChat && (
              <button
                type="button"
                onClick={onClearChat}
                className="px-2 py-1 bg-[#EBEBE8] hover:bg-rose-500/10 dark:bg-[#1E1E22] dark:hover:bg-rose-950/30 border border-[#E0E0DC] dark:border-[#2A2A2E] hover:border-rose-500/30 text-[10px] font-mono text-[#666666] hover:text-rose-600 dark:hover:text-rose-400 inline-flex items-center gap-1 cursor-pointer transition-colors"
                title="Borrar historial del chat"
              >
                <Trash2 className="w-3 h-3" />
                <span className="hidden sm:inline">Borrar</span>
              </button>
            )}
          </div>
        </header>

        {/* Grounding Status & Active Sources Strip */}
        <div className="px-3.5 py-1.5 border-b border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214] flex items-center justify-between text-[10px] font-mono text-[#666666] dark:text-[#888888] shrink-0 gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <ShieldCheck className={`w-3.5 h-3.5 shrink-0 ${activeCount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`} aria-hidden="true" />
            <span className="font-bold uppercase tracking-wider text-[9px] shrink-0">FUENTES EN RAG:</span>
            {activeCount === 0 ? (
              <span className="text-amber-700 dark:text-amber-400 font-semibold truncate flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                Ninguna fuente activa seleccionada
              </span>
            ) : isOnlyCurrentDoc ? (
              <span className="text-[#1A56DB] dark:text-[#60A5FA] font-medium truncate" title={documentTitle}>
                Solo este doc ({documentTitle})
              </span>
            ) : isAllActive ? (
              <span className="text-emerald-700 dark:text-emerald-400 font-medium truncate">
                Todo el corpus ({allSources.length} docs activos)
              </span>
            ) : (
              <span className="text-[#1A56DB] dark:text-[#60A5FA] font-medium truncate">
                {activeCount} de {allSources.length} docs activos
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsSourcesDropdownOpen(true)}
              className="text-[#1A56DB] dark:text-[#60A5FA] hover:underline cursor-pointer flex items-center gap-0.5"
              title="Abrir selector de fuentes"
            >
              <span>[Cambiar]</span>
            </button>
            <span className="tabular-nums">· {messages.length} msgs</span>
          </div>
        </div>

        {/* Chat Messages Stream */}
        <div className="flex-1 overflow-auto p-4 space-y-4 font-sans text-xs">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#E0E0DC] dark:border-[#2A2A2E]">
              <Bookmark className="w-5 h-5 text-[#999999] dark:text-[#555555] mb-2" aria-hidden="true" />
              <p className="font-mono text-xs font-semibold text-[#1A1A1A] dark:text-[#EDEDED]">
                [ESPACIO DE INVESTIGACIÓN ACTIVO]
              </p>
              <p className="text-xs text-[#666666] dark:text-[#888888] mt-1 max-w-xs">
                Hacé una consulta sobre el documento fuente. Las respuestas se fundamentan con citas numéricas auditables.
              </p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div
                key={msg.id}
                id={`archival-msg-${msg.id}`}
                className={`flex flex-col space-y-2 p-3.5 border transition-colors ${
                  msg.sender === 'user'
                    ? 'bg-[#EBEBE8] dark:bg-[#222226] border-[#E0E0DC] dark:border-[#2A2A2E] self-end max-w-[90%]'
                    : 'bg-[#F9F9F8] dark:bg-[#121214] border-[#E0E0DC] dark:border-[#2A2A2E]'
                }`}
              >
                {/* Sender Header */}
                <div className="flex items-center justify-between font-mono text-[10px] text-[#666666] dark:text-[#888888]">
                  <span className="font-bold uppercase tracking-wider">
                    {msg.sender === 'user' ? '[INVESTIGADOR]' : '[OPENFOLIO SÍNTESIS]'}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums">{msg.timestamp}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyMessage(msg.id, msg.text)}
                      className="p-0.5 hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] cursor-pointer"
                      title="Copiar texto"
                    >
                      {copiedMsgId === msg.id ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Message Body */}
                <div className="whitespace-pre-wrap leading-relaxed text-xs text-[#1A1A1A] dark:text-[#EDEDED]">
                  {renderMessageTextWithCitations(msg.text, msg.citations)}
                </div>

                {/* Interactive Citation Chips */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="pt-2 border-t border-[#E0E0DC] dark:border-[#2A2A2E] flex flex-wrap gap-1.5 items-center font-mono text-[10px]">
                    <span className="text-[#666666] dark:text-[#888888] uppercase font-bold">CITAS:</span>
                    {msg.citations.map((cit) => (
                      <button
                        key={cit.index}
                        type="button"
                        onClick={() =>
                          handleCitationClick(
                            cit.index,
                            cit.snippet,
                            cit.chunkId,
                            cit.sourceId,
                            cit.startChar,
                            cit.endChar
                          )
                        }
                        onMouseEnter={() => {
                          setActiveCitationIndex(cit.index);
                          if (cit.snippet) setActiveCitationSnippet(cit.snippet);
                        }}
                        onMouseLeave={() => {
                          setActiveCitationIndex(null);
                          setActiveCitationSnippet(null);
                        }}
                        className={`px-1.5 py-0.5 border font-mono transition-colors focus-visible:outline-none cursor-pointer ${
                          activeCitationIndex === cit.index
                            ? 'bg-[#1A56DB] text-white border-[#1A56DB]'
                            : 'bg-[#EBEBE8] dark:bg-[#222226] text-[#1A56DB] dark:text-[#60A5FA] border-[#E0E0DC] dark:border-[#2A2A2E] hover:bg-[#1A56DB] hover:text-white'
                        }`}
                        title={`Cita [${cit.index}] en ${cit.sourceFilename}`}
                      >
                        [{cit.index}] {cit.pageNumber ? `P${cit.pageNumber}` : 'Fuente'}
                      </button>
                    ))}
                  </div>
                )}

                {/* Actions & Verification Badge */}
                <div className="flex items-center justify-between pt-1 border-t border-[#E0E0DC]/60 dark:border-[#2A2A2E]/60 text-[10px] font-mono">
                  {msg.factualScore !== undefined ? (
                    <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                      <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                      <span>PRECISIÓN FUNDAMENTADA: {(msg.factualScore * 100).toFixed(0)}%</span>
                    </div>
                  ) : (
                    <span />
                  )}

                  {msg.sender === 'assistant' && onSaveToNotebook && (
                    <button
                      type="button"
                      disabled={savingMsgId === msg.id}
                      onClick={() => handleSaveMessageToNotebook(msg, idx)}
                      className="inline-flex items-center gap-1 text-[#1A56DB] dark:text-[#60A5FA] hover:underline cursor-pointer disabled:opacity-50"
                      title="Guardar esta síntesis en el Cuaderno de Notas"
                    >
                      <Bookmark className="w-3 h-3" />
                      <span>{savingMsgId === msg.id ? 'Guardando...' : 'Guardar en Cuaderno'}</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Assistant Generation In-Progress Indicator */}
          {(isSending || isLoading) && (
            <div className="p-3 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#19191C] flex items-center gap-2.5 font-mono text-xs text-[#1A56DB] dark:text-[#60A5FA] animate-pulse">
              <span className="w-2 h-2 rounded-full bg-[#1A56DB] dark:bg-[#60A5FA]" />
              <span>[GENERANDO SÍNTESIS CON CITAS AUDITABLES...]</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <footer className="p-3 border-t border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#19191C]">
          {/* Active Sources Zero Warning */}
          {activeCount === 0 && (
            <div className="mb-2 p-2 border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 flex items-center justify-between gap-2 text-[11px] font-mono text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-1.5 min-w-0">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="truncate">Sin fuentes seleccionadas para RAG. La respuesta no tendrá citas auditables.</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {document && onSetOnlyThisSourceActive && (
                  <button
                    type="button"
                    onClick={() => onSetOnlyThisSourceActive(document.id)}
                    className="px-1.5 py-0.5 border border-amber-300 dark:border-amber-700/80 bg-white dark:bg-amber-900/50 hover:bg-amber-100 dark:hover:bg-amber-900 text-amber-900 dark:text-amber-100 uppercase text-[10px] font-bold cursor-pointer transition-colors"
                    title="Activar solo el documento actual"
                  >
                    [Activar este doc]
                  </button>
                )}
                {onSetAllSourcesActive && (
                  <button
                    type="button"
                    onClick={onSetAllSourcesActive}
                    className="px-1.5 py-0.5 border border-amber-300 dark:border-amber-700/80 bg-white dark:bg-amber-900/50 hover:bg-amber-100 dark:hover:bg-amber-900 text-amber-900 dark:text-amber-100 uppercase text-[10px] font-bold cursor-pointer transition-colors"
                    title="Activar todos los documentos del corpus"
                  >
                    [Activar todo]
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="flex items-end gap-2 bg-[#F9F9F8] dark:bg-[#121214] border border-[#E0E0DC] dark:border-[#2A2A2E] p-2 focus-within:border-[#1A1A1A] dark:focus-within:border-[#EDEDED] transition-colors">
            <textarea
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={2}
              placeholder={
                activeCount === 0
                  ? 'Sin fuentes seleccionadas (consulta general sin grounding)… (Shift+Enter para salto)'
                  : isOnlyCurrentDoc
                  ? `Consultar sobre "${documentTitle}"… (Shift+Enter para salto)`
                  : isAllActive
                  ? `Consultar sobre todo el corpus (${allSources.length} documentos)… (Shift+Enter para salto)`
                  : `Consultar sobre las ${activeCount} fuentes seleccionadas… (Shift+Enter para salto)`
              }
              className="flex-1 bg-transparent border-none focus:outline-none resize-none font-sans text-xs text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555]"
              aria-label="Preguntar al asistente sobre el documento"
            />

            <button
              type="button"
              onClick={handleSend}
              disabled={!inputQuery.trim() || isSending}
              className="px-3 py-1.5 bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] text-xs font-mono font-medium tracking-wide uppercase transition-colors disabled:opacity-40 focus-visible:outline-none shrink-0 cursor-pointer"
              aria-label="Enviar consulta"
            >
              {isSending ? (
                <span className="animate-pulse">ENVIANDO…</span>
              ) : (
                <span className="flex items-center gap-1">
                  <span>ENVIAR</span>
                  <CornerDownLeft className="w-3 h-3" aria-hidden="true" />
                </span>
              )}
            </button>
          </div>
        </footer>
      </section>

      {/* Share Modal */}
      {isShareModalOpen && shareModalData && (
        <ShareChatModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          shareId={shareModalData.shareId}
          shareUrl={shareModalData.shareUrl}
          projectName={projectName || 'Investigación'}
          messages={rawMessages || []}
        />
      )}

      {/* Import Modal */}
      {isImportModalOpen && projectId && (
        <ImportChatModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          projectId={projectId}
          projectName={projectName || 'Investigación'}
          onMessagesImported={(newMsgs) => {
            if (onMessagesImported) onMessagesImported(newMsgs);
          }}
        />
      )}
    </div>
  );
};
