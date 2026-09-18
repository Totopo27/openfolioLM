import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  BookOpen,
  Loader2,
  Check,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  ExternalLink,
  Sparkles,
  Lightbulb,
  Tag,
} from 'lucide-react';
import { AcademicPaper, SourceDocument, SuggestedTopic } from '../types';
import { fetchSuggestedTopics } from '../services/api';

interface LiteratureDiscoveryModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSourcesAdded: (sources: SourceDocument[]) => void;
  initialQuery?: string;
  selectedEngine?: string;
}

export const LiteratureDiscoveryModal: React.FC<LiteratureDiscoveryModalProps> = ({
  projectId,
  isOpen,
  onClose,
  onSourcesAdded,
  initialQuery = '',
  selectedEngine,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [minYear, setMinYear] = useState<string>('');
  const [minCitations, setMinCitations] = useState<string>('0');
  const [limit, setLimit] = useState<number>(15);
  const [provider, setProvider] = useState<'all' | 'semanticscholar' | 'openalex'>('all');
  const [showFilters, setShowFilters] = useState(false);

  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<AcademicPaper[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [suggestedTopics, setSuggestedTopics] = useState<SuggestedTopic[]>([]);
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);

  const [selectedDois, setSelectedDois] = useState<string[]>([]);
  const [ingestingDois, setIngestingDois] = useState<string[]>([]);
  const [ingestedDois, setIngestedDois] = useState<string[]>([]);
  const [expandedAbstracts, setExpandedAbstracts] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isOpen) {
      if (initialQuery !== undefined) {
        setQuery(initialQuery);
      }
      loadSuggestedTopics();
    }
  }, [isOpen, initialQuery, projectId]);

  const loadSuggestedTopics = async () => {
    try {
      setIsLoadingTopics(true);
      const topics = await fetchSuggestedTopics(projectId);
      setSuggestedTopics(topics);
    } catch (err) {
      console.error('Failed to load suggested topics:', err);
    } finally {
      setIsLoadingTopics(false);
    }
  };

  const handleApplyTopicChip = (chipText: string) => {
    setQuery((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return chipText;
      if (trimmed.toLowerCase().includes(chipText.toLowerCase())) return prev;
      return `${trimmed} ${chipText}`;
    });
  };

  if (!isOpen) return null;

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim() || isSearching) return;

    setIsSearching(true);
    setSearchError(null);
    setSelectedDois([]);

    try {
      const params = new URLSearchParams({
        query: query.trim(),
        limit: limit.toString(),
        min_citations: minCitations,
        provider: provider,
      });
      if (minYear.trim()) {
        params.append('min_year', minYear.trim());
      }

      const res = await fetch(`/api/projects/${projectId}/discovery/search?${params.toString()}`);
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Error ${res.status}: ${errorText || 'Error en la búsqueda'}`);
      }

      const data: AcademicPaper[] = await res.json();
      setSearchResults(data);
      if (data.length === 0) {
        setSearchError('No se encontraron artículos científicos con los criterios indicados.');
      }
    } catch (err: any) {
      setSearchError(err.message || 'Error de conexión con el motor de descubrimiento');
    } finally {
      setIsSearching(false);
    }
  };

  const toggleSelectDoi = (doi: string) => {
    setSelectedDois((prev) =>
      prev.includes(doi) ? prev.filter((d) => d !== doi) : [...prev, doi]
    );
  };

  const toggleSelectAll = () => {
    const uningested = searchResults
      .map((p) => p.doi)
      .filter((doi) => !ingestedDois.includes(doi));

    if (selectedDois.length === uningested.length) {
      setSelectedDois([]);
    } else {
      setSelectedDois(uningested);
    }
  };

  const toggleAbstract = (doi: string) => {
    setExpandedAbstracts((prev) => ({ ...prev, [doi]: !prev[doi] }));
  };

  const handleIngest = async (doisToIngest: string[]) => {
    if (doisToIngest.length === 0) return;

    setIngestingDois((prev) => [...prev, ...doisToIngest]);

    try {
      const res = await fetch(`/api/projects/${projectId}/discovery/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dois: doisToIngest, engine: selectedEngine || undefined }),
      });

      if (!res.ok) {
        throw new Error(`Error al indexar artículos: ${await res.text()}`);
      }

      const newDocs: SourceDocument[] = await res.json();
      if (newDocs.length > 0) {
        onSourcesAdded(newDocs);
      }

      setIngestedDois((prev) => [...prev, ...doisToIngest]);
      setSelectedDois((prev) => prev.filter((d) => !doisToIngest.includes(d)));
    } catch (err: any) {
      alert(`Error durante la indexación: ${err.message}`);
    } finally {
      setIngestingDois((prev) => prev.filter((d) => !doisToIngest.includes(d)));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                Descubrimiento de Literatura Científica
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-normal">
                  OpenAlex &bull; 250M+ Papers
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Buscá literatura académica por lenguaje natural e indexala a tu proyecto en un solo clic.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar & Controls */}
        <div className="p-6 border-b border-slate-800 space-y-3 bg-slate-900/50">
          {/* Provider Selector Tabs */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-slate-400">Motor de búsqueda:</span>
              <div className="inline-flex p-0.5 rounded-lg bg-slate-950 border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setProvider('all')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                    provider === 'all'
                      ? 'bg-indigo-600/30 text-indigo-200 border border-indigo-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                  title="Consulta Semantic Scholar y OpenAlex en simultáneo con desduplicación RRF"
                >
                  <Sparkles className="w-3 h-3 text-indigo-400" />
                  <span>Todos (Federado)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setProvider('semanticscholar')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                    provider === 'semanticscholar'
                      ? 'bg-blue-600/30 text-blue-200 border border-blue-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                  title="Semantic Scholar (Allen Institute for AI) con IA TL;DR y PDF Open Access"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                  <span>Semantic Scholar (S2)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setProvider('openalex')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                    provider === 'openalex'
                      ? 'bg-teal-600/30 text-teal-200 border border-teal-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                  title="Catálogo global OpenAlex"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-400"></span>
                  <span>OpenAlex</span>
                </button>
              </div>
            </div>
          </div>

          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              <input
                type="text"
                autoFocus
                placeholder="Buscar temas o preguntas científicas (ej. retrieval augmented generation hallucination mitigation)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={isSearching}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all disabled:opacity-50"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className={`px-3 py-2 text-xs border rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer ${
                showFilters || minYear || minCitations !== '0'
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
              title="Filtros cienciométricos"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Filtros</span>
            </button>

            <button
              type="submit"
              disabled={!query.trim() || isSearching}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-emerald-900/30 disabled:opacity-50 cursor-pointer"
            >
              {isSearching ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando...
                </>
              ) : (
                <>
                  <Search className="w-3.5 h-3.5" /> Buscar Papers
                </>
              )}
            </button>
          </form>

          {/* Collapsible Filter Bar */}
          {showFilters && (
            <div className="flex flex-wrap items-center gap-4 pt-2 text-xs text-slate-300 animate-in fade-in duration-100">
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-slate-400">Año desde:</label>
                <input
                  type="number"
                  placeholder="2020"
                  value={minYear}
                  onChange={(e) => setMinYear(e.target.value)}
                  className="w-20 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="text-[11px] text-slate-400">Citas mínimas:</label>
                <select
                  value={minCitations}
                  onChange={(e) => setMinCitations(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                >
                  <option value="0">Cualquiera</option>
                  <option value="5">&ge; 5 citas</option>
                  <option value="20">&ge; 20 citas</option>
                  <option value="50">&ge; 50 citas (Alto impacto)</option>
                  <option value="100">&ge; 100 citas (Seminal)</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-[11px] text-slate-400">Cantidad:</label>
                <select
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                >
                  <option value={10}>10 resultados</option>
                  <option value={15}>15 resultados</option>
                  <option value={25}>25 resultados</option>
                  <option value={35}>35 resultados</option>
                </select>
              </div>
            </div>
          )}

          {/* Suggested Topics from Compendium / Books */}
          {((suggestedTopics && suggestedTopics.length > 0) || isLoadingTopics) && (
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-400" /> Conceptos de tu Compendio (Clic para inyectar a la búsqueda):
                  {isLoadingTopics && <Loader2 className="w-3 h-3 animate-spin text-slate-400 ml-1" />}
                </span>
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="text-[10px] text-slate-400 hover:text-slate-200 underline cursor-pointer"
                  >
                    Limpiar consulta
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                {suggestedTopics.map((top, idx) => (
                  <React.Fragment key={idx}>
                    <button
                      type="button"
                      onClick={() => handleApplyTopicChip(top.topic)}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/80 inline-flex items-center gap-1 cursor-pointer transition hover:border-indigo-500/50"
                      title={`Módulo: ${top.topic} (${top.source_title})`}
                    >
                      <BookOpen className="w-3 h-3 text-indigo-400" />
                      <span className="font-medium">{top.topic}</span>
                    </button>
                    {(top.concepts || []).slice(0, 3).map((concept, cIdx) => (
                      <button
                        key={`${idx}-${cIdx}`}
                        type="button"
                        onClick={() => handleApplyTopicChip(concept)}
                        className="text-[11px] px-2 py-0.5 rounded-md bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 inline-flex items-center gap-1 cursor-pointer transition hover:border-indigo-400/40"
                        title={`Concepto de '${top.topic}'`}
                      >
                        <Tag className="w-2.5 h-2.5 text-indigo-400" />
                        <span>{concept}</span>
                      </button>
                    ))}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {searchError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
              {searchError}
            </div>
          )}
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {searchResults.length === 0 && !isSearching ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500 space-y-2">
              <BookOpen className="w-10 h-10 text-slate-600 stroke-1" />
              <p className="text-sm font-medium text-slate-300">
                Explorá la frontera científica global
              </p>
              <p className="text-xs text-slate-500 max-w-md">
                Escribí un tema de investigación o términos clave. OpenFolioLM consultará Semantic Scholar y OpenAlex con IA para recuperar síntesis TL;DR, citas de impacto y PDFs Open Access listos para indexar en tu base de conocimiento.
              </p>
            </div>
          ) : (
            <>
              {/* Batch Action Toolbar */}
              {searchResults.length > 0 && (
                <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs text-slate-400">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={toggleSelectAll}
                      className="hover:text-slate-200 transition-colors font-medium flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>
                        {selectedDois.length === searchResults.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
                      </span>
                    </button>
                    <span className="text-slate-600">&bull;</span>
                    <span>{searchResults.length} artículos encontrados</span>
                  </div>

                  {selectedDois.length > 0 && (
                    <button
                      onClick={() => handleIngest(selectedDois)}
                      disabled={ingestingDois.length > 0}
                      className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium shadow transition-all cursor-pointer disabled:opacity-50"
                    >
                      {ingestingDois.length > 0 ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Indexando ({selectedDois.length})...
                        </>
                      ) : (
                        <>
                          <BookOpen className="w-3.5 h-3.5" /> Indexar Seleccionados ({selectedDois.length})
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}

              {/* Paper Cards */}
              <div className="space-y-3">
                {searchResults.map((paper) => {
                  const isSelected = selectedDois.includes(paper.doi);
                  const isIngesting = ingestingDois.includes(paper.doi);
                  const isIngested = ingestedDois.includes(paper.doi);
                  const isExpanded = !!expandedAbstracts[paper.doi];

                  return (
                    <div
                      key={paper.doi}
                      className={`p-4 rounded-xl border transition-all ${
                        isIngested
                          ? 'bg-slate-900/30 border-slate-800/50 opacity-80'
                          : isSelected
                          ? 'bg-slate-800/80 border-emerald-500/40 shadow-sm'
                          : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isIngested || isIngesting}
                          onChange={() => toggleSelectDoi(paper.doi)}
                          className="mt-1 rounded border-slate-700 text-emerald-600 focus:ring-emerald-500 bg-slate-950 cursor-pointer"
                        />

                        <div className="flex-1 space-y-1.5 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <h4 className="text-xs font-semibold text-slate-100 leading-snug">
                              {paper.title}
                            </h4>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {isIngested ? (
                                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-medium">
                                  <Check className="w-3 h-3 text-emerald-400" /> Indexado
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={isIngesting}
                                  onClick={() => handleIngest([paper.doi])}
                                  className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                                >
                                  {isIngesting ? (
                                    <>
                                      <Loader2 className="w-3 h-3 animate-spin" /> Indexando...
                                    </>
                                  ) : (
                                    <>
                                      <BookOpen className="w-3 h-3" /> Indexar
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                            {paper.authors.length > 0 && (
                              <span className="text-slate-300">
                                {paper.authors.slice(0, 3).join(', ')}
                                {paper.authors.length > 3 && ` +${paper.authors.length - 3}`}
                              </span>
                            )}
                            {paper.venue && (
                              <>
                                <span className="text-slate-600">&bull;</span>
                                <span className="italic text-slate-400">{paper.venue}</span>
                              </>
                            )}
                            {paper.publication_year && (
                              <>
                                <span className="text-slate-600">&bull;</span>
                                <span>{paper.publication_year}</span>
                              </>
                            )}

                            {/* Metadata Badges */}
                            <span className="text-slate-600">&bull;</span>
                            {paper.source_provider === 'both' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/30 font-semibold inline-flex items-center gap-1">
                                <Sparkles className="w-2.5 h-2.5 text-purple-400" /> S2 + OpenAlex
                              </span>
                            )}
                            {paper.source_provider === 'semanticscholar' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30 font-medium inline-flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span> S2
                              </span>
                            )}
                            {paper.source_provider === 'openalex' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-300 border border-teal-500/30 font-medium inline-flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-teal-400"></span> OpenAlex
                              </span>
                            )}

                            {paper.is_open_access ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                                🔓 Open Access PDF
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-medium">
                                🔒 Paywall / Ficha
                              </span>
                            )}

                            {paper.citations_count !== undefined && paper.citations_count !== null && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                                ⭐ {paper.citations_count.toLocaleString()} citas
                              </span>
                            )}

                            {paper.landing_page_url && (
                              <a
                                href={paper.landing_page_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-indigo-400 hover:text-indigo-300 ml-auto"
                                title="Ver página canónica"
                              >
                                <span>DOI</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )}
                          </div>

                          {/* Semantic Scholar AI TLDR */}
                          {paper.tldr && (
                            <div className="p-2.5 rounded-lg bg-indigo-950/30 border border-indigo-800/40 text-[11px] text-indigo-200 flex items-start gap-2">
                              <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                              <div className="space-y-0.5">
                                <span className="font-semibold text-indigo-300">TL;DR: </span>
                                <span className="text-slate-200 leading-relaxed">{paper.tldr}</span>
                              </div>
                            </div>
                          )}

                          {/* Abstract */}
                          {paper.abstract && (
                            <div className="text-[11px] text-slate-400 pt-1">
                              <p className={isExpanded ? '' : 'line-clamp-2'}>
                                {paper.abstract}
                              </p>
                              {paper.abstract.length > 180 && (
                                <button
                                  type="button"
                                  onClick={() => toggleAbstract(paper.doi)}
                                  className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium mt-0.5 flex items-center gap-0.5 cursor-pointer"
                                >
                                  {isExpanded ? (
                                    <>
                                      Menos <ChevronUp className="w-2.5 h-2.5" />
                                    </>
                                  ) : (
                                    <>
                                      Ver resumen completo <ChevronDown className="w-2.5 h-2.5" />
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
