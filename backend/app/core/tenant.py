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
        association_id: UUID | None,
        role: str,
        linked_association_ids: list[UUID] | None = None,
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
        base = [self.association_id] if self.association_id else []
        return base + [i for i in self.linked_association_ids if i != self.association_id]

    @property
    def is_admin_master(self) -> bool:
        return self.role in ("admin_master", "superadmin")

    @property
    def is_admin(self) -> bool:
        return self.role in ("admin", "admin_master", "superadmin", "diretoria", "conselho")

    @property
    def is_conferente(self) -> bool:
        return self.role in ("conferente", "admin", "admin_master", "superadmin", "diretoria", "conselho")

    @property
    def is_diretoria(self) -> bool:
        return self.role in ("diretoria_adjunta", "diretoria", "admin", "admin_master", "superadmin", "conselho")

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

    @property
    def is_esc_station(self) -> bool:
        """Estacionado na linha Escritório da empresa (Fase 9): association_id == empresa_id."""
        return (
            self.empresa_id is not None
            and self.association_id is not None
            and self.association_id == self.empresa_id
        )

    @property
    def is_legacy_wide(self) -> bool:
        """Fallback transicional: admin_master/superadmin sem association_id ainda remapeado."""
        return (
            self.empresa_id is not None
            and self.association_id is None
            and self.role in ("admin_master", "superadmin")
        )

    @property
    def is_empresa_wide(self) -> bool:
        return self.is_esc_station or self.is_legacy_wide


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
    association_id_claim = payload.get("association_id")
    return CurrentUser(
        user_id=user_id,
        association_id=UUID(association_id_claim) if association_id_claim else None,
        role=payload["role"],
        linked_association_ids=linked_ids,
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


def assert_same_empresa(current: CurrentUser, target_empresa_id: UUID | None) -> None:
    """Superadmin de plataforma passa livre. admin_master so mexe na propria empresa."""
    if current.is_platform_admin:
        return
    if target_empresa_id is None or current.empresa_id != target_empresa_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem acesso a essa empresa.")


# Template padrao exibido quando a empresa ainda nao configurou permissoes
# (empresas.access_groups vazio). O admin ve um ponto de partida e salva.
# Vive aqui (nao em esc.py) para poder ser consultado por require_esc_module
# sem import circular (esc.py importa deste modulo).
_DEFAULT_ACCESS_GROUPS = {
    "operator":          {"residents": ["view"], "packages": ["view", "create"], "service_orders": ["view"], "finance": ["view", "create"], "admin": [], "settings": [], "financeiro": []},
    "conferente":        {"residents": ["view", "create", "edit"], "packages": ["view", "create", "edit"], "service_orders": ["view", "create", "edit"], "finance": ["view", "create", "edit"], "admin": [], "settings": ["view"], "financeiro": []},
    "diretoria_adjunta": {"residents": ["view"], "packages": ["view"], "service_orders": ["view", "create", "edit"], "finance": ["view"], "admin": [], "settings": [], "financeiro": []},
    "diretoria":         {"residents": ["view"], "packages": ["view"], "service_orders": ["view"], "finance": ["view"], "admin": ["view"], "settings": ["view"], "financeiro": ["view"]},
    "conselho":          {"residents": ["view"], "packages": ["view"], "service_orders": ["view"], "finance": ["view"], "admin": ["view"], "settings": ["view"], "financeiro": ["view"]},
    "admin":             {"residents": ["view", "create", "edit", "delete"], "packages": ["view", "create", "edit", "delete"], "service_orders": ["view", "create", "edit", "delete"], "finance": ["view", "create", "edit", "delete"], "admin": ["view", "create", "edit", "delete"], "settings": ["view", "edit"], "financeiro": ["view", "create", "edit", "delete"]},
    "admin_master":      {"residents": ["view", "create", "edit", "delete"], "packages": ["view", "create", "edit", "delete"], "service_orders": ["view", "create", "edit", "delete"], "finance": ["view", "create", "edit", "delete"], "admin": ["view", "create", "edit", "delete"], "settings": ["view", "edit"], "financeiro": ["view", "create", "edit", "delete"]},
    "superadmin":        {"residents": ["view", "create", "edit", "delete"], "packages": ["view", "create", "edit", "delete"], "service_orders": ["view", "create", "edit", "delete"], "finance": ["view", "create", "edit", "delete"], "admin": ["view", "create", "edit", "delete"], "settings": ["view", "edit"], "financeiro": ["view", "create", "edit", "delete"]},
}


async def financeiro_scope(
    current: CurrentUser,
    session: AsyncSession,
    unidade: UUID | None = None,
) -> list[UUID]:
    """
    Resolve os association_id que o chamador pode ver no Financeiro.

    - Empresa sem financeiro_centralizado (ou usuario sem empresa): comportamento
      atual, escopado a propria associacao.
    - Empresa centralizada + chamador ESC-stationed (ou legacy wide): todas as
      unidades da empresa, ou so `unidade` se informado (visao agregada no ESC).
    - Empresa centralizada + chamador de associacao (nao ESC): tambem escopado a
      propria associacao (nao bloqueia) - a unidade continua operando o financeiro
      localmente; centralizacao so adiciona a visao agregada no ESC, nao remove o
      acesso local. (Antes bloqueava com 403 - decisao revertida a pedido.)
    - Empresa centralizada + ESC-stationed sem "financeiro:view" no grid de
      permissoes (access_groups): 403 - nem todo ESC ve o modulo.
    """
    if current.empresa_id is None:
        return [current.association_id]

    row = (await session.execute(
        text("SELECT financeiro_centralizado, access_groups FROM empresas WHERE id = :eid"),
        {"eid": str(current.empresa_id)},
    )).fetchone()
    centralizado = bool(row[0]) if row else False

    if not centralizado:
        return [current.association_id]

    if not current.is_empresa_wide:
        return [current.association_id]

    access_groups = row[1] if row and row[1] else _DEFAULT_ACCESS_GROUPS
    if "view" not in access_groups.get(current.role, {}).get("financeiro", []):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sem permissão de acesso ao módulo financeiro.",
        )

    if unidade is not None:
        check = (await session.execute(
            text("SELECT 1 FROM associations WHERE id = :aid AND empresa_id = :eid"),
            {"aid": str(unidade), "eid": str(current.empresa_id)},
        )).fetchone()
        if not check:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unidade não encontrada nesta empresa.")
        return [unidade]

    rows = (await session.execute(
        text("SELECT id FROM associations WHERE empresa_id = :eid"),
        {"eid": str(current.empresa_id)},
    )).fetchall()
    return [r[0] for r in rows]


def require_esc_module(module: str):
    """Dependency factory: require_empresa_admin + permissao de 'view' no modulo (access_groups)."""

    async def _check(
        current: CurrentUser = Depends(require_empresa_admin),
        session: AsyncSession = Depends(get_session),
    ) -> CurrentUser:
        row = (await session.execute(
            text("SELECT access_groups FROM empresas WHERE id = :eid"),
            {"eid": str(current.empresa_id)},
        )).fetchone()
        access_groups = row[0] if row and row[0] else _DEFAULT_ACCESS_GROUPS
        perms = access_groups.get(current.role, {}).get(module, [])
        if "view" not in perms:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Sem permissão de acesso ao módulo {module}.",
            )
        return current

    return _check
