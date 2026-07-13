from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from datetime import UTC, datetime, timedelta

from app.config import get_settings
from app.core.security import hash_password, verify_password, generate_refresh_token, hash_refresh_token, create_access_token
from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session
from app.models.association import Association
from app.models.user import User, UserRole
from app.services.auth_service import AuthService
from app.core.limiter import limiter

_settings = get_settings()

router = APIRouter(prefix="/auth", tags=["Autenticação"])


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class LoginRequest(BaseModel):
    email: str
    password: str
    association_id: UUID | None = None  # opcional: se omitido, usa associação de maior role
    remember_me: bool = False


@router.post("/token", response_model=TokenResponse, summary="Login")
@limiter.limit("10/minute")
async def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """
    Login OAuth2. username = email  ou  email::association_id (compatibilidade).
    """
    email, _, assoc_str = form.username.partition("::")
    assoc_id = UUID(assoc_str) if assoc_str else None
    svc = AuthService(session)
    token, _user, _aid = await svc.authenticate(email, form.password, assoc_id)
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse, summary="Login (JSON)")
@limiter.limit("10/minute")
async def login_json(
    request: Request,
    body: LoginRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    from sqlalchemy import text as _t
    svc = AuthService(session)
    access_token, user, primary_assoc_id = await svc.authenticate(
        body.email, body.password, body.association_id, body.remember_me
    )

    # Usa o MESMO usuário e a MESMA associação que geraram o access_token —
    # nunca reconsultar por e-mail aqui, senão o refresh token pode ficar
    # amarrado a uma linha diferente da que autenticou (quando o e-mail
    # tem mais de uma linha, uma por associação).
    raw, hashed = generate_refresh_token()
    expires = datetime.now(UTC) + timedelta(days=_settings.refresh_token_expire_days)
    await session.execute(_t("""
        INSERT INTO refresh_tokens (user_id, association_id, token_hash, expires_at)
        VALUES (:uid, :aid, :hash, :exp)
    """), {"uid": str(user.id), "aid": str(primary_assoc_id), "hash": hashed, "exp": expires})
    await session.commit()

    return TokenResponse(access_token=access_token, refresh_token=raw)


@router.post("/refresh", response_model=TokenResponse, summary="Renovar access token")
@limiter.limit("20/minute")
async def refresh_token(
    request: Request,
    body: RefreshRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    from sqlalchemy import text as _t
    token_hash = hash_refresh_token(body.refresh_token)
    row = (await session.execute(_t("""
        SELECT rt.id, rt.user_id, rt.association_id, rt.expires_at,
               u.full_name, u.role, u.is_active
        FROM refresh_tokens rt
        JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = :hash AND rt.revoked = FALSE
    """), {"hash": token_hash})).fetchone()

    if not row:
        raise HTTPException(status_code=401, detail="Refresh token inválido.")
    if not row[6]:  # is_active
        raise HTTPException(status_code=401, detail="Usuário inativo.")
    if row[3] < datetime.now(UTC):
        raise HTTPException(status_code=401, detail="Refresh token expirado.")

    # Revoga o token atual (rotação)
    await session.execute(_t(
        "UPDATE refresh_tokens SET revoked = TRUE WHERE id = :id"
    ), {"id": str(row[0])})

    # Emite novo access token
    access_token = create_access_token(
        row[1], row[2], row[5], row[4],
    )

    # Emite novo refresh token (rotação)
    raw, hashed = generate_refresh_token()
    expires = datetime.now(UTC) + timedelta(days=_settings.refresh_token_expire_days)
    await session.execute(_t("""
        INSERT INTO refresh_tokens (user_id, association_id, token_hash, expires_at)
        VALUES (:uid, :aid, :hash, :exp)
    """), {"uid": str(row[1]), "aid": str(row[2]), "hash": hashed, "exp": expires})
    await session.commit()

    return TokenResponse(access_token=access_token, refresh_token=raw)


@router.post("/logout", summary="Revogar refresh token")
async def logout(
    body: RefreshRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as _t
    token_hash = hash_refresh_token(body.refresh_token)
    await session.execute(_t(
        "UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = :hash"
    ), {"hash": token_hash})
    await session.commit()
    return {"detail": "Logout realizado."}


@router.get("/associations", summary="Associações disponíveis para um e-mail")
async def associations_for_email(
    email: str,
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """
    Returns all associations where this email has a user account.
    Checks both users.association_id (legacy) and user_association_roles.
    """
    from sqlalchemy import text as _t
    rows = (await session.execute(_t("""
        SELECT DISTINCT a.id, a.name, a.slug, uar.role
        FROM users u
        JOIN user_association_roles uar ON uar.user_id = u.id
        JOIN associations a ON a.id = uar.association_id
        WHERE u.email = :email
          AND u.is_active = TRUE
          AND uar.is_active = TRUE
          AND a.is_active = TRUE
        ORDER BY a.name
    """), {"email": email})).fetchall()

    if not rows:
        # Fallback legado: usuários sem UAR
        from sqlmodel import select as _sel
        legacy = (await session.execute(
            _sel(Association, User)
            .join(User, User.association_id == Association.id)
            .where(User.email == email, User.is_active == True, Association.is_active == True)  # noqa: E712
        )).all()
        return [{"id": str(a.id), "name": a.name, "slug": a.slug, "role": u.role.value} for a, u in legacy]

    return [{"id": str(r[0]), "name": r[1], "slug": r[2], "role": r[3]} for r in rows]


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
    user = (await session.execute(select(User).where(User.id == current.user_id))).scalar_one_or_none()
    assoc = (await session.execute(select(Association).where(Association.id == current.association_id))).scalar_one_or_none()
    return {
        "user_id": str(current.user_id),
        "association_id": str(current.association_id),
        "role": current.role,
        "full_name": user.full_name if user else "",
        "email": user.email if user else "",
        "simplifica_mode": user.simplifica_mode if user else False,
        "simplifica_enabled": assoc.simplifica_enabled if assoc else False,
    }


class PreferencesRequest(BaseModel):
    simplifica_mode: bool


@router.patch("/me/preferences", summary="Atualizar preferências do usuário")
async def update_preferences(
    body: PreferencesRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    user = (await session.execute(select(User).where(User.id == current.user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    user.simplifica_mode = body.simplifica_mode
    session.add(user)
    await session.commit()
    return {"simplifica_mode": user.simplifica_mode}
