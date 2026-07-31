from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session

settings = get_settings()

_bearer_scheme = HTTPBearer(auto_error=False)

_TOKEN_KIND = "resident"


class CurrentResident:
    def __init__(self, resident_id: UUID, association_id: UUID, full_name: str) -> None:
        self.resident_id = resident_id
        self.association_id = association_id
        self.full_name = full_name


def create_resident_token(resident_id: UUID, association_id: UUID, full_name: str, token_version: int) -> str:
    expire = datetime.now(UTC) + timedelta(days=7)
    payload = {
        "kind": _TOKEN_KIND,
        "sub": str(resident_id),
        "association_id": str(association_id),
        "full_name": full_name,
        "tv": int(token_version),
        "exp": expire,
        "iat": datetime.now(UTC),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


async def get_current_resident(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> CurrentResident:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sessão inválida ou expirada. Faça login novamente.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if creds is None:
        raise unauthorized
    try:
        payload = jwt.decode(creds.credentials, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        raise unauthorized

    if payload.get("kind") != _TOKEN_KIND:
        raise unauthorized

    resident_id = UUID(payload["sub"])
    row = (await session.execute(
        text("SELECT association_id, full_name, token_version FROM residents WHERE id = :rid"),
        {"rid": resident_id},
    )).fetchone()
    if not row:
        raise unauthorized

    if int(payload.get("tv", 0)) != int(row[2] or 0):
        raise unauthorized

    return CurrentResident(resident_id=resident_id, association_id=row[0], full_name=row[1])
