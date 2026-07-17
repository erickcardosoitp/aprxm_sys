from datetime import datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.exceptions import ForbiddenError, NotFoundError
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def authenticate(self, email: str, password: str, association_id: UUID | None = None, remember_me: bool = False) -> tuple[str, User, UUID]:
        # Busca por email + associação quando disponível, fallback global.
        # Ordena por created_at para ter resultado determinístico quando o mesmo
        # e-mail tem mais de uma linha (uma por associação).
        stmt = select(User).where(User.email == email, User.is_active == True).order_by(User.created_at)  # noqa: E712
        if association_id:
            scoped = (await self._session.execute(
                stmt.where(User.association_id == association_id)
            )).scalars().first()
            user = scoped or (await self._session.execute(stmt)).scalars().first()
        else:
            user = (await self._session.execute(stmt)).scalars().first()

        if not user or not verify_password(password, user.hashed_password):
            raise ForbiddenError("Credenciais inválidas.")

        user.last_login_at = datetime.utcnow()
        self._session.add(user)

        # Memberships via user_association_roles (pós-migração)
        # Guard: tabela pode não existir em cold-starts antes da migração completar
        _uar_exists = (await self._session.execute(
            text("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_association_roles'")
        )).scalar()
        if _uar_exists:
            memberships_result = await self._session.execute(text("""
                SELECT uar.association_id, uar.role, a.name, a.empresa_id
                FROM user_association_roles uar
                JOIN associations a ON a.id = uar.association_id
                WHERE uar.user_id = :uid AND uar.is_active = TRUE AND a.is_active = TRUE
                ORDER BY
                    CASE WHEN uar.association_id = :preferred THEN 0 ELSE 1 END,
                    CASE uar.role::text
                        WHEN 'superadmin' THEN 1 WHEN 'admin_master' THEN 2
                        WHEN 'admin' THEN 3 WHEN 'diretoria' THEN 4
                        WHEN 'conselho' THEN 5 WHEN 'conferente' THEN 6
                        ELSE 7 END,
                    uar.created_at
            """), {
                "uid": str(user.id),
                "preferred": str(association_id) if association_id else (
                    str(user.association_id) if user.association_id else None
                ),
            })
            memberships = memberships_result.fetchall()
        else:
            memberships = []

        # Usuarios empresa-wide (admin_master/superadmin) enxergam TODAS as
        # associacoes da empresa — escopo derivado de users.empresa_id, nao de
        # memberships manuais. Assim associacoes novas aparecem automaticamente.
        is_empresa_wide = user.role.value in ("admin_master", "superadmin") and user.empresa_id is not None

        if is_empresa_wide:
            emp_assocs = (await self._session.execute(text("""
                SELECT id, name FROM associations
                WHERE empresa_id = :eid AND is_active = TRUE
                ORDER BY name
            """), {"eid": str(user.empresa_id)})).fetchall()
            primary_empresa_id = user.empresa_id
            primary_role       = user.role.value
            if emp_assocs:
                primary_assoc_id = emp_assocs[0][0]
                association_name = emp_assocs[0][1]
                linked_ids       = [str(r[0]) for r in emp_assocs[1:]]
            else:
                primary_assoc_id = None
                association_name = ""
                linked_ids       = []
        elif memberships:
            primary = memberships[0]
            primary_assoc_id   = primary[0]
            primary_role       = primary[1]
            association_name   = primary[2]
            primary_empresa_id = primary[3]
            # Um token = uma empresa: linked so com a mesma empresa da primaria.
            linked_ids = [
                str(m[0]) for m in memberships[1:]
                if m[3] == primary_empresa_id
            ]
        elif user.association_id is not None:
            # Fallback para usuários que ainda não passaram pela migração
            assoc_row = await self._session.execute(
                text("SELECT name, empresa_id FROM associations WHERE id = :id"),
                {"id": str(user.association_id)},
            )
            ar = assoc_row.fetchone()
            primary_assoc_id = user.association_id
            primary_role     = user.role.value
            association_name = ar[0] if ar else ""
            primary_empresa_id = ar[1] if ar else user.empresa_id
            linked_ids       = []
        else:
            # Sem membership, sem association_id — usa empresa_id do usuario se houver.
            primary_assoc_id = None
            primary_role     = user.role.value
            association_name = ""
            primary_empresa_id = user.empresa_id
            linked_ids       = []

        token = create_access_token(
            user.id, primary_assoc_id, primary_role, user.full_name, linked_ids, association_name,
            expire_days=30 if remember_me else None,
            token_version=user.token_version,
            empresa_id=primary_empresa_id,
        )
        return token, user, primary_assoc_id

    async def create_user(
        self,
        association_id: UUID,
        full_name: str,
        email: str,
        password: str,
        role: str = "operator",
        phone: str | None = None,
    ) -> User:
        user = User(
            association_id=association_id,
            full_name=full_name,
            email=email,
            phone=phone,
            hashed_password=hash_password(password),
            role=role,
        )
        self._session.add(user)
        await self._session.flush()
        return user

    async def get_by_id(self, user_id: UUID, association_id: UUID | None = None) -> User:
        stmt = select(User).where(User.id == user_id)
        result = await self._session.execute(stmt)
        user = result.scalar_one_or_none()
        if not user:
            raise NotFoundError("Usuário")
        return user
