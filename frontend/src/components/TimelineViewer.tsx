import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  History,
  Sparkles,
  Search,
  RefreshCw,
  GitCommit,
  GitMerge,
  Award,
  Zap,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Calendar,
  ExternalLink,
  Layers,
  FileText,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ProjectTimeline, GraphRole } from '../types';
import { fetchProjectTimeline, generateTimelineNarrative } from '../services/api';

interface TimelineViewerProps {
  projectId: string;
  selectedDocId?: string | null;
  selectedEngine?: string;
  onSelectDocument: (docId: string) => void;
}

const ROLE_CONFIG: Record<
  GraphRole,
  { label: string; badgeClass: string; borderClass: string; icon: React.ReactNode }
> = {
  foundation: {
    label: 'Fundacional / Landmark',
    badgeClass: 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/20',
    borderClass: 'hover:border-amber-500/40',
    icon: <Award className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />,
  },
  frontier: {
    label: 'Frontera SOTA',
    badgeClass: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/20',
    borderClass: 'hover:border-emerald-500/40',
    icon: <Zap className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />,
  },
  bridge: {
    label: 'Puente Interdisciplinario',
    badgeClass: 'bg-purple-500/10 text-purple-800 dark:text-purple-300 border-purple-500/20',
    borderClass: 'hover:border-purple-500/40',
    icon: <GitMerge className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />,
  },
  corpus: {
    label: 'Corpus Científico',
    badgeClass: 'bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#666666] dark:text-[#AAAAAA] border-[#E0E0DC] dark:border-[#2A2A2E]',
    borderClass: 'hover:border-[#1A1A1A] dark:hover:border-[#EDEDED]',
    icon: <BookOpen className="w-3.5 h-3.5 text-[#1A56DB] dark:text-[#60A5FA]" />,
  },
};

