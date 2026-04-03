from datetime import datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.tenant import CurrentUser, get_current_user, require_admin
from app.database import get_session
from app.models.settings import AssociationSettings

router = APIRouter(prefix="/settings", tags=["Configurações"])


class UpdateSettingsRequest(BaseModel):
    default_cash_balance: Decimal = Field(ge=0)
    max_cash_before_sangria: Decimal = Field(ge=0)


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


@router.put("", summary="Atualizar configurações (admin)")
async def update_settings(
    body: UpdateSettingsRequest,
    current: CurrentUser = Depends(require_admin),
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
    return {
        "association_id": str(cfg.association_id),
        "default_cash_balance": str(cfg.default_cash_balance),
        "max_cash_before_sangria": str(cfg.max_cash_before_sangria),
    }
