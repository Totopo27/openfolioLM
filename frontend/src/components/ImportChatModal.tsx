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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-100">
      <div className="bg-[#F9F9F8] dark:bg-[#121214] border border-[#E0E0DC] dark:border-[#2A2A2E] shadow-2xl w-full max-w-md p-5 space-y-4 font-sans">
        <div className="flex items-center justify-between border-b border-[#E0E0DC] dark:border-[#2A2A2E] pb-3">
          <div className="flex items-center gap-2 text-[#1A1A1A] dark:text-[#EDEDED] font-semibold text-xs font-mono uppercase tracking-wider">
            <Upload className="w-4 h-4 text-[#1A56DB] dark:text-[#60A5FA]" />
            <span>Importar Conversación al Proyecto</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#666666] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[#666666] dark:text-[#888888] leading-relaxed font-sans">
          Seleccioná un archivo <span className="font-mono text-[#1A56DB] dark:text-[#60A5FA]">.json</span> exportado desde OpenFolioLM para cargar sus mensajes, respuestas fundamentadas y citas directamente en <span className="font-semibold text-[#1A1A1A] dark:text-[#EDEDED]">{projectName}</span>.
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
          className="p-6 border border-dashed border-[#E0E0DC] dark:border-[#2A2A2E] hover:border-[#1A1A1A] dark:hover:border-[#EDEDED] bg-[#EBEBE8] dark:bg-[#1E1E22] text-center transition-colors cursor-pointer flex flex-col items-center justify-center gap-2 group"
        >
          <div className="p-2 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214] text-[#1A56DB] dark:text-[#60A5FA]">
            <FileCode className="w-5 h-5" />
          </div>
          <p className="text-xs font-semibold text-[#1A1A1A] dark:text-[#EDEDED] font-mono">
            {selectedFile ? selectedFile.name : 'Hacé clic para seleccionar archivo .json'}
          </p>
          <p className="text-[10px] text-[#666666] dark:text-[#888888] font-sans">
            Exportación de OpenFolioLM con historial de chat
          </p>
        </div>

        {parseError && (
          <div className="p-2.5 border border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-400 text-xs font-mono flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{parseError}</span>
          </div>
        )}

        {parsedBundle && !parseError && (
          <div className="p-3 border border-emerald-500/30 bg-emerald-500/10 text-xs font-mono space-y-1 text-[#1A1A1A] dark:text-[#EDEDED]">
            <div className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
              <Check className="w-3.5 h-3.5" /> Conversación detectada
            </div>
            <p className="text-[#1A1A1A] dark:text-[#EDEDED]">
              <span className="text-[#666666] dark:text-[#888888]">Título:</span> {parsedBundle.title}
            </p>
            <p className="text-[#1A1A1A] dark:text-[#EDEDED]">
              <span className="text-[#666666] dark:text-[#888888]">Total mensajes:</span> {parsedBundle.messages.length}
            </p>
          </div>
        )}

        <div className="flex justify-end items-center gap-2 pt-2 border-t border-[#E0E0DC] dark:border-[#2A2A2E]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 border border-[#E0E0DC] dark:border-[#2A2A2E] text-xs font-mono text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!parsedBundle || isImporting}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono font-medium tracking-wide uppercase bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] transition-colors disabled:opacity-40 cursor-pointer"
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
