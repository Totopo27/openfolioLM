import React, { useState, useEffect, useMemo } from 'react';
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
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    borderClass: 'hover:border-amber-500/50',
    icon: <Award className="w-3.5 h-3.5 text-amber-400" />,
  },
  frontier: {
    label: 'Frontera SOTA',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    borderClass: 'hover:border-emerald-500/50',
    icon: <Zap className="w-3.5 h-3.5 text-emerald-400" />,
  },
  bridge: {
    label: 'Puente Interdisciplinario',
    badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    borderClass: 'hover:border-purple-500/50',
    icon: <GitMerge className="w-3.5 h-3.5 text-purple-400" />,
  },
  corpus: {
    label: 'Corpus Científico',
    badgeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    borderClass: 'hover:border-blue-500/50',
    icon: <BookOpen className="w-3.5 h-3.5 text-blue-400" />,
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
    setTimeout(() => setHasCopiedNarrative(false), 2000);
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
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* Top Header Bar */}
      <div className="flex flex-col gap-3 px-5 py-3.5 bg-slate-900/80 border-b border-slate-800 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                Línea de Tiempo Evolutiva & Genealogía
                {timeline && timeline.total_events > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                    {timeline.year_span[0]} — {timeline.year_span[1]} ({totalFilteredEvents} hitos)
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                Evolución de hitos científicos, linaje intelectual e impactos metodológicos
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSynthesizeNarrative}
              disabled={isNarrativeLoading || !timeline || timeline.total_events === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition shadow-sm cursor-pointer"
              title="Generar síntesis de la evolución intelectual con LLM"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isNarrativeLoading ? 'animate-spin' : ''}`} />
              <span>{isNarrativeLoading ? 'Sintetizando...' : 'Sintetizar Narrativa'}</span>
            </button>

            <button
              type="button"
              onClick={loadTimeline}
              disabled={isLoading}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
              title="Actualizar cronología"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por tesis, autor o título..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1 bg-slate-950 border border-slate-800 rounded-md text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Role Filters */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
            <button
              type="button"
              onClick={() => setSelectedRole('all')}
              className={`px-2 py-0.5 rounded cursor-pointer transition ${
                selectedRole === 'all'
                  ? 'bg-indigo-600 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Todos ({timeline ? timeline.total_events : 0})
            </button>
            {(['foundation', 'frontier', 'bridge', 'corpus'] as GraphRole[]).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setSelectedRole(role)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded cursor-pointer transition ${
                  selectedRole === role
                    ? 'bg-slate-800 text-slate-100 font-medium'
                    : 'text-slate-400 hover:text-slate-200'
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
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-400" />
            <p className="text-sm font-medium">Reconstruyendo linaje y cronología del corpus...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-xs">
            <p className="font-semibold mb-1">Error al compilar cronología:</p>
            <p>{error}</p>
          </div>
        )}

        {/* Empty Corpus State */}
        {!isLoading && timeline && timeline.total_events === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center max-w-md mx-auto space-y-3">
            <div className="p-3 bg-slate-900 border border-slate-800 rounded-full text-slate-400">
              <Calendar className="w-8 h-8" />
            </div>
            <h3 className="text-base font-semibold text-slate-200">Sin documentos con año de publicación</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Para visualizar la cronología evolutiva, añade papers con metadatos de publicación o utiliza el
              buscador académico de OpenAlex para importar literatura con linaje indexado.
            </p>
          </div>
        )}

        {/* Narrative Arc Banner (if generated) */}
        {narrative && (
          <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-b from-indigo-950/20 to-slate-900/60 overflow-hidden shadow-lg transition-all">
            <div className="flex items-center justify-between px-4 py-2.5 bg-indigo-950/40 border-b border-indigo-500/20">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-semibold text-indigo-200 uppercase tracking-wider">
                  Narrativa Evolutiva del Corpus
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopyNarrative}
                  className="p-1 rounded text-indigo-300 hover:text-indigo-100 hover:bg-indigo-900/40 transition cursor-pointer"
                  title="Copiar narrativa"
                >
                  {hasCopiedNarrative ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setIsNarrativeOpen(!isNarrativeOpen)}
                  className="p-1 rounded text-indigo-300 hover:text-indigo-100 hover:bg-indigo-900/40 transition cursor-pointer"
                  title={isNarrativeOpen ? 'Colapsar' : 'Expandir'}
                >
                  {isNarrativeOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {isNarrativeOpen && (
              <div className="p-4 text-xs text-slate-200 prose prose-invert max-w-none prose-p:leading-relaxed prose-headings:text-indigo-200">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{narrative}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* Chronological Stream with Vertical Spine */}
        {timeline && timeline.total_events > 0 && (
          <div className="relative pl-6">
            {/* Vertical Spine Line */}
            <div className="absolute left-[11px] top-2 bottom-4 w-0.5 bg-gradient-to-b from-indigo-500 via-purple-500/70 to-slate-800" />

            {/* Eras loop */}
            <div className="space-y-8">
              {filteredEras.map((era) => (
                <div key={era.year} className="relative group">
                  {/* Era Header Marker */}
                  <div className="flex items-center gap-3 mb-4 -ml-[23px]">
                    <div className="w-6 h-6 rounded-full bg-indigo-950 border-2 border-indigo-400 flex items-center justify-center shadow-[0_0_12px_rgba(99,102,241,0.5)] z-10">
                      <GitCommit className="w-3.5 h-3.5 text-indigo-300" />
                    </div>
                    <div className="flex items-baseline gap-2 bg-slate-900/90 px-3 py-1 rounded-lg border border-indigo-500/20 shadow-sm">
                      <span className="text-sm font-bold text-indigo-300 font-mono">{era.year}</span>
                      <span className="text-xs text-slate-300 font-medium">{era.era_name}</span>
                      <span className="text-[10px] text-slate-500">
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
                          className={`p-4 rounded-xl border transition-all cursor-pointer select-text relative ${
                            isSelected
                              ? 'bg-slate-900/95 border-indigo-500 shadow-md ring-1 ring-indigo-500/40'
                              : `bg-slate-900/60 border-slate-800/80 ${roleMeta.borderClass} hover:bg-slate-900/90`
                          }`}
                        >
                          {/* Card Top: Role Badge, Year & Citations */}
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${roleMeta.badgeClass}`}
                              >
                                {roleMeta.icon}
                                <span>{roleMeta.label}</span>
                              </span>

                              {event.citations_count > 0 && (
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 font-mono border border-slate-700/50">
                                  {event.citations_count.toLocaleString()} citas
                                </span>
                              )}
                            </div>

                            <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-slate-500" />
                              {event.year}
                            </span>
                          </div>

                          {/* Paper Title */}
                          <h4 className="text-sm font-semibold text-slate-100 group-hover:text-indigo-300 transition flex items-start justify-between gap-2">
                            <span>{event.title}</span>
                            <ExternalLink className="w-3.5 h-3.5 text-slate-500 opacity-0 group-hover:opacity-100 transition shrink-0 mt-0.5" />
                          </h4>

                          {/* Authors */}
                          {event.authors && event.authors.length > 0 && (
                            <p className="text-[11px] text-slate-400 mt-1">
                              {event.authors.slice(0, 4).join(', ')}
                              {event.authors.length > 4 ? ' et al.' : ''}
                            </p>
                          )}

                          {/* Paradigm Shift / Headline */}
                          {event.headline && (
                            <div className="mt-2.5 p-2.5 rounded-lg bg-indigo-950/20 border border-indigo-500/20 text-xs text-indigo-200/90 font-medium italic">
                              "{event.headline}"
                            </div>
                          )}

                          {/* Executive Summary */}
                          <p className="text-xs text-slate-300 mt-2.5 leading-relaxed line-clamp-3">
                            {event.summary}
                          </p>

                          {/* Methodology and Limitations */}
                          {(event.methodology || (event.limitations && event.limitations.length > 0)) && (
                            <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/60">
                              {event.methodology && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                                  <Layers className="w-2.5 h-2.5 text-indigo-400" />
                                  <span>{event.methodology}</span>
                                </span>
                              )}
                              {event.limitations && event.limitations.length > 0 && (
                                <span className="text-[10px] text-amber-400/90 bg-amber-950/30 px-2 py-0.5 rounded border border-amber-800/40">
                                  Brecha: {event.limitations[0]}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Intellectual Lineage / Antecesores */}
                          {event.built_upon_sources && event.built_upon_sources.length > 0 && (
                            <div className="mt-3 pt-2.5 border-t border-slate-800/80">
                              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-1.5">
                                <GitMerge className="w-3.5 h-3.5 text-purple-400" />
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
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-purple-950/40 hover:bg-purple-900/50 border border-purple-500/30 hover:border-purple-400 text-purple-200 text-[11px] transition cursor-pointer"
                                    title={`Abrir ${link.title}`}
                                  >
                                    <FileText className="w-3 h-3 text-purple-400" />
                                    <span className="font-medium truncate max-w-[220px]">{link.title}</span>
                                    {link.year && <span className="text-[10px] opacity-70">({link.year})</span>}
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
