import os
import re
from typing import Optional
import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.core.config import settings
from app.core.models import ModelsListResponse, ModelEngine
from app.ports.store import DocumentStorePort
from app.ports.synthesizer import SynthesizerPort
from app.ports.ingester import IngestionPort
from app.ports.chunker import ChunkerPort
from app.ports.reranker import RerankerPort
from app.ports.document_analyzer import DocumentAnalyzerPort
from app.ports.fact_checker import FactCheckerPort
from app.ports.academic_resolver import AcademicResolverPort
from app.adapters.markitdown_adapter import MarkItDownAdapter
from app.adapters.hybrid_ingester import HybridDocumentIngester
from app.adapters.positional_chunker import PositionalChunker
from app.adapters.sqlite_store import SQLiteDocumentStore
from app.adapters.grounded_synthesizer import GroundedSynthesizer
from app.adapters.cross_encoder_reranker import CrossEncoderReranker
from app.adapters.structured_analyzer import StructuredDocumentAnalyzer
from app.adapters.nli_fact_checker import NLIFactChecker
from app.adapters.academic_resolver import CompositeAcademicResolver
from app.adapters.llm_client import OpenAICompatibleLLMClient, health_registry
from app.adapters.vision_transcriber import VisionTranscriber
from app.adapters.project_manager import InvalidProjectIdError, ProjectManager
from app.api.routes_sources import create_sources_router
from app.api.routes_chat import create_chat_router
from app.api.routes_projects import create_projects_router
from app.core.logging_config import setup_logging


DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
)


def _get_cors_origins() -> list[str]:
    raw_origins = os.getenv("OPENFOLIO_CORS_ORIGINS", "")
    origins = (
        [origin.strip().rstrip("/") for origin in raw_origins.split(",") if origin.strip()]
        if raw_origins
        else list(DEFAULT_CORS_ORIGINS)
    )
    if "*" in origins:
        raise RuntimeError("OPENFOLIO_CORS_ORIGINS must not contain a wildcard")
    return origins