export const TimelineViewer: React.FC<TimelineViewerProps> = ({
  projectId,
  selectedDocId,
  selectedEngine,
  onSelectDocument,
}) => {
  const [timeline, setTimeline] = useState<ProjectTimeline | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState<GraphRole | 'all'>('all');

  // Narrative state
  const [narrative, setNarrative] = useState<string | null>(null);
  const [isNarrativeLoading, setIsNarrativeLoading] = useState(false);
  const [isNarrativeOpen, setIsNarrativeOpen] = useState(true);
  const [hasCopiedNarrative, setHasCopiedNarrative] = useState(false);

  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  // Load timeline data
  const loadTimeline = async () => {
    if (!projectId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchProjectTimeline(projectId);
      setTimeline(data);
      if (data.narrative_arc) {
        setNarrative(data.narrative_arc);
      }
    } catch (err: any) {
      setError(err.message || 'Error al cargar la cronología del proyecto');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTimeline();
  }, [projectId]);

  // Handle narrative synthesis
  const handleSynthesizeNarrative = async () => {
    if (!projectId) return;
    setIsNarrativeLoading(true);
    try {
      const result = await generateTimelineNarrative(projectId, selectedEngine);
      setNarrative(result);
      setIsNarrativeOpen(true);
    } catch (err: any) {
      alert(`Error al generar narrativa: ${err.message}`);
    } finally {
      setIsNarrativeLoading(false);
    }
  };

  const handleCopyNarrative = () => {
    if (!narrative) return;
    navigator.clipboard.writeText(narrative);
    setHasCopiedNarrative(true);
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setHasCopiedNarrative(false), 2000);
  };

  // Filtered eras & events
  const filteredEras = useMemo(() => {
    if (!timeline) return [];

    const query = searchQuery.trim().toLowerCase();

    return timeline.eras
      .map((era) => {
        const matchingEvents = era.events.filter((event) => {
          // Role filter
          if (selectedRole !== 'all' && event.role !== selectedRole) {
            return false;
          }

          // Search query filter
          if (query) {
            const inTitle = event.title.toLowerCase().includes(query);
            const inAuthors = event.authors.some((a) => a.toLowerCase().includes(query));
            const inHeadline = event.headline.toLowerCase().includes(query);
            const inSummary = event.summary.toLowerCase().includes(query);
            return inTitle || inAuthors || inHeadline || inSummary;
          }

          return true;
        });

        return {
          ...era,
          events: matchingEvents,
        };
      })
      .filter((era) => era.events.length > 0);
  }, [timeline, searchQuery, selectedRole]);

  const totalFilteredEvents = useMemo(() => {
    return filteredEras.reduce((acc, era) => acc + era.events.length, 0);
  }, [filteredEras]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#F9F9F8] dark:bg-[#121214] text-[#1A1A1A] dark:text-[#EDEDED] overflow-hidden select-none">
      {/* Top Header Bar */}
      <div className="flex flex-col gap-3 px-5 py-3.5 bg-[#F2F2F0] dark:bg-[#19191C] border-b border-[#E0E0DC] dark:border-[#2A2A2E] shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#EBEBE8] dark:bg-[#1E1E22] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[#1A56DB] dark:text-[#60A5FA]">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-[#1A1A1A] dark:text-[#EDEDED] flex items-center gap-2">
                Línea de Tiempo Evolutiva & Genealogía
                {timeline && timeline.total_events > 0 && (
                  <span className="text-[10px] px-2 py-0.5 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#666666] dark:text-[#888888] font-mono tabular-nums">
                    {timeline.year_span[0]} — {timeline.year_span[1]} ({totalFilteredEvents} hitos)
                  </span>
                )}
              </h2>
              <p className="text-xs text-[#666666] dark:text-[#888888]">
                Evolución de hitos científicos, linaje intelectual e impactos metodológicos
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSynthesizeNarrative}
              disabled={isNarrativeLoading || !timeline || timeline.total_events === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] disabled:opacity-50 text-[#F9F9F8] dark:text-[#121214] text-xs font-mono font-medium tracking-wide uppercase transition cursor-pointer border border-[#1A1A1A] dark:border-[#EDEDED]"
              title="Generar síntesis de la evolución intelectual con LLM"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isNarrativeLoading ? 'animate-spin' : ''}`} />
              <span>{isNarrativeLoading ? 'Sintetizando...' : 'Sintetizar Narrativa'}</span>
            </button>

            <button
              type="button"
              onClick={loadTimeline}
              disabled={isLoading}
              className="p-1.5 bg-[#EBEBE8] hover:bg-[#E0E0DC] dark:bg-[#1E1E22] dark:hover:bg-[#2A2A2E] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] transition cursor-pointer"
              title="Actualizar cronología"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#E0E0DC] dark:border-[#2A2A2E]">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#666666] dark:text-[#888888]" />
            <input
              type="text"
              placeholder="Buscar por tesis, autor o título..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1 bg-[#FFFFFF] dark:bg-[#121214] border border-[#E0E0DC] dark:border-[#2A2A2E] text-xs font-mono text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED]"
            />
          </div>

          {/* Role Filters */}
          <div className="flex items-center gap-1 bg-[#EBEBE8] dark:bg-[#1E1E22] p-1 border border-[#E0E0DC] dark:border-[#2A2A2E] font-mono text-[10px]">
            <button
              type="button"
              onClick={() => setSelectedRole('all')}
              className={`px-2 py-0.5 cursor-pointer transition ${
                selectedRole === 'all'
                  ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] font-bold'
                  : 'text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED]'
              }`}
            >
              Todos ({timeline ? timeline.total_events : 0})
            </button>
            {(['foundation', 'frontier', 'bridge', 'corpus'] as GraphRole[]).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setSelectedRole(role)}
                className={`flex items-center gap-1 px-2 py-0.5 cursor-pointer transition ${
                  selectedRole === role
                    ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] font-bold'
                    : 'text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED]'
                }`}
              >
                {ROLE_CONFIG[role].icon}
                <span className="capitalize">{role === 'foundation' ? 'Fundacional' : role}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* Loading Skeleton */}
        {isLoading && !timeline && (
          <div className="flex flex-col items-center justify-center py-20 text-[#666666] dark:text-[#888888] space-y-3 font-mono">
            <RefreshCw className="w-6 h-6 animate-spin text-[#1A56DB] dark:text-[#60A5FA]" />
            <p className="text-xs">Reconstruyendo linaje y cronología del corpus...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs font-mono">
            <p className="font-bold mb-1">Error al compilar cronología:</p>
            <p>{error}</p>
          </div>
        )}

        {/* Empty Corpus State */}
        {!isLoading && timeline && timeline.total_events === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center max-w-md mx-auto space-y-3">
            <div className="p-3 bg-[#EBEBE8] dark:bg-[#1E1E22] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[#666666] dark:text-[#888888]">
              <Calendar className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold font-mono text-[#1A1A1A] dark:text-[#EDEDED]">Sin documentos con año de publicación</h3>
            <p className="text-xs text-[#666666] dark:text-[#888888] leading-relaxed">
              Para visualizar la cronología evolutiva, añade papers con metadatos de publicación o utiliza el
              buscador académico de OpenAlex para importar literatura con linaje indexado.
            </p>
          </div>
        )}

        {/* Narrative Arc Banner (if generated) */}
        {narrative && (
          <div className="border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#19191C] overflow-hidden transition-all">
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#EBEBE8] dark:bg-[#1E1E22] border-b border-[#E0E0DC] dark:border-[#2A2A2E]">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#1A56DB] dark:text-[#60A5FA]" />
                <span className="text-xs font-mono font-bold text-[#1A56DB] dark:text-[#60A5FA] uppercase tracking-wider">
                  Narrativa Evolutiva del Corpus
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopyNarrative}
                  className="p-1 text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] transition cursor-pointer"
                  title="Copiar narrativa"
                >
                  {hasCopiedNarrative ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setIsNarrativeOpen(!isNarrativeOpen)}
                  className="p-1 text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] transition cursor-pointer"
                  title={isNarrativeOpen ? 'Colapsar' : 'Expandir'}
                >
                  {isNarrativeOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {isNarrativeOpen && (
              <div className="p-4 text-xs text-[#1A1A1A] dark:text-[#EDEDED] font-sans prose dark:prose-invert max-w-none prose-p:leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{narrative}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* Chronological Stream with Vertical Spine */}
        {timeline && timeline.total_events > 0 && (
          <div className="relative pl-6">
            {/* Vertical Spine Line */}
            <div className="absolute left-[11px] top-2 bottom-4 w-px bg-[#E0E0DC] dark:bg-[#2A2A2E]" />

            {/* Eras loop */}
            <div className="space-y-8">
              {filteredEras.map((era) => (
                <div key={era.year} className="relative group">
                  {/* Era Header Marker */}
                  <div className="flex items-center gap-3 mb-4 -ml-[23px]">
                    <div className="w-5 h-5 bg-[#F9F9F8] dark:bg-[#121214] border border-[#1A1A1A] dark:border-[#EDEDED] flex items-center justify-center z-10 text-[#1A1A1A] dark:text-[#EDEDED]">
                      <GitCommit className="w-3 h-3" />
                    </div>
                    <div className="flex items-baseline gap-2 bg-[#F2F2F0] dark:bg-[#19191C] px-3 py-1 border border-[#E0E0DC] dark:border-[#2A2A2E]">
                      <span className="text-xs font-bold text-[#1A1A1A] dark:text-[#EDEDED] font-mono">{era.year}</span>
                      <span className="text-xs text-[#666666] dark:text-[#888888] font-medium">{era.era_name}</span>
                      <span className="text-[10px] text-[#999999] dark:text-[#666666] font-mono">
                        ({era.events.length} {era.events.length === 1 ? 'hito' : 'hitos'})
                      </span>
                    </div>
                  </div>

                  {/* Era Events List */}
                  <div className="space-y-3.5 ml-2">
                    {era.events.map((event) => {
                      const isSelected = selectedDocId === event.source_id;
                      const roleMeta = ROLE_CONFIG[event.role] || ROLE_CONFIG.corpus;

                      return (
                        <div
                          key={event.id}
                          onClick={() => onSelectDocument(event.source_id)}
                          className={`p-4 border transition-colors cursor-pointer select-text relative ${
                            isSelected
                              ? 'bg-[#F2F2F0] dark:bg-[#222226] border-[#1A1A1A] dark:border-[#EDEDED] border-l-4 border-l-[#1A56DB] dark:border-l-[#60A5FA]'
                              : `bg-[#FFFFFF] dark:bg-[#18181B] border-[#E0E0DC] dark:border-[#2A2A2E] ${roleMeta.borderClass} hover:border-[#1A1A1A] dark:hover:border-[#EDEDED]`
                          }`}
                        >
                          {/* Card Top: Role Badge, Year & Citations */}
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 font-mono">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium border ${roleMeta.badgeClass}`}
                              >
                                {roleMeta.icon}
                                <span>{roleMeta.label}</span>
                              </span>

                              {event.citations_count > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#666666] dark:text-[#888888] border border-[#E0E0DC] dark:border-[#2A2A2E] tabular-nums">
                                  {event.citations_count.toLocaleString()} citas
                                </span>
                              )}
                            </div>

                            <span className="text-[10px] text-[#666666] dark:text-[#888888] flex items-center gap-1 tabular-nums">
                              <Calendar className="w-3 h-3 text-[#999999] dark:text-[#555555]" />
                              {event.year}
                            </span>
                          </div>

                          {/* Paper Title */}
                          <h4 className="text-xs font-bold text-[#1A1A1A] dark:text-[#EDEDED] group-hover:text-[#1A56DB] dark:group-hover:text-[#60A5FA] transition-colors flex items-start justify-between gap-2 font-sans">
                            <span>{event.title}</span>
                            <ExternalLink className="w-3.5 h-3.5 text-[#999999] dark:text-[#555555] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                          </h4>

                          {/* Authors */}
                          {event.authors && event.authors.length > 0 && (
                            <p className="text-[11px] text-[#666666] dark:text-[#888888] mt-1 font-sans">
                              {event.authors.slice(0, 4).join(', ')}
                              {event.authors.length > 4 ? ' et al.' : ''}
                            </p>
                          )}

                          {/* Paradigm Shift / Headline */}
                          {event.headline && (
                            <div className="mt-2.5 p-2.5 bg-[#F2F2F0] dark:bg-[#19191C] border-l-2 border-[#1A56DB] dark:border-[#60A5FA] text-xs text-[#1A1A1A] dark:text-[#EDEDED] font-sans italic">
                              "{event.headline}"
                            </div>
                          )}

                          {/* Executive Summary */}
                          <p className="text-xs text-[#444444] dark:text-[#BBBBBB] mt-2.5 leading-relaxed line-clamp-3 font-sans">
                            {event.summary}
                          </p>

                          {/* Methodology and Limitations */}
                          {(event.methodology || (event.limitations && event.limitations.length > 0)) && (
                            <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-[#E0E0DC] dark:border-[#2A2A2E] font-mono text-[10px]">
                              {event.methodology && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#666666] dark:text-[#888888] border border-[#E0E0DC] dark:border-[#2A2A2E]">
                                  <Layers className="w-2.5 h-2.5 text-[#1A56DB] dark:text-[#60A5FA]" />
                                  <span>{event.methodology}</span>
                                </span>
                              )}
                              {event.limitations && event.limitations.length > 0 && (
                                <span className="text-amber-800 dark:text-amber-300 bg-amber-500/10 px-2 py-0.5 border border-amber-500/20">
                                  Brecha: {event.limitations[0]}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Intellectual Lineage / Antecesores */}
                          {event.built_upon_sources && event.built_upon_sources.length > 0 && (
                            <div className="mt-3 pt-2.5 border-t border-[#E0E0DC] dark:border-[#2A2A2E]">
                              <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-[#666666] dark:text-[#888888] mb-1.5">
                                <GitMerge className="w-3 h-3 text-[#1A56DB] dark:text-[#60A5FA]" />
                                <span>Construye o fundamenta sobre:</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {event.built_upon_sources.map((link) => (
                                  <button
                                    key={link.source_id}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onSelectDocument(link.source_id);
                                    }}
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-[#EBEBE8] hover:bg-[#E0E0DC] dark:bg-[#1E1E22] dark:hover:bg-[#2A2A2E] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[#1A1A1A] dark:text-[#EDEDED] text-[10px] font-mono transition-colors cursor-pointer"
                                    title={`Abrir ${link.title}`}
                                  >
                                    <FileText className="w-3 h-3 text-[#1A56DB] dark:text-[#60A5FA]" />
                                    <span className="font-medium truncate max-w-[220px]">{link.title}</span>
                                    {link.year && <span className="opacity-70 tabular-nums">({link.year})</span>}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
