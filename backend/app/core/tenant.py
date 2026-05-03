from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.core.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


class CurrentUser:
    def __init__(
        self,
        user_id: UUID,
        association_id: UUID,
        role: str,
        linked_association_ids: list[UUID] | None = None,
        is_office: bool = False,
    ) -> None:
        self.user_id = user_id
        self.association_id = association_id
        self.role = role
        self.linked_association_ids: list[UUID] = linked_association_ids or []
        self.is_office = is_office

    @property
    def is_aggregator(self) -> bool:
        return len(self.linked_association_ids) > 0

    def scoped_ids(self, slug_filter: str | None = None) -> list[UUID]:
        """Returns association IDs to filter by. For aggregators, returns linked IDs."""
        if not self.is_aggregator:
            return [self.association_id]
        return self.linked_association_ids

    @property
    def is_admin_master(self) -> bool:
        return self.role in ("admin_master", "superadmin")

    @property
    def is_admin(self) -> bool:
        return self.role in ("admin", "admin_master", "superadmin", "diretoria", "conselho")

    @property
    def is_conferente(self) -> bool:
        return self.role in ("conferente", "admin", "superadmin", "diretoria", "conselho")

    @property
    def is_diretoria(self) -> bool:
        return self.role in ("diretoria_adjunta", "diretoria", "admin", "superadmin", "conselho")

    @property
    def is_superadmin(self) -> bool:
        return self.role == "superadmin"


async def get_current_user(token: str = Depends(oauth2_scheme)) -> CurrentUser:
    try:
        payload = decode_access_token(token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    linked_ids = [UUID(i) for i in payload.get("linked_association_ids", [])]
    return CurrentUser(
        user_id=UUID(payload["sub"]),
        association_id=UUID(payload["association_id"]),
        role=payload["role"],
        linked_association_ids=linked_ids,
        is_office=bool(payload.get("is_office", False)),
    )


async def require_admin(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissão de administrador necessária.")
    return current


async def require_conferente(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current.is_conferente:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissão de conferente ou superior necessária.")
    return current


async def require_diretoria(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current.is_diretoria:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissão de Diretoria Adjunta ou superior necessária.")
    return current
