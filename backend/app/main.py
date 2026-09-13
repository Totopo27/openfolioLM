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
from app.api.routes_sources import create_sources_router
from app.api.routes_chat import create_chat_router


def create_app(
    store: Optional[DocumentStorePort] = None,
    synthesizer: Optional[SynthesizerPort] = None,
    ingester: Optional[IngestionPort] = None,
    chunker: Optional[ChunkerPort] = None,
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
    if not os.path.exists(settings.data_dir):
        os.makedirs(settings.data_dir, exist_ok=True)

    active_store = store or SQLiteDocumentStore(db_path=settings.db_path)
    active_ingester = ingester or MarkItDownAdapter()
    active_chunker = chunker or PositionalChunker()

    if synthesizer is None:
        providers = {}
        if settings.gemini_api_key:
            providers["gemini"] = OpenAICompatibleLLMClient(
                base_url="https://generativelanguage.googleapis.com/v1beta/openai",
                api_key=settings.gemini_api_key,
                model=settings.gemini_model
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
    app.include_router(create_sources_router(active_store, active_ingester, active_chunker))
    app.include_router(create_chat_router(active_store, active_synthesizer))

    @app.get("/api/health")
    async def health():
        return {"status": "ok", "app": "OpenFolioLM"}

    return app


app = create_app()
