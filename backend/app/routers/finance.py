from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user, require_admin
from app.database import get_session
from app.models.finance import CashSession, PaymentMethod, Transaction, TransactionCategory, TransactionType
from app.services.finance_service import FinanceService

router = APIRouter(prefix="/finance", tags=["Finanças"])


# ---- Request / Response schemas ----

class OpenSessionRequest(BaseModel):
    opening_balance: Decimal = Field(default=Decimal("0.00"), ge=0)
    notes: str | None = None


class CloseSessionRequest(BaseModel):
    closing_balance: Decimal = Field(ge=0)
    notes: str | None = None


class SangriaRequest(BaseModel):
    amount: Decimal = Field(gt=0, description="Valor da sangria")
    reason: str = Field(min_length=5, description="Justificativa")
    destination: str = Field(min_length=3, description="Destino do valor (ex: banco, cofre)")
    receipt_photo_url: str = Field(description="URL da foto do recibo")
    category_id: UUID | None = None


class TransactionRequest(BaseModel):
    type: TransactionType
    amount: Decimal = Field(gt=0)
    description: str
    category_id: UUID | None = None
    payment_method_id: UUID | None = None
    resident_id: UUID | None = None
    reference_number: str | None = None


# ---- Endpoints ----

@router.post("/sessions/open", response_model=dict, summary="Abrir sessão de caixa")
async def open_session(
    body: OpenSessionRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = FinanceService(session)
    cash = await svc.open_session(
        association_id=current.association_id,
        opened_by=current.user_id,
        opening_balance=body.opening_balance,
        notes=body.notes,
    )
    return {"id": str(cash.id), "status": cash.status, "opened_at": str(cash.opened_at)}


@router.get("/sessions/current", summary="Sessão de caixa atual")
async def current_session(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = FinanceService(session)
    cash = await svc.get_open_session(current.association_id)
    return {
        "id": str(cash.id),
        "status": cash.status,
        "opening_balance": str(cash.opening_balance),
        "opened_at": str(cash.opened_at),
        "opened_by": str(cash.opened_by),
    }


@router.post("/sessions/close", summary="Fechamento cego de caixa")
async def close_session(
    body: CloseSessionRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = FinanceService(session)
    cash = await svc.close_session(
        association_id=current.association_id,
        closed_by=current.user_id,
        closing_balance=body.closing_balance,
        notes=body.notes,
    )
    return {
        "id": str(cash.id),
        "status": cash.status,
        "opening_balance": str(cash.opening_balance),
        "closing_balance": str(cash.closing_balance),
        "expected_balance": str(cash.expected_balance),
        "difference": str(cash.difference),
        "closed_at": str(cash.closed_at),
    }


@router.post("/sessions/sangria", summary="Realizar sangria de caixa")
async def perform_sangria(
    body: SangriaRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = FinanceService(session)
    tx = await svc.perform_sangria(
        association_id=current.association_id,
        opened_by=current.user_id,
        amount=body.amount,
        reason=body.reason,
        destination=body.destination,
        receipt_photo_url=body.receipt_photo_url,
        category_id=body.category_id,
    )
    return {"id": str(tx.id), "amount": str(tx.amount), "type": tx.type}


@router.post("/transactions", summary="Registrar transação")
async def register_transaction(
    body: TransactionRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = FinanceService(session)
    cash = await svc.get_open_session(current.association_id)
    tx = await svc.register_transaction(
        association_id=current.association_id,
        cash_session_id=cash.id,
        tx_type=body.type,
        amount=body.amount,
        description=body.description,
        created_by=current.user_id,
        category_id=body.category_id,
        payment_method_id=body.payment_method_id,
        resident_id=body.resident_id,
        reference_number=body.reference_number,
    )
    return {"id": str(tx.id), "type": tx.type, "amount": str(tx.amount)}


@router.get("/transactions", summary="Listar transações da sessão atual")
async def list_transactions(
    session_id: UUID | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    svc = FinanceService(session)
    txs = await svc.list_transactions(current.association_id, session_id)
    return [
        {
            "id": str(t.id),
            "type": t.type,
            "amount": str(t.amount),
            "description": t.description,
            "transaction_at": str(t.transaction_at),
            "is_sangria": t.is_sangria,
        }
        for t in txs
    ]


@router.get("/categories", summary="Categorias de transação")
async def list_categories(
    type: TransactionType | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlmodel import select
    stmt = select(TransactionCategory).where(
        TransactionCategory.association_id == current.association_id,
        TransactionCategory.is_active == True,  # noqa: E712
    )
    if type:
        stmt = stmt.where(TransactionCategory.type == type)
    stmt = stmt.order_by(TransactionCategory.name)
    result = await session.execute(stmt)
    return [
        {"id": str(c.id), "name": c.name, "type": c.type, "color": c.color}
        for c in result.scalars().all()
    ]


@router.get("/payment-methods", summary="Métodos de pagamento")
async def list_payment_methods(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlmodel import select
    stmt = select(PaymentMethod).where(
        PaymentMethod.association_id == current.association_id,
        PaymentMethod.is_active == True,  # noqa: E712
    ).order_by(PaymentMethod.name)
    result = await session.execute(stmt)
    return [{"id": str(m.id), "name": m.name} for m in result.scalars().all()]
