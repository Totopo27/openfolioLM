import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "OpenFolioLM"
    data_dir: str = "data"
    db_path: str = "data/openfolio.db"
    upload_dir: str = "data/uploads"
    
    # Active provider: "gemini" or "ollama"
    llm_provider: str = os.getenv("LLM_PROVIDER", "gemini")

    # Gemini settings
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")

    # Ollama settings
    ollama_base_url: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
    ollama_api_key: str = os.getenv("OLLAMA_API_KEY", "ollama")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")

    # Multimodal Vision (VLM) settings for diagram, chart and figure transcription
    vision_provider: str = os.getenv("VISION_PROVIDER", "ollama")
    vision_model: str = os.getenv("VISION_MODEL", "minicpm-v4.6")
    enable_vision_transcription: bool = os.getenv("ENABLE_VISION_TRANSCRIPTION", "true").lower() in ("true", "1", "yes")

    # Generic overrides
    llm_base_url: str = os.getenv("LLM_BASE_URL", "")
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_model: str = os.getenv("LLM_MODEL", "")

    # Neural Embedding & Reranker settings (FastEmbed ONNX)
    embedding_model: str = os.getenv(
        "EMBEDDING_MODEL", "jinaai/jina-embeddings-v2-base-es"
    )
    reranker_model: str = os.getenv(
        "RERANKER_MODEL", "BAAI/bge-reranker-base"
    )

    # NLI Fact-Checking & Hallucination Guardrail settings
    nli_model: str = os.getenv(
        "NLI_MODEL", "Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7"
    )
    enable_fact_checker: bool = os.getenv("ENABLE_FACT_CHECKER", "true").lower() in ("true", "1", "yes")

    # Document Layout & Table Parser (IBM Docling) settings
    enable_docling: bool = os.getenv("ENABLE_DOCLING", "true").lower() in ("true", "1", "yes")

    # Semantic Scholar (S2) settings
    semantic_scholar_api_key: str = os.getenv("SEMANTIC_SCHOLAR_API_KEY", "")
    semantic_scholar_api_url: str = os.getenv("SEMANTIC_SCHOLAR_API_URL", "https://api.semanticscholar.org/graph/v1")

    # Upload size limit in MB (0 = unlimited for large books, treatises, and scans)
    max_upload_size_mb: int = int(os.getenv("MAX_UPLOAD_SIZE_MB", "0"))

    # Audio Ingestion & Offline Speech-to-Text (sherpa-onnx)
    enable_audio_transcription: bool = os.getenv("ENABLE_AUDIO_TRANSCRIPTION", "true").lower() in ("true", "1", "yes")
    sherpa_whisper_model: str = os.getenv("SHERPA_WHISPER_MODEL", "small")
    sherpa_models_dir: str = os.getenv("SHERPA_MODELS_DIR", "data/models/sherpa")

    @property
    def effective_llm_base_url(self) -> str:
        if self.llm_base_url:
            return self.llm_base_url
        if self.llm_provider == "gemini" and self.gemini_api_key:
            return "https://generativelanguage.googleapis.com/v1beta/openai"
        return self.ollama_base_url

    @property
    def effective_llm_api_key(self) -> str:
        if self.llm_api_key:
            return self.llm_api_key
        if self.llm_provider == "gemini" and self.gemini_api_key:
            return self.gemini_api_key
        return self.ollama_api_key

    @property
    def effective_llm_model(self) -> str:
        if self.llm_model:
            return self.llm_model
        if self.llm_provider == "gemini" and self.gemini_api_key:
            return self.gemini_model
        return self.ollama_model


settings = Settings()
