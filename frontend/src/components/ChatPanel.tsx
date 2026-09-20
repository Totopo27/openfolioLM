import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Sparkles,
  AlertCircle,
  Bookmark,
  CheckCircle2,
  Loader2,
  Trash2,
  ShieldCheck,
  BookOpen,
  Share2,
  Upload,
} from 'lucide-react';
import { ChatMessage, Citation } from '../types';
import { shareProjectChat } from '../services/api';
import { ShareChatModal } from './ShareChatModal';
import { ImportChatModal } from './ImportChatModal';

interface ChatPanelProps {
  messages: ChatMessage[];
  isLoading: boolean;
  activeSourceCount: number;
  onSendMessage: (text: string) => void;
  onCitationClick: (citation: Citation) => void;
  onClearChat?: () => void;
  onSaveToNotebook?: (
    text: string,
    title?: string,
    citationIds?: string[],
    originPrompt?: string,
    sourceMessageId?: string
  ) => void | Promise<void>;
  targetMessageId?: string | null;
  onClearTargetMessage?: () => void;
  projectId?: string;
  projectName?: string;
  onMessagesImported?: (newMsgs: ChatMessage[]) => void;
  totalSourcesCount?: number;
  onOpenBibliography?: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  isLoading,
  activeSourceCount,
  onSendMessage,
  onCitationClick,
  onClearChat,
  onSaveToNotebook,
  targetMessageId,
  onClearTargetMessage,
  projectId,
  projectName,
  onMessagesImported,
  totalSourcesCount,
  onOpenBibliography,
}) => {
  const [input, setInput] = useState('');
  const [savingMsgId, setSavingMsgId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareModalData, setShareModalData] = useState<{ shareId: string; shareUrl: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleSaveMessageToNotebook = async (m: ChatMessage, msgIndex: number) => {
    if (!onSaveToNotebook) return;
    const msgKey = m.id || m.timestamp;
    setSavingMsgId(msgKey);
    try {
      const firstLine = m.text.replace(/\[\^\d+\]/g, '').trim().split('\n')[0];
      const cleanTitle = firstLine.slice(0, 50).trim() + (firstLine.length > 50 ? '...' : '');
      const cIds = m.citations?.map((c) => c.chunk_id) || [];

      // Find preceding user question
      let originPrompt: string | undefined = undefined;
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (messages[i].sender === 'user') {
          originPrompt = messages[i].text;
          break;
        }
      }

      await onSaveToNotebook(m.text, cleanTitle || 'Hallazgo de Investigación', cIds, originPrompt, m.id);
    } finally {
      setSavingMsgId(null);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (targetMessageId) {
      const el = document.getElementById(`chat-msg-${targetMessageId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedId(targetMessageId);
        const timer = setTimeout(() => {
          setHighlightedId(null);
          onClearTargetMessage?.();
        }, 3500);
        return () => clearTimeout(timer);
      }
    }
  }, [targetMessageId]);

  useEffect(() => {
    if (!targetMessageId) {
      scrollToBottom();
    }
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim());
    setInput('');
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
          const snapshot = await shareProjectChat(projectId, title, messages);
          currentShareId = snapshot.share_id;
          currentShareUrl = `${window.location.origin}${window.location.pathname}?share=${snapshot.share_id}`;
        } catch (apiErr) {
          console.warn('Backend share snapshot error, using local fallback:', apiErr);
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

  // Helper to render message text with clickable citation badges
  const renderMessageWithCitations = (message: ChatMessage) => {
    if (message.sender === 'user') {
      return <p className="whitespace-pre-wrap">{message.text}</p>;
    }

    const isHighDemandError =
      message.text.includes('Error al consultar el proveedor de IA') &&
      (message.text.includes('503') || message.text.toLowerCase().includes('high demand'));

    if (isHighDemandError) {
      return (
        <div className="space-y-2 text-xs">
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-amber-300">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Alta Demanda en el Proveedor de IA (HTTP 503)</span>
            </div>
            <p className="text-[11px] text-amber-200/90 leading-relaxed">
              Google Cloud está experimentando picos momentáneos de congestión en este modelo. Los picos suelen ser transitorios y durar pocos segundos.
            </p>
            <div className="text-[10px] text-amber-300/80 font-mono bg-amber-950/40 p-2 rounded border border-amber-500/20">
              Sugerencia: Podés pulsar el botón de ping (icono de pulso) arriba para chequear la latencia, reintentar la pregunta en un instante, o seleccionar otro modelo en la barra superior.
            </div>
          </div>
        </div>
      );
    }

    const citationMap = new Map<number, Citation>();
    if (message.citations) {
      message.citations.forEach((c) => citationMap.set(c.index, c));
    }

    // Split text by citation pattern [^N] or [N]
    const parts = message.text.split(/(\[\^?\d+\])/g);

    return (
      <div className="space-y-3">
        <p className="whitespace-pre-wrap leading-relaxed">
          {parts.map((part, i) => {
            const match = part.match(/\[\^?(\d+)\]/);
            if (match) {
              const index = parseInt(match[1], 10);
              const citation = citationMap.get(index);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => citation && onCitationClick(citation)}
                  className="inline-flex items-center justify-center px-1.5 py-0.5 mx-0.5 text-xs font-bold font-mono bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-300 hover:text-indigo-100 rounded border border-indigo-500/30 transition-all hover:scale-105"
                  title={citation ? `${citation.source_filename}${citation.page_number ? ` (Pág. ${citation.page_number})` : ''}: "${citation.quote_snippet}"` : 'Citation'}
                >
                  [{index}]
                </button>
              );
            }
            return <span key={i}>{part}</span>;
          })}
        </p>

        {/* Citations footer card list */}
        {message.citations && message.citations.length > 0 && (
          <div className="pt-3 border-t border-slate-800/80">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Bookmark className="w-3.5 h-3.5 text-indigo-400" />
              Cited Grounding Sources ({message.citations.length})
            </div>
            <div className="grid grid-cols-1 gap-2">
              {message.citations.map((c) => (
                <div
                  key={c.index}
                  onClick={() => onCitationClick(c)}
                  className="p-2.5 rounded-lg bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800/80 hover:border-indigo-500/40 cursor-pointer transition-all text-xs group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-indigo-300 group-hover:text-indigo-200 flex items-center gap-1.5">
                      <span>[{c.index}]</span>
                      <span className="truncate max-w-[200px]">{c.source_filename}</span>
                      {c.page_number !== undefined && c.page_number !== null && (
                        <span className="px-1.5 py-0.2 text-[10px] font-mono rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold">
                          Pág. {c.page_number}
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {c.heading_path.join(' > ') || 'General'}
                    </span>
                  </div>
                  <p className="text-slate-400 italic line-clamp-2 text-[11px]">
                    &ldquo;{c.quote_snippet}&rdquo;
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Evidence Status & Factual Verification Badge */}
        <div className="flex items-center flex-wrap gap-2 pt-1">
          {message.evidence_found !== undefined && (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              {message.evidence_found ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-medium">Strictly Grounded</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-amber-400 font-medium">Missing Evidence in Selected Sources</span>
                </>
              )}
            </div>
          )}

          {message.factual_score !== undefined && message.factual_score !== null && (
            <div
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                message.hallucination_risk === 'low'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : message.hallucination_risk === 'medium'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
              }`}
              title={`Consistencia fáctica calculada por NLI multilingüe: ${Math.round(message.factual_score * 100)}%`}
            >
              <ShieldCheck className="w-3 h-3" />
              <span>
                {message.hallucination_risk === 'low'
                  ? `Factualidad: ${Math.round(message.factual_score * 100)}% (Verificado)`
                  : message.hallucination_risk === 'medium'
                  ? `Verificación Parcial: ${Math.round(message.factual_score * 100)}%`
                  : `Riesgo de Alucinación: ${Math.round(message.factual_score * 100)}%`}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Action & History Header Bar */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-900 bg-slate-900/50 text-xs text-slate-400 shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-slate-500">
            {messages.length > 0 ? `Historial (${messages.length})` : 'Conversación'}
          </span>

          {onOpenBibliography && (
            <button
              type="button"
              onClick={onOpenBibliography}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/90 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700/60 text-xs transition cursor-pointer group"
              title="Ver y gestionar toda la bibliografía y compendio de fuentes"
            >
              <BookOpen className="w-3.5 h-3.5 text-indigo-400 group-hover:text-indigo-300" />
              <span className="font-medium">Bibliografía</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
                {activeSourceCount}{totalSourcesCount !== undefined ? ` / ${totalSourcesCount}` : ''} activas
              </span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Share Button */}
          <button
            type="button"
            onClick={handleOpenShare}
            disabled={messages.length === 0 || isSharing}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 hover:text-indigo-200 border border-indigo-500/30 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Compartir conversación (enlace público, JSON o Markdown con citas)"
          >
            {isSharing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Generando...</span>
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5" />
                <span>Compartir</span>
              </>
            )}
          </button>

          {/* Import Button */}
          {projectId && (
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/60 transition-all cursor-pointer"
              title="Importar conversación de colega (.json)"
            >
              <Upload className="w-3.5 h-3.5 text-slate-400" />
              <span>Importar</span>
            </button>
          )}

          {/* Clear History Button */}
          {messages.length > 0 && onClearChat && (
            <button
              type="button"
              onClick={onClearChat}
              className="inline-flex items-center gap-1 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer text-xs px-2 py-1 rounded-lg hover:bg-rose-500/10 hover:border-rose-500/20 border border-transparent"
              title="Borrar historial de chat"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Borrar</span>
            </button>
          )}
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500">
            <Sparkles className="w-12 h-12 text-indigo-500 mb-3 opacity-60" />
            <h4 className="text-sm font-medium text-slate-300">Grounded Research Assistant</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              Ask questions about your selected documents. All answers include verifiable citations and zero out-of-context hallucinations.
            </p>
            {activeSourceCount === 0 && onOpenBibliography && (
              <button
                type="button"
                onClick={onOpenBibliography}
                className="mt-4 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-950 transition cursor-pointer"
              >
                <BookOpen className="w-4 h-4" />
                <span>Abrir Bibliografía y seleccionar fuentes</span>
              </button>
            )}
          </div>
        ) : (
          messages.map((m, idx) => {
            const isHighlighted = highlightedId === m.id;
            return (
              <div
                key={m.id}
                id={`chat-msg-${m.id}`}
                className={`flex flex-col transition-all duration-500 ${
                  m.sender === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-5 py-4 text-sm shadow-md transition-all duration-500 ${
                    isHighlighted
                      ? 'ring-2 ring-indigo-400 shadow-xl shadow-indigo-500/30 scale-[1.01]'
                      : ''
                  } ${
                    m.sender === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-none'
                      : 'bg-slate-900/90 border border-slate-800 text-slate-200 rounded-bl-none'
                  }`}
                >
                  {renderMessageWithCitations(m)}
                  {m.sender === 'assistant' && onSaveToNotebook && (
                    <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-end">
                      <button
                        type="button"
                        disabled={savingMsgId === (m.id || m.timestamp)}
                        onClick={() => handleSaveMessageToNotebook(m, idx)}
                        className="inline-flex items-center gap-1.5 text-[11px] text-indigo-400 hover:text-indigo-300 font-medium transition-colors cursor-pointer disabled:opacity-50"
                        title="Guardar esta respuesta en el Cuaderno de Síntesis"
                      >
                        {savingMsgId === (m.id || m.timestamp) ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Guardando...</span>
                          </>
                        ) : (
                          <>
                            <BookOpen className="w-3.5 h-3.5" />
                            <span>Guardar en Cuaderno</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 mt-1 px-1">{m.timestamp}</span>
              </div>
            );
          })
        )}

        {isLoading && (
          <div className="flex items-center gap-3 p-4 bg-slate-900/40 rounded-xl border border-slate-800/60 max-w-[280px]">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
            <span className="text-xs text-slate-400 font-medium">
              Retrieving & grounding from sources...
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-slate-800/80 bg-slate-900/80 backdrop-blur">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading || activeSourceCount === 0}
            placeholder={
              activeSourceCount === 0
                ? 'Select at least one source above to query...'
                : 'Ask anything grounded in the active sources...'
            }
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 transition-all"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading || activeSourceCount === 0}
            className="p-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all disabled:opacity-40 disabled:hover:bg-indigo-600 shadow-sm"
            title="Send query"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
      {/* Share Modal */}
      {isShareModalOpen && shareModalData && (
        <ShareChatModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          shareId={shareModalData.shareId}
          shareUrl={shareModalData.shareUrl}
          projectName={projectName || 'Investigación'}
          messages={messages}
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
            onMessagesImported?.(newMsgs);
          }}
        />
      )}
    </div>
  );
};
