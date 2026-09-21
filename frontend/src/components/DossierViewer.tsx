import React, { useState, useEffect, useRef } from 'react';
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
  { label: string; badge: string }
> = {
  book: {
    label: 'Libro / Obra',
    badge: 'bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A1A1A] dark:text-[#EDEDED] border-[#E0E0DC] dark:border-[#2A2A2E]',
  },
  textbook: {
    label: 'Manual / Texto',
    badge: 'bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A1A1A] dark:text-[#EDEDED] border-[#E0E0DC] dark:border-[#2A2A2E]',
  },
  research_paper: {
    label: 'Paper Científico',
    badge: 'bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A56DB] dark:text-[#60A5FA] border-[#E0E0DC] dark:border-[#2A2A2E]',
  },
  monograph: {
    label: 'Monografía',
    badge: 'bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A1A1A] dark:text-[#EDEDED] border-[#E0E0DC] dark:border-[#2A2A2E]',
  },
  technical_report: {
    label: 'Reporte Técnico',
    badge: 'bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A1A1A] dark:text-[#EDEDED] border-[#E0E0DC] dark:border-[#2A2A2E]',
  },
  policy_plan: {
    label: 'Propuesta / Plan',
    badge: 'bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A1A1A] dark:text-[#EDEDED] border-[#E0E0DC] dark:border-[#2A2A2E]',
  },
  legal_regulatory: {
    label: 'Marco Legal',
    badge: 'bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A1A1A] dark:text-[#EDEDED] border-[#E0E0DC] dark:border-[#2A2A2E]',
  },
  general: {
    label: 'Documento General',
    badge: 'bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A1A1A] dark:text-[#EDEDED] border-[#E0E0DC] dark:border-[#2A2A2E]',
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

  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);
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
    setNewConceptInputs((prev) => ({ ...prev, [moduleIdx]: '' }));
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
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error('Failed to save dossier:', err);
      setError(err.message || 'Error al guardar las correcciones');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 bg-[#F9F9F8] dark:bg-[#121214] text-[#666666] dark:text-[#888888] font-mono select-none">
        <Loader2 className="w-6 h-6 animate-spin text-[#1A1A1A] dark:text-[#EDEDED] mb-3" />
        <p className="text-xs uppercase tracking-wider">Cargando reporte estructurado...</p>
      </div>
    );
  }

  if (!dossier) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 bg-[#F9F9F8] dark:bg-[#121214] text-[#1A1A1A] dark:text-[#EDEDED] max-w-lg mx-auto text-center select-none font-sans">
        <div className="p-4 bg-[#F2F2F0] dark:bg-[#19191C] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[#1A56DB] dark:text-[#60A5FA] mb-4">
          <BookOpen className="w-8 h-8 stroke-[1.5]" />
        </div>
        <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-[#1A1A1A] dark:text-[#EDEDED]">
          Estructura & Reporte de la Obra
        </h3>
        <p className="text-xs text-[#666666] dark:text-[#888888] mt-2 leading-relaxed">
          Generá automáticamente un dossier conceptual estructurado para libros, textos y papers:
          resumen ejecutivo, prerrequisitos, guía de lectura, mapa de módulos temáticos y dictamen crítico editorial.
        </p>

        {error && (
          <div className="mt-4 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs font-mono">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating}
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 text-xs font-mono font-medium tracking-wide uppercase bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] border border-[#1A1A1A] dark:border-[#EDEDED] transition-colors disabled:opacity-50 cursor-pointer"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Analizando Arquitectura Conceptual...</span>
            </>
          ) : (
            <>
              <GraduationCap className="w-3.5 h-3.5" />
              <span>Generar Reporte</span>
            </>
          )}
        </button>
      </div>
    );
  }

  const typeConfig = TYPE_CONFIG[dossier.doc_type] || TYPE_CONFIG.general;
  const confidencePercent = Math.round(dossier.confidence_score * 100);

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6 max-w-4xl mx-auto bg-[#F9F9F8] dark:bg-[#121214] text-[#1A1A1A] dark:text-[#EDEDED] font-sans">
      {/* Header Banner */}
      <div className="p-4 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#19191C] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`px-2.5 py-0.5 text-[11px] font-mono font-medium border ${typeConfig.badge}`}
            >
              {typeConfig.label}
            </span>
            <span className="px-2 py-0.5 text-[11px] font-mono text-[#666666] dark:text-[#888888] bg-[#EBEBE8] dark:bg-[#1E1E22] border border-[#E0E0DC] dark:border-[#2A2A2E] tabular-nums">
              {confidencePercent}% confianza
            </span>
            {saveSuccess && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
                <Check className="w-3 h-3" /> Guardado
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isEditing && (
              <button
                type="button"
                onClick={handleSaveDossier}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-medium text-white bg-emerald-700 hover:bg-emerald-600 transition disabled:opacity-50 cursor-pointer"
                title="Guardar correcciones del dossier en la base de datos"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>{isSaving ? 'Guardando...' : 'Guardar Cambios'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsEditing(!isEditing)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-medium transition cursor-pointer border ${
                isEditing
                  ? 'bg-[#1A56DB] text-white border-[#1A56DB]'
                  : 'bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A1A1A] dark:text-[#EDEDED] border-[#E0E0DC] dark:border-[#2A2A2E] hover:bg-[#E0E0DC] dark:hover:bg-[#2A2A2E]'
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
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-medium bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A1A1A] dark:text-[#EDEDED] border border-[#E0E0DC] dark:border-[#2A2A2E] hover:bg-[#E0E0DC] dark:hover:bg-[#2A2A2E] transition disabled:opacity-50 cursor-pointer"
              title="Regenerar análisis con el modelo actual"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin text-[#1A56DB] dark:text-[#60A5FA]' : ''}`} />
              <span>{isGenerating ? 'Regenerando...' : 'Regenerar'}</span>
            </button>
          </div>
        </div>

        <div>
          <h1 className="text-base font-bold font-sans text-[#1A1A1A] dark:text-[#EDEDED] leading-snug">
            {dossier.title}
          </h1>
          {dossier.authors_or_entities && dossier.authors_or_entities.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {dossier.authors_or_entities.map((auth, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#666666] dark:text-[#888888] border border-[#E0E0DC] dark:border-[#2A2A2E]"
                >
                  <Building2 className="w-3 h-3 text-[#666666] dark:text-[#888888]" />
                  {auth}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* § 01 Resumen Ejecutivo */}
      <div className="p-4 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214] space-y-2">
        <h4 className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#666666] dark:text-[#888888] flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-[#1A56DB] dark:text-[#60A5FA]" /> § 01 Resumen Ejecutivo de la Obra
        </h4>
        <p className="text-xs text-[#1A1A1A] dark:text-[#EDEDED] leading-relaxed font-sans">
          {dossier.executive_summary}
        </p>
      </div>

      {/* § 02 Guía de Aprendizaje & Prerrequisitos */}
      {dossier.study_guide && (
        <div className="p-4 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F2F2F0] dark:bg-[#19191C] space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[#1A1A1A] dark:text-[#EDEDED] flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-[#1A56DB] dark:text-[#60A5FA]" /> § 02 Guía de Aprendizaje & Prerrequisitos
            </h3>
            {dossier.study_guide.difficulty_level && (
              <span className="px-2.5 py-0.5 font-mono text-[10px] uppercase font-bold bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A56DB] dark:text-[#60A5FA] border border-[#E0E0DC] dark:border-[#2A2A2E]">
                Nivel: {dossier.study_guide.difficulty_level}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Target Audience */}
            {dossier.study_guide.target_audience && (
              <div className="p-3 bg-[#F9F9F8] dark:bg-[#121214] border border-[#E0E0DC] dark:border-[#2A2A2E] space-y-1">
                <h4 className="text-[10px] font-mono font-semibold text-[#666666] dark:text-[#888888] uppercase tracking-wide flex items-center gap-1.5">
                  <Target className="w-3 h-3 text-[#1A56DB] dark:text-[#60A5FA]" /> Público Objetivo
                </h4>
                <p className="text-xs text-[#1A1A1A] dark:text-[#EDEDED] leading-relaxed">
                  {dossier.study_guide.target_audience}
                </p>
              </div>
            )}

            {/* Reading Path */}
            {dossier.study_guide.recommended_reading_path && (
              <div className="p-3 bg-[#F9F9F8] dark:bg-[#121214] border border-[#E0E0DC] dark:border-[#2A2A2E] space-y-1">
                <h4 className="text-[10px] font-mono font-semibold text-[#666666] dark:text-[#888888] uppercase tracking-wide flex items-center gap-1.5">
                  <Compass className="w-3 h-3 text-[#1A56DB] dark:text-[#60A5FA]" /> Ruta de Lectura Recomendada
                </h4>
                <p className="text-xs text-[#1A1A1A] dark:text-[#EDEDED] leading-relaxed">
                  {dossier.study_guide.recommended_reading_path}
                </p>
              </div>
            )}
          </div>

          {/* Prerequisites */}
          {dossier.study_guide.prerequisites && dossier.study_guide.prerequisites.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-[10px] font-mono font-semibold text-[#666666] dark:text-[#888888] uppercase tracking-wide flex items-center gap-1.5">
                <Key className="w-3 h-3 text-amber-600 dark:text-amber-400" /> Prerrequisitos Indispensables
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {dossier.study_guide.prerequisites.map((prereq, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center text-xs font-mono px-2.5 py-0.5 bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A1A1A] dark:text-[#EDEDED] border border-[#E0E0DC] dark:border-[#2A2A2E]"
                  >
                    {prereq}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Key Takeaways */}
          {dossier.study_guide.key_takeaways && dossier.study_guide.key_takeaways.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <h4 className="text-[10px] font-mono font-semibold text-[#666666] dark:text-[#888888] uppercase tracking-wide flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> Competencias & Aprendizajes Clave
              </h4>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {dossier.study_guide.key_takeaways.map((takeaway, idx) => (
                  <li
                    key={idx}
                    className="text-xs text-[#1A1A1A] dark:text-[#EDEDED] leading-relaxed p-2.5 bg-[#F9F9F8] dark:bg-[#121214] border border-[#E0E0DC] dark:border-[#2A2A2E] flex items-start gap-2"
                  >
                    <span className="text-[#1A56DB] dark:text-[#60A5FA] mt-0.5 font-bold">&bull;</span>
                    <span>{takeaway}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* § 03 Módulos & Arquitectura Conceptual */}
      {dossier.thematic_modules && dossier.thematic_modules.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[#1A1A1A] dark:text-[#EDEDED] flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#1A56DB] dark:text-[#60A5FA]" /> § 03 Módulos & Arquitectura Conceptual
            </h3>
            <span className="text-[11px] font-mono text-[#666666] dark:text-[#888888] tabular-nums">
              {dossier.thematic_modules.length} módulos identificados
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {dossier.thematic_modules.map((mod, idx) => (
              <div
                key={idx}
                className="p-4 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214] space-y-2.5"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="text-xs font-mono font-bold text-[#1A1A1A] dark:text-[#EDEDED] flex items-center gap-2">
                    <span className="w-4 h-4 bg-[#1A1A1A] dark:bg-[#EDEDED] text-[#F9F9F8] dark:text-[#121214] text-[10px] flex items-center justify-center font-mono font-bold">
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
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium text-[#1A56DB] dark:text-[#60A5FA] bg-[#EBEBE8] dark:bg-[#1E1E22] hover:bg-[#1A56DB] hover:text-white dark:hover:bg-[#1A56DB] dark:hover:text-white border border-[#E0E0DC] dark:border-[#2A2A2E] transition-colors cursor-pointer"
                      title={`Explorar papers y literatura científica sobre: ${mod.topic}`}
                    >
                      <Search className="w-3 h-3" />
                      <span>Explorar Papers</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-[#1A1A1A] dark:text-[#EDEDED] leading-relaxed font-sans">{mod.summary}</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-semibold text-[#666666] dark:text-[#888888] uppercase tracking-wide">
                        Conceptos Axiomáticos:
                      </span>
                      {isEditing && (
                        <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 font-medium">Editando</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {(mod.core_concepts || []).map((concept, cIdx) => (
                        <span
                          key={cIdx}
                          className="text-xs font-mono px-2 py-0.5 bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A56DB] dark:text-[#60A5FA] border border-[#E0E0DC] dark:border-[#2A2A2E] inline-flex items-center gap-1.5"
                        >
                          <span>{concept}</span>
                          {isEditing && (
                            <button
                              type="button"
                              onClick={() => handleDeleteConcept(idx, cIdx)}
                              className="text-[#666666] dark:text-[#888888] hover:text-rose-600 cursor-pointer transition-colors p-0.5"
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
                            onChange={(e) => setNewConceptInputs((prev) => ({ ...prev, [idx]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddConcept(idx);
                              }
                            }}
                            placeholder="Añadir concepto..."
                            className="text-xs font-mono px-2 py-0.5 bg-[#F2F2F0] dark:bg-[#19191C] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[#1A1A1A] dark:text-[#EDEDED] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] w-32"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddConcept(idx)}
                            className="p-1 text-[#1A56DB] dark:text-[#60A5FA] bg-[#EBEBE8] dark:bg-[#1E1E22] hover:bg-[#1A56DB] hover:text-white border border-[#E0E0DC] dark:border-[#2A2A2E] cursor-pointer transition-colors"
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
                      <span className="text-[10px] font-mono font-semibold text-[#666666] dark:text-[#888888] uppercase tracking-wide">
                        Aplicaciones & Prácticas:
                      </span>
                      <ul className="text-xs text-[#1A1A1A] dark:text-[#EDEDED] space-y-1">
                        {mod.practical_applications.map((app, aIdx) => (
                          <li key={aIdx} className="flex items-start gap-1.5 text-xs text-[#1A1A1A] dark:text-[#EDEDED]">
                            <span className="text-[#1A56DB] dark:text-[#60A5FA] mt-0.5 font-bold">&bull;</span>
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

      {/* § 04 Tesis y Fundamentos Principales & Enfoque Metodológico */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Key Claims */}
        <div className="p-4 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214] space-y-2.5">
          <h3 className="text-xs font-mono font-bold text-[#1A1A1A] dark:text-[#EDEDED] uppercase tracking-wide flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> § 04 Tesis & Fundamentos
          </h3>
          <ul className="space-y-2">
            {dossier.key_claims.map((claim, idx) => (
              <li key={idx} className="text-xs leading-relaxed text-[#1A1A1A] dark:text-[#EDEDED] flex items-start gap-2">
                <span className="text-[#1A56DB] dark:text-[#60A5FA] mt-0.5 font-bold">&bull;</span>
                <span>{claim}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Methodology */}
        <div className="p-4 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214] space-y-2.5">
          <h3 className="text-xs font-mono font-bold text-[#1A1A1A] dark:text-[#EDEDED] uppercase tracking-wide flex items-center gap-2">
            <Scale className="w-4 h-4 text-[#1A56DB] dark:text-[#60A5FA]" /> § 05 Enfoque Metodológico
          </h3>
          <p className="text-xs leading-relaxed text-[#1A1A1A] dark:text-[#EDEDED]">
            {dossier.methodology_or_approach || 'No se especificó una metodología formal en los fragmentos analizados.'}
          </p>
        </div>
      </div>

      {/* § 05 Límites & Alcance */}
      {dossier.limitations && dossier.limitations.length > 0 && (
        <div className="p-4 border border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-200 space-y-2 font-mono">
          <h4 className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5" /> § 06 Límites & Alcance Temático de la Obra
          </h4>
          <ul className="space-y-1 font-sans text-xs">
            {dossier.limitations.map((lim, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-amber-600 dark:text-amber-400 font-bold">&bull;</span>
                <span>{lim}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* § 06 Dictamen Editorial & Juicio Crítico */}
      <div className="p-4 border border-[#1A56DB]/30 bg-[#1A56DB]/5 dark:bg-[#1A56DB]/10 space-y-2">
        <h4 className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#1A56DB] dark:text-[#60A5FA] flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> § 07 Dictamen Editorial & Juicio Crítico
        </h4>
        <p className="text-xs font-medium text-[#1A1A1A] dark:text-[#EDEDED] leading-relaxed font-sans">
          {dossier.verdict}
        </p>
      </div>
    </div>
  );
};
