import { useState, useMemo, useCallback } from 'react';
import { ChatMessage } from '../types';
import { GroundedChatMessage } from '../components/archival/ArchivalSplitViewer';
import {
  sendProjectGroundedChat,
  clearProjectMessages,
} from '../services/api';

interface UseChatManagerOptions {
  projectId: string | undefined;
  activeSourceIds: string[];
  selectedEngine: string;
  onMessageCountChanged?: (delta: number) => void;
  onChatCleared?: () => void;
  onAfterSend?: () => void;
}

export function useChatManager({
  projectId,
  activeSourceIds,
  selectedEngine,
  onMessageCountChanged,
  onChatCleared,
  onAfterSend,
}: UseChatManagerOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);

  const handleSendMessage = useCallback(async (query: string) => {
    if (!projectId) return;

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await sendProjectGroundedChat(projectId, query, activeSourceIds, selectedEngine);

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
      onMessageCountChanged?.(2);
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
      onAfterSend?.();
    }
  }, [projectId, activeSourceIds, selectedEngine, onMessageCountChanged, onAfterSend]);

  const handleClearChat = useCallback(async () => {
    if (!projectId) return;
    if (!confirm('Deseas vaciar el historial de conversacion de este proyecto?')) return;

    try {
      await clearProjectMessages(projectId);
      setMessages([]);
      onChatCleared?.();
    } catch (err: any) {
      alert(`Error clearing chat: ${err.message}`);
    }
  }, [projectId, onChatCleared]);

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

  return {
    messages,
    setMessages,
    isLoading,
    targetMessageId,
    setTargetMessageId,
    groundedMessages,
    handleSendMessage,
    handleClearChat,
  };
}
