import React, { useState, useEffect } from 'react';
import { BookOpen, Sparkles, Layers } from 'lucide-react';
import { SourceDocument, ChatMessage, HighlightTarget, Citation } from './types';
import { fetchSources, uploadSource, deleteSource, sendGroundedChat } from './services/api';
import { DocViewer } from './components/DocViewer';
import { SourceManager } from './components/SourceManager';
import { ChatPanel } from './components/ChatPanel';

export const App: React.FC = () => {
  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [activeSourceIds, setActiveSourceIds] = useState<string[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<SourceDocument | null>(null);
  const [highlightTarget, setHighlightTarget] = useState<HighlightTarget | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Initial load
  useEffect(() => {
    loadSources();
  }, []);

  const loadSources = async () => {
    try {
      const docs = await fetchSources();
      setSources(docs);
      // Auto-activate all sources on first load if none active
      if (activeSourceIds.length === 0 && docs.length > 0) {
        setActiveSourceIds(docs.map((d) => d.id));
        setSelectedDoc(docs[0]);
      }
    } catch (err) {
      console.error('Failed to load sources:', err);
    }
  };

  const handleUpload = async (file: File) => {
    const newDoc = await uploadSource(file);
    setSources((prev) => [newDoc, ...prev]);
    setActiveSourceIds((prev) => [...prev, newDoc.id]);
    setSelectedDoc(newDoc);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this source?')) return;
    await deleteSource(id);
    setSources((prev) => prev.filter((d) => d.id !== id));
    setActiveSourceIds((prev) => prev.filter((sId) => sId !== id));
    if (selectedDoc?.id === id) {
      const remaining = sources.filter((d) => d.id !== id);
      setSelectedDoc(remaining.length > 0 ? remaining[0] : null);
      setHighlightTarget(null);
    }
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
    // 1. Switch doc viewer to cited document if different
    const targetDoc = sources.find((s) => s.id === citation.source_id);
    if (targetDoc) {
      setSelectedDoc(targetDoc);
    }

    // 2. Set coordinate highlight
    setHighlightTarget({
      source_id: citation.source_id,
      start_char: citation.start_char,
      end_char: citation.end_char,
      quote_snippet: citation.quote_snippet,
    });
  };

  const handleSendMessage = async (query: string) => {
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await sendGroundedChat(query, activeSourceIds);

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

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100">
      {/* Top Navbar */}
      <header className="h-14 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur px-6 flex items-center justify-between shrink-0">
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

        <div className="flex items-center gap-4 text-xs text-slate-400 font-medium">
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            Hexagonal Architecture
          </span>
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            MarkItDown Ingestion
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
            onDelete={handleDelete}
          />
          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            activeSourceCount={activeSourceIds.length}
            onSendMessage={handleSendMessage}
            onCitationClick={handleCitationClick}
          />
        </div>
      </div>
    </div>
  );
};

export default App;
