import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import {
  Folder,
  FolderPlus,
  Trash2,
  ChevronDown,
  X,
  Activity,
} from 'lucide-react';
import {
  SourceDocument,
  ChatMessage,
  HighlightTarget,
  Citation,
  Project,
  ActiveUploadTask,
} from './types';
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
  createProjectNote,
  autoclassifyAllSources,
} from './services/api';
import { useModelEngines } from './hooks/useModelEngines';
const StudioNotebook = React.lazy(() => import('./components/StudioNotebook').then(m => ({ default: m.StudioNotebook })));
const NetworkGraphViewer = React.lazy(() => import('./components/NetworkGraphViewer').then(m => ({ default: m.NetworkGraphViewer })));
const TimelineViewer = React.lazy(() => import('./components/TimelineViewer').then(m => ({ default: m.TimelineViewer })));
const LiteratureDiscoveryModal = React.lazy(() => import('./components/LiteratureDiscoveryModal').then(m => ({ default: m.LiteratureDiscoveryModal })));
const SharedConversationView = React.lazy(() => import('./components/SharedConversationView').then(m => ({ default: m.SharedConversationView })));
const SystemLogsModal = React.lazy(() => import('./components/SystemLogsModal').then(m => ({ default: m.SystemLogsModal })));
import { ArchivalIndex, ArchivalDocument } from './components/archival/ArchivalIndex';
import {
  ArchivalSplitViewer,
  DocumentSourceChunk,
  GroundedChatMessage,
} from './components/archival/ArchivalSplitViewer';

export const formatShortModelName = (name: string): string => {
  if (!name) return 'Modelo';
  // Strip provider prefixes e.g. "ollama:qwen2.5:3b" or "google/"
  let clean = name.replace(/^(ollama|google|openai|anthropic|groq|openrouter):/i, '').trim();
  // Strip parenthetical text like "(3.1B)" or "(Offline)"
  clean = clean.replace(/\s*\([^)]*\)/g, '').trim();
  // Strip tags like ":latest" or ":3b" or ":8b"
  clean = clean.replace(/:[a-zA-Z0-9_.-]+/g, '').trim();

  // Handle GPT models specifically: "gpt-4o", "gpt-4.5-turbo", "gpt-4o-mini", "chatgpt-4o"
  const gptMatch = clean.match(/^(?:chat)?gpt[\s\-_]*(\d+(?:\.\d+)?(?:o)?)/i);
  if (gptMatch) {
    return `GPT-${gptMatch[1]}`;
  }

  // Match model name followed by version numbers e.g. "gemini 2.5", "claude-3.5", "qwen2.5", "llama3.2", "deepseek-r1"
  const matchWithVersion = clean.match(/^([A-Za-z]+)[\s\-_]*([vr])?(\d+(?:\.\d+)?)/i);
  if (matchWithVersion) {
    const brand = matchWithVersion[1];
    const formattedBrand = brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
    const prefix = matchWithVersion[2] ? matchWithVersion[2].toUpperCase() : '';
    const version = matchWithVersion[3];
    return prefix ? `${formattedBrand} ${prefix}${version}` : `${formattedBrand} ${version}`;
  }

  // Fallback: take first two words or first 14 chars
  const words = clean.split(/[\s\-_]+/);
  if (words.length >= 2) {
    return `${words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase()} ${words[1]}`;
  }
  return clean.slice(0, 14);
};

