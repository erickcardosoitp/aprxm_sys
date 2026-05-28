from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.security import hash_password, verify_password
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
    association_id: UUID | None = None  # opcional: se omitido, usa associação de maior role
    remember_me: bool = False


@router.post("/token", response_model=TokenResponse, summary="Login")
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """
    Login OAuth2. username = email  ou  email::association_id (compatibilidade).
    """
    email, _, assoc_str = form.username.partition("::")
    assoc_id = UUID(assoc_str) if assoc_str else None
    svc = AuthService(session)
    token = await svc.authenticate(email, form.password, assoc_id)
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse, summary="Login (JSON)")
async def login_json(
    body: LoginRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    svc = AuthService(session)
    token = await svc.authenticate(body.email, body.password, body.association_id, body.remember_me)
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
        {"id": str(assoc.id), "name": assoc.name, "slug": assoc.slug, "role": user.role.value}
        for assoc, user in rows
    ]


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password", summary="Alterar própria senha")
async def change_password(
    body: ChangePasswordRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if current.role in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Administradores devem alterar a senha pelo painel de admin.")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=422, detail="A nova senha deve ter pelo menos 6 caracteres.")

    result = await session.execute(select(User).where(User.id == current.user_id))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Senha atual incorreta.")

    user.hashed_password = hash_password(body.new_password)
    session.add(user)
    await session.commit()
    return {"detail": "Senha alterada com sucesso."}


class SwitchAssociationRequest(BaseModel):
    association_id: UUID


@router.get("/my-associations", summary="Ambientes disponíveis para o usuário atual")
async def my_associations(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text as _t
    rows = (await session.execute(_t("""
        SELECT a.id, a.name, a.slug, uar.role
        FROM user_association_roles uar
        JOIN associations a ON a.id = uar.association_id
        WHERE uar.user_id = :uid AND uar.is_active = TRUE AND a.is_active = TRUE
        ORDER BY a.name
    """), {"uid": str(current.user_id)})).fetchall()
    # Fallback: se ainda não migrado, busca pelo email legado
    if not rows:
        result = await session.execute(select(User).where(User.id == current.user_id))
        user = result.scalar_one_or_none()
        if not user:
            # Token válido mas user não existe no banco (ghost user / token stale).
            # Retorna a associação do token para não quebrar o app.
            from sqlmodel import select as _sel
            assoc = (await session.execute(
                _sel(Association).where(Association.id == current.association_id)
            )).scalar_one_or_none()
            if assoc:
                return [{"id": str(assoc.id), "name": assoc.name, "slug": assoc.slug,
                         "role": current.role, "current": True}]
            return []
        stmt = (
            select(Association, User)
            .join(User, User.association_id == Association.id)
            .where(User.email == user.email, User.is_active == True, Association.is_active == True)  # noqa: E712
        )
        legacy = (await session.execute(stmt)).all()
        return [{"id": str(a.id), "name": a.name, "slug": a.slug, "role": u.role,
                 "current": str(a.id) == str(current.association_id)} for a, u in legacy]
    return [{"id": str(r[0]), "name": r[1], "slug": r[2], "role": r[3],
             "current": str(r[0]) == str(current.association_id)} for r in rows]


@router.post("/switch-association", response_model=TokenResponse, summary="Trocar de ambiente")
async def switch_association(
    body: SwitchAssociationRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    from sqlalchemy import text as sa_text
    result = await session.execute(select(User).where(User.id == current.user_id))
    current_user = result.scalar_one_or_none()
    if not current_user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    # Verifica acesso via user_association_roles (modelo global)
    target_row = (await session.execute(sa_text("""
        SELECT uar.role, a.name, a.is_office
        FROM user_association_roles uar
        JOIN associations a ON a.id = uar.association_id
        WHERE uar.user_id = :uid AND uar.association_id = :aid
          AND uar.is_active = TRUE AND a.is_active = TRUE
    """), {"uid": str(current.user_id), "aid": str(body.association_id)})).fetchone()

    if not target_row:
        raise HTTPException(status_code=403, detail="Sem acesso a este ambiente.")

    from datetime import datetime as dt
    current_user.last_login_at = dt.utcnow()
    session.add(current_user)

    # Todas as outras associações do usuário
    other_rows = (await session.execute(sa_text("""
        SELECT uar.association_id FROM user_association_roles uar
        JOIN associations a ON a.id = uar.association_id
        WHERE uar.user_id = :uid AND uar.association_id != :aid
          AND uar.is_active = TRUE AND a.is_active = TRUE
    """), {"uid": str(current.user_id), "aid": str(body.association_id)})).fetchall()
    linked_ids = [str(r[0]) for r in other_rows]

    from app.core.security import create_access_token
    token = create_access_token(
        current_user.id, body.association_id, target_row[0],
        current_user.full_name, linked_ids, target_row[1],
        is_office=bool(target_row[2]) if target_row[2] is not None else False,
    )
    return TokenResponse(access_token=token)


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
