from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
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


@router.get("/pending", summary="Mensalidades a receber (não vencidas)")
async def list_pending(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    svc = MensalidadeService(session)
    return await svc.list_pending(current.association_id)


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


@router.get("/paid", summary="Mensalidades pagas (com nome do morador)")
async def list_paid(
    month: str | None = Query(default=None, description="Filtrar por mês YYYY-MM"),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    svc = MensalidadeService(session)
    return await svc.list_paid(current.association_id, month)


@router.get("/report", summary="Relatório de mensalidades por período")
async def payment_report(
    from_month: str = Query(..., description="Mês inicial YYYY-MM"),
    to_month: str = Query(..., description="Mês final YYYY-MM"),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = MensalidadeService(session)
    return await svc.payment_report(current.association_id, from_month, to_month)


@router.get("/{mensalidade_id}/comprovante", summary="Dados do comprovante de pagamento")
async def get_comprovante(
    mensalidade_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text
    result = await session.execute(
        text("""
            SELECT m.reference_month, m.due_date, m.amount, m.paid_at,
                   r.full_name, r.cpf, r.unit, r.block,
                   a.name AS assoc_name, a.address_city, a.phone AS assoc_phone,
                   t.description AS tx_desc, pm.name AS payment_method
            FROM mensalidades m
            JOIN residents r ON r.id = m.resident_id
            JOIN associations a ON a.id = m.association_id
            LEFT JOIN transactions t ON t.id = m.transaction_id
            LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
            WHERE m.id = :mid AND m.association_id = :aid AND m.status = 'paid'
        """),
        {"mid": str(mensalidade_id), "aid": str(current.association_id)},
    )
    row = result.fetchone()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(404, "Comprovante não disponível.")
    return {
        "reference_month": row[0], "due_date": str(row[1]),
        "amount": str(row[2]), "paid_at": str(row[3]),
        "resident_name": row[4], "resident_cpf": row[5],
        "unit": row[6], "block": row[7],
        "association_name": row[8], "city": row[9], "assoc_phone": row[10],
        "payment_method": row[12] or "Dinheiro",
    }


@router.get("/residents/{resident_id}/inadimplencia", summary="Histórico de inadimplência do morador")
async def inadimplencia_history(
    resident_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text
    result = await session.execute(
        text("""
            SELECT reference_month, due_date, amount, status, paid_at
            FROM mensalidades
            WHERE association_id = :aid AND resident_id = :rid
              AND (status != 'paid' OR paid_at > due_date + INTERVAL '2 days')
            ORDER BY reference_month DESC
        """),
        {"aid": str(current.association_id), "rid": str(resident_id)},
    )
    return [{"reference_month": r[0], "due_date": str(r[1]), "amount": str(r[2]),
             "status": r[3], "paid_at": str(r[4]) if r[4] else None,
             "pago_em_atraso": r[3] == 'paid'} for r in result.fetchall()]


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
