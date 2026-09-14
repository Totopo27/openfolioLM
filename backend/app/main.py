import os
import re
from typing import Optional
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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
from app.adapters.llm_client import OpenAICompatibleLLMClient
from app.adapters.project_manager import ProjectManager
from app.api.routes_sources import create_sources_router
from app.api.routes_chat import create_chat_router
from app.api.routes_projects import create_projects_router


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
    app = FastAPI(
        title="OpenFolioLM API",
        description="High-Precision Grounded Document Analysis & Research Assistant",
        version="0.1.0"
    )

    # Allow CORS for local frontend development
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Initialize dependencies if not supplied
    projects_dir = os.path.join(settings.data_dir, "projects")
    active_pm = project_manager or ProjectManager(
        projects_root=projects_dir,
        legacy_db_path=settings.db_path
    )
    default_proj = active_pm.ensure_default_project()

    active_store = store or active_pm.get_store(default_proj.id)
    active_resolver = academic_resolver or CompositeAcademicResolver()
    active_ingester = ingester or HybridDocumentIngester(academic_resolver=active_resolver)
    active_chunker = chunker or PositionalChunker()
    active_reranker = reranker or CrossEncoderReranker(model_name=settings.reranker_model)
    active_fact_checker = fact_checker or (
        NLIFactChecker(model_name=settings.nli_model) if settings.enable_fact_checker else None
    )

    providers = {}
    if settings.gemini_api_key:
        providers["gemini"] = OpenAICompatibleLLMClient(
            base_url="https://generativelanguage.googleapis.com/v1beta/openai",
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            fallback_models=["gemini-3.7-flash", "gemini-3.8-flash", "gemini-3.6-flash"]
        )
    providers["ollama"] = OpenAICompatibleLLMClient(
        base_url=settings.ollama_base_url,
        api_key=settings.ollama_api_key,
        model=settings.ollama_model
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
                ("gemini-3.5-flash", "Gemini 3.5 Flash (Google Cloud)"),
                ("gemini-3.7-flash", "Gemini 3.7 Flash (Google Cloud)"),
                ("gemini-3.8-flash", "Gemini 3.8 Flash (Google Cloud)"),
            ]
            custom_model = settings.gemini_model
            known_names = [m[0] for m in gemini_catalog]
            if custom_model and custom_model not in known_names:
                gemini_catalog.insert(0, (custom_model, f"Gemini {custom_model} (Google Cloud)"))

            for m_id, m_name in gemini_catalog:
                engines.append(
                    ModelEngine(
                        id=f"gemini:{m_id}",
                        provider="gemini",
                        model=m_id,
                        name=m_name,
                        is_available=True
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
                engines.append(
                    ModelEngine(
                        id=f"ollama:{settings.ollama_model}",
                        provider="ollama",
                        model=settings.ollama_model,
                        name=f"Ollama: {settings.ollama_model}",
                        is_available=True
                    )
                )
            else:
                for m in raw_models:
                    model_name = m.get("name") or m.get("model") or "unknown"
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
                            is_available=True
                        )
                    )
        except Exception:
            engines.append(
                ModelEngine(
                    id=f"ollama:{settings.ollama_model}",
                    provider="ollama",
                    model=settings.ollama_model,
                    name=f"Ollama: {settings.ollama_model} (Offline)",
                    is_available=False
                )
            )

        return ModelsListResponse(models=engines)

    return app


app = create_app()
