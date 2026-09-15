import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Scale,
  GraduationCap,
  BookOpen,
  Layers,
  Compass,
  Building2,
  Target,
  Key,
  Search,
  Edit3,
  Save,
  Plus,
  X,
  Check,
} from 'lucide-react';
import { SourceDocument, DocumentDossier, DocumentTypeEnum } from '../types';
import { fetchProjectSourceDossier, generateProjectSourceDossier, updateProjectSourceDossier } from '../services/api';

interface DossierViewerProps {
  projectId: string;
  document: SourceDocument;
  selectedEngine?: string;
  onExploreTopic?: (query: string) => void;
}

const TYPE_CONFIG: Record<
  DocumentTypeEnum,
  { label: string; bg: string; text: string; border: string }
> = {
  book: {
    label: '📚 Libro / Obra',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
  },
  textbook: {
    label: '📖 Libro de Texto / Manual',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
  },
  research_paper: {
    label: '🔬 Paper Científico',
    bg: 'bg-indigo-500/10',
    text: 'text-indigo-400',
    border: 'border-indigo-500/30',
  },
  monograph: {
    label: '📑 Monografía Académica',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
  },
  technical_report: {
    label: '⚙️ Reporte Técnico',
    bg: 'bg-cyan-500/10',
    text: 'text-cyan-400',
    border: 'border-cyan-500/30',
  },
  policy_plan: {
    label: '🏛️ Propuesta / Plan',
    bg: 'bg-slate-500/10',
    text: 'text-slate-400',
    border: 'border-slate-500/30',
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
  onExploreTopic,
}) => {
  const [dossier, setDossier] = useState<DocumentDossier | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [newConceptInputs, setNewConceptInputs] = useState<Record<number, string>>({});

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
      setError(err.message || 'Error al cargar la guía de estudio');
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
      setError(err.message || 'Error al generar la estructura y guía de estudio');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteConcept = (moduleIdx: number, conceptIdx: number) => {
    if (!dossier || !dossier.thematic_modules) return;
    const updatedModules = [...dossier.thematic_modules];
    const targetModule = { ...updatedModules[moduleIdx] };
    targetModule.core_concepts = targetModule.core_concepts.filter((_, idx) => idx !== conceptIdx);
    updatedModules[moduleIdx] = targetModule;
    setDossier({ ...dossier, thematic_modules: updatedModules });
  };

  const handleAddConcept = (moduleIdx: number) => {
    const text = (newConceptInputs[moduleIdx] || '').trim();
    if (!text || !dossier || !dossier.thematic_modules) return;
    const updatedModules = [...dossier.thematic_modules];
    const targetModule = { ...updatedModules[moduleIdx] };
    if (!targetModule.core_concepts.includes(text)) {
      targetModule.core_concepts = [...targetModule.core_concepts, text];
    }
    updatedModules[moduleIdx] = targetModule;
    setDossier({ ...dossier, thematic_modules: updatedModules });
    setNewConceptInputs(prev => ({ ...prev, [moduleIdx]: '' }));
  };

  const handleSaveDossier = async () => {
    if (!dossier) return;
    try {
      setIsSaving(true);
      setError(null);
      const saved = await updateProjectSourceDossier(projectId, document.id, dossier);
      setDossier(saved);
      setIsEditing(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error('Failed to save dossier:', err);
      setError(err.message || 'Error al guardar las correcciones');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400 mb-3" />
        <p className="text-sm font-medium text-slate-400">Consultando estructura y guía de estudio...</p>
      </div>
    );
  }

  if (!dossier) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-slate-400 max-w-lg mx-auto text-center">
        <div className="p-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 text-indigo-400 mb-4 shadow-lg shadow-indigo-950/20">
          <BookOpen className="w-12 h-12 stroke-[1.5]" />
        </div>
        <h3 className="text-lg font-semibold text-slate-200">Estructura & Guía de Estudio de la Obra</h3>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
          Generá automáticamente un dossier conceptual estructurado para libros, textos y papers:
          resumen ejecutivo, prerrequisitos, guía de lectura, mapa de módulos temáticos y dictamen crítico editorial.
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
              <span>Analizando Arquitectura Conceptual y Guía...</span>
            </>
          ) : (
            <>
              <GraduationCap className="w-4 h-4 text-amber-300" />
              <span>Generar Guía de Estudio & Estructura</span>
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
            {saveSuccess && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 animate-in fade-in">
                <Check className="w-3 h-3 text-emerald-400" /> Guardado
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isEditing && (
              <button
                type="button"
                onClick={handleSaveDossier}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 transition disabled:opacity-50 shadow-sm cursor-pointer"
                title="Guardar correcciones del dossier en la base de datos"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>{isSaving ? 'Guardando...' : 'Guardar Cambios'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsEditing(!isEditing)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer border ${
                isEditing
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                  : 'text-slate-300 bg-slate-800/80 hover:bg-slate-700 border border-slate-700'
              }`}
              title={isEditing ? 'Finalizar edición' : 'Editar conceptos axiomáticos de la obra'}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{isEditing ? 'Finalizar' : 'Editar Conceptos'}</span>
            </button>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 transition disabled:opacity-50 cursor-pointer"
              title="Regenerar análisis con el modelo actual"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin text-indigo-400' : ''}`} />
              <span>{isGenerating ? 'Regenerando...' : 'Regenerar'}</span>
            </button>
          </div>
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
            <BookOpen className="w-3.5 h-3.5 text-indigo-400" /> Resumen Ejecutivo de la Obra
          </h4>
          <p className="text-sm text-slate-200 leading-relaxed">{dossier.executive_summary}</p>
        </div>
      </div>

      {/* Study Guide & Pedagogical Roadmap */}
      {dossier.study_guide && (
        <div className="p-6 rounded-2xl bg-gradient-to-br from-indigo-950/20 via-slate-800/40 to-slate-900/60 border border-indigo-500/20 space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-indigo-400" /> Guía de Aprendizaje & Prerrequisitos
            </h3>
            {dossier.study_guide.difficulty_level && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
                Nivel: {dossier.study_guide.difficulty_level}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Target Audience */}
            {dossier.study_guide.target_audience && (
              <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/60 space-y-1.5">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5 text-indigo-400" /> Público Objetivo
                </h4>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {dossier.study_guide.target_audience}
                </p>
              </div>
            )}

            {/* Reading Path */}
            {dossier.study_guide.recommended_reading_path && (
              <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/60 space-y-1.5">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-cyan-400" /> Ruta de Lectura Recomendada
                </h4>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {dossier.study_guide.recommended_reading_path}
                </p>
              </div>
            )}
          </div>

          {/* Prerequisites */}
          {dossier.study_guide.prerequisites && dossier.study_guide.prerequisites.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-amber-400" /> Prerrequisitos Indispensables
              </h4>
              <div className="flex flex-wrap gap-2">
                {dossier.study_guide.prerequisites.map((prereq, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center text-xs px-3 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20"
                  >
                    {prereq}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Key Takeaways */}
          {dossier.study_guide.key_takeaways && dossier.study_guide.key_takeaways.length > 0 && (
            <div className="space-y-2 pt-1">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Competencias & Aprendizajes Clave
              </h4>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {dossier.study_guide.key_takeaways.map((takeaway, idx) => (
                  <li
                    key={idx}
                    className="text-xs text-slate-300 leading-relaxed p-2.5 rounded-lg bg-slate-900/40 border border-slate-800/60 flex items-start gap-2"
                  >
                    <span className="text-emerald-400 mt-0.5">&bull;</span>
                    <span>{takeaway}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Thematic Modules & Conceptual Breakdown */}
      {dossier.thematic_modules && dossier.thematic_modules.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" /> Módulos & Arquitectura Conceptual
            </h3>
            <span className="text-xs text-slate-500">
              {dossier.thematic_modules.length} módulos identificados
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {dossier.thematic_modules.map((mod, idx) => (
              <div
                key={idx}
                className="p-5 rounded-xl bg-slate-800/20 border border-slate-700/50 space-y-3 hover:border-slate-600 transition"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="text-sm font-bold text-indigo-300 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 text-[11px] flex items-center justify-center font-mono">
                      {idx + 1}
                    </span>
                    {mod.topic}
                  </h4>

                  {onExploreTopic && (
                    <button
                      type="button"
                      onClick={() => {
                        const terms = [mod.topic, ...(mod.core_concepts?.slice(0, 2) || [])].join(' ');
                        onExploreTopic(terms);
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 transition cursor-pointer"
                      title={`Explorar papers y literatura científica sobre: ${mod.topic}`}
                    >
                      <Search className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Explorar Papers</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{mod.summary}</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                        Conceptos Axiomáticos:
                      </span>
                      {isEditing && (
                        <span className="text-[10px] text-amber-400 font-medium">Editando</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {(mod.core_concepts || []).map((concept, cIdx) => (
                        <span
                          key={cIdx}
                          className="text-[11px] pl-2.5 pr-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 inline-flex items-center gap-1.5"
                        >
                          <span>{concept}</span>
                          {isEditing && (
                            <button
                              type="button"
                              onClick={() => handleDeleteConcept(idx, cIdx)}
                              className="text-slate-400 hover:text-rose-400 cursor-pointer transition-colors p-0.5 rounded"
                              title={`Eliminar '${concept}'`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      ))}

                      {isEditing && (
                        <div className="inline-flex items-center gap-1">
                          <input
                            type="text"
                            value={newConceptInputs[idx] || ''}
                            onChange={(e) => setNewConceptInputs(prev => ({ ...prev, [idx]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddConcept(idx);
                              }
                            }}
                            placeholder="Añadir concepto..."
                            className="text-[11px] px-2 py-0.5 bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-indigo-500 placeholder:text-slate-500 w-32"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddConcept(idx)}
                            className="p-1 text-indigo-300 hover:text-indigo-200 bg-indigo-500/20 hover:bg-indigo-500/30 rounded border border-indigo-500/30 cursor-pointer"
                            title="Agregar concepto a este módulo"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {mod.practical_applications && mod.practical_applications.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                        Aplicaciones & Prácticas:
                      </span>
                      <ul className="text-xs text-slate-300 space-y-1">
                        {mod.practical_applications.map((app, aIdx) => (
                          <li key={aIdx} className="flex items-start gap-1.5 text-[11px] text-cyan-200/90">
                            <span className="text-cyan-400 mt-0.5">&bull;</span>
                            <span>{app}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Key Claims & Methodology */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Key Claims */}
        <div className="p-5 rounded-xl bg-slate-800/30 border border-slate-700/50 space-y-3">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wide flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Tesis y Fundamentos Principales
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
            <Scale className="w-4 h-4 text-cyan-400" /> Enfoque Didáctico / Metodológico
          </h3>
          <p className="text-xs leading-relaxed text-slate-300">
            {dossier.methodology_or_approach || 'No se especificó una metodología formal en los fragmentos analizados.'}
          </p>
        </div>
      </div>

      {/* Limitations */}
      {dossier.limitations && dossier.limitations.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-2">
          <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Límites & Alcance Temático de la Obra
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
          <Sparkles className="w-4 h-4 text-amber-300" /> Dictamen Editorial & Juicio Crítico
        </h4>
        <p className="text-sm font-medium text-slate-100 leading-relaxed">{dossier.verdict}</p>
      </div>
    </div>
  );
};
