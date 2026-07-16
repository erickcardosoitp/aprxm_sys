"""
Login do painel de governança (painel-aprxm) — isolado do /auth do app
operacional. Autentica contra `painel_admins`, nunca contra `users`.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.limiter import limiter
from app.core.painel_auth import create_painel_token
from app.core.security import verify_password
from app.database import get_session
from app.models.painel_admin import PainelAdmin

router = APIRouter(prefix="/painel-auth", tags=["Painel — Auth"])


class PainelLoginRequest(BaseModel):
    email: str
    password: str


class PainelTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=PainelTokenResponse, summary="Login do painel de governança")
@limiter.limit("10/minute")
async def painel_login(
    request: Request,
    body: PainelLoginRequest,
    session: AsyncSession = Depends(get_session),
) -> PainelTokenResponse:
    admin = (await session.execute(
        select(PainelAdmin).where(PainelAdmin.email == body.email, PainelAdmin.is_active == True)  # noqa: E712
    )).scalar_one_or_none()

    if not admin or not verify_password(body.password, admin.hashed_password):
        raise HTTPException(status_code=401, detail="Credenciais inválidas.")

    token = create_painel_token(admin.id, admin.email)
    return PainelTokenResponse(access_token=token)