export const App: React.FC = () => {
  // Public shared conversation viewer (?share=share_xxxx)
  const [shareId, setShareId] = useState<string | null>(() => {
    return new URLSearchParams(window.location.search).get('share');
  });

  // Archival Navigation Tab
  const [archivalTab, setArchivalTab] = useState<'index' | 'split' | 'notebook' | 'network' | 'timeline'>('index');
  const archivalFileInputRef = useRef<HTMLInputElement>(null);

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
  const {
    models,
    selectedEngine,
    isPinging,
    setSelectedEngine,
    handlePingActiveModel,
    refreshModels,
  } = useModelEngines();
  const [uploadTasks, setUploadTasks] = useState<ActiveUploadTask[]>([]);

  // Studio & Tab State
  const [docViewerTab, setDocViewerTab] = useState<'reading' | 'dossier' | 'taxonomy'>('reading');
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
      setArchivalTab('notebook');
    } catch (err: any) {
      console.error('Error saving note to notebook:', err);
      alert(`Error al guardar en el cuaderno: ${err.message}`);
    }
  };

  const handleNavigateToChat = (msgId?: string) => {
    setArchivalTab('split');
    if (!selectedDoc && sources.length > 0) {
      setSelectedDoc(sources[0]);
    }
    if (msgId) {
      setTargetMessageId(msgId);
    }
  };

  const handleNavigateToSourceFromNote = (sourceCitationId?: string, citationIndex?: number) => {
    let targetDoc = sources.find((s) => s.id === sourceCitationId);
    let matchedCitation: Citation | undefined;

    // Search messages for matching citation if sourceCitationId is a chunkId or if citationIndex is given
    for (const msg of messages) {
      if (msg.citations) {
        const found = msg.citations.find(
          (c) =>
            (sourceCitationId && c.chunk_id === sourceCitationId) ||
            (sourceCitationId && c.source_id === sourceCitationId) ||
            (citationIndex !== undefined && c.index === citationIndex)
        );
        if (found) {
          matchedCitation = found;
          if (!targetDoc) {
            targetDoc = sources.find((s) => s.id === found.source_id);
          }
          break;
        }
      }
    }

    if (matchedCitation) {
      handleCitationClick(matchedCitation);
      return;
    }

    if (targetDoc) {
      setSelectedDoc(targetDoc);
    } else if (!selectedDoc && sources.length > 0) {
      setSelectedDoc(sources[0]);
    }
    setArchivalTab('split');
    setDocViewerTab('reading');
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

  // Initial Load: Fetch projects
  useEffect(() => {
    initProjects();
  }, []);

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
    setArchivalTab('split');
    setDocViewerTab('reading');

    setHighlightTarget({
      source_id: citation.source_id,
      start_char: citation.start_char,
      end_char: citation.end_char,
      quote_snippet: citation.quote_snippet,
      citation_index: citation.index,
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
      refreshModels();
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

  // Archival derived data and handlers
  const archivalDocuments: ArchivalDocument[] = useMemo(() => {
    return sources.map((s) => {
      const meta = s.metadata || {};
      const authors = meta.author
        ? [meta.author]
        : (meta.authors || ['Autor no especificado']);
      let year = new Date(s.created_at || Date.now()).getFullYear();
      if (meta.year_or_era) {
        const parsed = parseInt(meta.year_or_era, 10);
        if (!isNaN(parsed)) year = parsed;
      }
      const fileSize = s.char_count
        ? `${(s.char_count / 1024).toFixed(1)} KB`
        : 'N/A';

      return {
        id: s.id,
        title: meta.title || s.filename || 'Documento sin título',
        authors: Array.isArray(authors) ? authors : [String(authors)],
        year,
        doi: meta.doi || undefined,
        openAccess: Boolean(meta.source_url || meta.doi || meta.is_open_access),
        status: 'indexed' as const,
        chunkCount: Math.max(1, Math.ceil((s.char_count || 1000) / 1200)),
        fileSize,
        addedAt: s.created_at
          ? new Date(s.created_at).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0],
        category: meta.category || undefined,
        tags: Array.isArray(meta.tags) ? meta.tags : undefined,
        isAudio: Boolean(meta.is_audio || s.mime_type?.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(s.filename)),
        isYouTube: Boolean(meta.is_youtube),
        isCode: Boolean(meta.is_code || meta.is_repo),
        rawSource: s,
      };
    });
  }, [sources]);

  const archivalChunks: DocumentSourceChunk[] = useMemo(() => {
    if (!selectedDoc || !selectedDoc.raw_markdown) return [];
    const raw = selectedDoc.raw_markdown;
    const paragraphs = raw.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    if (paragraphs.length === 0) {
      return [
        {
          id: `${selectedDoc.id}-1`,
          chunkIndex: 1,
          pageNumber: 1,
          content: raw,
        },
      ];
    }
    return paragraphs.map((p, idx) => {
      const headingMatch = p.match(/^#{1,4}\s+(.+)$/m);
      const heading = headingMatch ? [headingMatch[1]] : undefined;
      const pageMatch = p.match(/<!-- PAGE: (\d+) -->/);
      const pageNum = pageMatch ? parseInt(pageMatch[1], 10) : Math.floor(idx / 4) + 1;
      const cleanContent = p.replace(/<!-- PAGE: \d+ -->/g, '').trim();

      return {
        id: `${selectedDoc.id}-${idx + 1}`,
        chunkIndex: idx + 1,
        pageNumber: pageNum,
        headingPath: heading,
        content: cleanContent,
      };
    });
  }, [selectedDoc]);

  const groundedMessages: GroundedChatMessage[] = useMemo(() => {
    return messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      text: m.text,
      factualScore: m.factual_score ?? (m.evidence_found ? 0.98 : undefined),
      timestamp: m.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      citations: m.citations?.map((c) => ({
        index: c.index,
        chunkId: c.chunk_id,
        sourceFilename: c.source_filename,
        pageNumber: c.page_number,
        snippet: c.quote_snippet,
        sourceId: c.source_id,
        startChar: c.start_char,
        endChar: c.end_char,
      })),
    }));
  }, [messages]);

  const selectedDocAuthors = useMemo(() => {
    if (!selectedDoc?.metadata) return ['Autor no especificado'];
    if (selectedDoc.metadata.author) return [selectedDoc.metadata.author];
    if (Array.isArray(selectedDoc.metadata.authors)) return selectedDoc.metadata.authors;
    return ['Autor no especificado'];
  }, [selectedDoc]);

  const handleArchivalSelectDoc = (
    doc: ArchivalDocument,
    tab: 'reading' | 'dossier' | 'taxonomy' = 'reading'
  ) => {
    const found = sources.find((s) => s.id === doc.id);
    if (found) {
      setSelectedDoc(found);
      setHighlightTarget(null);
      setDocViewerTab(tab);
      setArchivalTab('split');
    }
  };

  const handleArchivalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUpload(e.target.files[0]);
      e.target.value = '';
    }
  };

  if (shareId) {
    return (
      <Suspense fallback={null}>
        <SharedConversationView
          shareId={shareId}
          onBackToWorkspace={() => {
            window.history.replaceState({}, '', window.location.pathname);
            setShareId(null);
          }}
        />
      </Suspense>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#F9F9F8] dark:bg-[#121214] text-[#1A1A1A] dark:text-[#EDEDED] font-sans antialiased">
      {/* Archival Brutalist Top Header */}
          <header className="h-12 border-b border-[#E0E0DC] dark:border-[#2A2A2E] bg-[#F9F9F8] dark:bg-[#121214] px-4 flex items-center justify-between shrink-0 select-none text-xs">
            {/* Left: Brand & Project Selector */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold tracking-wider text-[#1A1A1A] dark:text-[#EDEDED]">
                  OpenFolioLM
                </span>
              </div>

              <span className="text-[#E0E0DC] dark:text-[#2A2A2E]">|</span>

              {/* Project Switcher Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
                  className="flex items-center gap-2 px-2.5 py-1 bg-[#EBEBE8] dark:bg-[#1E1E22] hover:bg-[#E0E0DC] dark:hover:bg-[#2A2A2E] border border-[#E0E0DC] dark:border-[#2A2A2E] text-xs font-mono text-[#1A1A1A] dark:text-[#EDEDED] transition-colors cursor-pointer"
                  title="Cambiar proyecto o crear uno nuevo"
                >
                  <Folder className="w-3.5 h-3.5 text-[#1A56DB] dark:text-[#60A5FA]" />
                  <span className="max-w-[140px] truncate font-semibold">
                    {activeProject ? activeProject.name : 'Seleccionar Proyecto'}
                  </span>
                  <span className="text-[10px] text-[#666666] dark:text-[#888888] tabular-nums">
                    ({sources.length} {sources.length === 1 ? 'fuente' : 'fuentes'})
                  </span>
                  <ChevronDown className="w-3 h-3 text-[#666666] dark:text-[#888888]" />
                </button>

                {isProjectDropdownOpen && (
                  <div className="absolute left-0 mt-1 w-72 bg-[#F9F9F8] dark:bg-[#121214] border border-[#E0E0DC] dark:border-[#2A2A2E] shadow-xl py-1 z-50 animate-in fade-in duration-100 font-mono text-xs">
                    <div className="px-3 py-1.5 text-[10px] font-bold text-[#666666] dark:text-[#888888] uppercase tracking-wider flex items-center justify-between border-b border-[#E0E0DC] dark:border-[#2A2A2E]">
                      <span>CATÁLOGOS ({projects.length})</span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsProjectDropdownOpen(false);
                          setIsCreateModalOpen(true);
                        }}
                        className="text-[#1A56DB] dark:text-[#60A5FA] hover:underline font-bold cursor-pointer"
                      >
                        + NUEVO
                      </button>
                    </div>

                    <div className="max-h-60 overflow-y-auto divide-y divide-[#E0E0DC] dark:divide-[#2A2A2E]">
                      {projects.map((proj) => {
                        const isSelected = activeProject?.id === proj.id;
                        return (
                          <div
                            key={proj.id}
                            onClick={() => handleSelectProject(proj)}
                            className={`px-3 py-2 flex items-center justify-between hover:bg-[#EBEBE8] dark:hover:bg-[#1E1E22] cursor-pointer transition-colors ${
                              isSelected ? 'bg-[#EBEBE8] dark:bg-[#1E1E22] border-l-2 border-[#1A56DB] dark:border-[#60A5FA]' : ''
                            }`}
                          >
                            <div className="min-w-0 pr-2">
                              <p className={`text-xs truncate ${isSelected ? 'font-bold text-[#1A56DB] dark:text-[#60A5FA]' : 'text-[#1A1A1A] dark:text-[#EDEDED]'}`}>
                                {proj.name}
                              </p>
                              <p className="text-[10px] text-[#666666] dark:text-[#888888] tabular-nums">
                                {proj.doc_count} docs · {proj.message_count} msgs
                              </p>
                            </div>
                            {projects.length > 1 && (
                              <button
                                type="button"
                                onClick={(e) => handleDeleteProject(e, proj.id)}
                                className="text-[#999999] hover:text-rose-600 p-1 transition-colors"
                                title="Eliminar proyecto"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Middle: Navigation Lanes */}
            <nav className="flex items-center gap-1 font-mono text-xs">
              <button
                type="button"
                onClick={() => setArchivalTab('index')}
                className={`px-3 py-1 transition-colors cursor-pointer border ${
                  archivalTab === 'index'
                    ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] border-[#1A1A1A] dark:border-[#EDEDED] font-bold'
                    : 'bg-transparent text-[#666666] dark:text-[#888888] border-transparent hover:border-[#E0E0DC] dark:hover:border-[#2A2A2E]'
                }`}
              >
                01 Catálogo
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!selectedDoc && sources.length > 0) {
                    setSelectedDoc(sources[0]);
                  }
                  setArchivalTab('split');
                }}
                className={`px-3 py-1 transition-colors cursor-pointer border ${
                  archivalTab === 'split'
                    ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] border-[#1A1A1A] dark:border-[#EDEDED] font-bold'
                    : 'bg-transparent text-[#666666] dark:text-[#888888] border-transparent hover:border-[#E0E0DC] dark:hover:border-[#2A2A2E]'
                }`}
              >
                02 Lectura y Chat
                {selectedDoc && (
                  <span className="ml-1.5 opacity-70 truncate max-w-[120px] inline-block align-bottom font-sans text-[11px]">
                    · {selectedDoc.metadata?.title || selectedDoc.filename}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setArchivalTab('notebook')}
                className={`px-3 py-1 transition-colors cursor-pointer border ${
                  archivalTab === 'notebook'
                    ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] border-[#1A1A1A] dark:border-[#EDEDED] font-bold'
                    : 'bg-transparent text-[#666666] dark:text-[#888888] border-transparent hover:border-[#E0E0DC] dark:hover:border-[#2A2A2E]'
                }`}
              >
                03 Cuaderno
                {notesCount > 0 && <span className="ml-1 text-[10px] tabular-nums">({notesCount})</span>}
              </button>
              <button
                type="button"
                onClick={() => setArchivalTab('timeline')}
                className={`px-3 py-1 transition-colors cursor-pointer border ${
                  archivalTab === 'timeline'
                    ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] border-[#1A1A1A] dark:border-[#EDEDED] font-bold'
                    : 'bg-transparent text-[#666666] dark:text-[#888888] border-transparent hover:border-[#E0E0DC] dark:hover:border-[#2A2A2E]'
                }`}
              >
                04 Cronología
              </button>
              <button
                type="button"
                onClick={() => setArchivalTab('network')}
                className={`px-3 py-1 transition-colors cursor-pointer border ${
                  archivalTab === 'network'
                    ? 'bg-[#1A1A1A] text-[#F9F9F8] dark:bg-[#EDEDED] dark:text-[#121214] border-[#1A1A1A] dark:border-[#EDEDED] font-bold'
                    : 'bg-transparent text-[#666666] dark:text-[#888888] border-transparent hover:border-[#E0E0DC] dark:hover:border-[#2A2A2E]'
                }`}
              >
                05 Red Semántica
              </button>
            </nav>

            {/* Right: Engine Selector, Health Monitor, Logs, and UI Mode Switch */}
            <div className="flex items-center gap-2 font-mono text-xs">
              <div className="flex items-center gap-1.5 bg-[#EBEBE8] dark:bg-[#1E1E22] border border-[#E0E0DC] dark:border-[#2A2A2E] px-2 py-0.5">
                <span className="text-[10px] text-[#666666] dark:text-[#888888]">Modelo:</span>
                <div className="relative inline-flex items-center">
                  <span className="text-[11px] font-mono text-[#1A56DB] dark:text-[#60A5FA] font-medium pr-3.5 pointer-events-none select-none">
                    {formatShortModelName(activeModel?.name || selectedEngine)}
                  </span>
                  <ChevronDown className="w-2.5 h-2.5 text-[#666666] dark:text-[#888888] absolute right-0 pointer-events-none" />
                  <select
                    value={selectedEngine}
                    onChange={(e) => {
                      setSelectedEngine(e.target.value);
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-xs"
                    title="Seleccionar modelo"
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id} className="bg-[#F9F9F8] dark:bg-[#121214] text-[#1A1A1A] dark:text-[#EDEDED]">
                        {m.name} {!m.is_available ? '(Offline)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {activeModel && (
                  <span
                    className={`text-[9px] px-1 py-0.2 border ${
                      activeModel.status === 'healthy'
                        ? 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400'
                        : activeModel.status === 'high_demand'
                        ? 'border-amber-600/40 text-amber-700 dark:text-amber-400'
                        : 'border-rose-600/40 text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {activeModel.status === 'healthy'
                      ? `${activeModel.latency_ms ? `${activeModel.latency_ms}ms` : 'OPERATIVO'}`
                      : activeModel.status === 'high_demand'
                      ? 'DEMANDA'
                      : 'OFFLINE'}
                  </span>
                )}

                <button
                  type="button"
                  onClick={handlePingActiveModel}
                  disabled={isPinging}
                  className="text-[#666666] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] p-0.5 cursor-pointer disabled:opacity-40"
                  title="Ping latencia"
                >
                  <Activity className={`w-3 h-3 ${isPinging ? 'animate-spin text-[#1A56DB]' : ''}`} />
                </button>
              </div>

              {/* Logs Console Button */}
              <button
                type="button"
                onClick={() => setIsLogsModalOpen(true)}
                className="px-2.5 py-1 bg-[#EBEBE8] dark:bg-[#1E1E22] hover:bg-[#E0E0DC] dark:hover:bg-[#2A2A2E] border border-[#E0E0DC] dark:border-[#2A2A2E] text-xs font-mono text-[#1A1A1A] dark:text-[#EDEDED] cursor-pointer"
                title="Consola de logs del servidor"
              >
                Logs
              </button>
            </div>
          </header>

          {/* Archival Main Content */}
          <main className="flex-1 overflow-hidden relative">
            {archivalTab === 'index' && (
              <ArchivalIndex
                documents={archivalDocuments}
                selectedDocId={selectedDoc?.id || null}
                activeSourceIds={activeSourceIds}
                projectId={activeProject?.id}
                selectedEngine={selectedEngine}
                uploadTasks={uploadTasks}
                onSelectDocument={(doc, tab) => handleArchivalSelectDoc(doc, tab)}
                onOpenDossier={(doc) => handleArchivalSelectDoc(doc, 'dossier')}
                onOpenTaxonomy={(doc) => handleArchivalSelectDoc(doc, 'taxonomy')}
                onDeleteDocument={handleDeleteSource}
                onUploadFile={handleUpload}
                onIngestUrl={handleIngestUrl}
                onOpenDiscovery={() => handleOpenDiscovery()}
                onSourcesAdded={handleSourcesAdded}
                onAutoclassifyAll={async () => {
                  if (!activeProject) return;
                  await autoclassifyAllSources(activeProject.id, selectedEngine);
                  await handleRefreshSources();
                }}
                onToggleActive={handleToggleActive}
                onToggleAll={handleToggleAll}
                onDismissUploadTask={handleDismissUploadTask}
                onRefreshSources={handleRefreshSources}
              />
            )}

            {archivalTab === 'split' && (
              selectedDoc ? (
                <ArchivalSplitViewer
                  document={selectedDoc}
                  documentTitle={selectedDoc.metadata?.title || selectedDoc.filename || 'Documento sin título'}
                  documentAuthors={selectedDocAuthors}
                  documentDoi={selectedDoc.metadata?.doi}
                  chunks={archivalChunks}
                  messages={groundedMessages}
                  rawMessages={messages}
                  onSendMessage={handleSendMessage}
                  onBackToIndex={() => setArchivalTab('index')}
                  isLoading={isLoading}
                  projectId={activeProject?.id}
                  projectName={activeProject?.name}
                  selectedEngine={selectedEngine}
                  allSources={sources}
                  activeSourceIds={activeSourceIds}
                  onToggleActiveSource={handleToggleActive}
                  onToggleAllSources={handleToggleAll}
                  onSetOnlyThisSourceActive={(id) => setActiveSourceIds([id])}
                  onSetAllSourcesActive={() => setActiveSourceIds(sources.map((s) => s.id))}
                  activeTab={docViewerTab}
                  onTabChange={(tab) => setDocViewerTab(tab)}
                  onExploreTopic={handleSendMessage}
                  onMetadataUpdated={handleMetadataUpdated}
                  onClearChat={handleClearChat}
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
                  onSaveToNotebook={handleSaveToNotebook}
                  highlightTarget={highlightTarget}
                  onClearHighlight={() => setHighlightTarget(null)}
                  onSelectDocument={(doc) => {
                    setSelectedDoc(doc);
                    setDocViewerTab('reading');
                  }}
                  onCitationClick={handleCitationClick}
                  targetMessageId={targetMessageId}
                  onClearTargetMessage={() => setTargetMessageId(null)}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-[#F9F9F8] dark:bg-[#121214] select-none">
                  <div className="p-6 border border-dashed border-[#E0E0DC] dark:border-[#2A2A2E] max-w-md space-y-3 font-mono">
                    <p className="text-xs font-bold text-[#1A1A1A] dark:text-[#EDEDED] uppercase tracking-wide">
                      Ningún documento seleccionado
                    </p>
                    <p className="text-xs text-[#666666] dark:text-[#888888] font-sans">
                      Seleccioná un documento del catálogo de fuentes para abrir el visor sincronizado de lectura y chat con citas auditables.
                    </p>
                    <button
                      type="button"
                      onClick={() => setArchivalTab('index')}
                      className="px-4 py-2 bg-[#1A1A1A] dark:bg-[#EDEDED] text-[#F9F9F8] dark:text-[#121214] text-xs font-mono font-medium uppercase hover:opacity-90 transition-opacity cursor-pointer"
                    >
                      Abrir Catálogo de Fuentes ({sources.length})
                    </button>
                  </div>
                </div>
              )
            )}

            {archivalTab === 'notebook' && (
              <Suspense fallback={null}>
                <StudioNotebook
                  projectId={activeProject?.id || 'default'}
                  projectName={activeProject?.name || 'Investigación'}
                  onNotesCountChange={setNotesCount}
                  targetNoteId={targetNoteId}
                  onClearTargetNote={() => setTargetNoteId(null)}
                  initialNewNote={draftNote}
                  onClearInitialNote={() => setDraftNote(null)}
                  onNavigateToChat={handleNavigateToChat}
                  onNavigateToSource={handleNavigateToSourceFromNote}
                  messages={messages}
                  sources={sources}
                  onNavigateToCitation={handleCitationClick}
                />
              </Suspense>
            )}

            {archivalTab === 'timeline' && (
              <Suspense fallback={null}>
                <TimelineViewer
                  projectId={activeProject?.id || 'default'}
                  selectedDocId={selectedDoc?.id || null}
                  selectedEngine={selectedEngine}
                  onSelectDocument={(docId) => {
                    const doc = sources.find((s) => s.id === docId);
                    if (doc) {
                      setSelectedDoc(doc);
                      setHighlightTarget(null);
                      setArchivalTab('split');
                    }
                  }}
                />
              </Suspense>
            )}

            {archivalTab === 'network' && (
              <Suspense fallback={null}>
                <NetworkGraphViewer
                  projectId={activeProject?.id || 'default'}
                  selectedDocId={selectedDoc?.id || null}
                  onSelectDocument={(docId) => {
                    const doc = sources.find((s) => s.id === docId);
                    if (doc) {
                      setSelectedDoc(doc);
                      setHighlightTarget(null);
                      setArchivalTab('split');
                    }
                  }}
                />
              </Suspense>
            )}
          </main>

      {/* Hidden File Input for Archival Add Document */}
      <input
        type="file"
        ref={archivalFileInputRef}
        className="hidden"
        accept=".pdf,.txt,.md,.docx,.epub,.mp3,.m4a,.wav,.ogg,.flac,.aac,.opus,.wma,.mp4,.webm,.mkv,.mov"
        onChange={handleArchivalFileChange}
      />

      {/* Create Project Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-100">
          <div className="bg-[#F9F9F8] dark:bg-[#121214] border border-[#E0E0DC] dark:border-[#2A2A2E] shadow-2xl w-full max-w-md p-5 space-y-4 font-sans">
            <div className="flex items-center justify-between border-b border-[#E0E0DC] dark:border-[#2A2A2E] pb-3">
              <div className="flex items-center gap-2 text-[#1A1A1A] dark:text-[#EDEDED] font-semibold text-xs font-mono uppercase tracking-wider">
                <FolderPlus className="w-4 h-4 text-[#1A56DB] dark:text-[#60A5FA]" />
                <span>Nuevo Proyecto de Investigación</span>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-[#666666] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProjectSubmit} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-[11px] font-bold text-[#666666] dark:text-[#888888] uppercase mb-1">
                  Nombre del Proyecto <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Ej: Análisis Económico 2026, Novela Edipo..."
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full bg-[#EBEBE8] dark:bg-[#1E1E22] border border-[#E0E0DC] dark:border-[#2A2A2E] px-3 py-2 text-xs text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED] font-sans"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[#666666] dark:text-[#888888] uppercase mb-1">
                  Descripción (opcional)
                </label>
                <textarea
                  rows={3}
                  placeholder="Objetivo o notas sobre los documentos a investigar..."
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  className="w-full bg-[#EBEBE8] dark:bg-[#1E1E22] border border-[#E0E0DC] dark:border-[#2A2A2E] px-3 py-2 text-xs text-[#1A1A1A] dark:text-[#EDEDED] placeholder-[#999999] dark:placeholder-[#555555] focus:outline-none focus:border-[#1A1A1A] dark:focus:border-[#EDEDED] font-sans resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E0E0DC] dark:border-[#2A2A2E]">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-3 py-1.5 border border-[#E0E0DC] dark:border-[#2A2A2E] text-xs font-mono text-[#666666] dark:text-[#888888] hover:text-[#1A1A1A] dark:hover:text-[#EDEDED] cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!newProjectName.trim() || isSubmittingProject}
                  className="px-4 py-1.5 bg-[#1A1A1A] hover:bg-[#333333] dark:bg-[#EDEDED] dark:hover:bg-[#FFFFFF] text-[#F9F9F8] dark:text-[#121214] text-xs font-mono font-medium tracking-wide uppercase transition-colors disabled:opacity-40 cursor-pointer"
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
        <Suspense fallback={null}>
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
        </Suspense>
      )}
      {/* Real-time System Diagnostics & Logs Modal */}
      <Suspense fallback={null}>
        <SystemLogsModal
          isOpen={isLogsModalOpen}
          onClose={() => setIsLogsModalOpen(false)}
        />
      </Suspense>
    </div>
  );
};

export default App;
