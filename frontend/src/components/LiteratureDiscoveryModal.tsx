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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-100">
      <div className="bg-[#F9F9F8] dark:bg-[#121214] border border-[#E0E0DC] dark:border-[#2A2A2E] w-full max-w-4xl h-[85vh] flex flex-col shadow-2xl overflow-hidden font-sans">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#E0E0DC] dark:border-[#2A2A2E] flex items-center justify-between bg-[#F2F2F0] dark:bg-[#19191C]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214] text-[#1A56DB] dark:text-[#60A5FA]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[#1A1A1A] dark:text-[#EDEDED]">
                  Descubrimiento de Literatura Científica
                </h3>
                <span className="text-[10px] px-1.5 py-0.2 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214] font-mono text-[#666666] dark:text-[#888888]">
                  OpenAlex · 250M+ Papers
                </span>
              </div>
              <p className="text-[11px] text-[#666666] dark:text-[#888888] font-sans">
                Buscá literatura académica por lenguaje natural e indexala a tu proyecto en un solo clic.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#666666] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] p-1 cursor-pointer"
            title="Cerrar ventana"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Bar & Controls */}
        <div className="p-4 border-b border-[#E0E0DC] dark:border-[#2A2A2E] space-y-3 bg-[#F9F9F8] dark:bg-[#121214]">
          {/* Provider Selector Tabs */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#666666] dark:text-[#888888]">
                Motor:
              </span>
              <div className="inline-flex border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#EBEBE8] dark:bg-[#1E1E22] p-0.5">
                <button
                  type="button"
                  onClick={() => setProvider('all')}
                  className={`px-2.5 py-1 text-[11px] font-mono font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                    provider === 'all'
                      ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214]'
                      : 'text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED]'
                  }`}
                  title="Consulta Semantic Scholar y OpenAlex en simultáneo con desduplicación RRF"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Todos (Federado)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setProvider('semanticscholar')}
                  className={`px-2.5 py-1 text-[11px] font-mono font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                    provider === 'semanticscholar'
                      ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214]'
                      : 'text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED]'
                  }`}
                  title="Semantic Scholar (Allen Institute for AI) con IA TL;DR y PDF Open Access"
                >
                  <span>Semantic Scholar (S2)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setProvider('openalex')}
                  className={`px-2.5 py-1 text-[11px] font-mono font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                    provider === 'openalex'
                      ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214]'
                      : 'text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED]'
                  }`}
                  title="Catálogo global OpenAlex"
                >
                  <span>OpenAlex</span>
                </button>
              </div>
            </div>
          </div>

          {/* Search Input Bar */}
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-[#666666] dark:text-[#888888] absolute left-3 top-2.5" />
              <input
                type="text"
                autoFocus
                placeholder="Buscar temas o preguntas científicas (ej. retrieval augmented generation hallucination mitigation)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={isSearching}
                className="w-full bg-[#EBEBE8] dark:bg-[#1E1E22] border border-[#E0E0DC] dark:border-[#2A2A2E] pl-9 pr-3 py-1.5 text-xs text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED] font-sans disabled:opacity-50"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className={`px-3 py-1.5 text-xs font-mono border flex items-center gap-1.5 transition-colors cursor-pointer ${
                showFilters || minYear || minCitations !== '0'
                  ? 'bg-[#1A56DB] text-white border-[#1A56DB]'
                  : 'border-[#E0E0DC] dark:border-[#2A2A2E] text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] bg-[#EBEBE8] dark:bg-[#1E1E22]'
              }`}
              title="Filtros cienciométricos"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Filtros</span>
            </button>

            <button
              type="submit"
              disabled={!query.trim() || isSearching}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] text-xs font-mono font-medium tracking-wide uppercase transition-colors disabled:opacity-40 cursor-pointer"
            >
              {isSearching ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Buscando…</span>
                </>
              ) : (
                <>
                  <Search className="w-3.5 h-3.5" />
                  <span>Buscar Papers</span>
                </>
              )}
            </button>
          </form>

          {/* Collapsible Filter Bar */}
          {showFilters && (
            <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-[#E0E0DC] dark:border-[#2A2A2E] text-xs font-mono text-[#666666] dark:text-[#888888]">
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold uppercase tracking-wider">Año desde:</label>
                <input
                  type="number"
                  placeholder="2020"
                  value={minYear}
                  onChange={(e) => setMinYear(e.target.value)}
                  className="w-20 bg-[#EBEBE8] dark:bg-[#1E1E22] border border-[#E0E0DC] dark:border-[#2A2A2E] px-2 py-1 text-xs text-[#1A1A1A] dark:text-[#EDEDED] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED]"
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold uppercase tracking-wider">Citas mínimas:</label>
                <select
                  value={minCitations}
                  onChange={(e) => setMinCitations(e.target.value)}
                  className="bg-[#EBEBE8] dark:bg-[#1E1E22] border border-[#E0E0DC] dark:border-[#2A2A2E] px-2 py-1 text-xs text-[#1A1A1A] dark:text-[#EDEDED] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED]"
                >
                  <option value="0">Cualquiera</option>
                  <option value="5">&ge; 5 citas</option>
                  <option value="20">&ge; 20 citas</option>
                  <option value="50">&ge; 50 citas (Alto impacto)</option>
                  <option value="100">&ge; 100 citas (Seminal)</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold uppercase tracking-wider">Cantidad:</label>
                <select
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="bg-[#EBEBE8] dark:bg-[#1E1E22] border border-[#E0E0DC] dark:border-[#2A2A2E] px-2 py-1 text-xs text-[#1A1A1A] dark:text-[#EDEDED] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED]"
                >
                  <option value={10}>10 resultados</option>
                  <option value={15}>15 resultados</option>
                  <option value={25}>25 resultados</option>
                  <option value={35}>35 resultados</option>
                </select>
              </div>
            </div>
          )}

          {/* Suggested Topics from Compendium */}
          {((suggestedTopics && suggestedTopics.length > 0) || isLoadingTopics) && (
            <div className="pt-2 border-t border-[#E0E0DC] dark:border-[#2A2A2E] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#666666] dark:text-[#888888] flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>Conceptos de tu Compendio (Clic para inyectar):</span>
                  {isLoadingTopics && <Loader2 className="w-3 h-3 animate-spin text-[#666666] ml-1" />}
                </span>
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="text-[10px] font-mono text-[#1A56DB] dark:text-[#60A5FA] hover:underline cursor-pointer"
                  >
                    [Limpiar consulta]
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                {suggestedTopics.map((top, idx) => (
                  <React.Fragment key={idx}>
                    <button
                      type="button"
                      onClick={() => handleApplyTopicChip(top.topic)}
                      className="text-[10px] font-mono px-2 py-0.5 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#EBEBE8] dark:bg-[#1E1E22] hover:bg-[#E0E0DC] dark:hover:bg-[#2A2A2E] text-[#1A1A1A] dark:text-[#EDEDED] inline-flex items-center gap-1 cursor-pointer transition-colors"
                      title={`Módulo: ${top.topic} (${top.source_title})`}
                    >
                      <BookOpen className="w-3 h-3 text-[#1A56DB] dark:text-[#60A5FA]" />
                      <span className="font-medium">{top.topic}</span>
                    </button>
                    {(top.concepts || []).slice(0, 3).map((concept, cIdx) => (
                      <button
                        key={`${idx}-${cIdx}`}
                        type="button"
                        onClick={() => handleApplyTopicChip(concept)}
                        className="text-[10px] font-mono px-1.5 py-0.5 border border-[#1A56DB]/30 bg-[#1A56DB]/5 hover:bg-[#1A56DB]/15 text-[#1A56DB] dark:text-[#60A5FA] inline-flex items-center gap-1 cursor-pointer transition-colors"
                        title={`Concepto de '${top.topic}'`}
                      >
                        <Tag className="w-2.5 h-2.5" />
                        <span>{concept}</span>
                      </button>
                    ))}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {searchError && (
            <div className="p-2.5 border border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-400 text-xs font-mono">
              {searchError}
            </div>
          )}
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F9F9F8] dark:bg-[#121214]">
          {searchResults.length === 0 && !isSearching ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-[#E0E0DC] dark:border-[#2A2A2E]">
              <BookOpen className="w-8 h-8 text-[#999999] dark:text-[#555555] mb-2 stroke-1" />
              <p className="font-mono text-xs font-bold text-[#1A1A1A] dark:text-[#EDEDED] uppercase tracking-wider">
                [EXPLORACIÓN DE LITERATURA GLOBAL]
              </p>
              <p className="text-xs text-[#666666] dark:text-[#888888] mt-1 max-w-md font-sans">
                Escribí un tema de investigación o términos clave. OpenFolioLM consultará Semantic Scholar y OpenAlex con IA para recuperar síntesis TL;DR, citas de impacto y PDFs Open Access listos para indexar en tu base de conocimiento.
              </p>
            </div>
          ) : (
            <>
              {/* Batch Action Toolbar */}
              {searchResults.length > 0 && (
                <div className="flex items-center justify-between pb-2 border-b border-[#E0E0DC] dark:border-[#2A2A2E] text-xs font-mono text-[#666666] dark:text-[#888888]">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] transition-colors font-medium cursor-pointer"
                    >
                      [{selectedDois.length === searchResults.length ? 'Deseleccionar todos' : 'Seleccionar todos'}]
                    </button>
                    <span>·</span>
                    <span className="tabular-nums">{searchResults.length} artículos encontrados</span>
                  </div>

                  {selectedDois.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handleIngest(selectedDois)}
                      disabled={ingestingDois.length > 0}
                      className="flex items-center gap-1.5 px-3 py-1 bg-[#1A56DB] hover:bg-[#1644A8] text-white text-xs font-mono uppercase tracking-wide transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {ingestingDois.length > 0 ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Indexando ({selectedDois.length})…</span>
                        </>
                      ) : (
                        <>
                          <BookOpen className="w-3.5 h-3.5" />
                          <span>Indexar Seleccionados ({selectedDois.length})</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}

              {/* Paper Cards */}
              <div className="space-y-2">
                {searchResults.map((paper) => {
                  const isSelected = selectedDois.includes(paper.doi);
                  const isIngesting = ingestingDois.includes(paper.doi);
                  const isIngested = ingestedDois.includes(paper.doi);
                  const isExpanded = !!expandedAbstracts[paper.doi];

                  return (
                    <div
                      key={paper.doi}
                      className={`p-3.5 border transition-colors ${
                        isIngested
                          ? 'bg-[#EBEBE8] dark:bg-[#1E1E22] border-[#E0E0DC] dark:border-[#2A2A2E] opacity-75'
                          : isSelected
                          ? 'bg-[#1A56DB]/5 dark:bg-[#1A56DB]/10 border-[#1A56DB]'
                          : 'bg-[#F9F9F8] dark:bg-[#121214] border-[#E0E0DC] dark:border-[#2A2A2E] hover:bg-[#F2F2F0] dark:hover:bg-[#19191C]'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isIngested || isIngesting}
                          onChange={() => toggleSelectDoi(paper.doi)}
                          className="mt-0.5 accent-[#1A56DB] cursor-pointer"
                        />

                        <div className="flex-1 space-y-1.5 min-w-0 font-sans">
                          <div className="flex items-start justify-between gap-3">
                            <h4 className="text-xs font-semibold text-[#1A1A1A] dark:text-[#EDEDED] leading-snug">
                              {paper.title}
                            </h4>

                            <div className="flex items-center gap-1.5 shrink-0 font-mono">
                              {isIngested ? (
                                <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium">
                                  <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                  <span>INDEXADO</span>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={isIngesting}
                                  onClick={() => handleIngest([paper.doi])}
                                  className="flex items-center gap-1 text-[10px] px-2.5 py-1 bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] uppercase tracking-wider font-medium transition-colors disabled:opacity-50 cursor-pointer"
                                >
                                  {isIngesting ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      <span>Indexando…</span>
                                    </>
                                  ) : (
                                    <>
                                      <BookOpen className="w-3.5 h-3.5" />
                                      <span>Indexar</span>
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#666666] dark:text-[#888888]">
                            {paper.authors.length > 0 && (
                              <span className="text-[#1A1A1A] dark:text-[#CCCCCC]">
                                {paper.authors.slice(0, 3).join(', ')}
                                {paper.authors.length > 3 && ` +${paper.authors.length - 3}`}
                              </span>
                            )}
                            {paper.venue && (
                              <>
                                <span>·</span>
                                <span className="italic">{paper.venue}</span>
                              </>
                            )}
                            {paper.publication_year && (
                              <>
                                <span>·</span>
                                <span className="tabular-nums">{paper.publication_year}</span>
                              </>
                            )}

                            {/* Metadata Badges */}
                            <span>·</span>
                            {paper.source_provider === 'both' && (
                              <span className="text-[10px] px-1.5 py-0.2 border border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300 font-semibold inline-flex items-center gap-1">
                                <Sparkles className="w-2.5 h-2.5" /> S2 + OpenAlex
                              </span>
                            )}
                            {paper.source_provider === 'semanticscholar' && (
                              <span className="text-[10px] px-1.5 py-0.2 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A56DB] dark:text-[#60A5FA] font-medium">
                                S2
                              </span>
                            )}
                            {paper.source_provider === 'openalex' && (
                              <span className="text-[10px] px-1.5 py-0.2 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#EBEBE8] dark:bg-[#1E1E22] text-teal-700 dark:text-teal-400 font-medium">
                                OpenAlex
                              </span>
                            )}

                            {paper.is_open_access ? (
                              <span className="text-[10px] px-1.5 py-0.2 border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium">
                                🔓 Open Access PDF
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.2 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#666666] dark:text-[#888888] font-medium">
                                🔒 Ficha / Paywall
                              </span>
                            )}

                            {paper.citations_count !== undefined && paper.citations_count !== null && (
                              <span className="text-[10px] px-1.5 py-0.2 border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300 font-medium tabular-nums">
                                ⭐ {paper.citations_count.toLocaleString()} citas
                              </span>
                            )}

                            {paper.landing_page_url && (
                              <a
                                href={paper.landing_page_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-[#1A56DB] dark:text-[#60A5FA] hover:underline ml-auto"
                                title="Ver página canónica"
                              >
                                <span>DOI</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )}
                          </div>

                          {/* Semantic Scholar AI TLDR */}
                          {paper.tldr && (
                            <div className="p-2.5 border border-[#1A56DB]/20 bg-[#1A56DB]/5 text-[11px] text-[#1A1A1A] dark:text-[#EDEDED] flex items-start gap-2">
                              <Lightbulb className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                              <div className="space-y-0.5 font-sans">
                                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#1A56DB] dark:text-[#60A5FA]">
                                  TL;DR SÍNTESIS:{' '}
                                </span>
                                <span className="leading-relaxed">{paper.tldr}</span>
                              </div>
                            </div>
                          )}

                          {/* Abstract */}
                          {paper.abstract && (
                            <div className="text-[11px] text-[#666666] dark:text-[#888888] pt-0.5">
                              <p className={isExpanded ? '' : 'line-clamp-2'}>
                                {paper.abstract}
                              </p>
                              {paper.abstract.length > 180 && (
                                <button
                                  type="button"
                                  onClick={() => toggleAbstract(paper.doi)}
                                  className="text-[10px] font-mono text-[#1A56DB] dark:text-[#60A5FA] hover:underline mt-0.5 flex items-center gap-0.5 cursor-pointer"
                                >
                                  {isExpanded ? (
                                    <>
                                      <span>[Menos]</span> <ChevronUp className="w-2.5 h-2.5" />
                                    </>
                                  ) : (
                                    <>
                                      <span>[Ver resumen completo]</span> <ChevronDown className="w-2.5 h-2.5" />
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
