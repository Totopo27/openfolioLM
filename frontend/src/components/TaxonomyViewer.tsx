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
    // Replace spaces with hyphens for clean hashtags
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
        `Clasificación generada con éxito (${Math.round(result.confidence * 100)}% certeza). ¡Guardá los cambios o editalos si querés!`
      );

      // Create a cloned doc to inform parent
      const updatedDoc: SourceDocument = {
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
    <div className="h-full flex flex-col bg-slate-900/40 overflow-y-auto p-6 space-y-6">
      {/* Top Banner */}
      <div className="flex items-start justify-between bg-slate-900/90 border border-slate-800 rounded-xl p-5 backdrop-blur shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <FolderTree className="w-4 h-4" />
            </span>
            <h3 className="text-base font-semibold text-slate-100">
              Organización Taxonómica & Metadatos
            </h3>
          </div>
          <p className="text-xs text-slate-400 max-w-xl">
            Asigná categorías, autores y etiquetas conceptuales a <span className="font-semibold text-slate-200">{document.filename}</span> para organizar tu biblioteca y realizar consultas RAG filtradas por temática.
          </p>
        </div>

        {/* AI Autoclassify Button */}
        <button
          type="button"
          onClick={handleAutoclassify}
          disabled={isClassifying || isSaving}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-md transition-all cursor-pointer disabled:opacity-50 shrink-0"
        >
          {isClassifying ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Analizando Obra con IA...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>Autoclasificar con IA</span>
            </>
          )}
        </button>
      </div>

      {/* Notifications */}
      {saveSuccess && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>¡Metadatos guardados correctamente en la base de datos!</span>
        </div>
      )}

      {aiSuccessMessage && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-teal-500/15 border border-teal-500/30 text-teal-300 text-xs animate-in fade-in">
          <Sparkles className="w-4 h-4 shrink-0 text-amber-300" />
          <span>{aiSuccessMessage}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Grid: Category, Author, Era */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Category Selector */}
        <div className="space-y-2 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
          <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <FolderTree className="w-3.5 h-3.5 text-indigo-400" />
              Categoría Principal
            </span>
            {category && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-medium">
                {category}
              </span>
            )}
          </label>

          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Ej: Hardware & Eurorack, Teoría & Afinación, Historia & Pioneros..."
            className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />

          {/* Quick Category Suggestions */}
          {availableCategories.length > 0 && (
            <div className="pt-2">
              <span className="text-[11px] text-slate-400 block mb-1.5 flex items-center gap-1">
                <Lightbulb className="w-3 h-3 text-amber-400" /> Categorías del proyecto:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {availableCategories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={`px-2 py-0.5 text-[11px] rounded-md transition cursor-pointer border ${
                      category === c
                        ? 'bg-indigo-600 text-white border-indigo-500'
                        : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-750'
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
        <div className="space-y-4 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-indigo-400" />
              Autor / Creador / Entidad
            </label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Ej: Harry Partch, Dieter Doepfer, Heinz Bohlen..."
              className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-indigo-400" />
              Época / Año / Tendencia
            </label>
            <input
              type="text"
              value={yearOrEra}
              onChange={(e) => setYearOrEra(e.target.value)}
              placeholder="Ej: 1949, Pioneros siglo XX, Síntesis modular moderna..."
              className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* Tags Manager */}
      <div className="space-y-3 p-5 rounded-xl bg-slate-900/60 border border-slate-800">
        <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Tags className="w-3.5 h-3.5 text-indigo-400" />
            Etiquetas Conceptuales ({tags.length})
          </span>
          <span className="text-[11px] text-slate-500">
            Presioná Enter o coma para añadir cada etiqueta
          </span>
        </label>

        {/* Tag Input */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Hash className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleKeyDownTag}
              placeholder="Escribí una etiqueta (ej: Eurorack, Escalas, Just-Intonation)..."
              className="w-full pl-8 pr-3 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <button
            type="button"
            onClick={() => handleAddTag()}
            className="px-3 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer flex items-center gap-1 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Añadir
          </button>
        </div>

        {/* Current Tag Chips */}
        <div className="flex flex-wrap gap-2 pt-1 min-h-[38px] p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
          {tags.length === 0 ? (
            <span className="text-xs text-slate-500 italic p-1">
              No hay etiquetas asignadas todavía. Añadí etiquetas o pulsá "Autoclasificar con IA".
            </span>
          ) : (
            tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 group transition hover:border-indigo-400"
              >
                <span>{tag}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="p-0.5 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition cursor-pointer"
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
          <div className="pt-2">
            <span className="text-[11px] text-slate-400 block mb-1.5 flex items-center gap-1">
              <Lightbulb className="w-3 h-3 text-amber-400" /> Etiquetas usadas en este proyecto (hacé clic para sumar):
            </span>
            <div className="flex flex-wrap gap-1.5">
              {availableTags
                .filter((t) => !tags.includes(t))
                .slice(0, 12)
                .map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleAddTag(t)}
                    className="px-2 py-0.5 text-[11px] rounded-md bg-slate-800/80 hover:bg-indigo-900/40 text-slate-300 hover:text-indigo-200 border border-slate-750 hover:border-indigo-500/40 transition cursor-pointer flex items-center gap-1"
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
      <div className="space-y-2 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
        <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-indigo-400" />
          Resumen Temático Breve
        </label>
        <textarea
          rows={2}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Síntesis de una o dos oraciones sobre el foco conceptual de la obra..."
          className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 leading-relaxed resize-none"
        />
      </div>

      {/* Bottom Save Action */}
      <div className="flex items-center justify-end pt-2 pb-6">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || isClassifying}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-md hover:shadow-indigo-500/20 transition-all cursor-pointer disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Guardando...</span>
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              <span>Guardar Cambios</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
