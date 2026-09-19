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
  MessageSquare,
  Share2,
  History,
  Activity,
  Terminal,
} from 'lucide-react';
import {
  SourceDocument,
  ChatMessage,
  HighlightTarget,
  Citation,
  Project,
  ModelEngine,
  ActiveUploadTask,
} from './types';
import { CircularProgressRing } from './components/CircularProgressRing';
import {
  fetchProjects,
  createProject,
  deleteProject,
  fetchProjectSources,
  uploadProjectSourceBackground,
  fetchProjectTasks,
  dismissProjectTask,
  ingestProjectUrl,
  deleteProjectSource,
  fetchProjectMessages,
  clearProjectMessages,
  sendProjectGroundedChat,
  fetchAvailableModels,
  createProjectNote,
  pingModelEngine,
} from './services/api';
import { DocViewer } from './components/DocViewer';
import { SourceManager } from './components/SourceManager';
import { ChatPanel } from './components/ChatPanel';
import { StudioNotebook } from './components/StudioNotebook';
import { NetworkGraphViewer } from './components/NetworkGraphViewer';
import { TimelineViewer } from './components/TimelineViewer';
import { LiteratureDiscoveryModal } from './components/LiteratureDiscoveryModal';
import { SharedConversationView } from './components/SharedConversationView';
import { ResizableSplitter } from './components/ResizableSplitter';
import { SystemLogsModal } from './components/SystemLogsModal';

