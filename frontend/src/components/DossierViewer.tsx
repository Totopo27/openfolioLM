import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Scale,
  TrendingUp,
  FileBarChart,
  Building2,
} from 'lucide-react';
import { SourceDocument, DocumentDossier, DocumentTypeEnum } from '../types';
import { fetchProjectSourceDossier, generateProjectSourceDossier } from '../services/api';

interface DossierViewerProps {
  projectId: string;
  document: SourceDocument;
  selectedEngine?: string;
}

const TYPE_CONFIG: Record<
  DocumentTypeEnum,
  { label: string; bg: string; text: string; border: string }
> = {
  research_paper: {
    label: '🔬 Paper Científico',
    bg: 'bg-indigo-500/10',
    text: 'text-indigo-400',
    border: 'border-indigo-500/30',
  },
  policy_plan: {
    label: '🏛️ Plan de Gobierno / Política',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
  },
  technical_report: {
    label: '⚙️ Reporte Técnico',
    bg: 'bg-cyan-500/10',
    text: 'text-cyan-400',
    border: 'border-cyan-500/30',
  },
  legal_regulatory: {
    label: '⚖️ Normativa / Marco Legal',
    bg: 'bg-purple-500/10',
    text: 'text-purple-400',
    border: 'border-purple-500/30',
  },
  general: {
    label: '📄 Documento General',
    bg: 'bg-slate-500/10',
    text: 'text-slate-400',
    border: 'border-slate-500/30',
  },
};

