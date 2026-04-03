from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session
from app.models.association import Association
from app.models.user import User, UserRole
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["Autenticação"])


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    email: str
    password: str
    association_id: UUID


@router.post("/token", response_model=TokenResponse, summary="Login")
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """
    Login padrão OAuth2 (usado por clientes Swagger/OpenAPI).
    O campo `username` deve conter `email::association_id`.
    """
    email, _, assoc_str = form.username.partition("::")
    assoc_id = UUID(assoc_str)
    svc = AuthService(session)
    token = await svc.authenticate(email, form.password, assoc_id)
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse, summary="Login (JSON)")
async def login_json(
    body: LoginRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    svc = AuthService(session)
    token = await svc.authenticate(body.email, body.password, body.association_id)
    return TokenResponse(access_token=token)


@router.get("/associations", summary="Associações disponíveis para um e-mail")
async def associations_for_email(
    email: str,
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """
    Returns all associations where this email has a user account.
    Used in the login flow to populate the org selector.
    """
    from sqlmodel import select
    stmt = (
        select(Association, User)
        .join(User, User.association_id == Association.id)
        .where(User.email == email, User.is_active == True, Association.is_active == True)  # noqa: E712
    )
    result = await session.execute(stmt)
    rows = result.all()
    return [
        {"id": str(assoc.id), "name": assoc.name, "slug": assoc.slug, "role": user.role}
        for assoc, user in rows
    ]


@router.get("/me", summary="Perfil do usuário atual")
async def me(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlmodel import select
    stmt = select(User).where(User.id == current.user_id)
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()
    return {
        "user_id": str(current.user_id),
        "association_id": str(current.association_id),
        "role": current.role,
        "full_name": user.full_name if user else "",
        "email": user.email if user else "",
    }
