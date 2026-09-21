import { useState, useEffect, useCallback } from 'react';
import { ModelEngine } from '../types';
import { fetchAvailableModels, pingModelEngine } from '../services/api';

const HEALTH_POLL_INTERVAL_MS = 30_000;
const STORAGE_KEY = 'openfolio_selected_engine';

export function useModelEngines() {
  const [models, setModels] = useState<ModelEngine[]>([]);
  const [selectedEngine, setSelectedEngine] = useState<string>('gemini:gemini-2.5-flash');
  const [isPinging, setIsPinging] = useState(false);

  const triggerModelPing = useCallback(async (engineId: string) => {
    if (!engineId) return;
    try {
      setIsPinging(true);
      const res = await pingModelEngine(engineId);
      setModels((prev) =>
        prev.map((m) =>
          m.id === engineId
            ? {
                ...m,
                status: res.status as any,
                latency_ms: res.latency_ms,
                last_error: res.last_error,
                is_available: res.status !== 'offline',
              }
            : m
        )
      );
    } catch (err) {
      console.error('Failed to ping model:', err);
    } finally {
      setIsPinging(false);
    }
  }, []);

  const initModels = useCallback(async () => {
    try {
      const modelList = await fetchAvailableModels();
      setModels(modelList);
      if (modelList.length > 0) {
        const savedEngine = localStorage.getItem(STORAGE_KEY);
        const matched = modelList.find((m) => m.id === savedEngine && m.is_available);
        let activeId = '';
        if (matched) {
          activeId = matched.id;
          setSelectedEngine(matched.id);
        } else {
          const firstAvailable = modelList.find((m) => m.is_available) || modelList[0];
          activeId = firstAvailable.id;
          setSelectedEngine(firstAvailable.id);
        }
        if (activeId) {
          triggerModelPing(activeId);
        }
      }
    } catch (err) {
      console.error('Failed to load available models:', err);
    }
  }, [triggerModelPing]);

  useEffect(() => {
    initModels();
    const healthInterval = setInterval(initModels, HEALTH_POLL_INTERVAL_MS);
    return () => clearInterval(healthInterval);
  }, [initModels]);

  const handleSelectEngine = useCallback((engineId: string) => {
    setSelectedEngine(engineId);
    localStorage.setItem(STORAGE_KEY, engineId);
  }, []);

  const handlePingActiveModel = useCallback(async () => {
    if (!selectedEngine) return;
    await triggerModelPing(selectedEngine);
  }, [selectedEngine, triggerModelPing]);

  return {
    models,
    selectedEngine,
    isPinging,
    setSelectedEngine: handleSelectEngine,
    handlePingActiveModel,
    refreshModels: initModels,
  };
}
