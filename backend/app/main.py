import os
from typing import Optional
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.ports.store import DocumentStorePort
from app.ports.synthesizer import SynthesizerPort
from app.ports.ingester import IngestionPort
from app.ports.chunker import ChunkerPort
from app.adapters.markitdown_adapter import MarkItDownAdapter
from app.adapters.positional_chunker import PositionalChunker
from app.adapters.sqlite_store import SQLiteDocumentStore
from app.adapters.grounded_synthesizer import GroundedSynthesizer
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
    active_ingester = ingester or MarkItDownAdapter()
    active_chunker = chunker or PositionalChunker()

    if synthesizer is None:
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
        active_synthesizer = GroundedSynthesizer(
            providers=providers,
            default_provider=settings.llm_provider
        )
    else:
        active_synthesizer = synthesizer

    # Register routers
    app.include_router(create_projects_router(active_pm, active_ingester, active_chunker, active_synthesizer))
    app.include_router(create_sources_router(active_store, active_ingester, active_chunker))
    app.include_router(create_chat_router(active_store, active_synthesizer))

    @app.get("/api/health")
    async def health():
        return {"status": "ok", "app": "OpenFolioLM"}

    return app


app = create_app()
