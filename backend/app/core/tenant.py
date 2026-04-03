from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.core.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


class CurrentUser:
    def __init__(self, user_id: UUID, association_id: UUID, role: str) -> None:
        self.user_id = user_id
        self.association_id = association_id
        self.role = role

    @property
    def is_admin(self) -> bool:
        return self.role in ("admin", "superadmin")

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

    return CurrentUser(
        user_id=UUID(payload["sub"]),
        association_id=UUID(payload["association_id"]),
        role=payload["role"],
    )


async def require_admin(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissão de administrador necessária.")
    return current
