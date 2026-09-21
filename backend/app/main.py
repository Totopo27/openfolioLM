import os
import logging
from typing import Optional

import uvicorn

logger = logging.getLogger(__name__)
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.core.config import settings
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
from app.adapters.youtube_ingester import YouTubeIngester
from app.adapters.sherpa_transcriber import SherpaOnnxTranscriber
from app.adapters.audio_ingester import AudioIngester
from app.adapters.llm_client import OpenAICompatibleLLMClient
from app.adapters.vision_transcriber import VisionTranscriber
from app.adapters.project_manager import InvalidProjectIdError, ProjectManager
from app.api.routes_sources import create_sources_router
from app.api.routes_chat import create_chat_router
from app.api.routes_projects import create_projects_router
from app.api.routes_system import create_system_router
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
            fallback_models=["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"],
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

    active_transcriber = None
    if settings.enable_audio_transcription:
        active_transcriber = SherpaOnnxTranscriber(
            models_dir=settings.sherpa_models_dir,
            model_size=settings.sherpa_whisper_model,
        )

    active_audio_ingester = AudioIngester(transcriber=active_transcriber)
    active_yt_ingester = YouTubeIngester(audio_transcriber=active_transcriber)

    active_store = store or active_pm.get_store(default_proj.id)
    active_resolver = academic_resolver or CompositeAcademicResolver()
    active_ingester = ingester or HybridDocumentIngester(
        academic_resolver=active_resolver,
        vision_transcriber=active_vision_transcriber,
        audio_ingester=active_audio_ingester,
        youtube_ingester=active_yt_ingester,
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
        vision_transcriber=active_vision_transcriber,
        audio_ingester=active_audio_ingester,
    ))
    app.include_router(create_sources_router(active_store, active_ingester, active_chunker))
    app.include_router(create_chat_router(
        active_store,
        active_synthesizer,
        fact_checker=active_fact_checker,
    ))
    app.include_router(create_system_router(
        project_manager=active_pm,
        providers=providers,
    ))

    return app


app = create_app()

API_LOOPBACK_HOST = "127.0.0.1"
API_DEFAULT_PORT = 8000


def run_api() -> None:
    """Run the local-first API on loopback only."""
    uvicorn.run(
        "app.main:app",
        host=API_LOOPBACK_HOST,
        port=API_DEFAULT_PORT,
        reload=False,
    )


if __name__ == "__main__":
    run_api()
