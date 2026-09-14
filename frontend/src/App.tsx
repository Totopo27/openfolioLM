import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen,
  Layers,
  Folder,
  FolderPlus,
  Trash2,
  ChevronDown,
  Plus,
  X,
} from 'lucide-react';
import {
  SourceDocument,
  ChatMessage,
  HighlightTarget,
  Citation,
  Project,
  ModelEngine,
} from './types';
import {
  fetchProjects,
  createProject,
  deleteProject,
  fetchProjectSources,
  uploadProjectSource,
  ingestProjectUrl,
  deleteProjectSource,
  fetchProjectMessages,
  clearProjectMessages,
  sendProjectGroundedChat,
  fetchAvailableModels,
} from './services/api';
import { DocViewer } from './components/DocViewer';
import { SourceManager } from './components/SourceManager';
import { ChatPanel } from './components/ChatPanel';

export const App: React.FC = () => {
  // Project State
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [isSubmittingProject, setIsSubmittingProject] = useState(false);

  // Document & Chat State
  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [activeSourceIds, setActiveSourceIds] = useState<string[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<SourceDocument | null>(null);
  const [highlightTarget, setHighlightTarget] = useState<HighlightTarget | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [models, setModels] = useState<ModelEngine[]>([]);
  const [selectedEngine, setSelectedEngine] = useState<string>('gemini:gemini-3.5-flash');

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProjectDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Initial Load: Fetch projects and models
  useEffect(() => {
    initProjects();
    initModels();
  }, []);

  const initModels = async () => {
    try {
      const modelList = await fetchAvailableModels();
      setModels(modelList);
      if (modelList.length > 0) {
        const savedEngine = localStorage.getItem('openfolio_selected_engine');
        const matched = modelList.find((m) => m.id === savedEngine && m.is_available);
        if (matched) {
          setSelectedEngine(matched.id);
        } else {
          const firstAvailable = modelList.find((m) => m.is_available) || modelList[0];
          setSelectedEngine(firstAvailable.id);
        }
      }
    } catch (err) {
      console.error('Failed to load available models:', err);
    }
  };

  const initProjects = async () => {
    try {
      const projList = await fetchProjects();
      setProjects(projList);

      if (projList.length > 0) {
        const savedId = localStorage.getItem('openfolio_active_project_id');
        const matched = projList.find((p) => p.id === savedId);
        const target = matched || projList[0];
        await handleSelectProject(target);
      }
    } catch (err) {
      console.error('Failed to initialize projects:', err);
    }
  };

  const handleSelectProject = async (project: Project) => {
    setActiveProject(project);
    localStorage.setItem('openfolio_active_project_id', project.id);
    setIsProjectDropdownOpen(false);
    setHighlightTarget(null);

    // Fetch sources for this project
    try {
      const docs = await fetchProjectSources(project.id);
      setSources(docs);
      setActiveSourceIds(docs.map((d) => d.id));
      setSelectedDoc(docs.length > 0 ? docs[0] : null);
    } catch (err) {
      console.error(`Failed to load sources for project ${project.id}:`, err);
      setSources([]);
      setActiveSourceIds([]);
      setSelectedDoc(null);
    }

    // Fetch persistent chat messages for this project
    try {
      const msgs = await fetchProjectMessages(project.id);
      setMessages(msgs);
    } catch (err) {
      console.error(`Failed to load messages for project ${project.id}:`, err);
      setMessages([]);
    }
  };

  const handleCreateProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || isSubmittingProject) return;

    setIsSubmittingProject(true);
    try {
      const created = await createProject(newProjectName.trim(), newProjectDesc.trim());
      setProjects((prev) => [created, ...prev]);
      setNewProjectName('');
      setNewProjectDesc('');
      setIsCreateModalOpen(false);
      await handleSelectProject(created);
    } catch (err: any) {
      alert(`Error creating project: ${err.message}`);
    } finally {
      setIsSubmittingProject(false);
    }
  };

  const handleDeleteProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (!confirm('¿Estás seguro de eliminar este proyecto? Se borrarán todos sus documentos y conversaciones.')) {
      return;
    }

    try {
      await deleteProject(projectId);
      const updated = await fetchProjects();
      setProjects(updated);

      if (activeProject?.id === projectId) {
        if (updated.length > 0) {
          await handleSelectProject(updated[0]);
        } else {
          setActiveProject(null);
          setSources([]);
          setMessages([]);
          setSelectedDoc(null);
        }
      }
    } catch (err: any) {
      alert(`Error deleting project: ${err.message}`);
    }
  };

  const handleUpload = async (file: File) => {
    if (!activeProject) return;
    const newDoc = await uploadProjectSource(activeProject.id, file);
    setSources((prev) => [newDoc, ...prev]);
    setActiveSourceIds((prev) => [...prev, newDoc.id]);
    setSelectedDoc(newDoc);

    // Refresh project metadata count
    setProjects((prev) =>
      prev.map((p) => (p.id === activeProject.id ? { ...p, doc_count: p.doc_count + 1 } : p))
    );
  };

  const handleIngestUrl = async (url: string, title?: string) => {
    if (!activeProject) return;
    const newDoc = await ingestProjectUrl(activeProject.id, url, title);
    setSources((prev) => [newDoc, ...prev]);
    setActiveSourceIds((prev) => [...prev, newDoc.id]);
    setSelectedDoc(newDoc);

    // Refresh project metadata count
    setProjects((prev) =>
      prev.map((p) => (p.id === activeProject.id ? { ...p, doc_count: p.doc_count + 1 } : p))
    );
  };

  const handleDeleteSource = async (id: string) => {
    if (!activeProject) return;
    if (!confirm('¿Estás seguro de que quieres eliminar esta fuente?')) return;
    await deleteProjectSource(activeProject.id, id);
    setSources((prev) => prev.filter((d) => d.id !== id));
    setActiveSourceIds((prev) => prev.filter((sId) => sId !== id));
    if (selectedDoc?.id === id) {
      const remaining = sources.filter((d) => d.id !== id);
      setSelectedDoc(remaining.length > 0 ? remaining[0] : null);
      setHighlightTarget(null);
    }

    // Refresh project metadata count
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProject.id ? { ...p, doc_count: Math.max(0, p.doc_count - 1) } : p
      )
    );
  };

  const handleToggleActive = (id: string) => {
    setActiveSourceIds((prev) =>
      prev.includes(id) ? prev.filter((sId) => sId !== id) : [...prev, id]
    );
  };

  const handleToggleAll = () => {
    if (activeSourceIds.length === sources.length) {
      setActiveSourceIds([]);
    } else {
      setActiveSourceIds(sources.map((s) => s.id));
    }
  };

  const handleCitationClick = (citation: Citation) => {
    const targetDoc = sources.find((s) => s.id === citation.source_id);
    if (targetDoc) {
      setSelectedDoc(targetDoc);
    }

    setHighlightTarget({
      source_id: citation.source_id,
      start_char: citation.start_char,
      end_char: citation.end_char,
      quote_snippet: citation.quote_snippet,
    });
  };

  const handleSendMessage = async (query: string) => {
    if (!activeProject) return;

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await sendProjectGroundedChat(activeProject.id, query, activeSourceIds, selectedEngine);

      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        sender: 'assistant',
        text: res.answer,
        citations: res.citations,
        evidence_found: res.evidence_found,
        active_sources_consulted: res.active_sources_consulted,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // Update message count in active project
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProject.id ? { ...p, message_count: p.message_count + 2 } : p
        )
      );
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        sender: 'assistant',
        text: `Error processing query: ${err.message}`,
        evidence_found: false,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearChat = async () => {
    if (!activeProject) return;
    if (!confirm('¿Deseas vaciar el historial de conversación de este proyecto?')) return;

    try {
      await clearProjectMessages(activeProject.id);
      setMessages([]);
      setProjects((prev) =>
        prev.map((p) => (p.id === activeProject.id ? { ...p, message_count: 0 } : p))
      );
    } catch (err: any) {
      alert(`Error clearing chat: ${err.message}`);
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100">
      {/* Top Navbar */}
      <header className="relative z-40 h-14 border-b border-slate-800/80 bg-slate-900/80 backdrop-blur px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-indigo-600 rounded-lg shadow-md shadow-indigo-900/40 text-white">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
                OpenFolioLM
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Grounded Core
                </span>
              </h1>
            </div>
          </div>

          {/* Project Switcher Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 text-xs text-slate-200 transition-all cursor-pointer font-medium"
              title="Cambiar proyecto o crear uno nuevo"
            >
              <Folder className="w-3.5 h-3.5 text-indigo-400" />
              <span className="max-w-[160px] truncate font-semibold">
                {activeProject ? activeProject.name : 'Seleccionar Proyecto'}
              </span>
              {activeProject && (
                <span className="text-[10px] text-slate-400 font-mono bg-slate-900/80 px-1.5 py-0.5 rounded border border-slate-700/50">
                  {sources.length} {sources.length === 1 ? 'doc' : 'docs'}
                </span>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {isProjectDropdownOpen && (
              <div className="absolute left-0 mt-2 w-80 bg-slate-900 border border-slate-700/90 rounded-xl shadow-2xl py-2 z-50 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>Proyectos ({projects.length})</span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsProjectDropdownOpen(false);
                      setIsCreateModalOpen(true);
                    }}
                    className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 text-xs font-semibold cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Nuevo
                  </button>
                </div>

                <div className="max-h-60 overflow-y-auto divide-y divide-slate-800/60 my-1">
                  {projects.map((proj) => {
                    const isSelected = activeProject?.id === proj.id;
                    return (
                      <div
                        key={proj.id}
                        onClick={() => handleSelectProject(proj)}
                        className={`px-3 py-2.5 flex items-center justify-between hover:bg-slate-800/80 cursor-pointer transition-colors group ${
                          isSelected ? 'bg-indigo-600/15 border-l-2 border-indigo-500' : ''
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <p className={`text-xs font-medium truncate ${isSelected ? 'text-indigo-300 font-semibold' : 'text-slate-200'}`}>
                            {proj.name}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {proj.doc_count} {proj.doc_count === 1 ? 'fuente' : 'fuentes'} · {proj.message_count} {proj.message_count === 1 ? 'mensaje' : 'mensajes'}
                          </p>
                        </div>
                        {projects.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => handleDeleteProject(e, proj.id)}
                            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 p-1 rounded transition-opacity"
                            title="Eliminar proyecto"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="pt-2 px-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setIsProjectDropdownOpen(false);
                      setIsCreateModalOpen(true);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all shadow-sm cursor-pointer"
                  >
                    <FolderPlus className="w-4 h-4" />
                    Crear Nuevo Proyecto
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Dynamic Engine Switcher */}
        <div className="flex items-center gap-4 text-xs text-slate-400 font-medium">
          <div className="flex items-center gap-2 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700/80">
            <span className="text-[11px] text-slate-400 font-mono">Engine:</span>
            <select
              value={selectedEngine}
              onChange={(e) => {
                setSelectedEngine(e.target.value);
                localStorage.setItem('openfolio_selected_engine', e.target.value);
              }}
              className="bg-transparent text-xs text-indigo-300 font-medium focus:outline-none cursor-pointer max-w-[220px] truncate"
            >
              {models.length === 0 ? (
                <option value="gemini:gemini-3.5-flash" className="bg-slate-900 text-slate-200">
                  Cargando modelos...
                </option>
              ) : (
                models.map((m) => (
                  <option
                    key={m.id}
                    value={m.id}
                    disabled={!m.is_available}
                    className="bg-slate-900 text-slate-200"
                  >
                    {m.provider === 'gemini' ? '⚡ ' : '🔒 '}
                    {m.name} {!m.is_available ? '(Offline)' : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          <span className="hidden sm:flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            Hexagonal Core
          </span>
        </div>
      </header>

      {/* Main Dual-Pane Split Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Pane: Synchronized Document Viewer */}
        <div className="w-1/2 h-full">
          <DocViewer
            document={selectedDoc}
            highlightTarget={highlightTarget}
            onClearHighlight={() => setHighlightTarget(null)}
            projectId={activeProject?.id}
            selectedEngine={selectedEngine}
          />
        </div>

        {/* Right Pane: Sources Checklist & Grounded Chat */}
        <div className="w-1/2 h-full flex flex-col">
          <SourceManager
            sources={sources}
            activeSourceIds={activeSourceIds}
            selectedDocId={selectedDoc?.id || null}
            onToggleActive={handleToggleActive}
            onToggleAll={handleToggleAll}
            onSelectDoc={(doc) => {
              setSelectedDoc(doc);
              setHighlightTarget(null);
            }}
            onUpload={handleUpload}
            onIngestUrl={handleIngestUrl}
            onDelete={handleDeleteSource}
          />
          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            activeSourceCount={activeSourceIds.length}
            onSendMessage={handleSendMessage}
            onCitationClick={handleCitationClick}
            onClearChat={handleClearChat}
          />
        </div>
      </div>

      {/* Create Project Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-white font-semibold text-sm">
                <FolderPlus className="w-4 h-4 text-indigo-400" />
                <span>Nuevo Proyecto de Investigación</span>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProjectSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Nombre del Proyecto <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Ej: Análisis Económico 2026, Novela Edipo..."
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Descripción (opcional)
                </label>
                <textarea
                  rows={3}
                  placeholder="Objetivo o notas sobre los documentos a investigar..."
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!newProjectName.trim() || isSubmittingProject}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-indigo-900/30 disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingProject ? 'Creando...' : 'Crear Proyecto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
