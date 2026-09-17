import React, { useEffect, useState } from 'react';
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
      setTimeout(() => setIsCopied(false), 3000);
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
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
        <p className="text-sm font-medium">Cargando conversación de investigación...</p>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center text-slate-400">
        <div className="p-4 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 mb-3">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-semibold text-slate-200">Conversación no encontrada</h2>
        <p className="text-sm text-slate-400 max-w-md mt-1 mb-6">
          {error || 'El enlace de la conversación es inválido o fue eliminado.'}
        </p>
        <button
          type="button"
          onClick={onBackToWorkspace}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-md transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Volver a OpenFolioLM
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Bar Header */}
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur border-b border-slate-800 px-6 py-3.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToWorkspace}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs border border-slate-700 transition cursor-pointer"
            title="Abrir espacio de trabajo de OpenFolioLM"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Espacio de Trabajo</span>
          </button>

          <div className="h-4 w-px bg-slate-700" />

          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white tracking-tight">OpenFolioLM</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 font-medium">
                Grounded Chat Snapshot
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
            title="Copiar enlace de esta conversación"
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{isCopied ? '¡Enlace Copiado!' : 'Copiar Enlace'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadJson}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition cursor-pointer"
            title="Descargar conversación en formato JSON para importar en OpenFolioLM"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Descargar (.json)</span>
          </button>
        </div>
      </header>

      {/* Main Conversation Content Container */}
      <main className="flex-1 max-w-3xl w-full mx-auto p-6 md:p-10 space-y-8">
        {/* Document Meta Banner */}
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-xs text-indigo-400 font-medium">
            <BookOpen className="w-4 h-4" />
            <span>Proyecto: {snapshot.project_name}</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-100">{snapshot.title}</h1>
          <p className="text-xs text-slate-400">
            Publicado el {new Date(snapshot.created_at).toLocaleDateString()} &bull; {snapshot.messages.length} mensajes en total
          </p>
        </div>

        {/* Message Stream */}
        <div className="space-y-6">
          {snapshot.messages.map((m: ChatMessage, idx: number) => {
            const isUser = m.sender === 'user';
            return (
              <div
                key={m.id || idx}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[90%] rounded-2xl p-5 space-y-3 leading-relaxed text-sm ${
                    isUser
                      ? 'bg-indigo-600 text-white shadow-lg'
                      : 'bg-slate-900 border border-slate-800/90 text-slate-200'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.text}</p>

                  {/* Assistant Citations */}
                  {!isUser && m.citations && m.citations.length > 0 && (
                    <div className="border-t border-slate-800/80 pt-3 space-y-2 text-xs">
                      <div className="font-semibold text-indigo-300 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" /> Fuentes de Evidencia Consultadas
                      </div>
                      <div className="space-y-1.5">
                        {m.citations.map((c: Citation) => (
                          <div
                            key={c.index}
                            className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 space-y-1"
                          >
                            <div className="font-semibold text-indigo-400 flex items-center justify-between">
                              <span>[{c.index}] {c.source_filename || 'Documento'}</span>
                              {c.page_number && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300">
                                  Pág. {c.page_number}
                                </span>
                              )}
                            </div>
                            <p className="italic text-slate-400">"{c.quote_snippet}"</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Factuality indicator if present */}
                  {!isUser && m.factual_score !== undefined && m.factual_score !== null && (
                    <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                      <ShieldCheck className="w-3 h-3" />
                      <span>Factualidad comprobada por NLI: {Math.round(m.factual_score * 100)}%</span>
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
