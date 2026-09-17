import React, { useEffect, useRef, useState } from 'react';
import { FileText, Bookmark, GraduationCap, Tags, X } from 'lucide-react';
import { SourceDocument, HighlightTarget } from '../types';
import { CodeViewer } from './CodeViewer';
import { DossierViewer } from './DossierViewer';
import { TaxonomyViewer } from './TaxonomyViewer';

interface DocViewerProps {
  document: SourceDocument | null;
  highlightTarget: HighlightTarget | null;
  onClearHighlight?: () => void;
  projectId?: string;
  selectedEngine?: string;
  allSources?: SourceDocument[];
  activeTab?: 'reading' | 'dossier' | 'taxonomy';
  onTabChange?: (tab: 'reading' | 'dossier' | 'taxonomy') => void;
  onExploreTopic?: (query: string) => void;
  onMetadataUpdated?: (updatedDoc: SourceDocument) => void;
}

export const DocViewer: React.FC<DocViewerProps> = ({
  document,
  highlightTarget,
  onClearHighlight,
  projectId,
  selectedEngine,
  allSources = [],
  activeTab: controlledActiveTab,
  onTabChange,
  onExploreTopic,
  onMetadataUpdated,
}) => {
  const highlightRef = useRef<HTMLDivElement>(null);
  const [internalActiveTab, setInternalActiveTab] = useState<'reading' | 'dossier' | 'taxonomy'>('reading');
  const activeTab = controlledActiveTab !== undefined ? controlledActiveTab : internalActiveTab;

  const handleTabSelect = (tab: 'reading' | 'dossier' | 'taxonomy') => {
    setInternalActiveTab(tab);
    onTabChange?.(tab);
  };

  // When a citation highlight target is set, automatically switch to reading tab
  useEffect(() => {
    if (highlightTarget && document && highlightTarget.source_id === document.id) {
      handleTabSelect('reading');
      const timer = setTimeout(() => {
        highlightRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [highlightTarget, document]);

  if (!document) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-slate-500 bg-slate-900/40 border-r border-slate-800">
        <FileText className="w-16 h-16 mb-4 stroke-[1.5] text-slate-600" />
        <h3 className="text-lg font-medium text-slate-400">No source selected</h3>
        <p className="text-sm text-center mt-1 max-w-sm">
          Select a document from the source manager on the right or click a citation to inspect its grounding context.
        </p>
      </div>
    );
  }

  const isHighlightedForThisDoc =
    highlightTarget && highlightTarget.source_id === document.id;

  const raw = document.raw_markdown;
  let beforeText = raw;
  let highlightedText = '';
  let afterText = '';

  if (
    isHighlightedForThisDoc &&
    highlightTarget.start_char >= 0 &&
    highlightTarget.end_char <= raw.length &&
    highlightTarget.start_char < highlightTarget.end_char
  ) {
    beforeText = raw.slice(0, highlightTarget.start_char);
    highlightedText = raw.slice(highlightTarget.start_char, highlightTarget.end_char);
    afterText = raw.slice(highlightTarget.end_char);
  }

  return (
    <div className="h-full flex flex-col bg-slate-900/60 border-r border-slate-800/80 overflow-hidden">
      {/* Document Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/80 bg-slate-900/90 backdrop-blur gap-3 overflow-x-auto scrollbar-none">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20 shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-200 truncate max-w-[130px] sm:max-w-[180px] lg:max-w-[240px]" title={document.filename}>
              {document.filename}
            </h2>
            <p className="text-[11px] text-slate-400 truncate">
              {document.metadata?.page_count ? `${document.metadata.page_count} págs • ` : ''}
              {document.char_count.toLocaleString()} chars &bull; {document.mime_type}
            </p>
          </div>
        </div>

        {/* View Mode Switcher: Reading vs. Dossier vs. Taxonomy */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-lg border border-slate-700/60 shrink-0">
            <button
              onClick={() => handleTabSelect('reading')}
              title="Lectura del texto y fuentes indexadas"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                activeTab === 'reading'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Lectura</span>
            </button>
            <button
              onClick={() => handleTabSelect('dossier')}
              title="Estructura, Resumen y Guía de Estudio"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                activeTab === 'dossier'
                  ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <GraduationCap className="w-3.5 h-3.5 text-amber-300" />
              <span>Guía de Estudio</span>
            </button>
            <button
              onClick={() => handleTabSelect('taxonomy')}
              title="Categorías, Etiquetas, Época y Metadatos"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                activeTab === 'taxonomy'
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Tags className="w-3.5 h-3.5 text-teal-300" />
              <span>Categorías & Tags</span>
            </button>
          </div>

          {isHighlightedForThisDoc && activeTab === 'reading' && (
            <button
              onClick={onClearHighlight}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition cursor-pointer shrink-0 shadow-sm"
              title="Cita activa en el texto. Clic para deseleccionar"
            >
              <Bookmark className="w-3 h-3 text-amber-400" />
              <span>Cita Activa</span>
              <X className="w-3 h-3 ml-0.5 text-amber-400/80 hover:text-white" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'taxonomy' ? (
          <TaxonomyViewer
            projectId={projectId || 'default'}
            document={document}
            allSources={allSources}
            selectedEngine={selectedEngine}
            onMetadataUpdated={onMetadataUpdated}
          />
        ) : activeTab === 'dossier' ? (
          <DossierViewer
            projectId={projectId || 'default'}
            document={document}
            selectedEngine={selectedEngine}
            onExploreTopic={onExploreTopic}
          />
        ) : document.metadata?.is_code || document.metadata?.is_repo ? (
          <CodeViewer
            document={document}
            highlightTarget={highlightTarget}
            onClearHighlight={onClearHighlight}
          />
        ) : (
          <div className="h-full overflow-y-auto px-8 py-6 font-mono text-sm leading-relaxed text-slate-300">
            {highlightedText ? (
              <div className="whitespace-pre-wrap">
                <span>{beforeText}</span>
                <div
                  ref={highlightRef}
                  id="active-citation-highlight"
                  className="bg-amber-400/20 border-l-4 border-amber-400 px-3 py-2 my-2 rounded-r-md text-amber-200 ring-2 ring-amber-400/40 shadow-lg shadow-amber-950/40 transition-all duration-300"
                >
                  <div className="text-[10px] uppercase font-bold tracking-wider text-amber-400 mb-1 flex items-center gap-1">
                    <Bookmark className="w-3 h-3" /> Grounded Evidence Chunk
                  </div>
                  {highlightedText}
                </div>
                <span>{afterText}</span>
              </div>
            ) : (
              <div className="whitespace-pre-wrap">{raw}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