export const App: React.FC = () => {
  // Public shared conversation viewer (?share=share_xxxx)
  const [shareId, setShareId] = useState<string | null>(() => {
    return new URLSearchParams(window.location.search).get('share');
  });

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
  const [selectedEngine, setSelectedEngine] = useState<string>('gemini:gemini-2.5-flash');
  const [isPinging, setIsPinging] = useState(false);
  const [uploadTasks, setUploadTasks] = useState<ActiveUploadTask[]>([]);

  // Studio & Tab State
  const [docViewerTab, setDocViewerTab] = useState<'reading' | 'dossier' | 'taxonomy'>('reading');
  const [rightPaneMode, setRightPaneMode] = useState<'sources' | 'chat' | 'notebook' | 'network' | 'timeline'>('chat');
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    const saved = localStorage.getItem('openfolio_split_ratio');
    if (saved) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= 15 && parsed <= 85) return parsed;
    }
    const legacy = localStorage.getItem('openfolio_split_layout');
    return legacy === 'chat_focused' ? 35 : 50;
  });

  const mainContainerRef = useRef<HTMLDivElement>(null);

  const handleSplitRatioChange = (ratio: number) => {
    setSplitRatio(ratio);
    localStorage.setItem('openfolio_split_ratio', ratio.toString());
  };
  const [notesCount, setNotesCount] = useState<number>(0);
  const [draftNote, setDraftNote] = useState<{
    title: string;
    content: string;
    source_citation_ids?: string[];
  } | null>(null);
  const [targetNoteId, setTargetNoteId] = useState<string | null>(null);
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);
  const [isLogsModalOpen, setIsLogsModalOpen] = useState<boolean>(false);

  const handleSaveToNotebook = async (
    text: string,
    noteTitle?: string,
    cIds?: string[],
    originPrompt?: string,
    sourceMessageId?: string
  ) => {
    if (!activeProject) return;
    try {
      const created = await createProjectNote(activeProject.id, {
        title: noteTitle || 'Hallazgo de Investigación',
        content: text,
        tags: ['síntesis', 'chat'],
        source_citation_ids: cIds || [],
        origin_prompt: originPrompt,
        source_message_id: sourceMessageId,
      });
      setNotesCount((prev) => prev + 1);
      setTargetNoteId(created.id);
      setRightPaneMode('notebook');
    } catch (err: any) {
      console.error('Error saving note to notebook:', err);
      alert(`Error al guardar en el cuaderno: ${err.message}`);
    }
  };

  const handleNavigateToChat = (msgId?: string) => {
    setRightPaneMode('chat');
    if (msgId) {
      setTargetMessageId(msgId);
    }
  };

  // Literature Discovery Modal
  const [isDiscoveryOpen, setIsDiscoveryOpen] = useState(false);
  const [discoveryInitialQuery, setDiscoveryInitialQuery] = useState<string | undefined>(undefined);

  const handleOpenDiscovery = (query?: string) => {
    setDiscoveryInitialQuery(query);
    setIsDiscoveryOpen(true);
  };

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

    // Periodic model health refresh every 30 seconds
    const healthInterval = setInterval(() => {
      initModels();
    }, 30000);
    return () => clearInterval(healthInterval);
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

  const handlePingActiveModel = async () => {
    if (!selectedEngine) return;
    try {
      setIsPinging(true);
      await pingModelEngine(selectedEngine);
      await initModels();
    } catch (err) {
      console.error('Failed to ping model:', err);
    } finally {
      setIsPinging(false);
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
    setDocViewerTab('reading');
    setDraftNote(null);

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

    // Fetch active or recently completed background tasks for this project
    try {
      const backendTasks = await fetchProjectTasks(project.id);
      const activeOrRecent = backendTasks.filter(
        (t) => t.stage !== 'done' || (t.completed_at && Date.now() - t.completed_at * 1000 < 10000)
      );
      setUploadTasks(
        activeOrRecent.map((t) => ({
          id: t.id,
          name: t.filename,
          size: t.file_size,
          progress: t.progress,
          stage: t.stage,
          statusText: t.status_text,
          error: t.error || undefined,
          document_id: t.document_id,
          startedAt: Math.round(t.created_at * 1000),
        }))
      );
    } catch (err) {
      console.error(`Failed to load tasks for project ${project.id}:`, err);
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

  // Polling loop for active background ingestion tasks with adaptive intervals
  useEffect(() => {
    if (!activeProject) return;

    let isMounted = true;
    let timerId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const backendTasks = await fetchProjectTasks(activeProject.id);
        if (!isMounted) return;

        let hasNewCompleted = false;

        setUploadTasks((prev) => {
          let hasChanges = false;
          const updated = [...prev];

          for (const bt of backendTasks) {
            const existingIdx = updated.findIndex((t) => t.id === bt.id);
            const mappedTask: ActiveUploadTask = {
              id: bt.id,
              name: bt.filename,
              size: bt.file_size,
              progress: bt.progress,
              stage: bt.stage,
              statusText: bt.status_text,
              error: bt.error || undefined,
              document_id: bt.document_id,
              startedAt: Math.round(bt.created_at * 1000),
            };

            if (existingIdx >= 0) {
              const prevTask = updated[existingIdx];
              if (prevTask.stage !== 'done' && bt.stage === 'done') {
                hasNewCompleted = true;
              }
              if (
                prevTask.progress !== bt.progress ||
                prevTask.stage !== bt.stage ||
                prevTask.statusText !== bt.status_text ||
                prevTask.error !== (bt.error || undefined)
              ) {
                hasChanges = true;
                updated[existingIdx] = {
                  ...prevTask,
                  ...mappedTask,
                };
              }
            } else {
              if (bt.stage !== 'done' || (bt.completed_at && Date.now() - bt.completed_at * 1000 < 8000)) {
                hasChanges = true;
                updated.push(mappedTask);
              }
            }
          }

          // If nothing changed, return prev reference so React skips re-render
          if (!hasChanges) {
            return prev;
          }
          return updated;
        });

        if (hasNewCompleted) {
          const freshDocs = await fetchProjectSources(activeProject.id);
          setSources(freshDocs);
          setActiveSourceIds(freshDocs.map((d) => d.id));
          setProjects((prev) =>
            prev.map((p) => (p.id === activeProject.id ? { ...p, doc_count: freshDocs.length } : p))
          );
        }

        // Adaptive interval: 2.5s if active tasks, 15s when idle
        const hasActiveTasks = backendTasks.some(
          (t) => t.stage !== 'done' && t.stage !== 'error'
        );
        const nextInterval = hasActiveTasks ? 2500 : 15000;
        if (isMounted) {
          timerId = setTimeout(poll, nextInterval);
        }
      } catch (err) {
        if (isMounted) {
          timerId = setTimeout(poll, 15000);
        }
      }
    };

    poll();

    return () => {
      isMounted = false;
      clearTimeout(timerId);
    };
  }, [activeProject?.id]);

  const handleUpload = async (file: File) => {
    if (!activeProject) return;
    const tempTaskId = `task_temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newTask: ActiveUploadTask = {
      id: tempTaskId,
      name: file.name,
      size: file.size,
      progress: 5,
      stage: 'uploading',
      statusText: 'Iniciando transferencia...',
      startedAt: Date.now(),
    };

    setUploadTasks((prev) => [newTask, ...prev]);

    try {
      const backendTask = await uploadProjectSourceBackground(
        activeProject.id,
        file,
        (percent, loaded, total) => {
          const loadedMb = (loaded / (1024 * 1024)).toFixed(1);
          const totalMb = (total / (1024 * 1024)).toFixed(1);
          setUploadTasks((prev) =>
            prev.map((t) =>
              t.id === tempTaskId
                ? {
                    ...t,
                    progress: Math.min(100, Math.max(1, percent)),
                    statusText: `Transfiriendo archivo: ${loadedMb} / ${totalMb} MB (${percent}%)`,
                  }
                : t
            )
          );
        },
        selectedEngine
      );

      // Successfully enqueued on server: update task with backend id and status
      setUploadTasks((prev) =>
        prev.map((t) =>
          t.id === tempTaskId
            ? {
                ...t,
                id: backendTask.id,
                progress: backendTask.progress,
                stage: backendTask.stage,
                statusText: backendTask.status_text,
                error: backendTask.error || undefined,
              }
            : t
        )
      );
    } catch (err: any) {
      console.error('Upload error:', err);
      setUploadTasks((prev) =>
        prev.map((t) =>
          t.id === tempTaskId
            ? { ...t, stage: 'error', error: err.message || 'Error al subir el archivo' }
            : t
        )
      );
    }
  };

  const handleDismissUploadTask = async (taskId: string) => {
    if (activeProject && !taskId.startsWith('task_temp_')) {
      try {
        await dismissProjectTask(activeProject.id, taskId);
      } catch (err) {
        console.error('Error dismissing task from backend:', err);
      }
    }
    setUploadTasks((prev) => prev.filter((t) => t.id !== taskId));
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

  const handleToggleBatchActive = (ids: string[], activate: boolean) => {
    setActiveSourceIds((prev) => {
      if (activate) {
        return Array.from(new Set([...prev, ...ids]));
      }
      return prev.filter((id) => !ids.includes(id));
    });
  };

  const handleMetadataUpdated = (updatedDoc: SourceDocument) => {
    setSources((prev) => prev.map((s) => (s.id === updatedDoc.id ? updatedDoc : s)));
    if (selectedDoc?.id === updatedDoc.id) {
      setSelectedDoc(updatedDoc);
    }
  };

  const handleRefreshSources = async () => {
    if (!activeProject) return;
    try {
      const docs = await fetchProjectSources(activeProject.id);
      setSources(docs);
      if (selectedDoc) {
        const refreshedSelected = docs.find((d) => d.id === selectedDoc.id);
        if (refreshedSelected) setSelectedDoc(refreshedSelected);
      }
    } catch (err) {
      console.error('Failed to refresh sources:', err);
    }
  };

  const handleCitationClick = (citation: Citation) => {
    const targetDoc = sources.find((s) => s.id === citation.source_id);
    if (targetDoc) {
      setSelectedDoc(targetDoc);
    }
    setDocViewerTab('reading');
    setRightPaneMode('chat');

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
      initModels();
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

  const handleSourcesAdded = (newDocs: SourceDocument[]) => {
    setSources((prev) => [...newDocs, ...prev]);
    setActiveSourceIds((prev) => [...prev, ...newDocs.map((d) => d.id)]);
    if (newDocs.length > 0) setSelectedDoc(newDocs[0]);
    if (activeProject) {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProject.id ? { ...p, doc_count: p.doc_count + newDocs.length } : p
        )
      );
    }
  };

  const activeModel = models.find((m) => m.id === selectedEngine);

  if (shareId) {
    return (
      <SharedConversationView
        shareId={shareId}
        onBackToWorkspace={() => {
          window.history.replaceState({}, '', window.location.pathname);
          setShareId(null);
        }}
      />
    );
  }

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

        {/* Dynamic Engine Switcher & Health Monitor */}
        <div className="flex items-center gap-3 text-xs text-slate-400 font-medium">
          <div className="flex items-center gap-2 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700/80">
            <span className="text-[11px] text-slate-400 font-mono">Engine:</span>
            <select
              value={selectedEngine}
              onChange={(e) => {
                setSelectedEngine(e.target.value);
                localStorage.setItem('openfolio_selected_engine', e.target.value);
              }}
              className="bg-transparent text-xs text-indigo-300 font-medium focus:outline-none cursor-pointer max-w-[200px] truncate"
            >
              {models.length === 0 ? (
                <option value="gemini:gemini-2.5-flash" className="bg-slate-900 text-slate-200">
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

            {/* Active Model Health / Demand Status Badge */}
            {activeModel && (
              <div
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono border transition-all ${
                  activeModel.status === 'high_demand'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                    : activeModel.status === 'offline'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                }`}
                title={
                  activeModel.status === 'high_demand'
                    ? `Picos de alta demanda en Google Cloud (${activeModel.last_error || 'HTTP 503'}). Reintentos con backoff y fallback activos.`
                    : activeModel.status === 'offline'
                    ? `Modelo offline: ${activeModel.last_error || 'Sin conexión'}`
                    : `Modelo operativo y disponible${activeModel.latency_ms ? ` · Latencia: ${activeModel.latency_ms}ms` : ''}`
                }
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    activeModel.status === 'high_demand'
                      ? 'bg-amber-400'
                      : activeModel.status === 'offline'
                      ? 'bg-rose-400'
                      : 'bg-emerald-400'
                  }`}
                />
                <span>
                  {activeModel.status === 'high_demand'
                    ? 'Alta Demanda'
                    : activeModel.status === 'offline'
                    ? 'Offline'
                    : activeModel.latency_ms
                    ? `${activeModel.latency_ms}ms`
                    : 'Operativo'}
                </span>
              </div>
            )}

            {/* Ping button to check latency/demand on demand */}
            <button
              type="button"
              onClick={handlePingActiveModel}
              disabled={isPinging || !selectedEngine}
              className="text-slate-400 hover:text-indigo-300 transition-colors p-0.5 cursor-pointer disabled:opacity-40 ml-0.5"
              title="Comprobar demanda y latencia en tiempo real (Ping)"
            >
              <Activity className={`w-3.5 h-3.5 ${isPinging ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
          </div>

          {/* Server Logs Console Button */}
          <button
            type="button"
            onClick={() => setIsLogsModalOpen(true)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white border border-slate-700/80 transition-all text-xs font-medium cursor-pointer shadow-sm shrink-0"
            title="Abrir consola de logs en tiempo real del servidor (openfolio.log)"
          >
            <Terminal className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Logs</span>
          </button>
        </div>
      </header>

      {/* Main Dual-Pane Split Layout */}
      <div ref={mainContainerRef} className="flex-1 flex overflow-hidden relative">
        {/* Left Pane: Synchronized Document Viewer & Dossier */}
        <div
          style={{ width: `${splitRatio}%` }}
          className="h-full shrink-0 overflow-hidden"
        >
          <DocViewer
            document={selectedDoc}
            highlightTarget={highlightTarget}
            onClearHighlight={() => setHighlightTarget(null)}
            projectId={activeProject?.id}
            selectedEngine={selectedEngine}
            allSources={sources}
            activeTab={docViewerTab}
            onTabChange={setDocViewerTab}
            onExploreTopic={handleOpenDiscovery}
            onMetadataUpdated={handleMetadataUpdated}
          />
        </div>

        {/* Resizable Draggable Splitter with col-resize */}
        <ResizableSplitter
          splitPercent={splitRatio}
          onSplitChange={handleSplitRatioChange}
          onReset={() => handleSplitRatioChange(50)}
          containerRef={mainContainerRef}
        />

        {/* Right Pane: Multi-lane Studio (Chat & Grounding vs Cuaderno de Síntesis vs Bibliografía) */}
        <div
          style={{ width: `${100 - splitRatio}%` }}
          className="h-full flex flex-col bg-slate-950 overflow-hidden shrink-0"
        >
          {/* Lane Switcher Navigation */}
          <div className="flex items-center justify-between px-4 py-2 bg-slate-900/60 border-b border-slate-800 shrink-0 gap-2">
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800/80 overflow-x-auto scrollbar-none">
              <button
                type="button"
                onClick={() => setRightPaneMode('sources')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition cursor-pointer whitespace-nowrap ${
                  rightPaneMode === 'sources'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Ver compendio completo de bibliografía y fuentes"
              >
                <Layers className="w-3.5 h-3.5 text-indigo-300" />
                <span>Bibliografía</span>
                <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-slate-800 text-slate-300 font-mono">
                  {sources.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setRightPaneMode('chat')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition cursor-pointer whitespace-nowrap ${
                  rightPaneMode === 'chat'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Chat de Evidencia</span>
              </button>
              <button
                type="button"
                onClick={() => setRightPaneMode('notebook')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition cursor-pointer whitespace-nowrap ${
                  rightPaneMode === 'notebook'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5 text-amber-300" />
                <span>Cuaderno de Síntesis</span>
                {notesCount > 0 && (
                  <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-indigo-900 text-indigo-300 font-mono">
                    {notesCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setRightPaneMode('network')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition cursor-pointer whitespace-nowrap ${
                  rightPaneMode === 'network'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Share2 className="w-3.5 h-3.5 text-indigo-300" />
                <span>Red Semántica</span>
              </button>
              <button
                type="button"
                onClick={() => setRightPaneMode('timeline')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition cursor-pointer whitespace-nowrap ${
                  rightPaneMode === 'timeline'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <History className="w-3.5 h-3.5 text-indigo-300" />
                <span>Cronología</span>
              </button>
            </div>

            {/* Background uploads indicator badge */}
            {uploadTasks.length > 0 && (
              <div
                onClick={() => setRightPaneMode('sources')}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-950/90 border border-indigo-500/40 text-[10px] text-indigo-200 shadow-md cursor-pointer hover:bg-indigo-900/90 transition animate-in fade-in shrink-0"
                title="Hacé clic para ver el estado de las fuentes en la bibliografía"
              >
                <CircularProgressRing
                  progress={uploadTasks[0].progress}
                  stage={uploadTasks[0].stage}
                  size="xs"
                />
                <span className="truncate max-w-[120px] sm:max-w-[200px] font-medium font-mono">
                  {uploadTasks[0].stage === 'done'
                    ? `¡Listo! ${uploadTasks[0].name}`
                    : `${uploadTasks[0].progress}% ${uploadTasks[0].name}`}
                </span>
                {uploadTasks.length > 1 && (
                  <span className="text-indigo-400 text-[9px] font-mono">
                    +{uploadTasks.length - 1}
                  </span>
                )}
              </div>
            )}

            {/* Split Layout Presets */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800/80 shrink-0">
              <button
                type="button"
                onClick={() => handleSplitRatioChange(50)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition cursor-pointer ${
                  Math.abs(splitRatio - 50) < 2
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Distribución Equilibrada: 50% Visor / 50% Estudio (Doble clic en el divisor también centra)"
              >
                50:50
              </button>
              <button
                type="button"
                onClick={() => handleSplitRatioChange(30)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition cursor-pointer ${
                  Math.abs(splitRatio - 30) < 4
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Foco Chat: 30% Visor / 70% Chat y Estudio"
              >
                Foco Chat
              </button>
            </div>
          </div>

          {/* Persistent SourceManager Panel */}
          <div className={`h-full flex-1 overflow-hidden ${rightPaneMode === 'sources' ? 'flex flex-col' : 'hidden'}`}>
            <SourceManager
              projectId={activeProject?.id}
              sources={sources}
              activeSourceIds={activeSourceIds}
              selectedDocId={selectedDoc?.id || null}
              onToggleActive={handleToggleActive}
              onToggleAll={handleToggleAll}
              onToggleBatchActive={handleToggleBatchActive}
              onSelectDoc={(doc) => {
                setSelectedDoc(doc);
                setHighlightTarget(null);
                setDocViewerTab('reading');
              }}
              onOpenDossier={(doc) => {
                setSelectedDoc(doc);
                setDocViewerTab('dossier');
              }}
              onOpenTaxonomy={(doc) => {
                setSelectedDoc(doc);
                setDocViewerTab('taxonomy');
              }}
              onUpload={handleUpload}
              onIngestUrl={handleIngestUrl}
              onSourcesAdded={handleSourcesAdded}
              onOpenDiscovery={() => handleOpenDiscovery()}
              onDelete={handleDeleteSource}
              onRefreshSources={handleRefreshSources}
              selectedEngine={selectedEngine}
              isFullView={true}
              onNavigateToChat={() => setRightPaneMode('chat')}
              uploadTasks={uploadTasks}
              onDismissUploadTask={handleDismissUploadTask}
              onOpenLogs={() => setIsLogsModalOpen(true)}
            />
          </div>

          {/* Persistent Chat Panel */}
          <div className={`h-full flex-1 overflow-hidden ${rightPaneMode === 'chat' ? 'flex flex-col' : 'hidden'}`}>
            <ChatPanel
              projectId={activeProject?.id}
              projectName={activeProject?.name}
              messages={messages}
              isLoading={isLoading}
              activeSourceCount={activeSourceIds.length}
              totalSourcesCount={sources.length}
              onOpenBibliography={() => setRightPaneMode('sources')}
              onSendMessage={handleSendMessage}
              onCitationClick={handleCitationClick}
              onClearChat={handleClearChat}
              onSaveToNotebook={handleSaveToNotebook}
              targetMessageId={targetMessageId}
              onClearTargetMessage={() => setTargetMessageId(null)}
              onMessagesImported={(newMsgs) => {
                setMessages((prev) => [...prev, ...newMsgs]);
                if (activeProject) {
                  setProjects((prev) =>
                    prev.map((p) =>
                      p.id === activeProject.id
                        ? { ...p, message_count: (p.message_count || 0) + newMsgs.length }
                        : p
                    )
                  );
                }
              }}
            />
          </div>

          {rightPaneMode === 'notebook' && (
            <StudioNotebook
              projectId={activeProject?.id || 'default'}
              projectName={activeProject?.name || 'Investigación'}
              onNotesCountChange={setNotesCount}
              targetNoteId={targetNoteId}
              onClearTargetNote={() => setTargetNoteId(null)}
              initialNewNote={draftNote}
              onClearInitialNote={() => setDraftNote(null)}
              onNavigateToChat={handleNavigateToChat}
            />
          )}

          {rightPaneMode === 'network' && (
            <NetworkGraphViewer
              projectId={activeProject?.id || 'default'}
              selectedDocId={selectedDoc?.id || null}
              onSelectDocument={(docId) => {
                const doc = sources.find((s) => s.id === docId);
                if (doc) {
                  setSelectedDoc(doc);
                  setHighlightTarget(null);
                }
              }}
            />
          )}

          {rightPaneMode === 'timeline' && (
            <TimelineViewer
              projectId={activeProject?.id || 'default'}
              selectedDocId={selectedDoc?.id || null}
              selectedEngine={selectedEngine}
              onSelectDocument={(docId) => {
                const doc = sources.find((s) => s.id === docId);
                if (doc) {
                  setSelectedDoc(doc);
                  setHighlightTarget(null);
                }
              }}
            />
          )}
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

      {/* Literature Discovery Modal (Compendio & Modules seed search) */}
      {activeProject && (
        <LiteratureDiscoveryModal
          projectId={activeProject.id}
          isOpen={isDiscoveryOpen}
          initialQuery={discoveryInitialQuery}
          selectedEngine={selectedEngine}
          onClose={() => {
            setIsDiscoveryOpen(false);
            setDiscoveryInitialQuery(undefined);
          }}
          onSourcesAdded={handleSourcesAdded}
        />
      )}
      {/* Real-time System Diagnostics & Logs Modal */}
      <SystemLogsModal
        isOpen={isLogsModalOpen}
        onClose={() => setIsLogsModalOpen(false)}
      />
    </div>
  );
};

export default App;
