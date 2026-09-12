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
    # Default (3/7) e seguro pra Vercel serverless (N instancias, cada uma com seu
    # pool - ver comentario em database.py). Na VM (1 processo fixo), subir via env
    # var, sem precisar mudar codigo (docs/superpowers/plans/2026-09-12-migracao-aprxm-execucao.md, Fase C).
    db_pool_size: int = 3
    db_max_overflow: int = 7

    # Security
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 120
    refresh_token_expire_days: int = 7

    # Painel de Governanca (painel-aprxm) — auth isolada do app operacional,
    # de proposito: nao compartilha secret nem usuarios com o sistema principal.
    painel_secret_key: str = ""
    painel_access_token_expire_minutes: int = 120

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

    # Neon "aprxm-analytics" — data warehouse dedicado (gold: dim_/fact_, empresa-aware)
    datawarehouse_aprxm_database_url: str = ""

    @property
    def datawarehouse_db_url(self) -> str:
        return self.datawarehouse_aprxm_database_url.strip()

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


def validate_production_config() -> None:
    """Falha cedo no boot em producao se a config critica estiver incompleta.
    Ver docs/superpowers/plans/2026-09-12-migracao-aprxm-execucao.md, Fase F."""
    s = get_settings()
    if s.app_env != "production":
        return

    if not s.cron_secret:
        raise RuntimeError(
            "CRON_SECRET vazio em produção — os 8 endpoints de cron ficam "
            "sem autenticação. Configure a env var antes de subir."
        )
    if s.vapid_private_key == "" and s.vapid_public_key:
        import logging
        logging.getLogger(__name__).warning(
            "VAPID_PUBLIC_KEY configurada sem VAPID_PRIVATE_KEY correspondente — "
            "push notifications vão falhar silenciosamente."
        )
