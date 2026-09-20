import React, { useState, useRef, useEffect } from 'react';
import { FileText, Bookmark, Sparkles, ExternalLink, ChevronLeft, ShieldCheck, CornerDownLeft } from 'lucide-react';

export interface ChunkCitation {
  index: number;
  chunkId: string;
  sourceFilename: string;
  pageNumber?: number;
  snippet: string;
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

interface ArchivalSplitViewerProps {
  documentTitle: string;
  documentAuthors: string[];
  documentDoi?: string;
  chunks: DocumentSourceChunk[];
  messages: GroundedChatMessage[];
  onSendMessage: (query: string) => Promise<void>;
  onBackToIndex?: () => void;
  isLoading?: boolean;
}

export const ArchivalSplitViewer: React.FC<ArchivalSplitViewerProps> = ({
  documentTitle,
  documentAuthors,
  documentDoi,
  chunks,
  messages,
  onSendMessage,
  onBackToIndex,
  isLoading = false,
}) => {
  const [splitRatio, setSplitRatio] = useState<number>(50); // 50% / 50%
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [activeCitationIndex, setActiveCitationIndex] = useState<number | null>(null);
  const [activeCitationSnippet, setActiveCitationSnippet] = useState<string | null>(null);
  const [inputQuery, setInputQuery] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const chunkRefs = useRef<Map<number, HTMLDivElement>>(new Map());

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

  // Scroll to cited chunk on click
  const handleCitationClick = (citationIndex: number, snippet?: string, chunkId?: string) => {
    setActiveCitationIndex(citationIndex);
    setActiveCitationSnippet(snippet || null);

    let targetEl: HTMLDivElement | undefined;
    if (snippet && snippet.trim().length > 0) {
      const matchIdx = chunks.findIndex((c) =>
        c.content.toLowerCase().includes(snippet.toLowerCase().slice(0, 30))
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
    if (!targetEl) {
      targetEl = chunkRefs.current.get(citationIndex);
    }
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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

  return (
    <div
      ref={containerRef}
      className={`w-full h-full flex flex-col md:flex-row bg-[#F9F9F8] dark:bg-[#121214] text-[#1A1A1A] dark:text-[#EDEDED] font-sans overflow-hidden ${
        isResizing ? 'select-none' : ''
      }`}
    >
      {/* LEFT PANEL: Document Source Reader */}
      <section
        style={{ width: `${splitRatio}%` }}
        className="flex flex-col h-full border-r border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214] min-w-[280px]"
        aria-label="Visor de Documento Fuente"
      >
        {/* Document Header */}
        <header className="p-3.5 border-b border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#19191C] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {onBackToIndex && (
              <button
                type="button"
                onClick={onBackToIndex}
                className="p-1 hover:bg-[#EBEBE8] dark:hover:bg-[#222226] text-[#666666] dark:text-[#888888] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1A1A] dark:focus-visible:ring-[#EDEDED]"
                aria-label="Volver al índice"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
            <FileText className="w-4 h-4 text-[#666666] dark:text-[#888888] shrink-0" aria-hidden="true" />
            <div className="flex flex-col min-w-0">
              <h2 className="text-xs font-semibold tracking-tight truncate text-[#1A1A1A] dark:text-[#EDEDED]">
                {documentTitle}
              </h2>
              <span className="text-[10px] text-[#666666] dark:text-[#888888] font-mono truncate">
                {documentAuthors.join(', ')}
              </span>
            </div>
          </div>

          {documentDoi && (
            <a
              href={`https://doi.org/${documentDoi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10px] text-[#1A56DB] dark:text-[#60A5FA] hover:underline flex items-center gap-1 shrink-0"
              aria-label={`Ver DOI ${documentDoi}`}
            >
              <span>DOI</span>
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          )}
        </header>

        {/* Reader Document Content with Hairline Gutter & Coordinates */}
        <div ref={leftPanelRef} className="flex-1 overflow-auto p-4 md:p-6 font-sans leading-relaxed text-xs">
          <article className="space-y-6 max-w-2xl mx-auto">
            {chunks.map((chunk, idx) => {
              const chunkNum = idx + 1;
              const isActive =
                activeCitationIndex === chunkNum ||
                (Boolean(activeCitationSnippet) &&
                  chunk.content.toLowerCase().includes(activeCitationSnippet!.toLowerCase().slice(0, 30)));

              return (
                <div
                  key={chunk.id}
                  ref={(el) => {
                    if (el) chunkRefs.current.set(chunkNum, el);
                    else chunkRefs.current.delete(chunkNum);
                  }}
                  className={`group relative pl-10 pr-3 py-3 border-l-2 transition-all ${
                    isActive
                      ? 'border-[#1A56DB] bg-[#FEF08A]/30 dark:bg-[#1A56DB]/15 text-[#1A1A1A] dark:text-[#EDEDED]'
                      : 'border-transparent hover:border-[#E0E0DC] dark:hover:border-[#2A2A2E]'
                  }`}
                >
                  {/* Margin Coordinate Anchor */}
                  <div className="absolute left-0 top-3 font-mono text-[10px] text-[#999999] dark:text-[#555555] select-none flex items-center gap-1">
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

                  {/* Chunk Text Content */}
                  <p className="whitespace-pre-wrap font-sans text-xs text-[#1A1A1A] dark:text-[#EDEDED] leading-normal">
                    {chunk.content}
                  </p>
                </div>
              );
            })}
          </article>
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
        className="w-1.5 hover:w-2 bg-[#E0E0DC] dark:bg-[#2A2A2E] hover:bg-[#1A56DB] dark:hover:bg-[#60A5FA] cursor-col-resize transition-all shrink-0 hidden md:block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1A1A] dark:focus-visible:ring-[#EDEDED]"
      />

      {/* RIGHT PANEL: Synthesis & Grounded Chat */}
      <section
        style={{ width: `${100 - splitRatio}%` }}
        className="flex flex-col h-full bg-[#F9F9F8] dark:bg-[#121214] min-w-[280px]"
        aria-label="Panel de Síntesis y Chat Científico"
      >
        {/* Right Header */}
        <header className="p-3.5 border-b border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#19191C] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-[#1A56DB] dark:text-[#60A5FA]" aria-hidden="true" />
            <h3 className="text-xs font-semibold tracking-tight font-sans text-[#1A1A1A] dark:text-[#EDEDED]">
              Grounded Synthesis & Research Chat
            </h3>
          </div>

          <div className="font-mono text-[10px] text-[#666666] dark:text-[#888888] flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>STRICT GROUNDING ON</span>
          </div>
        </header>

        {/* Chat Messages Stream */}
        <div className="flex-1 overflow-auto p-4 space-y-4 font-sans text-xs">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#E0E0DC] dark:border-[#2A2A2E]">
              <Bookmark className="w-5 h-5 text-[#999999] dark:text-[#555555] mb-2" aria-hidden="true" />
              <p className="font-mono text-xs font-semibold text-[#1A1A1A] dark:text-[#EDEDED]">
                [STUDIO WORKSPACE READY]
              </p>
              <p className="text-xs text-[#666666] dark:text-[#888888] mt-1 max-w-xs">
                Hacé una pregunta sobre el documento fuente. Todas las respuestas incluyen citas numéricas auditables.
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col space-y-2 p-3.5 border transition-colors ${
                  msg.sender === 'user'
                    ? 'bg-[#EBEBE8] dark:bg-[#222226] border-[#E0E0DC] dark:border-[#2A2A2E] self-end max-w-[90%]'
                    : 'bg-[#F9F9F8] dark:bg-[#121214] border-[#E0E0DC] dark:border-[#2A2A2E]'
                }`}
              >
                {/* Sender Header */}
                <div className="flex items-center justify-between font-mono text-[10px] text-[#666666] dark:text-[#888888]">
                  <span className="font-bold uppercase tracking-wider">
                    {msg.sender === 'user' ? '[RESEARCHER]' : '[OPENFOLIO SINTERIS]'}
                  </span>
                  <span className="tabular-nums">{msg.timestamp}</span>
                </div>

                {/* Message Body */}
                <p className="whitespace-pre-wrap leading-relaxed text-xs text-[#1A1A1A] dark:text-[#EDEDED]">
                  {msg.text}
                </p>

                {/* Interactive Citation Chips */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="pt-2 border-t border-[#E0E0DC] dark:border-[#2A2A2E] flex flex-wrap gap-1.5 items-center font-mono text-[10px]">
                    <span className="text-[#666666] dark:text-[#888888] uppercase font-bold">CITATIONS:</span>
                    {msg.citations.map((cit) => (
                      <button
                        key={cit.index}
                        type="button"
                        onClick={() => handleCitationClick(cit.index, cit.snippet, cit.chunkId)}
                        onMouseEnter={() => {
                          setActiveCitationIndex(cit.index);
                          if (cit.snippet) setActiveCitationSnippet(cit.snippet);
                        }}
                        onMouseLeave={() => {
                          setActiveCitationIndex(null);
                          setActiveCitationSnippet(null);
                        }}
                        className={`px-1.5 py-0.5 border font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A56DB] ${
                          activeCitationIndex === cit.index
                            ? 'bg-[#1A56DB] text-white border-[#1A56DB]'
                            : 'bg-[#EBEBE8] dark:bg-[#222226] text-[#1A56DB] dark:text-[#60A5FA] border-[#E0E0DC] dark:border-[#2A2A2E] hover:bg-[#1A56DB] hover:text-white'
                        }`}
                        title={`Cita [${cit.index}] en ${cit.sourceFilename}`}
                      >
                        [{cit.index}] {cit.pageNumber ? `P${cit.pageNumber}` : 'Src'}
                      </button>
                    ))}
                  </div>
                )}

                {/* Audit Score Badge */}
                {msg.factualScore !== undefined && (
                  <div className="flex items-center gap-1 font-mono text-[9px] text-emerald-700 dark:text-emerald-400">
                    <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                    <span>GROUNDED SCORE: {(msg.factualScore * 100).toFixed(0)}% VERIFIED</span>
                  </div>
                )}
              </div>
            ))
          )}

          {/* Assistant Generation In-Progress Indicator */}
          {(isSending || isLoading) && (
            <div className="p-3 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#19191C] flex items-center gap-2.5 font-mono text-xs text-[#1A56DB] dark:text-[#60A5FA] animate-pulse">
              <span className="w-2 h-2 rounded-full bg-[#1A56DB] dark:bg-[#60A5FA]" />
              <span>[GENERATING SYNTHESIS // STRICT CITATION EXTRACTION ACTIVE]</span>
            </div>
          )}
        </div>

        {/* Input Bar */}
        <footer className="p-3 border-t border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#19191C]">
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
              placeholder="Ask a question about the document… (Shift+Enter for newline)"
              className="flex-1 bg-transparent border-none focus:outline-none resize-none font-sans text-xs text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555]"
              aria-label="Preguntar al asistente sobre el documento"
            />

            <button
              type="button"
              onClick={handleSend}
              disabled={!inputQuery.trim() || isSending}
              className="px-3 py-1.5 bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] text-xs font-mono font-medium tracking-wide uppercase transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1A1A] dark:focus-visible:ring-[#EDEDED] shrink-0"
              aria-label="Enviar consulta"
            >
              {isSending ? (
                <span className="animate-pulse">SENDING…</span>
              ) : (
                <span className="flex items-center gap-1">
                  <span>SEND</span>
                  <CornerDownLeft className="w-3 h-3" aria-hidden="true" />
                </span>
              )}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
};
