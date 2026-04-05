from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session
from app.models.mensalidade import Mensalidade
from app.services.mensalidade_service import MensalidadeService

router = APIRouter(prefix="/mensalidades", tags=["Mensalidades"])


class CreateMensalidadeRequest(BaseModel):
    resident_id: UUID
    reference_month: str = Field(pattern=r"^\d{4}-\d{2}$", description="YYYY-MM")
    due_date: date
    amount: Decimal = Field(gt=0)
    notes: str | None = None


class PayMensalidadeRequest(BaseModel):
    payment_method_id: UUID | None = None
    auto_next: bool = True


@router.post("", summary="Criar mensalidade")
async def create_mensalidade(
    body: CreateMensalidadeRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = MensalidadeService(session)
    m = await svc.create(
        association_id=current.association_id,
        resident_id=body.resident_id,
        reference_month=body.reference_month,
        due_date=body.due_date,
        amount=body.amount,
        created_by=current.user_id,
        notes=body.notes,
    )
    await session.commit()
    return _fmt(m)


@router.get("/delinquent", summary="Listar inadimplentes")
async def list_delinquent(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    svc = MensalidadeService(session)
    return await svc.list_delinquent(current.association_id)


@router.get("/residents/{resident_id}", summary="Histórico por morador")
async def list_by_resident(
    resident_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    svc = MensalidadeService(session)
    items = await svc.list_by_resident(current.association_id, resident_id)
    return [_fmt(m) for m in items]


@router.post("/{mensalidade_id}/pay", summary="Pagar mensalidade via caixa aberto")
async def pay_mensalidade(
    mensalidade_id: UUID,
    body: PayMensalidadeRequest = PayMensalidadeRequest(),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = MensalidadeService(session)
    result = await svc.pay_with_cash(
        mensalidade_id=mensalidade_id,
        association_id=current.association_id,
        paid_by=current.user_id,
        payment_method_id=body.payment_method_id,
        auto_next=body.auto_next,
    )
    await session.commit()
    return {
        "mensalidade": _fmt(result["mensalidade"]),
        "transaction": {
            "id": str(result["transaction"].id),
            "amount": str(result["transaction"].amount),
            "description": result["transaction"].description,
        },
        "next_month": _fmt(result["next"]) if result["next"] else None,
    }


def _fmt(m: Mensalidade) -> dict:
    return {
        "id": str(m.id),
        "resident_id": str(m.resident_id),
        "reference_month": m.reference_month,
        "due_date": str(m.due_date),
        "amount": str(m.amount),
        "status": m.status,
        "paid_at": str(m.paid_at) if m.paid_at else None,
        "transaction_id": str(m.transaction_id) if m.transaction_id else None,
        "notes": m.notes,
    }
