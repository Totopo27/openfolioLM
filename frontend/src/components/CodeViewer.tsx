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
    <div className="h-full flex flex-col bg-[#F9F9F8] dark:bg-[#121214] text-[#1A1A1A] dark:text-[#EDEDED] border-r border-[#E0E0DC] dark:border-[#2A2A2E] overflow-hidden select-text font-sans">
      {/* Code Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#161618] shrink-0 font-mono">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A56DB] dark:text-[#60A5FA] border border-[#E0E0DC] dark:border-[#2A2A2E]">
            {isRepo ? <FolderTree className="w-4 h-4" /> : <Code2 className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold text-[#1A1A1A] dark:text-[#EDEDED] truncate font-mono" title={currentFileName}>
                {currentFileName}
              </h2>
              <span className="text-[9px] uppercase font-mono px-1.5 py-0.2 bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A56DB] dark:text-[#60A5FA] border border-[#E0E0DC] dark:border-[#2A2A2E]">
                {ext}
              </span>
            </div>
            <p className="text-[10px] text-[#666666] dark:text-[#888888] font-mono tabular-nums">
              {lines.length} líneas · {activeCode.length.toLocaleString()} caracteres
              {isRepo ? ` · ${fileKeys.length} archivos en paquete` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isTargetInCurrentCode && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30">
              <Bookmark className="w-3 h-3" /> Cita Enfocada
            </span>
          )}

          {highlightTarget && onClearHighlight && (
            <button
              onClick={onClearHighlight}
              className="text-[10px] font-mono text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] underline cursor-pointer"
            >
              Limpiar
            </button>
          )}

          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono bg-[#EBEBE8] dark:bg-[#1E1E22] hover:bg-[#E0E0DC] dark:hover:bg-[#2A2A2E] text-[#1A1A1A] dark:text-[#EDEDED] border border-[#E0E0DC] dark:border-[#2A2A2E] transition-colors cursor-pointer"
            title="Copiar código fuente"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copiado' : 'Copiar'}</span>
          </button>
        </div>
      </div>

      {/* Main Workspace: Repo File Explorer Sidebar + Code Pane */}
      <div className="flex-1 flex overflow-hidden font-mono">
        {/* Repo File Explorer Sidebar */}
        {isRepo && (
          <div className="w-56 border-r border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#161618] flex flex-col shrink-0">
            <div className="p-2 border-b border-[#E0E0DC] dark:border-[#2A2A2E]">
              <div className="relative">
                <Search className="w-3 h-3 text-[#666666] dark:text-[#888888] absolute left-2 top-2" />
                <input
                  type="text"
                  placeholder="Filtrar archivos..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  className="w-full bg-[#EBEBE8] dark:bg-[#1E1E22] border border-[#E0E0DC] dark:border-[#2A2A2E] pl-7 pr-2 py-1 text-[11px] text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED]"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-1 space-y-0.5 font-mono text-xs">
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
                    className={`w-full text-left px-2 py-1 flex items-center justify-between gap-1.5 transition-colors cursor-pointer border ${
                      isSelected
                        ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] border-[#1A1A1A] dark:border-[#EDEDED] font-bold'
                        : 'bg-transparent text-[#666666] dark:text-[#888888] border-transparent hover:bg-[#EBEBE8] dark:hover:bg-[#1E1E22] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED]'
                    }`}
                    title={file}
                  >
                    <span className="truncate flex items-center gap-1.5 min-w-0">
                      <FileCode className={`w-3 h-3 shrink-0 ${isSelected ? 'text-[#F9F9F8] dark:text-[#121214]' : 'text-[#666666] dark:text-[#888888]'}`} />
                      <span className="truncate text-[11px]">{file}</span>
                    </span>
                    {fileHasActiveCitation && (
                      <span className="w-1.5 h-1.5 bg-amber-500 shrink-0" title="Contiene cita activa" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Code Content Pane with Line Numbers */}
        <div className="flex-1 overflow-y-auto bg-[#F9F9F8] dark:bg-[#121214] p-3 font-mono text-xs leading-relaxed">
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
                      ? 'bg-amber-500/15 border-l-2 border-amber-500 text-amber-900 dark:text-amber-200 font-semibold'
                      : 'hover:bg-[#EBEBE8]/60 dark:hover:bg-[#1E1E22]/60 text-[#1A1A1A] dark:text-[#EDEDED]'
                  }`}
                >
                  {/* Line Number Gutter */}
                  <span className="table-cell text-right pr-3 pl-1 select-none text-[#999999] dark:text-[#555555] font-mono text-[11px] w-10 shrink-0 border-r border-[#E0E0DC] dark:border-[#2A2A2E]">
                    {lineNum}
                  </span>
                  {/* Code Content */}
                  <span className="table-cell whitespace-pre font-mono pl-3">
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
