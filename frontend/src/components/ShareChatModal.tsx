import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  FileText,
  ExternalLink,
  Share2,
  MessageCircle,
} from 'lucide-react';
import { ChatMessage } from '../types';

interface ShareChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  shareId: string;
  shareUrl: string;
  projectName: string;
  messages: ChatMessage[];
}

export const ShareChatModal: React.FC<ShareChatModalProps> = ({
  isOpen,
  onClose,
  shareId,
  shareUrl,
  projectName,
  messages,
}) => {
  const [isCopiedUrl, setIsCopiedUrl] = useState(false);
  const [isCopiedMd, setIsCopiedMd] = useState(false);

  if (!isOpen) return null;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setIsCopiedUrl(true);
      setTimeout(() => setIsCopiedUrl(false), 3000);
    } catch (err) {
      console.error('Failed to copy share url:', err);
    }
  };

  const handleDownloadJson = () => {
    const bundle = {
      openfolio_version: '2.0',
      type: 'openfolio_chat_bundle',
      exported_at: new Date().toISOString(),
      project_name: projectName,
      share_id: shareId,
      message_count: messages.length,
      messages: messages,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openfolio-chat-${projectName.toLowerCase().replace(/\s+/g, '_')}-${shareId.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyMarkdown = async () => {
    let md = `# Conversación de Investigación: ${projectName}\n`;
    md += `*Fecha: ${new Date().toLocaleDateString()} • OpenFolioLM Grounded Chat*\n\n---\n\n`;

    messages.forEach((m, idx) => {
      if (m.sender === 'user') {
        md += `### 👤 Pregunta de Investigación (${idx + 1})\n\n${m.text}\n\n`;
      } else {
        md += `### 🤖 Respuesta Fundamentada con Evidencia\n\n${m.text}\n\n`;
        if (m.citations && m.citations.length > 0) {
          md += `#### 📚 Fuentes Citadas:\n`;
          m.citations.forEach((c) => {
            md += `- **[${c.index}] ${c.source_filename || 'Fuente'}**${c.page_number ? ` (Pág. ${c.page_number})` : ''}: "${c.quote_snippet}"\n`;
          });
          md += `\n`;
        }
        md += `---\n\n`;
      }
    });

    try {
      await navigator.clipboard.writeText(md);
      setIsCopiedMd(true);
      setTimeout(() => setIsCopiedMd(false), 3000);
    } catch (err) {
      console.error('Failed to copy markdown:', err);
    }
  };

  const encodedUrl = encodeURIComponent(shareUrl);
  const shareTitle = encodeURIComponent(`Conversación de investigación sobre ${projectName} en OpenFolioLM`);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5 text-white font-semibold text-base">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Share2 className="w-4 h-4" />
            </div>
            <span>Enlace público para compartir</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
            title="Cerrar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Share Link Box (Similar to Gemini) */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800 focus-within:border-indigo-500 transition-colors">
            <input
              type="text"
              readOnly
              value={shareUrl}
              className="flex-1 bg-transparent px-3 py-1.5 text-xs text-slate-200 outline-none select-all truncate font-mono"
            />
            <button
              type="button"
              onClick={handleCopyUrl}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer shrink-0 ${
                isCopiedUrl
                  ? 'bg-emerald-600 text-white'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm'
              }`}
            >
              {isCopiedUrl ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>¡Copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar enlace</span>
                </>
              )}
            </button>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed px-1">
            Los enlaces públicos permiten ver la conversación completa con sus evidencias y fragmentos citados. Cualquiera que tenga el enlace puede importarla a su propio OpenFolioLM.
          </p>
        </div>

        {/* Social / Quick Share Bar */}
        <div className="space-y-2 pt-1">
          <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider">
            Compartir en redes o mensajería
          </span>
          <div className="flex items-center gap-3">
            <a
              href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white text-xs border border-slate-700/60 transition"
              title="Compartir en LinkedIn"
            >
              <svg className="w-3.5 h-3.5 text-sky-400 fill-current" viewBox="0 0 24 24">
                <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" />
              </svg>
              <span>LinkedIn</span>
            </a>
            <a
              href={`https://twitter.com/intent/tweet?text=${shareTitle}&url=${encodedUrl}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white text-xs border border-slate-700/60 transition"
              title="Compartir en X (Twitter)"
            >
              <svg className="w-3.5 h-3.5 text-slate-200 fill-current" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span>X</span>
            </a>
            <a
              href={`https://api.whatsapp.com/send?text=${shareTitle}%20${encodedUrl}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white text-xs border border-slate-700/60 transition"
              title="Compartir por WhatsApp"
            >
              <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span>WhatsApp</span>
            </a>
          </div>
        </div>

        {/* Alternative Export Actions */}
        <div className="border-t border-slate-800/80 pt-4 space-y-2.5">
          <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider">
            Exportar datos para otros usuarios o documentos
          </span>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={handleDownloadJson}
              className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-750 text-left transition cursor-pointer group"
              title="Descargar archivo JSON completo para importar en otro OpenFolioLM"
            >
              <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 group-hover:scale-105 transition-transform shrink-0">
                <Download className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-200 truncate">Descargar Bundle (.json)</div>
                <div className="text-[10px] text-slate-400">Para importar en OpenFolioLM</div>
              </div>
            </button>

            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-750 text-left transition cursor-pointer group"
              title="Copiar texto formateado en Markdown con citas académicas"
            >
              <div className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400 border border-teal-500/20 group-hover:scale-105 transition-transform shrink-0">
                {isCopiedMd ? <Check className="w-4 h-4 text-emerald-400" /> : <FileText className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-200 truncate">
                  {isCopiedMd ? '¡Markdown Copiado!' : 'Copiar como Markdown'}
                </div>
                <div className="text-[10px] text-slate-400">Transcripción con citas [^1]</div>
              </div>
            </button>
          </div>

          <div className="pt-2 flex justify-between items-center text-xs">
            <a
              href={shareUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition underline cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Abrir vista previa pública</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
