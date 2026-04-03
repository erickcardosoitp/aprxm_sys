from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    app_name: str = "APROXIMA"
    app_version: str = "1.0.0"
    app_env: Literal["development", "staging", "production"] = "development"

    # Database
    database_url: str

    # Security
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7

    # CORS
    allowed_origins: str = "http://localhost:5173"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]

    # Storage — Supabase
    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_storage_bucket: str = "aprxm-midia"

    # Business rules
    delivery_fee_default: float = 2.50


@lru_cache
def get_settings() -> Settings:
    return Settings()
