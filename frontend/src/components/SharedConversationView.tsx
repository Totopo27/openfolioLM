import React, { useEffect, useState, useRef } from 'react';
import {
  Copy,
  Check,
  Download,
  ArrowLeft,
  Loader2,
  BookOpen,
  Sparkles,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { getSharedChat } from '../services/api';
import { SharedConversationSnapshot, ChatMessage, Citation } from '../types';

interface SharedConversationViewProps {
  shareId: string;
  onBackToWorkspace: () => void;
}

export const SharedConversationView: React.FC<SharedConversationViewProps> = ({
  shareId,
  onBackToWorkspace,
}) => {
  const [snapshot, setSnapshot] = useState<SharedConversationSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [isCopied, setIsCopied] = useState(false);

  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  useEffect(() => {
    async function load() {
      try {
        setIsLoading(true);
        setError('');
        const data = await getSharedChat(shareId);
        setSnapshot(data);
      } catch (err: any) {
        setError(err.message || 'No se pudo cargar la conversación compartida.');
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [shareId]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setIsCopied(true);
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = setTimeout(() => setIsCopied(false), 3000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDownloadJson = () => {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openfolio-shared-${snapshot.share_id.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F9F9F8] dark:bg-[#121214] flex flex-col items-center justify-center text-[#666666] dark:text-[#888888] font-mono gap-3 select-none">
        <Loader2 className="w-6 h-6 animate-spin text-[#1A1A1A] dark:text-[#EDEDED]" />
        <p className="text-xs uppercase tracking-wider">Cargando conversación de investigación...</p>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="min-h-screen bg-[#F9F9F8] dark:bg-[#121214] flex flex-col items-center justify-center p-6 text-center text-[#666666] dark:text-[#888888] font-mono">
        <div className="p-3 bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 mb-3">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#1A1A1A] dark:text-[#EDEDED]">
          Conversación no encontrada
        </h2>
        <p className="text-xs text-[#666666] dark:text-[#888888] max-w-md mt-1 mb-6 font-sans">
          {error || 'El enlace de la conversación es inválido o fue eliminado.'}
        </p>
        <button
          type="button"
          onClick={onBackToWorkspace}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono font-medium tracking-wide uppercase bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] border border-[#1A1A1A] dark:border-[#EDEDED] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Volver a OpenFolioLM
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9F9F8] dark:bg-[#121214] text-[#1A1A1A] dark:text-[#EDEDED] font-sans antialiased flex flex-col">
      {/* Top Bar Header */}
      <header className="sticky top-0 z-30 bg-[#F9F9F8] dark:bg-[#121214] border-b border-[#E0E0DC] dark:border-[#2A2A2E] px-6 py-2.5 flex items-center justify-between gap-4 select-none">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToWorkspace}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-[#EBEBE8] dark:bg-[#1E1E22] hover:bg-[#E0E0DC] dark:hover:bg-[#2A2A2E] text-[#1A1A1A] dark:text-[#EDEDED] text-xs font-mono border border-[#E0E0DC] dark:border-[#2A2A2E] transition-colors cursor-pointer"
            title="Abrir espacio de trabajo de OpenFolioLM"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Espacio de Trabajo</span>
          </button>

          <span className="text-[#E0E0DC] dark:text-[#2A2A2E]">|</span>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold font-mono text-[#1A1A1A] dark:text-[#EDEDED] uppercase tracking-wider">
              OpenFolioLM
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 bg-[#EBEBE8] dark:bg-[#222226] text-[#1A56DB] dark:text-[#60A5FA] border border-[#1A56DB]/30">
              Chat Compartido
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#EBEBE8] dark:bg-[#1E1E22] hover:bg-[#E0E0DC] dark:hover:bg-[#2A2A2E] text-[#1A1A1A] dark:text-[#EDEDED] border border-[#E0E0DC] dark:border-[#2A2A2E] transition-colors cursor-pointer"
            title="Copiar enlace de esta conversación"
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{isCopied ? '¡Copiado!' : 'Copiar Enlace'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadJson}
            className="inline-flex items-center gap-1.5 px-3 py-1 font-medium tracking-wide uppercase bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] border border-[#1A1A1A] dark:border-[#EDEDED] transition-colors cursor-pointer"
            title="Descargar conversación en formato JSON para importar en OpenFolioLM"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Descargar JSON</span>
          </button>
        </div>
      </header>

      {/* Main Conversation Content Container */}
      <main className="flex-1 max-w-3xl w-full mx-auto p-6 md:p-8 space-y-6">
        {/* Document Meta Banner */}
        <div className="p-4 bg-[#F2F2F0] dark:bg-[#19191C] border border-[#E0E0DC] dark:border-[#2A2A2E] space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-mono text-[#1A56DB] dark:text-[#60A5FA]">
            <BookOpen className="w-3.5 h-3.5" />
            <span>Proyecto: {snapshot.project_name}</span>
          </div>
          <h1 className="text-lg md:text-xl font-bold font-sans text-[#1A1A1A] dark:text-[#EDEDED]">
            {snapshot.title}
          </h1>
          <p className="text-[11px] font-mono text-[#666666] dark:text-[#888888]">
            Publicado el {new Date(snapshot.created_at).toLocaleDateString()} · {snapshot.messages.length} mensajes
          </p>
        </div>

        {/* Message Stream */}
        <div className="space-y-4">
          {snapshot.messages.map((m: ChatMessage, idx: number) => {
            const isUser = m.sender === 'user';
            return (
              <div
                key={m.id || idx}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[90%] p-4 space-y-2.5 leading-relaxed text-xs border ${
                    isUser
                      ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] border-[#1A1A1A] dark:border-[#EDEDED]'
                      : 'bg-[#F2F2F0] dark:bg-[#19191C] border-[#E0E0DC] dark:border-[#2A2A2E] text-[#1A1A1A] dark:text-[#EDEDED]'
                  }`}
                >
                  <p className="whitespace-pre-wrap font-sans">{m.text}</p>

                  {/* Assistant Citations */}
                  {!isUser && m.citations && m.citations.length > 0 && (
                    <div className="border-t border-[#E0E0DC] dark:border-[#2A2A2E] pt-2.5 space-y-1.5 font-mono text-xs">
                      <div className="font-semibold text-[#1A56DB] dark:text-[#60A5FA] flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                        <Sparkles className="w-3 h-3" /> Fuentes Consultadas
                      </div>
                      <div className="space-y-1">
                        {m.citations.map((c: Citation) => (
                          <div
                            key={c.index}
                            className="p-2 bg-[#EBEBE8] dark:bg-[#222226] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[10px] space-y-0.5"
                          >
                            <div className="font-bold text-[#1A1A1A] dark:text-[#EDEDED] flex items-center justify-between">
                              <span>[{c.index}] {c.source_filename || 'Documento'}</span>
                              {c.page_number && (
                                <span className="px-1 py-0.2 bg-[#E0E0DC] dark:bg-[#2A2A2E] text-[#666666] dark:text-[#888888]">
                                  Pág. {c.page_number}
                                </span>
                              )}
                            </div>
                            <p className="italic text-[#666666] dark:text-[#888888] font-sans text-[11px]">"{c.quote_snippet}"</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Factuality indicator if present */}
                  {!isUser && m.factual_score !== undefined && m.factual_score !== null && (
                    <div className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5">
                      <ShieldCheck className="w-3 h-3" />
                      <span>Factualidad NLI: {Math.round(m.factual_score * 100)}%</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
};