export const DossierViewer: React.FC<DossierViewerProps> = ({
  projectId,
  document,
  selectedEngine,
}) => {
  const [dossier, setDossier] = useState<DocumentDossier | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDossier();
  }, [projectId, document.id]);

  const loadDossier = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchProjectSourceDossier(projectId, document.id);
      setDossier(data);
    } catch (err: any) {
      console.error('Failed to load dossier:', err);
      setError(err.message || 'Error al cargar la ficha técnica');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerate = async () => {
    try {
      setIsGenerating(true);
      setError(null);
      const provider = selectedEngine ? selectedEngine.split(':')[0] : undefined;
      const newDossier = await generateProjectSourceDossier(projectId, document.id, provider);
      setDossier(newDossier);
    } catch (err: any) {
      console.error('Failed to generate dossier:', err);
      setError(err.message || 'Error al generar la ficha técnica');
    } finally {
      setIsGenerating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400 mb-3" />
        <p className="text-sm font-medium text-slate-400">Consultando ficha técnica del documento...</p>
      </div>
    );
  }

  if (!dossier) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-slate-400 max-w-lg mx-auto text-center">
        <div className="p-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 text-indigo-400 mb-4 shadow-lg shadow-indigo-950/20">
          <FileBarChart className="w-12 h-12 stroke-[1.5]" />
        </div>
        <h3 className="text-lg font-semibold text-slate-200">Ficha Técnica & Dossier Multidimensional</h3>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
          Generá automáticamente un dossier analítico estructurado con tipado estricto Pydantic:
          resumen ejecutivo, matriz FODA, dimensiones temáticas y dictamen crítico de viabilidad.
        </p>

        {error && (
          <div className="mt-4 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs rounded-lg">
            {error}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 text-white shadow-lg shadow-indigo-950/40 hover:shadow-indigo-900/60 transition-all disabled:opacity-50 cursor-pointer"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Extrayendo Ficha con CeNAT / PASE...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>Generar Ficha Estructurada</span>
            </>
          )}
        </button>
      </div>
    );
  }

  const typeConfig = TYPE_CONFIG[dossier.doc_type] || TYPE_CONFIG.general;
  const confidencePercent = Math.round(dossier.confidence_score * 100);

  return (
    <div className="h-full overflow-y-auto px-8 py-6 space-y-8 max-w-4xl mx-auto text-slate-300 font-sans">
      {/* Header Banner */}
      <div className="p-6 rounded-2xl bg-slate-800/40 border border-slate-700/60 backdrop-blur space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold border ${typeConfig.bg} ${typeConfig.text} ${typeConfig.border}`}
            >
              {typeConfig.label}
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-slate-800 text-slate-400 border border-slate-700">
              {confidencePercent}% confianza
            </span>
          </div>

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 transition disabled:opacity-50"
            title="Regenerar análisis con el modelo actual"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin text-indigo-400' : ''}`} />
            <span>{isGenerating ? 'Regenerando...' : 'Regenerar'}</span>
          </button>
        </div>

        <div>
          <h1 className="text-xl font-bold text-slate-100 leading-snug">{dossier.title}</h1>
          {dossier.authors_or_entities && dossier.authors_or_entities.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {dossier.authors_or_entities.map((auth, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-slate-800/80 text-slate-300 border border-slate-700/50"
                >
                  <Building2 className="w-3 h-3 text-slate-400" />
                  {auth}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Executive Summary */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
            <FileBarChart className="w-3.5 h-3.5 text-indigo-400" /> Resumen Ejecutivo
          </h4>
          <p className="text-sm text-slate-200 leading-relaxed">{dossier.executive_summary}</p>
        </div>
      </div>

      {/* Key Claims & Methodology */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Key Claims */}
        <div className="p-5 rounded-xl bg-slate-800/30 border border-slate-700/50 space-y-3">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wide flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Tesis y Afirmaciones Clave
          </h3>
          <ul className="space-y-2">
            {dossier.key_claims.map((claim, idx) => (
              <li key={idx} className="text-xs leading-relaxed text-slate-300 flex items-start gap-2">
                <span className="text-indigo-400 mt-0.5">&bull;</span>
                <span>{claim}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Methodology */}
        <div className="p-5 rounded-xl bg-slate-800/30 border border-slate-700/50 space-y-3">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wide flex items-center gap-2">
            <Scale className="w-4 h-4 text-cyan-400" /> Enfoque Metodológico / Marco
          </h3>
          <p className="text-xs leading-relaxed text-slate-300">
            {dossier.methodology_or_approach || 'No se especificó una metodología formal en los fragmentos analizados.'}
          </p>
        </div>
      </div>

      {/* FODA / SWOT Matrix (CeNAT / PASE pattern) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-400" /> Matriz FODA Estructurada
          </h3>
          <span className="text-xs text-slate-500">Evaluación Interna / Externa</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Fortalezas */}
          <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/20 space-y-2">
            <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
              🟢 Fortalezas (Internas)
            </h4>
            <ul className="space-y-1.5">
              {dossier.foda.strengths.map((item, idx) => (
                <li key={idx} className="text-xs text-emerald-200/90 leading-relaxed flex items-start gap-1.5">
                  <span className="text-emerald-500">+</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Debilidades */}
          <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/20 space-y-2">
            <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              🟡 Debilidades (Internas)
            </h4>
            <ul className="space-y-1.5">
              {dossier.foda.weaknesses.map((item, idx) => (
                <li key={idx} className="text-xs text-amber-200/90 leading-relaxed flex items-start gap-1.5">
                  <span className="text-amber-500">-</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Oportunidades */}
          <div className="p-4 rounded-xl bg-blue-950/20 border border-blue-500/20 space-y-2">
            <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
              🔵 Oportunidades (Externas)
            </h4>
            <ul className="space-y-1.5">
              {dossier.foda.opportunities.map((item, idx) => (
                <li key={idx} className="text-xs text-blue-200/90 leading-relaxed flex items-start gap-1.5">
                  <span className="text-blue-500">&uarr;</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Amenazas */}
          <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-500/20 space-y-2">
            <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
              🔴 Amenazas / Riesgos (Externos)
            </h4>
            <ul className="space-y-1.5">
              {dossier.foda.threats.map((item, idx) => (
                <li key={idx} className="text-xs text-rose-200/90 leading-relaxed flex items-start gap-1.5">
                  <span className="text-rose-500">&times;</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Multidimensional Area Analysis */}
      {dossier.multidimensional_analysis && dossier.multidimensional_analysis.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
            Desglose Analítico por Dimensiones
          </h3>
          <div className="grid grid-cols-1 gap-4">
            {dossier.multidimensional_analysis.map((area, idx) => (
              <div
                key={idx}
                className="p-5 rounded-xl bg-slate-800/20 border border-slate-700/50 space-y-3 hover:border-slate-600 transition"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-indigo-300">{area.area}</h4>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{area.summary}</p>

                {(area.strengths?.length > 0 || area.weaknesses?.length > 0 || area.risks?.length > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 text-[11px]">
                    {area.strengths?.length > 0 && (
                      <div className="space-y-1">
                        <span className="font-semibold text-emerald-400">Fortalezas:</span>
                        <ul className="list-disc list-inside text-slate-400 space-y-0.5">
                          {area.strengths.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {area.weaknesses?.length > 0 && (
                      <div className="space-y-1">
                        <span className="font-semibold text-amber-400">Debilidades:</span>
                        <ul className="list-disc list-inside text-slate-400 space-y-0.5">
                          {area.weaknesses.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {area.risks?.length > 0 && (
                      <div className="space-y-1">
                        <span className="font-semibold text-rose-400">Riesgos:</span>
                        <ul className="list-disc list-inside text-slate-400 space-y-0.5">
                          {area.risks.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Limitations */}
      {dossier.limitations && dossier.limitations.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-2">
          <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Limitaciones & Vacíos Identificados
          </h4>
          <ul className="space-y-1">
            {dossier.limitations.map((lim, idx) => (
              <li key={idx} className="text-xs text-slate-300 flex items-start gap-2">
                <span className="text-amber-400">&bull;</span>
                <span>{lim}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Final Verdict */}
      <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-950/40 to-slate-900 border border-indigo-500/30 space-y-2 shadow-xl shadow-indigo-950/30">
        <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-amber-300" /> Dictamen & Conclusión Crítica
        </h4>
        <p className="text-sm font-medium text-slate-100 leading-relaxed">{dossier.verdict}</p>
      </div>
    </div>
  );
};
