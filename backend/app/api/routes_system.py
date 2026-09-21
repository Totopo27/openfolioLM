"""System-level API endpoints: health, models, logs, and shared conversations."""

import os
import re
import time
import logging
import asyncio
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.core.models import ModelsListResponse, ModelEngine
from app.adapters.llm_client import health_registry
from app.adapters.project_manager import ProjectManager

logger = logging.getLogger(__name__)

# --- Gemini model discovery (cached) ---

_gemini_models_cache: list[tuple[str, str]] = []
_gemini_models_cache_time: float = 0.0
GEMINI_CACHE_TTL_SECS = 300.0

DEFAULT_GEMINI_CATALOG: list[tuple[str, str]] = [
    ("gemini-3.6-flash", "Gemini 3.6 Flash (Google Cloud - Estable)"),
    ("gemini-3.7-flash", "Gemini 3.7 Flash (Google Cloud)"),
    ("gemini-3.5-flash", "Gemini 3.5 Flash (Google Cloud)"),
    ("gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite (Google Cloud)"),
    ("gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview (Google Cloud)"),
    ("gemini-3.8-flash", "Gemini 3.8 Flash (Google Cloud)"),
]


async def fetch_available_gemini_models(api_key: str) -> list[tuple[str, str]]:
    """Dynamically discover generation models from Google AI API with in-memory caching."""
    global _gemini_models_cache, _gemini_models_cache_time
    now = time.time()
    if _gemini_models_cache and (now - _gemini_models_cache_time) < GEMINI_CACHE_TTL_SECS:
        return list(_gemini_models_cache)

    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                discovered: list[tuple[str, str]] = []
                for m in data.get("models", []):
                    methods = m.get("supportedGenerationMethods", [])
                    name = m.get("name", "").replace("models/", "")
                    display = m.get("displayName", name)
                    if "generateContent" not in methods:
                        continue
                    if not name.startswith("gemini"):
                        continue
                    if any(
                        skip in name
                        for skip in [
                            "1.5",
                            "2.0",
                            "2.5",
                            "tts",
                            "robotics",
                            "translate",
                            "clip",
                            "transcribe",
                            "native-audio",
                            "embedding",
                            "computer-use",
                            "customtools",
                            "image",
                        ]
                    ):
                        continue
                    discovered.append((name, f"{display} (Google Cloud)"))

                if discovered:
                    discovered.sort(
                        key=lambda item: (
                            item[0] == "gemini-3.6-flash",
                            item[0].startswith("gemini-3.7"),
                            item[0].startswith("gemini-3.5"),
                            item[0],
                        ),
                        reverse=True,
                    )
                    _gemini_models_cache = discovered
                    _gemini_models_cache_time = now
                    return list(discovered)
    except Exception as e:
        logger.debug("Dynamic Gemini model discovery failed, falling back to catalog: %s", e)

    return list(DEFAULT_GEMINI_CATALOG)


# --- Router factory ---

