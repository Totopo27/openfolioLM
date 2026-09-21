import React, { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  FileText,
  Bookmark,
  Sparkles,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Layout,
  AlignLeft,
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
  Maximize2,
} from 'lucide-react';
import { SourceDocument, ChatMessage, HighlightTarget, Citation } from '../../types';
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
  sourceFilename: string;
  pageNumber?: number;
  snippet: string;
  sourceId?: string;
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
}

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

export const parseTimestampSeconds = (text?: string | null): number | null => {
  if (!text) return null;
  const match = text.match(/(?:\[|\b)(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\]|\b)/);
  if (!match) return null;
  if (match[3] !== undefined) {
    const hours = parseInt(match[1], 10);
    const mins = parseInt(match[2], 10);
    const secs = parseInt(match[3], 10);
    return hours * 3600 + mins * 60 + secs;
  } else {
    const mins = parseInt(match[1], 10);
    const secs = parseInt(match[2], 10);
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
  chunks?: DocumentSourceChunk[];
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
  onSelectDocument?: (doc: SourceDocument) => void;
  onCitationClick?: (citation: Citation) => void;
  targetMessageId?: string | null;
  onClearTargetMessage?: () => void;
}

export const ArchivalSplitViewer: React.FC<ArchivalSplitViewerProps> = ({
  document,
  documentTitle,
  documentAuthors,
  documentDoi,
  chunks: _chunks,
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
  onSelectDocument,
  onCitationClick,
  targetMessageId,
  onClearTargetMessage,
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
  const [viewStyle, setViewStyle] = useState<'raw' | 'rich'>('rich');
  const [fontSize, setFontSize] = useState<'xs' | 'sm' | 'base'>('sm');
  const [activeSeekTime, setActiveSeekTime] = useState<number | null>(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  const [isPaginated, setIsPaginated] = useState<boolean>(true);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);

  // Chat sharing & importing states
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareModalData, setShareModalData] = useState<{ shareId: string; shareUrl: string } | null>(null);
  const [savingMsgId, setSavingMsgId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const pages = useMemo(() => {
    if (!document?.raw_markdown) return [];
    return getDocPages(document.raw_markdown);
  }, [document?.raw_markdown]);

  const currentPage = pages.length > 0 ? pages[Math.min(currentPageIndex, pages.length - 1)] : null;
  const activeContent = isPaginated && currentPage ? currentPage.content : (document.raw_markdown || '');
  const contentStartChar = isPaginated && currentPage ? currentPage.startChar : 0;
  const contentEndChar = isPaginated && currentPage ? currentPage.endChar : (document.raw_markdown?.length || 0);

  const handleTabSelect = (tab: 'reading' | 'dossier' | 'taxonomy') => {
    setInternalActiveTab(tab);
    if (onTabChange) onTabChange(tab);
  };

  // Reset video seek time, page index, and image modal when switching documents
  useEffect(() => {
    setActiveSeekTime(null);
    setCurrentPageIndex(0);
    setActiveCitationIndex(null);
    setActiveCitationSnippet(null);
    setSelectedImageUrl(null);
  }, [document.id]);

  // Close image lightbox on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedImageUrl) {
        setSelectedImageUrl(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImageUrl]);

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

  // Handle targetMessageId scrolling & pulsing
  useEffect(() => {
    if (!targetMessageId) return;
    setHighlightedMsgId(targetMessageId);

    const timer = setTimeout(() => {
      const msgEl = window.document.getElementById(`chat-msg-${targetMessageId}`);
      if (msgEl) {
        msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);

    const clearTimer = setTimeout(() => {
      setHighlightedMsgId(null);
      onClearTargetMessage?.();
    }, 4000);

    return () => {
      clearTimeout(timer);
      clearTimeout(clearTimer);
    };
  }, [targetMessageId, onClearTargetMessage]);

  // Handle highlightTarget sync, seeking and scrolling
  useEffect(() => {
    if (!highlightTarget || highlightTarget.source_id !== document.id) return;

    if (activeTab !== 'reading') {
      handleTabSelect('reading');
    }

    if (highlightTarget.citation_index !== undefined) {
      setActiveCitationIndex(highlightTarget.citation_index);
    }
    if (highlightTarget.quote_snippet) {
      setActiveCitationSnippet(highlightTarget.quote_snippet);
    }

    // Auto-jump to page containing citation if paginated
    if (pages.length > 1) {
      let targetPageIdx = -1;
      if (highlightTarget.start_char !== undefined && highlightTarget.start_char > 0) {
        targetPageIdx = pages.findIndex(
          (p) => highlightTarget.start_char >= p.startChar && highlightTarget.start_char < p.endChar
        );
      }
      // Fallback search across pages if offset not in range
      if (targetPageIdx === -1 && highlightTarget.quote_snippet) {
        const needle = highlightTarget.quote_snippet.trim().toLowerCase().slice(0, 30);
        targetPageIdx = pages.findIndex((p) => p.content.toLowerCase().includes(needle));
      }
      if (targetPageIdx >= 0) {
        setCurrentPageIndex(targetPageIdx);
      }
    }

    // If video, extract timestamp
    if (document.metadata?.is_youtube) {
      const raw = document.raw_markdown || '';
      const start = Math.max(0, highlightTarget.start_char - 150);
      const end = Math.min(raw.length, highlightTarget.end_char + 150);
      const windowText = raw.slice(start, end) || highlightTarget.quote_snippet;
      const parsedSecs = parseTimestampSeconds(windowText) || parseTimestampSeconds(highlightTarget.quote_snippet);
      if (parsedSecs !== null) {
        setActiveSeekTime(parsedSecs);
      }
    }

    const timer = setTimeout(() => {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);

    return () => clearTimeout(timer);
  }, [highlightTarget, document.id, pages, activeTab]);

  // Unified slice-based evidence highlighting computation
  const { beforeText, highlightedText, afterText } = useMemo(() => {
    const raw = activeContent;
    if (!raw) return { beforeText: '', highlightedText: '', afterText: '' };

    const isCurrentDoc = !highlightTarget || highlightTarget.source_id === document.id;

    // 1. Check exact character offsets if highlightTarget matches this doc
    if (
      isCurrentDoc &&
      highlightTarget &&
      highlightTarget.end_char > highlightTarget.start_char &&
      highlightTarget.start_char < contentEndChar &&
      highlightTarget.end_char > contentStartChar
    ) {
      const relStart = Math.max(0, highlightTarget.start_char - contentStartChar);
      const relEnd = Math.min(raw.length, Math.max(relStart, highlightTarget.end_char - contentStartChar));
      if (relEnd > relStart) {
        return {
          beforeText: raw.slice(0, relStart),
          highlightedText: raw.slice(relStart, relEnd),
          afterText: raw.slice(relEnd),
        };
      }
    }

    // 2. Fallback to snippet matching (from highlightTarget or activeCitationSnippet)
    const snippetToFind = (
      (isCurrentDoc && highlightTarget?.quote_snippet) ||
      activeCitationSnippet ||
      ''
    ).trim();

    if (snippetToFind.length > 0) {
      let idx = raw.toLowerCase().indexOf(snippetToFind.toLowerCase());
      let matchLen = snippetToFind.length;

      if (idx === -1 && snippetToFind.length > 20) {
        const prefix = snippetToFind.toLowerCase().slice(0, 30);
        idx = raw.toLowerCase().indexOf(prefix);
        if (idx !== -1) {
          matchLen = Math.min(snippetToFind.length, raw.length - idx);
        }
      }

      if (idx !== -1) {
        return {
          beforeText: raw.slice(0, idx),
          highlightedText: raw.slice(idx, idx + matchLen),
          afterText: raw.slice(idx + matchLen),
        };
      }
    }

    return { beforeText: raw, highlightedText: '', afterText: '' };
  }, [
    activeContent,
    contentStartChar,
    contentEndChar,
    highlightTarget,
    document.id,
    activeCitationSnippet,
  ]);

  // Clickable timestamps in chunk text for YouTube sources
  const renderChunkTextWithClickableTimestamps = (text: string) => {
    if (!text) return null;
    if (!document.metadata?.is_youtube) return text;
    const regex = /((?:\[|\b)(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\]|\b))/g;
    const parts = text.split(regex);
    return parts.map((part, pIdx) => {
      const secs = parseTimestampSeconds(part);
      if (secs !== null && part.match(/(?:\d{1,2}:)?\d{1,2}:\d{2}/)) {
        return (
          <button
            key={pIdx}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setActiveSeekTime(secs);
            }}
            className="inline-flex items-center gap-0.5 px-1 py-0.2 mx-0.5 font-mono text-[10px] text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 cursor-pointer select-none"
            title={`Reproducir video desde ${part}`}
          >
            ▶ {part}
          </button>
        );
      }
      return <span key={pIdx}>{part}</span>;
    });
  };

  // Scroll to cited evidence on click with cross-doc routing and video seek
  const handleCitationClick = (
    citationIndex: number,
    snippet?: string,
    chunkId?: string,
    sourceId?: string,
    startChar?: number,
    endChar?: number
  ) => {
    // If citation is from another document, navigate to that document first
    if (sourceId && sourceId !== document.id) {
      const targetDoc = allSources.find((s) => s.id === sourceId);
      if (onCitationClick) {
        onCitationClick({
          index: citationIndex,
          source_id: sourceId,
          chunk_id: chunkId || '',
          quote_snippet: snippet || '',
          start_char: startChar ?? 0,
          end_char: endChar ?? 0,
          heading_path: [],
          source_filename: targetDoc?.filename || '',
        });
        return;
      }
      if (targetDoc && onSelectDocument) {
        onSelectDocument(targetDoc);
        return;
      }
    }

    // Switch to reading mode
    if (activeTab !== 'reading') {
      handleTabSelect('reading');
    }

    setActiveCitationIndex(citationIndex);
    setActiveCitationSnippet(snippet || null);

    // If paginated, switch to target page
    if (pages.length > 1) {
      let targetPageIdx = -1;
      if (startChar !== undefined && startChar > 0) {
        targetPageIdx = pages.findIndex(
          (p) => startChar >= p.startChar && startChar < p.endChar
        );
      }
      if (targetPageIdx === -1 && snippet) {
        const needle = snippet.trim().toLowerCase().slice(0, 30);
        targetPageIdx = pages.findIndex((p) => p.content.toLowerCase().includes(needle));
      }
      if (targetPageIdx >= 0) {
        setCurrentPageIndex(targetPageIdx);
      }
    }

    // If video source, seek to citation's timestamp
    if (document.metadata?.is_youtube) {
      const ts = parseTimestampSeconds(snippet);
      if (ts !== null) {
        setActiveSeekTime(ts);
      } else if (startChar !== undefined && startChar > 0) {
        const raw = document.raw_markdown || '';
        const windowText = raw.slice(Math.max(0, startChar - 150), Math.min(raw.length, (endChar || startChar) + 150));
        const parsedSecs = parseTimestampSeconds(windowText);
        if (parsedSecs !== null) setActiveSeekTime(parsedSecs);
      }
    }

    if (onCitationClick) {
      onCitationClick({
        index: citationIndex,
        source_id: sourceId || document.id,
        chunk_id: chunkId || '',
        quote_snippet: snippet || '',
        start_char: startChar ?? 0,
        end_char: endChar ?? 0,
        heading_path: [],
        source_filename: document.filename,
      });
    }

    setTimeout(() => {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
  };

  const markdownComponents = useMemo(
    () => ({
      table: ({ node, ...props }: any) => (
        <div className="overflow-x-auto my-4 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214]">
          <table className="min-w-full divide-y divide-[#E0E0DC] dark:divide-[#2A2A2E] text-xs font-sans" {...props} />
        </div>
      ),
      thead: ({ node, ...props }: any) => (
        <thead className="bg-[#F2F2F0] dark:bg-[#19191C] text-[#1A1A1A] dark:text-[#EDEDED] font-mono text-[10px] uppercase tracking-wider" {...props} />
      ),
      tbody: ({ node, ...props }: any) => (
        <tbody className="divide-y divide-[#E0E0DC]/60 dark:divide-[#2A2A2E]/60" {...props} />
      ),
      tr: ({ node, ...props }: any) => (
        <tr className="hover:bg-[#EBEBE8]/50 dark:hover:bg-[#1E1E22]/50 transition-colors" {...props} />
      ),
      th: ({ node, ...props }: any) => (
        <th className="px-3 py-2 text-left font-semibold text-[#1A1A1A] dark:text-[#EDEDED]" {...props} />
      ),
      td: ({ node, ...props }: any) => (
        <td className="px-3 py-2 text-[12px] whitespace-normal" {...props} />
      ),
      img: ({ node, src, alt, ...props }: any) => (
        <div className="my-5 flex flex-col items-center">
          <div
            className="border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#19191C] group relative cursor-pointer max-w-2xl"
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
              <span className="px-2 py-1 bg-[#1A1A1A] text-white text-[10px] font-mono flex items-center gap-1">
                <Maximize2 className="w-3 h-3 text-[#1A56DB] dark:text-[#60A5FA]" /> Ampliar figura
              </span>
            </div>
          </div>
          {alt && (
            <span className="text-[10px] text-[#666666] dark:text-[#888888] mt-1 text-center max-w-lg italic font-mono">
              {alt}
            </span>
          )}
        </div>
      ),
      blockquote: ({ node, ...props }: any) => (
        <blockquote className="border-l-2 border-[#1A56DB] bg-[#1A56DB]/5 dark:bg-[#1A56DB]/10 px-3 py-2 my-2 text-xs italic text-[#1A1A1A] dark:text-[#EDEDED]" {...props} />
      ),
      a: ({ node, href, children, ...props }: any) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-[#1A56DB] dark:text-[#60A5FA] underline underline-offset-2 hover:opacity-80"
          {...props}
        >
          {children}
        </a>
      ),
    }),
    []
  );

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
      const cIds = msg.citations?.map((c) => c.chunkId) || [];

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
            onClick={() => handleCitationClick(citIndex, cit?.snippet, cit?.chunkId, cit?.sourceId, cit?.startChar, cit?.endChar)}
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
                  onClick={() => setViewStyle('rich')}
                  className={`px-2 py-0.5 cursor-pointer transition-colors inline-flex items-center gap-1 ${
                    viewStyle === 'rich'
                      ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] font-bold'
                      : 'text-[#666666] dark:text-[#888888]'
                  }`}
                  title="Vista formateada en Markdown"
                >
                  <Layout className="w-3 h-3" />
                  <span>Formato</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewStyle('raw')}
                  className={`px-2 py-0.5 cursor-pointer transition-colors inline-flex items-center gap-1 ${
                    viewStyle === 'raw'
                      ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] font-bold'
                      : 'text-[#666666] dark:text-[#888888]'
                  }`}
                  title="Vista de texto plano"
                >
                  <AlignLeft className="w-3 h-3" />
                  <span>Texto</span>
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
                    onClearHighlight?.();
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
              {document.metadata?.is_code || document.metadata?.is_repo ? (
                <CodeViewer
                  document={document}
                  highlightTarget={
                    activeCitationSnippet
                      ? ({ quote_snippet: activeCitationSnippet } as HighlightTarget)
                      : null
                  }
                  onClearHighlight={() => {
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
                       {/* Pagination Toolbar when multi-page */}
                  {pages.length > 1 && (
                    <div className="flex items-center justify-between px-3 py-1.5 bg-[#F2F2F0] dark:bg-[#19191C] border-b border-[#E0E0DC] dark:border-[#2A2A2E] text-xs shrink-0 select-none font-mono">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setCurrentPageIndex((prev) => Math.max(0, prev - 1))}
                          disabled={currentPageIndex === 0}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#EBEBE8] hover:bg-[#E0E0DC] dark:bg-[#222226] dark:hover:bg-[#2A2A2E] border border-[#E0E0DC] dark:border-[#2A2A2E] disabled:opacity-35 disabled:cursor-not-allowed text-[#1A1A1A] dark:text-[#EDEDED] transition cursor-pointer text-[11px]"
                          title="Página anterior"
                        >
                          <ChevronLeft className="w-3 h-3" />
                          <span className="hidden sm:inline">Anterior</span>
                        </button>

                        <span className="font-medium text-[#1A1A1A] dark:text-[#EDEDED] text-[11px]">
                          {currentPage?.pageNumber
                            ? `Pág. ${currentPage.pageNumber}`
                            : `Sección ${currentPageIndex + 1}`}
                          <span className="text-[#666666] dark:text-[#888888]"> de {pages.length}</span>
                        </span>

                        <button
                          type="button"
                          onClick={() => setCurrentPageIndex((prev) => Math.min(pages.length - 1, prev + 1))}
                          disabled={currentPageIndex === pages.length - 1}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#EBEBE8] hover:bg-[#E0E0DC] dark:bg-[#222226] dark:hover:bg-[#2A2A2E] border border-[#E0E0DC] dark:border-[#2A2A2E] disabled:opacity-35 disabled:cursor-not-allowed text-[#1A1A1A] dark:text-[#EDEDED] transition cursor-pointer text-[11px]"
                          title="Página siguiente"
                        >
                          <span className="hidden sm:inline">Siguiente</span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-[#666666] dark:text-[#888888] hidden sm:inline">Ir a pág:</span>
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
                            className="w-12 px-1 py-0.5 text-center font-mono text-[11px] bg-[#F9F9F8] dark:bg-[#121214] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[#1A1A1A] dark:text-[#EDEDED] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED]"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => setIsPaginated(!isPaginated)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono border transition cursor-pointer ${
                            isPaginated
                              ? 'bg-[#1A56DB] text-white border-[#1A56DB]'
                              : 'bg-[#EBEBE8] dark:bg-[#222226] text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] border-[#E0E0DC] dark:border-[#2A2A2E]'
                          }`}
                          title={
                            isPaginated
                              ? 'Modo paginado activo. Clic para ver documento continuo'
                              : 'Modo continuo activo. Clic para ver paginado'
                          }
                        >
                          <BookOpen className="w-3 h-3" />
                          <span className="hidden md:inline">{isPaginated ? 'Paginado' : 'Continuo'}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Reading Content Pane */}
                  <div ref={leftPanelRef} className="flex-1 overflow-auto p-4 md:p-6 select-text">
                    {viewStyle === 'rich' ? (
                      /* Rich Markdown Mode with Grounded Citation Highlight */
                      <article className={`prose dark:prose-invert max-w-2xl mx-auto font-sans ${fontSizeClass}`}>
                        {highlightedText ? (
                          <div className="space-y-4">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                              {beforeText}
                            </ReactMarkdown>
                            <div
                              ref={highlightRef}
                              id="active-citation-highlight"
                              className="bg-amber-500/15 border-l-4 border-amber-500 px-4 py-3 my-3 text-[#1A1A1A] dark:text-[#EDEDED] ring-1 ring-amber-500/30 transition-all font-sans"
                            >
                              <div className="text-[10px] font-mono uppercase font-bold tracking-wider text-amber-700 dark:text-amber-400 mb-1.5 flex items-center gap-1">
                                <Bookmark className="w-3.5 h-3.5" />
                                <span>Evidencia Fundamentada {activeCitationIndex !== null ? `[${activeCitationIndex}]` : ''}</span>
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
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {activeContent || '*Documento sin contenido disponible.*'}
                          </ReactMarkdown>
                        )}
                      </article>
                    ) : (
                      /* Raw Text Mode with Grounded Citation Highlight */
                      <article className={`max-w-2xl mx-auto font-mono text-[#1A1A1A] dark:text-[#EDEDED] ${fontSizeClass}`}>
                        {highlightedText ? (
                          <div className="whitespace-pre-wrap">
                            <span>{renderChunkTextWithClickableTimestamps(beforeText)}</span>
                            <div
                              ref={highlightRef}
                              id="active-citation-highlight"
                              className="bg-amber-500/15 border-l-4 border-amber-500 px-3 py-2.5 my-2.5 text-[#1A1A1A] dark:text-[#EDEDED] ring-1 ring-amber-500/30 transition-all font-mono"
                            >
                              <div className="text-[10px] font-mono uppercase font-bold tracking-wider text-amber-700 dark:text-amber-400 mb-1.5 flex items-center gap-1">
                                <Bookmark className="w-3.5 h-3.5" />
                                <span>Evidencia Fundamentada {activeCitationIndex !== null ? `[${activeCitationIndex}]` : ''}</span>
                              </div>
                              {renderChunkTextWithClickableTimestamps(highlightedText)}
                            </div>
                            <span>{renderChunkTextWithClickableTimestamps(afterText)}</span>
                          </div>
                        ) : (
                          <div className="whitespace-pre-wrap">
                            {renderChunkTextWithClickableTimestamps(activeContent || 'Documento sin contenido disponible.')}
                          </div>
                        )}
                      </article>
                    )}
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
            messages.map((msg, idx) => {
              const isTargetMsg = highlightedMsgId === msg.id;
              return (
                <div
                  key={msg.id}
                  id={`chat-msg-${msg.id}`}
                  className={`flex flex-col space-y-2 p-3.5 border transition-all ${
                    isTargetMsg
                      ? 'ring-2 ring-[#1A56DB] bg-[#1A56DB]/5 dark:bg-[#1A56DB]/15 border-[#1A56DB] shadow-md'
                      : msg.sender === 'user'
                      ? 'bg-[#EBEBE8] dark:bg-[#222226] border-[#E0E0DC] dark:border-[#2A2A2E] self-end max-w-[90%]'
                      : 'bg-[#F9F9F8] dark:bg-[#121214] border-[#E0E0DC] dark:border-[#2A2A2E]'
                  }`}
                >
                  {/* Sender Header */}
                  <div className="flex items-center justify-between font-mono text-[10px] text-[#666666] dark:text-[#888888]">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold uppercase tracking-wider">
                        {msg.sender === 'user' ? '[INVESTIGADOR]' : '[OPENFOLIO SÍNTESIS]'}
                      </span>
                      {isTargetMsg && (
                        <span className="px-1 py-0.2 bg-[#1A56DB] text-white text-[9px] uppercase font-bold animate-pulse">
                          Nota Vinculada
                        </span>
                      )}
                    </div>
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
                          onClick={() => handleCitationClick(cit.index, cit.snippet, cit.chunkId, cit.sourceId, cit.startChar, cit.endChar)}
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
            );
          }))}

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
      {/* Lightbox modal for enlarged image preview */}
      {selectedImageUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in select-none"
          onClick={() => setSelectedImageUrl(null)}
        >
          <div
            className="relative max-w-5xl max-h-[90vh] bg-[#F9F9F8] dark:bg-[#19191C] border border-[#E0E0DC] dark:border-[#2A2A2E] shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#141416]">
              <div className="flex items-center gap-1.5 text-xs font-mono text-[#1A1A1A] dark:text-[#EDEDED]">
                <FileText className="w-3.5 h-3.5 text-[#1A56DB] dark:text-[#60A5FA]" />
                <span>Figura extraída / Esquema</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={selectedImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1 text-[#666666] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED]"
                  title="Abrir imagen original en nueva pestaña"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedImageUrl(null)}
                  className="p-1 text-[#666666] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] cursor-pointer"
                  title="Cerrar (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="p-4 overflow-auto flex items-center justify-center bg-black/10 min-h-[300px]">
              <img
                src={selectedImageUrl}
                alt="Figura ampliada"
                className="max-w-full max-h-[75vh] object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
