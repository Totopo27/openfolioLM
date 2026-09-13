import React, { useRef, useState } from 'react';
import { Upload, Trash2, CheckSquare, Square, Eye, Loader2 } from 'lucide-react';
import { SourceDocument } from '../types';

interface SourceManagerProps {
  sources: SourceDocument[];
  activeSourceIds: string[];
  selectedDocId: string | null;
  onToggleActive: (id: string) => void;
  onToggleAll: () => void;
  onSelectDoc: (doc: SourceDocument) => void;
  onUpload: (file: File) => Promise<void>;
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
  onDelete,
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      await onUpload(file);
    } catch (err: any) {
      alert(`Error uploading file: ${err.message}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const allActive = sources.length > 0 && activeSourceIds.length === sources.length;

  return (
    <div className="bg-slate-900/90 border-b border-slate-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Sources ({sources.length})
          </h3>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
            {activeSourceIds.length} Active in Context
          </span>
        </div>

        <div className="flex items-center gap-2">
          {sources.length > 0 && (
            <button
              onClick={onToggleAll}
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-800"
              title="Toggle all sources"
            >
              {allActive ? (
                <>
                  <CheckSquare className="w-3.5 h-3.5 text-indigo-400" /> Deselect All
                </>
              ) : (
                <>
                  <Square className="w-3.5 h-3.5 text-slate-500" /> Select All
                </>
              )}
            </button>
          )}

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            accept=".pdf,.docx,.pptx,.xlsx,.txt,.md"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Ingesting...
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5" /> Add Source
              </>
            )}
          </button>
        </div>
      </div>

      {/* Sources horizontal / compact list */}
      {sources.length === 0 ? (
        <div className="p-4 border border-dashed border-slate-800 rounded-lg text-center text-xs text-slate-500">
          Upload PDF, Word, PowerPoint, or Markdown documents to begin grounded analysis.
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
                  className="hover:scale-110 transition-transform"
                  title={isActive ? 'Deactivate from context' : 'Activate in context'}
                >
                  {isActive ? (
                    <CheckSquare className="w-4 h-4 text-indigo-400" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-600" />
                  )}
                </button>

                <span
                  onClick={() => onSelectDoc(doc)}
                  className="cursor-pointer max-w-[140px] truncate font-medium hover:text-indigo-300"
                  title={`${doc.filename} (${doc.char_count} chars)`}
                >
                  {doc.filename}
                </span>

                <button
                  type="button"
                  onClick={() => onSelectDoc(doc)}
                  className="p-1 hover:text-indigo-400 text-slate-400 transition-colors"
                  title="View Document"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => onDelete(doc.id)}
                  className="p-1 hover:text-rose-400 text-slate-500 transition-colors"
                  title="Delete Source"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
