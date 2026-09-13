import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "OpenFolioLM"
    data_dir: str = "data"
    db_path: str = "data/openfolio.db"
    upload_dir: str = "data/uploads"
    
    # LLM Settings (OpenAI-compatible: works with Ollama, DeepSeek, OpenAI, vLLM)
    llm_base_url: str = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")
    llm_api_key: str = os.getenv("LLM_API_KEY", "ollama")
    llm_model: str = os.getenv("LLM_MODEL", "deepseek-r1:latest")


settings = Settings()
