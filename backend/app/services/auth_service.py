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

    async def authenticate(self, email: str, password: str, association_id: UUID) -> str:
        stmt = select(User).where(
            User.email == email,
            User.association_id == association_id,
            User.is_active == True,  # noqa: E712
        )
        result = await self._session.execute(stmt)
        user = result.scalar_one_or_none()

        if not user or not verify_password(password, user.hashed_password):
            raise ForbiddenError("Credenciais inválidas.")

        user.last_login_at = datetime.utcnow()
        self._session.add(user)

        # Resolve linked associations for aggregator accounts (raw SQL — evita bug asyncpg+ARRAY)
        linked_ids: list[str] = []
        slugs_row = await self._session.execute(
            text("SELECT linked_association_slugs FROM associations WHERE id = :id"),
            {"id": str(user.association_id)},
        )
        slugs_result = slugs_row.fetchone()
        linked_slugs: list[str] = slugs_result[0] if slugs_result and slugs_result[0] else []
        if linked_slugs:
            ids_row = await self._session.execute(
                text("SELECT id FROM associations WHERE slug = ANY(:slugs)"),
                {"slugs": linked_slugs},
            )
            linked_ids = [str(r[0]) for r in ids_row.fetchall()]

        # Fetch association name for JWT
        assoc_name_row = await self._session.execute(
            text("SELECT name FROM associations WHERE id = :id"),
            {"id": str(user.association_id)},
        )
        assoc_name_result = assoc_name_row.fetchone()
        association_name = assoc_name_result[0] if assoc_name_result else ""

        return create_access_token(
            user.id, user.association_id, user.role.value, user.full_name, linked_ids, association_name
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

    async def get_by_id(self, user_id: UUID, association_id: UUID) -> User:
        stmt = select(User).where(
            User.id == user_id,
            User.association_id == association_id,
        )
        result = await self._session.execute(stmt)
        user = result.scalar_one_or_none()
        if not user:
            raise NotFoundError("Usuário")
        return user
