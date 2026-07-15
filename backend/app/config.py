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
    database_url_direct: str = ""

    # Security
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 120
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

    # Email (Gmail SMTP)
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = "erickcardoso@institutotiapretinha.org"
    smtp_password: str = ""
    smtp_from: str = "Associação de Moradores <erickcardoso@institutotiapretinha.org>"

    # Cron
    cron_secret: str = ""

    # Groq — LLM tool-use (Simplifica agent)
    groq_api_key: str = ""

    # Cloudflare R2 — Data Lake
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = "aprxm-datalake"

    # Neon Analytics (OLAP — Power BI)
    analytics_database_url: str = ""

    @property
    def analytics_db_url(self) -> str:
        return self.analytics_database_url.strip()

    # WebAuthn
    webauthn_rp_id: str = "localhost"
    webauthn_rp_name: str = "APRXM"
    webauthn_origin: str = "http://localhost:5173"

    # Web Push (VAPID)
    vapid_public_key: str = "BOcNCRtISdpFA9m4hvp2vacUuutGUsSTcBAERRnoCBKcjxSGzohZb7zDcwFW18JmbumwZrlEpg0cI0VcZfVSU_8"
    vapid_private_key: str = ""
    vapid_claims_sub: str = "mailto:erickcardoso@institutotiapretinha.org"



@lru_cache
def get_settings() -> Settings:
    return Settings()
