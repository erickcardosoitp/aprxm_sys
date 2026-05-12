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

    async def authenticate(self, email: str, password: str, association_id: UUID | None = None, remember_me: bool = False) -> str:
        # Busca por email + associação quando disponível, fallback global
        stmt = select(User).where(User.email == email, User.is_active == True)  # noqa: E712
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
                SELECT uar.association_id, uar.role, a.name, a.is_office
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
            """), {"uid": str(user.id), "preferred": str(association_id) if association_id else str(user.association_id)})
            memberships = memberships_result.fetchall()
        else:
            memberships = []

        if memberships:
            primary = memberships[0]
            primary_assoc_id   = primary[0]
            primary_role       = primary[1]
            association_name   = primary[2]
            is_office: bool    = bool(primary[3]) if primary[3] is not None else False
            linked_ids         = [str(m[0]) for m in memberships[1:]]
        else:
            # Fallback para usuários que ainda não passaram pela migração
            assoc_row = await self._session.execute(
                text("SELECT name, is_office FROM associations WHERE id = :id"),
                {"id": str(user.association_id)},
            )
            ar = assoc_row.fetchone()
            primary_assoc_id = user.association_id
            primary_role     = user.role.value
            association_name = ar[0] if ar else ""
            is_office        = bool(ar[1]) if ar else False
            linked_ids       = []

        return create_access_token(
            user.id, primary_assoc_id, primary_role, user.full_name, linked_ids, association_name,
            expire_days=30 if remember_me else None,
            is_office=is_office,
        )

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
