import React, { useRef, useState } from 'react';
import { X, Upload, FileCode, Check, AlertCircle, Loader2 } from 'lucide-react';
import { importProjectChat } from '../services/api';
import { ChatMessage } from '../types';

interface ImportChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  onMessagesImported: (newMessages: ChatMessage[]) => void;
}

export const ImportChatModal: React.FC<ImportChatModalProps> = ({
  isOpen,
  onClose,
  projectId,
  projectName,
  onMessagesImported,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedBundle, setParsedBundle] = useState<any | null>(null);
  const [parseError, setParseError] = useState<string>('');
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFile = (file: File) => {
    setSelectedFile(file);
    setParseError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        const msgs = json.messages || (Array.isArray(json) ? json : null);
        if (!msgs || !Array.isArray(msgs) || msgs.length === 0) {
          throw new Error('El archivo no contiene un historial de mensajes válido.');
        }
        setParsedBundle({
          title: json.title || json.project_name || file.name,
          date: json.exported_at || json.created_at || new Date().toISOString(),
          messages: msgs,
        });
      } catch (err: any) {
        setParseError(err.message || 'Error al leer el archivo JSON.');
        setParsedBundle(null);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!parsedBundle || !projectId) return;

    try {
      setIsImporting(true);
      await importProjectChat(projectId, parsedBundle.messages);
      onMessagesImported(parsedBundle.messages);
      onClose();
    } catch (err: any) {
      setParseError(err.message || 'Error al importar los mensajes al proyecto.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5 text-white font-semibold text-base">
            <div className="p-1.5 rounded-lg bg-teal-500/10 text-teal-400 border border-teal-500/20">
              <Upload className="w-4 h-4" />
            </div>
            <span>Importar Conversación al Proyecto</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Seleccioná un archivo <span className="font-mono text-teal-300">.json</span> exportado desde OpenFolioLM para cargar sus mensajes, respuestas fundamentadas y citas directamente en <span className="font-semibold text-slate-200">{projectName}</span>.
        </p>

        <input
          type="file"
          accept=".json"
          ref={fileInputRef}
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              handleFile(e.target.files[0]);
            }
          }}
        />

        {/* Drop / Select zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="p-6 border-2 border-dashed border-slate-750 hover:border-teal-500/60 rounded-xl bg-slate-950/60 hover:bg-slate-950/80 text-center transition cursor-pointer flex flex-col items-center justify-center gap-2 group"
        >
          <div className="p-2.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20 group-hover:scale-110 transition-transform">
            <FileCode className="w-5 h-5" />
          </div>
          <p className="text-xs font-semibold text-slate-300">
            {selectedFile ? selectedFile.name : 'Hacé clic para seleccionar archivo .json'}
          </p>
          <p className="text-[10px] text-slate-500">
            Exportación de OpenFolioLM con historial de chat
          </p>
        </div>

        {parseError && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{parseError}</span>
          </div>
        )}

        {parsedBundle && !parseError && (
          <div className="p-3 rounded-xl bg-teal-500/10 border border-teal-500/20 text-xs space-y-1">
            <div className="font-semibold text-teal-300 flex items-center gap-1.5">
              <Check className="w-4 h-4" /> Conversación detectada
            </div>
            <p className="text-slate-300">
              <span className="text-slate-400">Título:</span> {parsedBundle.title}
            </p>
            <p className="text-slate-300">
              <span className="text-slate-400">Total mensajes:</span> {parsedBundle.messages.length}
            </p>
          </div>
        )}

        <div className="flex justify-end items-center gap-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!parsedBundle || isImporting}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer"
          >
            {isImporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Importando...</span>
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5" />
                <span>Importar ({parsedBundle ? parsedBundle.messages.length : 0} msgs)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
