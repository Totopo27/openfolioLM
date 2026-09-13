import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, AlertCircle, Bookmark, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import { ChatMessage, Citation } from '../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  isLoading: boolean;
  activeSourceCount: number;
  onSendMessage: (text: string) => void;
  onCitationClick: (citation: Citation) => void;
  onClearChat?: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  isLoading,
  activeSourceCount,
  onSendMessage,
  onCitationClick,
  onClearChat,
}) => {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim());
    setInput('');
  };

  // Helper to render message text with clickable citation badges
  const renderMessageWithCitations = (message: ChatMessage) => {
    if (message.sender === 'user') {
      return <p className="whitespace-pre-wrap">{message.text}</p>;
    }

    const citationMap = new Map<number, Citation>();
    if (message.citations) {
      message.citations.forEach((c) => citationMap.set(c.index, c));
    }

    // Split text by citation pattern [^N]
    const parts = message.text.split(/(\[\^\d+\])/g);

    return (
      <div className="space-y-3">
        <p className="whitespace-pre-wrap leading-relaxed">
          {parts.map((part, i) => {
            const match = part.match(/\[\^(\d+)\]/);
            if (match) {
              const index = parseInt(match[1], 10);
              const citation = citationMap.get(index);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => citation && onCitationClick(citation)}
                  className="inline-flex items-center justify-center px-1.5 py-0.5 mx-0.5 text-xs font-bold font-mono bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-300 hover:text-indigo-100 rounded border border-indigo-500/30 transition-all hover:scale-105"
                  title={citation ? `${citation.source_filename}: "${citation.quote_snippet}"` : 'Citation'}
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
                    <span className="font-semibold text-indigo-300 group-hover:text-indigo-200">
                      [{c.index}] {c.source_filename}
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

        {/* Evidence Status Pill */}
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
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Optional Chat Header Bar */}
      {messages.length > 0 && onClearChat && (
        <div className="flex items-center justify-between px-6 py-2 border-b border-slate-900 bg-slate-900/40 text-xs text-slate-400 shrink-0">
          <span className="font-mono text-[11px] text-slate-500">
            Historial del proyecto ({messages.length} mensajes)
          </span>
          <button
            type="button"
            onClick={onClearChat}
            className="flex items-center gap-1.5 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer text-[11px] px-2 py-0.5 rounded hover:bg-slate-800"
            title="Borrar historial de chat"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Borrar historial</span>
          </button>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500">
            <Sparkles className="w-12 h-12 text-indigo-500 mb-3 opacity-60" />
            <h4 className="text-sm font-medium text-slate-300">Grounded Research Assistant</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              Ask questions about your selected documents. All answers include verifiable citations and zero out-of-context hallucinations.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-5 py-4 text-sm shadow-md ${
                  m.sender === 'user'
                    ? 'bg-indigo-600 text-white rounded-br-none'
                    : 'bg-slate-900/90 border border-slate-800 text-slate-200 rounded-bl-none'
                }`}
              >
                {renderMessageWithCitations(m)}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 px-1">{m.timestamp}</span>
            </div>
          ))
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
    </div>
  );
};
