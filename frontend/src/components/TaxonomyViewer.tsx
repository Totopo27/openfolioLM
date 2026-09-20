import React, { useState, useEffect } from 'react';
import {
  Tags,
  FolderTree,
  Sparkles,
  Save,
  CheckCircle2,
  AlertCircle,
  Plus,
  X,
  User,
  Calendar,
  FileText,
  Loader2,
  Hash,
  Lightbulb,
} from 'lucide-react';
import { SourceDocument, TaxonomyClassificationResult } from '../types';
import { updateSourceMetadata, autoclassifySource, fetchProjectTaxonomy } from '../services/api';

interface TaxonomyViewerProps {
  projectId: string;
  document: SourceDocument;
  allSources?: SourceDocument[];
  selectedEngine?: string;
  onMetadataUpdated?: (updatedDoc: SourceDocument) => void;
}

export const TaxonomyViewer: React.FC<TaxonomyViewerProps> = ({
  projectId,
  document,
  allSources = [],
  selectedEngine,
  onMetadataUpdated,
}) => {
  const [category, setCategory] = useState<string>(document.metadata?.category || '');
  const [tags, setTags] = useState<string[]>(document.metadata?.tags || []);
  const [tagInput, setTagInput] = useState<string>('');
  const [author, setAuthor] = useState<string>(document.metadata?.author || '');
  const [yearOrEra, setYearOrEra] = useState<string>(document.metadata?.year_or_era || '');
  const [summary, setSummary] = useState<string>(document.metadata?.summary || '');

  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  const [isSaving, setIsSaving] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [aiSuccessMessage, setAiSuccessMessage] = useState('');
  const [error, setError] = useState('');

  // Sync state when document prop changes
  useEffect(() => {
    setCategory(document.metadata?.category || '');
    setTags(document.metadata?.tags || []);
    setAuthor(document.metadata?.author || '');
    setYearOrEra(document.metadata?.year_or_era || '');
    setSummary(document.metadata?.summary || '');
    setSaveSuccess(false);
    setAiSuccessMessage('');
    setError('');
  }, [document.id, document.metadata]);

  // Load existing project categories and tags
  useEffect(() => {
    let isMounted = true;
    fetchProjectTaxonomy(projectId)
      .then((tax) => {
        if (!isMounted) return;
        setAvailableCategories(tax.categories.map((c) => c.name));
        setAvailableTags(tax.tags.map((t) => t.name));
      })
      .catch(() => {
        // Fallback to local sources if API fails
        if (!isMounted) return;
        const cats = new Set<string>();
        const tgs = new Set<string>();
        allSources.forEach((s) => {
          if (s.metadata?.category) cats.add(s.metadata.category);
          if (Array.isArray(s.metadata?.tags)) {
            s.metadata.tags.forEach((t: string) => tgs.add(t));
          }
        });
        setAvailableCategories(Array.from(cats));
        setAvailableTags(Array.from(tgs));
      });
    return () => {
      isMounted = false;
    };
  }, [projectId, allSources]);

  const handleAddTag = (tagToAdd?: string) => {
    const raw = tagToAdd || tagInput;
    if (!raw || !raw.trim()) return;

    let clean = raw.trim();
    if (!clean.startsWith('#')) {
      clean = `#${clean}`;
    }
    clean = clean.replace(/\s+/g, '-');

    if (!tags.includes(clean)) {
      setTags([...tags, clean]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleKeyDownTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError('');
      setSaveSuccess(false);

      const updated = await updateSourceMetadata(projectId, document.id, {
        category: category.trim() || undefined,
        tags,
        author: author.trim() || undefined,
        year_or_era: yearOrEra.trim() || undefined,
        summary: summary.trim() || undefined,
      });

      setSaveSuccess(true);
      if (onMetadataUpdated) {
        onMetadataUpdated(updated);
      }
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Error al guardar metadatos');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutoclassify = async () => {
    try {
      setIsClassifying(true);
      setError('');
      setAiSuccessMessage('');

      const result: TaxonomyClassificationResult = await autoclassifySource(
        projectId,
        document.id,
        selectedEngine
      );

      setCategory(result.category);
      setTags(result.tags);
      if (result.author) setAuthor(result.author);
      if (result.year_or_era) setYearOrEra(result.year_or_era);
      if (result.thematic_summary) setSummary(result.thematic_summary);

      setAiSuccessMessage(
        `Autoclasificación completada: categoría "${result.category}" y ${result.tags.length} etiquetas generadas con éxito.`
      );

      const updatedDoc = {
        ...document,
        metadata: {
          ...document.metadata,
          category: result.category,
          tags: result.tags,
          author: result.author || document.metadata?.author,
          year_or_era: result.year_or_era || document.metadata?.year_or_era,
          summary: result.thematic_summary || document.metadata?.summary,
        },
      };

      if (onMetadataUpdated) {
        onMetadataUpdated(updatedDoc);
      }
    } catch (err: any) {
      setError(err.message || 'Error al autoclasificar con IA');
    } finally {
      setIsClassifying(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#F9F9F8] dark:bg-[#121214] text-[#1A1A1A] dark:text-[#EDEDED] overflow-y-auto p-6 space-y-5 font-sans">
      {/* Top Banner */}
      <div className="flex items-start justify-between bg-[#F2F2F0] dark:bg-[#19191C] border border-[#E0E0DC] dark:border-[#2A2A2E] p-4 shrink-0 gap-3 flex-wrap sm:flex-nowrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1 bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A56DB] dark:text-[#60A5FA] border border-[#E0E0DC] dark:border-[#2A2A2E]">
              <FolderTree className="w-3.5 h-3.5" />
            </span>
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[#1A1A1A] dark:text-[#EDEDED]">
              Organización Taxonómica & Metadatos
            </h3>
          </div>
          <p className="text-xs text-[#666666] dark:text-[#888888] max-w-xl leading-relaxed">
            Asigná categorías, autores y etiquetas conceptuales a <span className="font-semibold text-[#1A1A1A] dark:text-[#EDEDED]">{document.filename}</span> para organizar tu biblioteca y realizar consultas RAG filtradas por temática.
          </p>
        </div>

        {/* AI Autoclassify Button */}
        <button
          type="button"
          onClick={handleAutoclassify}
          disabled={isClassifying || isSaving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium tracking-wide uppercase bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] border border-[#1A1A1A] dark:border-[#EDEDED] transition-colors cursor-pointer disabled:opacity-50 shrink-0"
        >
          {isClassifying ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Analizando con IA...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 text-[#1A56DB] dark:text-[#60A5FA]" />
              <span>Autoclasificar con IA</span>
            </>
          )}
        </button>
      </div>

      {/* Notifications */}
      {saveSuccess && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-mono">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>¡Metadatos guardados correctamente en la base de datos!</span>
        </div>
      )}

      {aiSuccessMessage && (
        <div className="flex items-center gap-2 p-3 bg-teal-500/10 border border-teal-500/20 text-teal-700 dark:text-teal-400 text-xs font-mono">
          <Sparkles className="w-4 h-4 shrink-0" />
          <span>{aiSuccessMessage}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs font-mono">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Grid: Category, Author, Era */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Category Selector */}
        <div className="space-y-2.5 p-4 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214]">
          <label className="text-xs font-mono font-semibold text-[#1A1A1A] dark:text-[#EDEDED] uppercase tracking-wider flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <FolderTree className="w-3.5 h-3.5 text-[#1A56DB] dark:text-[#60A5FA]" />
              § Categoría Principal
            </span>
            {category && (
              <span className="text-[10px] px-2 py-0.5 bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A56DB] dark:text-[#60A5FA] border border-[#E0E0DC] dark:border-[#2A2A2E] font-mono">
                {category}
              </span>
            )}
          </label>

          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Ej: Hardware & Eurorack, Teoría & Afinación, Historia & Pioneros..."
            className="w-full px-3 py-1.5 text-xs font-mono bg-[#F2F2F0] dark:bg-[#19191C] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED]"
          />

          {/* Quick Category Suggestions */}
          {availableCategories.length > 0 && (
            <div className="pt-1.5">
              <span className="text-[11px] font-mono text-[#666666] dark:text-[#888888] block mb-1.5 flex items-center gap-1">
                <Lightbulb className="w-3 h-3 text-amber-600 dark:text-amber-400" /> Categorías registradas en este proyecto:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {availableCategories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={`px-2 py-0.5 text-xs font-mono transition cursor-pointer border ${
                      category === c
                        ? 'bg-[#1A1A1A] dark:bg-[#EDEDED] text-[#F9F9F8] dark:text-[#121214] border-[#1A1A1A] dark:border-[#EDEDED]'
                        : 'bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] border-[#E0E0DC] dark:border-[#2A2A2E]'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Author and Year/Era */}
        <div className="space-y-3 p-4 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214]">
          <div className="space-y-1.5">
            <label className="text-xs font-mono font-semibold text-[#1A1A1A] dark:text-[#EDEDED] uppercase tracking-wider flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-[#1A56DB] dark:text-[#60A5FA]" />
              § Autor / Creador / Entidad
            </label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Ej: Harry Partch, Dieter Doepfer, Heinz Bohlen..."
              className="w-full px-3 py-1.5 text-xs font-mono bg-[#F2F2F0] dark:bg-[#19191C] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-mono font-semibold text-[#1A1A1A] dark:text-[#EDEDED] uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[#1A56DB] dark:text-[#60A5FA]" />
              § Época / Año / Tendencia
            </label>
            <input
              type="text"
              value={yearOrEra}
              onChange={(e) => setYearOrEra(e.target.value)}
              placeholder="Ej: 1949, Pioneros siglo XX, Síntesis modular moderna..."
              className="w-full px-3 py-1.5 text-xs font-mono bg-[#F2F2F0] dark:bg-[#19191C] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED]"
            />
          </div>
        </div>
      </div>

      {/* Tags Manager */}
      <div className="space-y-3 p-4 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214]">
        <label className="text-xs font-mono font-semibold text-[#1A1A1A] dark:text-[#EDEDED] uppercase tracking-wider flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Tags className="w-3.5 h-3.5 text-[#1A56DB] dark:text-[#60A5FA]" />
            § Etiquetas Conceptuales ({tags.length})
          </span>
          <span className="text-[11px] font-mono text-[#666666] dark:text-[#888888]">
            Presioná Enter o coma para añadir cada etiqueta
          </span>
        </label>

        {/* Tag Input */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Hash className="w-3.5 h-3.5 text-[#666666] dark:text-[#888888] absolute left-3 top-2.5" />
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleKeyDownTag}
              placeholder="Escribí una etiqueta (ej: Eurorack, Escalas, Just-Intonation)..."
              className="w-full pl-8 pr-3 py-1.5 text-xs font-mono bg-[#F2F2F0] dark:bg-[#19191C] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED]"
            />
          </div>
          <button
            type="button"
            onClick={() => handleAddTag()}
            className="px-3 py-1.5 text-xs font-mono font-medium bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] border border-[#1A1A1A] dark:border-[#EDEDED] transition-colors cursor-pointer flex items-center gap-1 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Añadir
          </button>
        </div>

        {/* Current Tag Chips */}
        <div className="flex flex-wrap gap-1.5 pt-1 min-h-[36px] p-2 bg-[#F2F2F0] dark:bg-[#19191C] border border-[#E0E0DC] dark:border-[#2A2A2E]">
          {tags.length === 0 ? (
            <span className="text-xs font-mono text-[#666666] dark:text-[#888888] italic p-1">
              No hay etiquetas asignadas todavía. Añadí etiquetas o pulsá "Autoclasificar con IA".
            </span>
          ) : (
            tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-mono bg-[#EBEBE8] dark:bg-[#1E1E22] text-[#1A56DB] dark:text-[#60A5FA] border border-[#E0E0DC] dark:border-[#2A2A2E] transition-colors"
              >
                <span>{tag}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="hover:text-rose-600 cursor-pointer transition-colors p-0.5"
                  title="Eliminar etiqueta"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))
          )}
        </div>

        {/* Suggestions from project */}
        {availableTags.length > 0 && (
          <div className="pt-1.5">
            <span className="text-[11px] font-mono text-[#666666] dark:text-[#888888] block mb-1.5 flex items-center gap-1">
              <Lightbulb className="w-3 h-3 text-amber-600 dark:text-amber-400" /> Etiquetas usadas en este proyecto (hacé clic para sumar):
            </span>
            <div className="flex flex-wrap gap-1.5">
              {availableTags
                .filter((t) => !tags.includes(t))
                .slice(0, 14)
                .map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleAddTag(t)}
                    className="px-2 py-0.5 text-xs font-mono bg-[#EBEBE8] dark:bg-[#1E1E22] hover:bg-[#1A56DB] hover:text-white dark:hover:bg-[#1A56DB] dark:hover:text-white text-[#666666] dark:text-[#888888] border border-[#E0E0DC] dark:border-[#2A2A2E] transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <Plus className="w-2.5 h-2.5 opacity-60" />
                    <span>{t}</span>
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Thematic Summary / Scope */}
      <div className="space-y-2 p-4 border border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214]">
        <label className="text-xs font-mono font-semibold text-[#1A1A1A] dark:text-[#EDEDED] uppercase tracking-wider flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-[#1A56DB] dark:text-[#60A5FA]" />
          § Resumen Temático Breve
        </label>
        <textarea
          rows={2}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Síntesis de una o dos oraciones sobre el foco conceptual de la obra..."
          className="w-full px-3 py-1.5 text-xs font-mono bg-[#F2F2F0] dark:bg-[#19191C] border border-[#E0E0DC] dark:border-[#2A2A2E] text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED] leading-relaxed resize-none"
        />
      </div>

      {/* Bottom Save Action */}
      <div className="flex items-center justify-end pt-1 pb-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || isClassifying}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-medium tracking-wide uppercase bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] border border-[#1A1A1A] dark:border-[#EDEDED] transition-colors cursor-pointer disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Guardando...</span>
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              <span>Guardar Metadatos</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
