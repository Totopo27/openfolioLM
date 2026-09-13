import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Code2,
  FolderTree,
  FileCode,
  Bookmark,
  Copy,
  Check,
  Search,
} from 'lucide-react';
import { SourceDocument, HighlightTarget } from '../types';

interface CodeViewerProps {
  document: SourceDocument;
  highlightTarget: HighlightTarget | null;
  onClearHighlight?: () => void;
}

export const CodeViewer: React.FC<CodeViewerProps> = ({
  document,
  highlightTarget,
  onClearHighlight,
}) => {
  const isRepo = document.metadata?.is_repo || false;
  const filesMap: Record<string, string> = document.metadata?.files || {};
  const fileKeys = useMemo(() => Object.keys(filesMap).sort(), [filesMap]);

  // Selected file within repository
  const [selectedFile, setSelectedFile] = useState<string>(() => {
    return fileKeys.length > 0 ? fileKeys[0] : '';
  });

  const [filterQuery, setFilterQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const highlightRef = useRef<HTMLDivElement>(null);

  // When document changes, reset selected file
  useEffect(() => {
    if (isRepo && fileKeys.length > 0) {
      // If we have a highlight target that points to a specific file in heading_path
      if (highlightTarget?.quote_snippet) {
        const found = fileKeys.find((k) => filesMap[k]?.includes(highlightTarget.quote_snippet));
        if (found) {
          setSelectedFile(found);
          return;
        }
      }
      setSelectedFile(fileKeys[0]);
    }
  }, [document.id, isRepo]);

  // Auto-switch to file if a citation target is clicked
  useEffect(() => {
    if (isRepo && highlightTarget && highlightTarget.source_id === document.id) {
      if (highlightTarget.quote_snippet) {
        const matchingFile = fileKeys.find((k) =>
          filesMap[k]?.includes(highlightTarget.quote_snippet)
        );
        if (matchingFile) {
          setSelectedFile(matchingFile);
        }
      }
    }
  }, [highlightTarget, isRepo, document.id]);

  // Auto-scroll to highlighted segment
  useEffect(() => {
    if (highlightTarget && highlightTarget.source_id === document.id) {
      const timer = setTimeout(() => {
        highlightRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [highlightTarget, selectedFile]);

  // Current active code content
  const activeCode = isRepo ? filesMap[selectedFile] || '' : document.raw_markdown;
  const currentFileName = isRepo ? selectedFile : document.filename;

  // Detect extension / language badge
  const ext = currentFileName.split('.').pop()?.toLowerCase() || 'code';

  const handleCopy = () => {
    navigator.clipboard.writeText(activeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Check if active code contains the cited quote
  const isTargetInCurrentCode =
    highlightTarget &&
    highlightTarget.source_id === document.id &&
    highlightTarget.quote_snippet &&
    activeCode.includes(highlightTarget.quote_snippet);

  // Split code into lines for syntax/gutter display
  const lines = activeCode.split('\n');

  // Filtered files for repo explorer
  const visibleFiles = useMemo(() => {
    if (!filterQuery.trim()) return fileKeys;
    const q = filterQuery.toLowerCase();
    return fileKeys.filter((k) => k.toLowerCase().includes(q));
  }, [fileKeys, filterQuery]);

  return (
    <div className="h-full flex flex-col bg-slate-950 border-r border-slate-800/80 overflow-hidden select-text">
      {/* Code Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800/80 bg-slate-900/90 backdrop-blur shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-cyan-500/10 text-cyan-400 rounded-lg border border-cyan-500/20">
            {isRepo ? <FolderTree className="w-5 h-5" /> : <Code2 className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-200 truncate font-mono" title={currentFileName}>
                {currentFileName}
              </h2>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700">
                {ext}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              {lines.length} líneas &bull; {activeCode.length.toLocaleString()} caracteres
              {isRepo ? ` &bull; ${fileKeys.length} archivos en repo` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isTargetInCurrentCode && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
              <Bookmark className="w-3 h-3" /> Cita Enfocada
            </span>
          )}

          {highlightTarget && onClearHighlight && (
            <button
              onClick={onClearHighlight}
              className="text-xs text-slate-400 hover:text-slate-200 underline"
            >
              Limpiar
            </button>
          )}

          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors border border-slate-800 cursor-pointer"
            title="Copiar código"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copiado' : 'Copiar'}</span>
          </button>
        </div>
      </div>

      {/* Main Workspace: Optional Repo Tree Sidebar + Code Pane */}
      <div className="flex-1 flex overflow-hidden">
        {/* Repo File Explorer Sidebar */}
        {isRepo && (
          <div className="w-60 border-r border-slate-800/80 bg-slate-900/40 flex flex-col shrink-0">
            <div className="p-2 border-b border-slate-800/60">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Filtrar archivos..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-lg pl-8 pr-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5 font-mono text-xs">
              {visibleFiles.map((file) => {
                const isSelected = file === selectedFile;
                const fileHasActiveCitation =
                  highlightTarget &&
                  highlightTarget.source_id === document.id &&
                  highlightTarget.quote_snippet &&
                  filesMap[file]?.includes(highlightTarget.quote_snippet);

                return (
                  <button
                    key={file}
                    onClick={() => setSelectedFile(file)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-1.5 transition-colors cursor-pointer group ${
                      isSelected
                        ? 'bg-cyan-950/60 text-cyan-300 font-semibold border border-cyan-500/30'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                    title={file}
                  >
                    <span className="truncate flex items-center gap-1.5">
                      <FileCode className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-cyan-400' : 'text-slate-500'}`} />
                      <span className="truncate">{file}</span>
                    </span>
                    {fileHasActiveCitation && (
                      <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title="Contiene la cita citada" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Code Content Pane with Line Numbers */}
        <div className="flex-1 overflow-y-auto bg-slate-950 p-4 font-mono text-xs leading-relaxed">
          <div className="table w-full border-collapse">
            {lines.map((line, idx) => {
              const lineNum = idx + 1;
              const isLineInQuote =
                isTargetInCurrentCode &&
                highlightTarget.quote_snippet &&
                line.trim() !== '' &&
                highlightTarget.quote_snippet.includes(line.trim());

              return (
                <div
                  key={idx}
                  ref={isLineInQuote ? highlightRef : undefined}
                  className={`table-row transition-colors ${
                    isLineInQuote
                      ? 'bg-amber-400/15 border-l-4 border-amber-400 text-amber-200'
                      : 'hover:bg-slate-900/60 text-slate-300'
                  }`}
                >
                  {/* Line Number Gutter */}
                  <span className="table-cell text-right pr-4 pl-2 select-none text-slate-600 font-mono text-[11px] w-12 shrink-0">
                    {lineNum}
                  </span>
                  {/* Code Content */}
                  <span className="table-cell whitespace-pre font-mono pl-2">
                    {line || ' '}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
