import React, { useState, useEffect, useRef } from 'react';
import { Terminal, X, RefreshCw, Copy, Check, Download, Search, AlertCircle, FileText } from 'lucide-react';
import { fetchSystemLogs, SystemLogsResponse } from '../services/api';

interface SystemLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SystemLogsModal: React.FC<SystemLogsModalProps> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [logFile, setLogFile] = useState<string>('');
  const [totalLines, setTotalLines] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isAutoRefresh, setIsAutoRefresh] = useState<boolean>(true);
  const [filterQuery, setFilterQuery] = useState<string>('');
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const loadLogs = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setErrorMsg(null);
    try {
      const data: SystemLogsResponse = await fetchSystemLogs(300);
      setLogs(data.lines || []);
      setLogFile(data.log_file || '');
      setTotalLines(data.total_lines || data.lines?.length || 0);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al conectar con el endpoint de logs');
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadLogs();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isAutoRefresh) return;
    const interval = setInterval(() => {
      loadLogs(true);
    }, 2500);
    return () => clearInterval(interval);
  }, [isOpen, isAutoRefresh]);

  useEffect(() => {
    if (isOpen && logs.length > 0 && !filterQuery) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs.length, isOpen, filterQuery]);

  if (!isOpen) return null;

  const filteredLogs = filterQuery.trim()
    ? logs.filter((l) => l.toLowerCase().includes(filterQuery.toLowerCase()))
    : logs;

  const handleCopy = () => {
    navigator.clipboard.writeText(logs.join('\n'));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([logs.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `openfolio_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const formatLine = (line: string, idx: number) => {
    const isError = line.includes('[ERROR]') || line.includes('Traceback') || line.includes('Exception');
    const isWarning = line.includes('[WARNING]');
    const isInfo = line.includes('[INFO]');

    let textColor = 'text-slate-300';
    let bgColor = '';
    if (isError) {
      textColor = 'text-rose-300';
      bgColor = 'bg-rose-950/20';
    } else if (isWarning) {
      textColor = 'text-amber-300';
      bgColor = 'bg-amber-950/15';
    } else if (isInfo) {
      textColor = 'text-slate-200';
    }

    return (
      <div
        key={idx}
        className={`px-3 py-0.5 hover:bg-slate-800/60 font-mono text-[11px] leading-relaxed break-all flex items-start gap-2 ${bgColor}`}
      >
        <span className="text-slate-600 select-none w-8 shrink-0 text-right text-[10px]">
          {idx + 1}
        </span>
        <span className={`flex-1 ${textColor}`}>{line}</span>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative w-full max-w-5xl h-[85vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white">Consola de Logs del Servidor</h2>
                {isAutoRefresh && (
                  <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    En vivo
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 flex items-center gap-1.5 truncate max-w-md" title={logFile}>
                <FileText className="w-3 h-3 text-slate-500 shrink-0" />
                <span className="truncate">{logFile || 'backend/data/openfolio.log'}</span>
                {totalLines > 0 && <span className="text-slate-500">({totalLines} líneas)</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsAutoRefresh(!isAutoRefresh)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition flex items-center gap-1.5 cursor-pointer ${
                isAutoRefresh
                  ? 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-750'
                  : 'bg-slate-800/40 text-slate-400 border-slate-800 hover:text-white'
              }`}
              title="Alternar auto-actualización cada 2.5s"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isAutoRefresh ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
              <span className="hidden sm:inline">Auto-refresco</span>
            </button>

            <button
              type="button"
              onClick={() => loadLogs()}
              disabled={isLoading}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
              title="Actualizar ahora"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
              title="Copiar logs al portapapeles"
            >
              {isCopied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
              title="Descargar archivo de logs"
            >
              <Download className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-slate-800 mx-1" />

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800/60 text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title="Cerrar visor"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="px-5 py-2.5 bg-slate-950/40 border-b border-slate-800/80 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filtrar logs por texto (ej: VLM, LanceDB, minicpm, error, pdf)..."
              className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/80"
            />
            {filterQuery && (
              <button
                type="button"
                onClick={() => setFilterQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
          {filterQuery && (
            <span className="text-[11px] text-slate-400 shrink-0">
              {filteredLogs.length} coincidencias
            </span>
          )}
        </div>

        {/* Terminal Output */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto bg-slate-950 p-3 select-text font-mono"
        >
          {errorMsg ? (
            <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              {filterQuery ? 'No hay logs que coincidan con el filtro.' : 'No se han registrado eventos todavía.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-900/50">
              {filteredLogs.map((line, idx) => formatLine(line, idx))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-5 py-2 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between text-[11px] text-slate-500">
          <span>Consejo: podés revisar este visor en cualquier momento durante la subida para ver el progreso detallado de la IA.</span>
          <span className="font-mono">OpenFolioLM Diagnostics</span>
        </div>
      </div>
    </div>
  );
};
