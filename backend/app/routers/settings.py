from datetime import datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.tenant import CurrentUser, get_current_user, require_admin, require_conferente
from app.database import get_session
from app.models.settings import AssociationSettings

router = APIRouter(prefix="/settings", tags=["Configurações"])


class UpdateSettingsRequest(BaseModel):
    default_cash_balance: Decimal = Field(ge=0)
    max_cash_before_sangria: Decimal = Field(ge=0)


class UpdateAssocDataRequest(BaseModel):
    assoc_name: str | None = None
    assoc_phone: str | None = None
    assoc_email: str | None = None
    assoc_address: str | None = None
    assoc_cep: str | None = None
    president_user_id: UUID | None = None


@router.get("", summary="Configurações da associação")
async def get_settings(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    stmt = select(AssociationSettings).where(
        AssociationSettings.association_id == current.association_id
    )
    result = await session.execute(stmt)
    cfg = result.scalar_one_or_none()
    if not cfg:
        return {
            "association_id": str(current.association_id),
            "default_cash_balance": "200.00",
            "max_cash_before_sangria": "500.00",
        }
    return {
        "association_id": str(cfg.association_id),
        "default_cash_balance": str(cfg.default_cash_balance),
        "max_cash_before_sangria": str(cfg.max_cash_before_sangria),
    }


@router.put("", summary="Atualizar configurações (conferente+)")
async def update_settings(
    body: UpdateSettingsRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    stmt = select(AssociationSettings).where(
        AssociationSettings.association_id == current.association_id
    )
    result = await session.execute(stmt)
    cfg = result.scalar_one_or_none()
    if cfg:
        cfg.default_cash_balance = body.default_cash_balance
        cfg.max_cash_before_sangria = body.max_cash_before_sangria
        cfg.updated_at = datetime.utcnow()
        cfg.updated_by = current.user_id
    else:
        cfg = AssociationSettings(
            association_id=current.association_id,
            default_cash_balance=body.default_cash_balance,
            max_cash_before_sangria=body.max_cash_before_sangria,
            updated_by=current.user_id,
        )
    session.add(cfg)
    await session.flush()
    return {
        "association_id": str(cfg.association_id),
        "default_cash_balance": str(cfg.default_cash_balance),
        "max_cash_before_sangria": str(cfg.max_cash_before_sangria),
    }


@router.get("/association", summary="Dados da associação")
async def get_assoc_data(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        text("SELECT name, phone, email, address_street, address_zip FROM associations WHERE id = :id"),
        {"id": str(current.association_id)},
    )
    row = result.fetchone()
    cfg_result = await session.execute(
        text("SELECT assoc_name, assoc_phone, assoc_email, assoc_address, assoc_cep, president_user_id FROM association_settings WHERE association_id = :id"),
        {"id": str(current.association_id)},
    )
    cfg = cfg_result.fetchone()
    return {
        "name": (cfg[0] if cfg and cfg[0] else row[0]) if row else "",
        "phone": (cfg[1] if cfg and cfg[1] else row[1]) if row else "",
        "email": (cfg[2] if cfg and cfg[2] else row[2]) if row else "",
        "address": (cfg[3] if cfg and cfg[3] else row[3]) if row else "",
        "cep": (cfg[4] if cfg and cfg[4] else row[4]) if row else "",
        "president_user_id": str(cfg[5]) if cfg and cfg[5] else None,
    }


@router.put("/association", summary="Atualizar dados da associação (admin+)")
async def update_assoc_data(
    body: UpdateAssocDataRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(
        text("""
            INSERT INTO association_settings (association_id, assoc_name, assoc_phone, assoc_email, assoc_address, assoc_cep, president_user_id, updated_at)
            VALUES (:id, :name, :phone, :email, :address, :cep, :president, NOW())
            ON CONFLICT (association_id) DO UPDATE SET
                assoc_name = EXCLUDED.assoc_name,
                assoc_phone = EXCLUDED.assoc_phone,
                assoc_email = EXCLUDED.assoc_email,
                assoc_address = EXCLUDED.assoc_address,
                assoc_cep = EXCLUDED.assoc_cep,
                president_user_id = EXCLUDED.president_user_id,
                updated_at = NOW()
        """),
        {
            "id": str(current.association_id),
            "name": body.assoc_name, "phone": body.assoc_phone,
            "email": body.assoc_email, "address": body.assoc_address,
            "cep": body.assoc_cep,
            "president": str(body.president_user_id) if body.president_user_id else None,
        },
    )
    await session.commit()
    return {"ok": True}