def create_app(
    store: Optional[DocumentStorePort] = None,
    synthesizer: Optional[SynthesizerPort] = None,
    ingester: Optional[IngestionPort] = None,
    chunker: Optional[ChunkerPort] = None,
    project_manager: Optional[ProjectManager] = None,
    reranker: Optional[RerankerPort] = None,
    analyzer: Optional[DocumentAnalyzerPort] = None,
    fact_checker: Optional[FactCheckerPort] = None,
    academic_resolver: Optional[AcademicResolverPort] = None,
) -> FastAPI:
    setup_logging()
    app = FastAPI(
        title="OpenFolioLM API",
        description="High-Precision Grounded Document Analysis & Research Assistant",
        version="0.1.0"
    )

    # Permit only explicitly trusted local development frontends. Production
    # deployments should normally be same-origin or set OPENFOLIO_CORS_ORIGINS.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_get_cors_origins(),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Accept", "Content-Type"],
    )

    @app.exception_handler(InvalidProjectIdError)
    async def invalid_project_id_handler(
        _request: Request,
        _exc: InvalidProjectIdError,
    ) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": "Project not found"})

    # Initialize dependencies if not supplied
    projects_dir = os.path.join(settings.data_dir, "projects")
    active_pm = project_manager or ProjectManager(
        projects_root=projects_dir,
        legacy_db_path=settings.db_path
    )
    default_proj = active_pm.ensure_default_project()

    providers = {}
    if settings.gemini_api_key:
        providers["gemini"] = OpenAICompatibleLLMClient(
            base_url="https://generativelanguage.googleapis.com/v1beta/openai",
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            fallback_models=["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
            provider_name="gemini",
        )
    providers["ollama"] = OpenAICompatibleLLMClient(
        base_url=settings.ollama_base_url,
        api_key=settings.ollama_api_key,
        model=settings.ollama_model,
        provider_name="ollama",
    )

    # Multimodal Vision (VLM) Transcriber
    vision_client = None
    if settings.enable_vision_transcription:
        if settings.vision_provider == "ollama":
            vision_client = OpenAICompatibleLLMClient(
                base_url=settings.ollama_base_url,
                api_key=settings.ollama_api_key,
                model=settings.vision_model,
                provider_name="ollama",
                timeout=90.0,
            )
        elif settings.vision_provider == "gemini" and settings.gemini_api_key:
            vision_client = OpenAICompatibleLLMClient(
                base_url="https://generativelanguage.googleapis.com/v1beta/openai",
                api_key=settings.gemini_api_key,
                model=settings.gemini_model,
                provider_name="gemini",
                timeout=60.0,
            )

    active_vision_transcriber = VisionTranscriber(
        llm_client=vision_client,
        enabled=settings.enable_vision_transcription and (vision_client is not None),
    )

    active_store = store or active_pm.get_store(default_proj.id)
    active_resolver = academic_resolver or CompositeAcademicResolver()
    active_ingester = ingester or HybridDocumentIngester(
        academic_resolver=active_resolver,
        vision_transcriber=active_vision_transcriber,
    )
    active_chunker = chunker or PositionalChunker()
    active_reranker = reranker or CrossEncoderReranker(model_name=settings.reranker_model)
    active_fact_checker = fact_checker or (
        NLIFactChecker(model_name=settings.nli_model) if settings.enable_fact_checker else None
    )

    if synthesizer is None:
        active_synthesizer = GroundedSynthesizer(
            providers=providers,
            default_provider=settings.llm_provider
        )
    else:
        active_synthesizer = synthesizer

    if analyzer is None:
        active_analyzer = StructuredDocumentAnalyzer(
            providers=providers,
            default_provider=settings.llm_provider
        )
    else:
        active_analyzer = analyzer

    # Register routers
    app.include_router(create_projects_router(
        active_pm,
        active_ingester,
        active_chunker,
        active_synthesizer,
        reranker=active_reranker,
        analyzer=active_analyzer,
        fact_checker=active_fact_checker,
        academic_resolver=active_resolver,
    ))
    app.include_router(create_sources_router(active_store, active_ingester, active_chunker))
    app.include_router(create_chat_router(
        active_store,
        active_synthesizer,
        fact_checker=active_fact_checker,
    ))

    @app.get("/api/chat/shared/{share_id}")
    async def get_shared_chat_conversation(share_id: str):
        snapshot = active_pm.get_shared_conversation(share_id)
        if not snapshot:
            raise HTTPException(status_code=404, detail="Shared conversation not found")
        return snapshot

    @app.get("/api/health")
    async def health():
        return {
            "status": "ok",
            "app": "OpenFolioLM",
            "embedding_model": settings.embedding_model,
            "reranker_model": settings.reranker_model,
            "nli_model": settings.nli_model if settings.enable_fact_checker else None,
            "docling_enabled": settings.enable_docling,
        }

    @app.get("/api/models", response_model=ModelsListResponse)
    async def get_available_models():
        engines: list[ModelEngine] = []

        # 1. Cloud / Gemini Engines
        if settings.gemini_api_key:
            gemini_catalog = [
                ("gemini-2.5-flash", "Gemini 2.5 Flash (Google Cloud)"),
                ("gemini-2.0-flash", "Gemini 2.0 Flash (Google Cloud)"),
                ("gemini-1.5-flash", "Gemini 1.5 Flash (Google Cloud)"),
                ("gemini-1.5-pro", "Gemini 1.5 Pro (Google Cloud)"),
            ]
            custom_model = settings.gemini_model
            known_names = [m[0] for m in gemini_catalog]
            if custom_model and custom_model not in known_names:
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
        # Windows IPv6 resolution fix: ensure 127.0.0.1 is used instead of localhost
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
                            is_available=True,
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

    @app.get("/api/models/health")
    async def get_models_health():
        """Returns live model statuses from ModelHealthRegistry."""
        return {
            "statuses": {
                m: rec.to_dict() for m, rec in health_registry.get_all().items()
            }
        }

    @app.post("/api/models/ping")
    async def ping_model(model_id: str):
        """Pings a specific model to check latency and availability."""
        prov = "gemini"
        m_name = model_id
        if ":" in model_id:
            prov, m_name = model_id.split(":", 1)
        client = providers.get(prov)
        if not client or not hasattr(client, "ping"):
            raise HTTPException(status_code=400, detail=f"Provider '{prov}' does not support pinging")
        rec = client.ping(m_name)
        return rec.to_dict()

    @app.get("/api/system/logs")
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

    return app


app = create_app()
