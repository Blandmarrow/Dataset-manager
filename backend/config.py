from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Paths
    base_dir: Path = Path(__file__).parent.parent
    data_dir: Path = Path(__file__).parent.parent / "data"
    datasets_dir: Path = Path(__file__).parent.parent / "data" / "datasets"
    models_cache_dir: Path = Path(__file__).parent.parent / "models_cache"

    # Database (absolute path so it's consistent regardless of working directory)
    database_url: str = f"sqlite+aiosqlite:///{Path(__file__).parent.parent / 'dataset_manager.db'}"

    # HuggingFace
    hf_token: str = ""

    # Booru APIs
    gelbooru_api_key: str = ""
    gelbooru_user_id: str = ""

    # ML settings
    max_vram_mb: int = 20000
    ollama_base_url: str = "http://localhost:11434"
    ollama_image_max_px: int = 1024  # resize images before sending to Ollama

    # Thumbnail settings
    thumbnail_size: int = 256

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.datasets_dir.mkdir(parents=True, exist_ok=True)
        self.models_cache_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
