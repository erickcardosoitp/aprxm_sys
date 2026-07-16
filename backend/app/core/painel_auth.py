from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

from app.config import get_settings

_settings = get_settings()

# Isolado do OAuth2PasswordBearer do app principal (tokenUrl proprio) —
# nenhum token de um sistema e aceito como Authorization de outro, mesmo
# que o esquema Bearer pareca identico.
_painel_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/painel-auth/login")


def _require_painel_secret() -> str:
    if not _settings.painel_secret_key:
        raise RuntimeError(
            "PAINEL_SECRET_KEY nao configurada — auth do painel exige um segredo "
            "proprio, isolado do SECRET_KEY do app operacional."
        )
    return _settings.painel_secret_key


def create_painel_token(admin_id: UUID, email: str) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=_settings.painel_access_token_expire_minutes)
    payload = {
        "sub": str(admin_id),
        "email": email,
        "aud": "painel-aprxm",
        "exp": expire,
        "iat": datetime.now(UTC),
    }
    return jwt.encode(payload, _require_painel_secret(), algorithm=_settings.algorithm)


def decode_painel_token(token: str) -> dict:
    try:
        return jwt.decode(token, _require_painel_secret(), algorithms=[_settings.algorithm], audience="painel-aprxm")
    except JWTError as exc:
        raise ValueError("Token do painel inválido ou expirado") from exc


class PainelCurrentAdmin:
    def __init__(self, admin_id: UUID, email: str) -> None:
        self.admin_id = admin_id
        self.email = email


async def require_painel_admin(token: str = Depends(_painel_oauth2_scheme)) -> PainelCurrentAdmin:
    try:
        payload = decode_painel_token(token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    return PainelCurrentAdmin(admin_id=UUID(payload["sub"]), email=payload["email"])
