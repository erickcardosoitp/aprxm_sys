from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.security import decode_access_token
from app.database import get_session

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


class CurrentUser:
    def __init__(
        self,
        user_id: UUID,
        association_id: UUID,
        role: str,
        linked_association_ids: list[UUID] | None = None,
        is_office: bool = False,
        association_name: str = "",
        restrict_edit_tx: bool = False,
        restrict_reverse_tx: bool = False,
        require_own_cash_session: bool = False,
        empresa_id: UUID | None = None,
    ) -> None:
        self.user_id = user_id
        self.association_id = association_id
        self.role = role
        self.linked_association_ids: list[UUID] = linked_association_ids or []
        self.is_office = is_office
        self.association_name = association_name
        self.restrict_edit_tx = restrict_edit_tx
        self.restrict_reverse_tx = restrict_reverse_tx
        self.require_own_cash_session = require_own_cash_session
        self.empresa_id = empresa_id

    @property
    def is_aggregator(self) -> bool:
        return len(self.linked_association_ids) > 0

    def scoped_ids(self, slug_filter: str | None = None) -> list[UUID]:
        """Returns all association IDs accessible to this user (primary + linked)."""
        ids = [self.association_id] + [i for i in self.linked_association_ids if i != self.association_id]
        return ids

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

    @property
    def is_platform_admin(self) -> bool:
        """Superadmin da plataforma (dono do SaaS) — cross-empresa."""
        return self.role == "superadmin"

    @property
    def is_empresa_admin(self) -> bool:
        """Admin da empresa (cliente) — escopado à própria empresa via empresa_id."""
        return self.role in ("admin_master", "superadmin")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_session),
) -> CurrentUser:
    try:
        payload = decode_access_token(token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user_id = UUID(payload["sub"])
    row = await session.execute(
        text(
            "SELECT is_active, restrict_edit_tx, restrict_reverse_tx, "
            "require_own_cash_session, token_version FROM users WHERE id = :uid"
        ),
        {"uid": user_id},
    )
    user_row = row.fetchone()
    if not user_row or not user_row[0]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário não encontrado ou desativado.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Revogacao em tempo real: token antigo sem claim 'tv' vale 0, que casa
    # com o DEFAULT 0 da coluna - ninguem e deslogado por isso sozinho.
    # Ao incrementar token_version (troca de senha, role, desativacao etc),
    # tokens ja emitidos passam a divergir e sao rejeitados imediatamente.
    tv_claim = int(payload.get("tv", 0))
    if tv_claim != int(user_row[4]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sessão expirada. Faça login novamente.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    linked_ids = [UUID(i) for i in payload.get("linked_association_ids", [])]
    empresa_id_claim = payload.get("empresa_id")
    return CurrentUser(
        user_id=user_id,
        association_id=UUID(payload["association_id"]),
        role=payload["role"],
        linked_association_ids=linked_ids,
        is_office=bool(payload.get("is_office", False)),
        association_name=payload.get("association_name", ""),
        restrict_edit_tx=bool(user_row[1]),
        restrict_reverse_tx=bool(user_row[2]),
        require_own_cash_session=bool(user_row[3]),
        empresa_id=UUID(empresa_id_claim) if empresa_id_claim else None,
    )


async def require_admin(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissão de administrador necessária.")
    return current


async def require_admin_master(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current.is_admin_master:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissão de admin master necessária.")
    return current


async def require_conferente(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current.is_conferente:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissão de conferente ou superior necessária.")
    return current


async def require_diretoria(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current.is_diretoria:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissão de Diretoria Adjunta ou superior necessária.")
    return current


async def require_platform_admin(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Superadmin da plataforma (dono do SaaS) - cross-empresa. Gerencia empresas."""
    if not current.is_platform_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissão de superadmin da plataforma necessária.")
    return current


async def require_empresa_admin(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Admin da empresa (cliente) - admin_master ou superadmin, escopado a current.empresa_id."""
    if not current.is_empresa_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissão de admin da empresa necessária.")
    return current


async def require_office_context(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Modulos Financeiro/Admin/TI so operam a partir da unidade Escritorio.
    Superadmin de plataforma sempre passa (acesso irrestrito de suporte)."""
    if not current.is_office and not current.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Este módulo só está disponível operando a partir do Escritório.",
        )
    return current


def assert_same_empresa(current: CurrentUser, target_empresa_id: UUID | None) -> None:
    """Superadmin de plataforma passa livre. admin_master so mexe na propria empresa."""
    if current.is_platform_admin:
        return
    if target_empresa_id is None or current.empresa_id != target_empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem acesso a essa empresa.")
