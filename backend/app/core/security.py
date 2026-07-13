import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

import bcrypt
from jose import JWTError, jwt

from app.config import get_settings

settings = get_settings()


def generate_refresh_token() -> tuple[str, str]:
    """Retorna (token_raw, token_hash). Armazenar apenas o hash."""
    raw = secrets.token_urlsafe(48)
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, hashed


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(
    subject: UUID,
    association_id: UUID,
    role: str,
    full_name: str = "",
    linked_association_ids: list[str] | None = None,
    association_name: str = "",
    expire_days: int | None = None,
    is_office: bool = False,
    token_version: int = 0,
    empresa_id: UUID | str | None = None,
) -> str:
    if expire_days:
        expire = datetime.now(UTC) + timedelta(days=expire_days)
    else:
        expire = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {
        "sub": str(subject),
        "association_id": str(association_id),
        "role": role,
        "full_name": full_name,
        "linked_association_ids": linked_association_ids or [],
        "association_name": association_name,
        "is_office": is_office,
        "tv": int(token_version),
        "empresa_id": str(empresa_id) if empresa_id else None,
        "exp": expire,
        "iat": datetime.now(UTC),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError as exc:
        raise ValueError("Token inválido ou expirado") from exc
