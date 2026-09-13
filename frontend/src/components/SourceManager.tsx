import React, { useRef, useState } from 'react';
import {
  Upload,
  Trash2,
  CheckSquare,
  Square,
  Eye,
  Loader2,
  Globe,
  Link2,
  X,
  Package,
  Code2,
} from 'lucide-react';
import { SourceDocument } from '../types';

interface SourceManagerProps {
  sources: SourceDocument[];
  activeSourceIds: string[];
  selectedDocId: string | null;
  onToggleActive: (id: string) => void;
  onToggleAll: () => void;
  onSelectDoc: (doc: SourceDocument) => void;
  onUpload: (file: File) => Promise<void>;
  onIngestUrl?: (url: string, title?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export const SourceManager: React.FC<SourceManagerProps> = ({
  sources,
  activeSourceIds,
  selectedDocId,
  onToggleActive,
  onToggleAll,
  onSelectDoc,
  onUpload,
  onIngestUrl,
  onDelete,
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isUrlModalOpen, setIsUrlModalOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [isIngestingUrl, setIsIngestingUrl] = useState(false);
  const [urlError, setUrlError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || !onIngestUrl) return;

    let targetUrl = urlInput.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = 'https://' + targetUrl;
    }

    try {
      setIsIngestingUrl(true);
      setUrlError('');
      await onIngestUrl(targetUrl, titleInput.trim() || undefined);
      setUrlInput('');
      setTitleInput('');
      setIsUrlModalOpen(false);
    } catch (err: any) {
      setUrlError(err.message || 'Error al procesar el enlace web');
    } finally {
      setIsIngestingUrl(false);
    }
  };

  const processFiles = async (files: File[]) => {
    if (!files.length) return;

    try {
      setIsUploading(true);
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (files.length > 1) {
          setUploadProgressText(`(${i + 1}/${files.length}) ${file.name}`);
        } else {
          setUploadProgressText(file.name);
        }
        await onUpload(file);
      }
    } catch (err: any) {
      alert(`Error uploading file: ${err.message}`);
    } finally {
      setIsUploading(false);
      setUploadProgressText('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    await processFiles(files);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      setIsDragging(false);
      dragCounterRef.current = 0;
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = Array.from(e.dataTransfer.files || []);
    await processFiles(files);
  };

  const allActive = sources.length > 0 && activeSourceIds.length === sources.length;

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative bg-slate-900/90 border-b border-slate-800 p-4 transition-colors"
    >
      {/* Drag overlay when dragging files over container with existing sources */}
      {isDragging && sources.length > 0 && (
        <div className="absolute inset-0 bg-indigo-950/90 border-2 border-dashed border-indigo-400 rounded-lg flex flex-col items-center justify-center z-30 backdrop-blur-sm pointer-events-none animate-in fade-in duration-100 m-2">
          <Upload className="w-6 h-6 text-indigo-300 animate-bounce mb-1" />
          <p className="text-xs font-semibold text-indigo-200">
            Soltá los archivos para subirlos a este proyecto
          </p>
          <p className="text-[10px] text-indigo-400">PDF, Word, PPTX, Excel, Markdown, TXT o Código (.zip, .py, .ts...)</p>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Fuentes ({sources.length})
          </h3>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
            {activeSourceIds.length} Activas en Contexto
          </span>
        </div>

        <div className="flex items-center gap-2">
          {sources.length > 0 && (
            <button
              onClick={onToggleAll}
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-800 cursor-pointer"
              title="Toggle all sources"
            >
              {allActive ? (
                <>
                  <CheckSquare className="w-3.5 h-3.5 text-indigo-400" /> Deseleccionar todo
                </>
              ) : (
                <>
                  <Square className="w-3.5 h-3.5 text-slate-500" /> Seleccionar todo
                </>
              )}
            </button>
          )}

          <input
            type="file"
            multiple
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.zip,.py,.ts,.tsx,.js,.jsx,.go,.rs,.java,.cpp,.c,.h,.cs,.sql,.html,.css,.json,.yaml,.yml"
          />

          {onIngestUrl && (
            <button
              type="button"
              onClick={() => {
                setUrlError('');
                setIsUrlModalOpen(true);
              }}
              disabled={isUploading || isIngestingUrl}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              title="Añadir página web o artículo online por URL"
            >
              <Globe className="w-3.5 h-3.5 text-indigo-400" /> Enlace Web
            </button>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || isIngestingUrl}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />{' '}
                {uploadProgressText ? `Procesando ${uploadProgressText}...` : 'Procesando...'}
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5" /> Agregar Fuentes
              </>
            )}
          </button>
        </div>
      </div>

      {/* Sources horizontal / compact list */}
      {sources.length === 0 ? (
        <div
          onClick={() => !isUploading && fileInputRef.current?.click()}
          className={`p-6 border-2 border-dashed rounded-xl text-center text-xs transition-all cursor-pointer flex flex-col items-center justify-center gap-2 group ${
            isDragging
              ? 'border-indigo-400 bg-indigo-500/15 text-indigo-200 ring-2 ring-indigo-500/30 scale-[1.01]'
              : 'border-slate-800 hover:border-indigo-500/50 bg-slate-950/40 text-slate-400 hover:text-slate-300'
          }`}
        >
          <div className="p-3 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 group-hover:scale-110 transition-transform">
            {isUploading ? (
              <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
            ) : (
              <Upload className={`w-5 h-5 ${isDragging ? 'text-indigo-300 animate-bounce' : 'text-indigo-400'}`} />
            )}
          </div>
          <p className="font-semibold text-slate-200 text-sm">
            {isUploading
              ? `Procesando e indexando ${uploadProgressText}...`
              : isDragging
              ? '¡Soltá los archivos acá para procesarlos!'
              : 'Arrastrá y soltá tus archivos aquí'}
          </p>
          <p className="text-[11px] text-slate-500 max-w-sm">
            o hacé clic para explorar desde tu equipo &bull; Soporta Documentos (PDF, Word, PPTX, Excel, Markdown, TXT) y Código (.zip, repositorios, .py, .ts, .go, .rs...)
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto pr-1">
          {sources.map((doc) => {
            const isActive = activeSourceIds.includes(doc.id);
            const isSelected = selectedDocId === doc.id;

            return (
              <div
                key={doc.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-all ${
                  isActive
                    ? 'bg-slate-800/90 border-indigo-500/40 text-slate-200'
                    : 'bg-slate-900/50 border-slate-800/80 text-slate-500 hover:text-slate-400'
                } ${isSelected ? 'ring-1 ring-indigo-400' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => onToggleActive(doc.id)}
                  className="hover:scale-110 transition-transform cursor-pointer"
                  title={isActive ? 'Desactivar del contexto' : 'Activar en contexto'}
                >
                  {isActive ? (
                    <CheckSquare className="w-4 h-4 text-indigo-400" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-600" />
                  )}
                </button>

                {doc.metadata?.is_repo ? (
                  <span title="Repositorio de Código" className="flex items-center shrink-0">
                    <Package className="w-3.5 h-3.5 text-cyan-400" />
                  </span>
                ) : doc.metadata?.is_code ? (
                  <span title="Archivo de Código" className="flex items-center shrink-0">
                    <Code2 className="w-3.5 h-3.5 text-cyan-400" />
                  </span>
                ) : doc.metadata?.source_url || doc.mime_type === 'text/html' ? (
                  <span title="Enlace Web" className="flex items-center shrink-0">
                    <Globe className="w-3.5 h-3.5 text-indigo-400" />
                  </span>
                ) : null}

                <span
                  onClick={() => onSelectDoc(doc)}
                  className="cursor-pointer max-w-[140px] truncate font-medium hover:text-indigo-300"
                  title={`${doc.filename} (${doc.char_count.toLocaleString()} chars)`}
                >
                  {doc.filename}
                </span>

                <button
                  type="button"
                  onClick={() => onSelectDoc(doc)}
                  className="p-1 hover:text-indigo-400 text-slate-400 transition-colors cursor-pointer"
                  title="Ver documento"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => onDelete(doc.id)}
                  className="p-1 hover:text-rose-400 text-slate-500 transition-colors cursor-pointer"
                  title="Eliminar fuente"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Web URL Modal */}
      {isUrlModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-white font-semibold text-sm">
                <Globe className="w-4 h-4 text-indigo-400" />
                <span>Agregar Fuente desde Enlace Web</span>
              </div>
              <button
                type="button"
                onClick={() => !isIngestingUrl && setIsUrlModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUrlSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  URL de la Página Web <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <Link2 className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="https://es.wikipedia.org/wiki/... o https://noticias..."
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    disabled={isIngestingUrl}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Título personalizado (opcional)
                </label>
                <input
                  type="text"
                  placeholder="Dejar vacío para detectar el título automáticamente"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  disabled={isIngestingUrl}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all disabled:opacity-50"
                />
              </div>

              {urlError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                  {urlError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsUrlModalOpen(false)}
                  disabled={isIngestingUrl}
                  className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!urlInput.trim() || isIngestingUrl}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-indigo-900/30 disabled:opacity-50 cursor-pointer"
                >
                  {isIngestingUrl ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Descargando y Extrayendo...
                    </>
                  ) : (
                    <>
                      <Globe className="w-3.5 h-3.5" /> Extraer e Indexar
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
