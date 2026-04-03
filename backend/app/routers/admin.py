from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.security import hash_password
from app.core.tenant import CurrentUser, require_admin
from app.database import get_session
from app.models.user import User, UserRole

router = APIRouter(prefix="/admin", tags=["Administração"])


class CreateUserRequest(BaseModel):
    full_name: str
    email: str
    password: str
    role: UserRole = UserRole.operator
    phone: str | None = None


class UpdateUserRequest(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    password: str | None = None


def _serialize_user(u: User) -> dict:
    return {
        "id": str(u.id),
        "full_name": u.full_name,
        "email": u.email,
        "phone": u.phone,
        "role": u.role,
        "is_active": u.is_active,
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        "created_at": u.created_at.isoformat(),
    }


@router.get("/users", summary="Listar usuários da associação")
async def list_users(
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    stmt = (
        select(User)
        .where(User.association_id == current.association_id)
        .order_by(User.full_name)
    )
    result = await session.execute(stmt)
    return [_serialize_user(u) for u in result.scalars().all()]


@router.post("/users", summary="Criar usuário")
async def create_user(
    body: CreateUserRequest,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    # check email uniqueness within association
    stmt = select(User).where(
        User.email == body.email,
        User.association_id == current.association_id,
    )
    existing = (await session.execute(stmt)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="E-mail já cadastrado nesta associação.")
    user = User(
        association_id=current.association_id,
        full_name=body.full_name,
        email=body.email,
        phone=body.phone,
        hashed_password=hash_password(body.password),
        role=body.role,
    )
    session.add(user)
    await session.flush()
    return _serialize_user(user)


@router.put("/users/{user_id}", summary="Atualizar usuário")
async def update_user(
    user_id: UUID,
    body: UpdateUserRequest,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    stmt = select(User).where(
        User.id == user_id,
        User.association_id == current.association_id,
    )
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.phone is not None:
        user.phone = body.phone
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password:
        user.hashed_password = hash_password(body.password)
    from datetime import datetime
    user.updated_at = datetime.utcnow()
    session.add(user)
    return _serialize_user(user)


@router.delete("/users/{user_id}", summary="Desativar usuário")
async def deactivate_user(
    user_id: UUID,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if user_id == current.user_id:
        raise HTTPException(status_code=400, detail="Você não pode desativar sua própria conta.")
    stmt = select(User).where(
        User.id == user_id,
        User.association_id == current.association_id,
    )
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    user.is_active = False
    session.add(user)
    return {"id": str(user.id), "is_active": False}
