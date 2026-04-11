from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session
from app.services.transfer_service import TransferService

router = APIRouter(prefix="/transfers", tags=["Transferências"])


class TransferRequest(BaseModel):
    destino_id: UUID
    amount: Decimal = Field(gt=0, decimal_places=2)
    descricao: str | None = None


class SetPresidentRequest(BaseModel):
    association_id: UUID
    presidente_user_id: UUID | None = None


class SetPermitirTransferenciaRequest(BaseModel):
    permitir_transferencia: bool


@router.post("", summary="Transferir saldo entre associações")
async def transfer(
    body: TransferRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = TransferService(session)
    result = await svc.transfer(
        origem_id=current.association_id,
        destino_id=body.destino_id,
        amount=body.amount,
        descricao=body.descricao,
        current_user_id=current.user_id,
        current_user_role=current.role,
    )
    await session.commit()
    return result


@router.put("/associations/{association_id}/president", summary="Definir presidente da associação (admin_master)")
async def set_president(
    association_id: UUID,
    body: SetPresidentRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if not current.is_admin_master:
        raise HTTPException(403, "Apenas admin_master pode definir o presidente.")
    await session.execute(
        text("UPDATE associations SET presidente_user_id = :pid, updated_at = NOW() WHERE id = :aid"),
        {"pid": str(body.presidente_user_id) if body.presidente_user_id else None, "aid": str(association_id)},
    )
    await session.commit()
    return {"association_id": str(association_id), "presidente_user_id": str(body.presidente_user_id) if body.presidente_user_id else None}


@router.put("/settings/permitir-transferencia", summary="Habilitar/desabilitar transferência na associação")
async def set_permitir_transferencia(
    body: SetPermitirTransferenciaRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if not current.is_admin_master:
        raise HTTPException(403, "Apenas admin_master pode alterar esta configuração.")
    await session.execute(
        text("""
            INSERT INTO association_settings (association_id, permitir_transferencia, updated_at)
            VALUES (:aid, :v, NOW())
            ON CONFLICT (association_id) DO UPDATE SET permitir_transferencia = :v, updated_at = NOW()
        """),
        {"aid": str(current.association_id), "v": body.permitir_transferencia},
    )
    await session.commit()
    return {"permitir_transferencia": body.permitir_transferencia}


@router.get("/history", summary="Extrato de transferências da associação")
async def transfer_history(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    result = await session.execute(
        text("""
            SELECT t.id, t.type, t.amount, t.description, t.transaction_at,
                   t.transfer_counterpart_id
              FROM transactions t
             WHERE t.association_id = :aid AND t.is_transfer = true
             ORDER BY t.transaction_at DESC
             LIMIT 100
        """),
        {"aid": str(current.association_id)},
    )
    return [
        {
            "id": str(r[0]),
            "type": r[1],
            "amount": str(r[2]),
            "description": r[3],
            "transaction_at": str(r[4]),
            "counterpart_id": str(r[5]) if r[5] else None,
        }
        for r in result.fetchall()
    ]