def create_system_router(
    project_manager: ProjectManager,
    providers: dict,
) -> APIRouter:
    router = APIRouter()

    @router.get("/api/chat/shared/{share_id}")
    async def get_shared_chat_conversation(share_id: str):
        snapshot = project_manager.get_shared_conversation(share_id)
        if not snapshot:
            raise HTTPException(status_code=404, detail="Shared conversation not found")
        return snapshot

    @router.get("/api/health")
    async def health():
        return {
            "status": "ok",
            "app": "OpenFolioLM",
            "embedding_model": settings.embedding_model,
            "reranker_model": settings.reranker_model,
            "nli_model": settings.nli_model if settings.enable_fact_checker else None,
            "docling_enabled": settings.enable_docling,
        }

    @router.get("/api/models", response_model=ModelsListResponse)
    async def get_available_models():
        engines: list[ModelEngine] = []

        # 1. Cloud / Gemini Engines
        if settings.gemini_api_key:
            gemini_catalog = await fetch_available_gemini_models(settings.gemini_api_key)
            custom_model = settings.gemini_model
            if custom_model:
                match_idx = next((i for i, m in enumerate(gemini_catalog) if m[0] == custom_model), -1)
                if match_idx > 0:
                    model_entry = gemini_catalog.pop(match_idx)
                    gemini_catalog.insert(0, model_entry)
                elif match_idx == -1:
                    gemini_catalog.insert(0, (custom_model, f"Gemini {custom_model} (Google Cloud)"))

            for m_id, m_name in gemini_catalog:
                rec = health_registry.get_status(m_id)
                engines.append(
                    ModelEngine(
                        id=f"gemini:{m_id}",
                        provider="gemini",
                        model=m_id,
                        name=m_name,
                        is_available=(rec.status != "offline"),
                        status=rec.status,
                        latency_ms=rec.latency_ms,
                        last_error=rec.last_error,
                    )
                )

        # 2. Local Ollama Engines
        ollama_root = re.sub(r"/v1/?$", "", settings.ollama_base_url)
        ollama_root = ollama_root.replace("localhost", "127.0.0.1")
        tags_url = f"{ollama_root}/api/tags"
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(tags_url)
                resp.raise_for_status()
                ollama_data = resp.json()
            raw_models = ollama_data.get("models", [])
            if not raw_models:
                rec = health_registry.get_status(settings.ollama_model)
                engines.append(
                    ModelEngine(
                        id=f"ollama:{settings.ollama_model}",
                        provider="ollama",
                        model=settings.ollama_model,
                        name=f"Ollama: {settings.ollama_model}",
                        is_available=True,
                        status=rec.status,
                        latency_ms=rec.latency_ms,
                        last_error=rec.last_error,
                    )
                )
            else:
                for m in raw_models:
                    model_name = m.get("name") or m.get("model") or "unknown"
                    rec = health_registry.get_status(model_name)
                    details = m.get("details", {})
                    param_size = details.get("parameter_size", "")
                    display = f"Ollama: {model_name}"
                    if param_size:
                        display += f" ({param_size})"
                    engines.append(
                        ModelEngine(
                            id=f"ollama:{model_name}",
                            provider="ollama",
                            model=model_name,
                            name=display,
                            is_available=(rec.status != "offline"),
                            status=rec.status,
                            latency_ms=rec.latency_ms,
                            last_error=rec.last_error,
                        )
                    )
        except Exception:
            rec = health_registry.get_status(settings.ollama_model)
            engines.append(
                ModelEngine(
                    id=f"ollama:{settings.ollama_model}",
                    provider="ollama",
                    model=settings.ollama_model,
                    name=f"Ollama: {settings.ollama_model} (Offline)",
                    is_available=False,
                    status="offline",
                    latency_ms=None,
                    last_error="Ollama endpoint unreachable",
                )
            )

        return ModelsListResponse(models=engines)

    @router.get("/api/models/health")
    async def get_models_health():
        """Returns live model statuses from ModelHealthRegistry."""
        return {
            "statuses": {
                m: rec.to_dict() for m, rec in health_registry.get_all().items()
            }
        }

    @router.post("/api/models/ping")
    async def ping_model(model_id: str):
        """Pings a specific model to check latency and availability."""
        prov = "gemini"
        m_name = model_id
        if ":" in model_id:
            prov, m_name = model_id.split(":", 1)
        client = providers.get(prov)
        if not client or not hasattr(client, "ping"):
            raise HTTPException(status_code=400, detail=f"Provider '{prov}' does not support pinging")
        rec = await asyncio.to_thread(client.ping, m_name)
        return rec.to_dict()

    @router.get("/api/system/logs")
    async def get_system_logs(lines: int = 150):
        """Returns the latest N lines of server logs for diagnostic inspection."""
        log_path = os.path.join(settings.data_dir, "openfolio.log")
        if not os.path.exists(log_path):
            return {
                "lines": [],
                "log_file": os.path.abspath(log_path),
                "total_lines": 0,
                "status": "No log file found yet",
            }
        try:
            with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                all_lines = f.readlines()
                tail = all_lines[-lines:]
                return {
                    "lines": [line.rstrip("\r\n") for line in tail],
                    "log_file": os.path.abspath(log_path),
                    "total_lines": len(all_lines),
                }
        except Exception as e:
            return {
                "lines": [f"Error al leer archivo de logs: {e}"],
                "log_file": os.path.abspath(log_path),
                "total_lines": 0,
            }

    return router
