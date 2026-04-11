from datetime import datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user, require_admin, require_conferente
from app.database import get_session
from app.models.finance import CashSession, IncomeSubtype, PaymentMethod, Transaction, TransactionCategory, TransactionType
from app.services.finance_service import FinanceService

router = APIRouter(prefix="/finance", tags=["Finanças"])


# ---- Request / Response schemas ----

class OpenSessionRequest(BaseModel):
    opening_balance: Decimal = Field(default=Decimal("0.00"), ge=0)
    notes: str | None = None


class CloseSessionRequest(BaseModel):
    closing_balance: Decimal = Field(ge=0)
    notes: str | None = None


class ManualSessionRequest(BaseModel):
    opening_balance: Decimal = Field(ge=0)
    closing_balance: Decimal = Field(ge=0)
    opened_at: datetime
    closed_at: datetime
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
    income_subtype: IncomeSubtype | None = None
    category_id: UUID | None = None
    payment_method_id: UUID | None = None
    resident_id: UUID | None = None
    reference_number: str | None = None


class ConferenciaRequest(BaseModel):
    counted_amount: Decimal = Field(ge=0)


class ProofOfResidenceRequest(BaseModel):
    resident_name: str
    resident_cpf: str
    resident_neighborhood: str
    resident_cep: str
    amount: Decimal = Field(gt=0)
    payment_method_id: UUID | None = None
    category_id: UUID | None = None
    resident_id: UUID | None = None


# ---- Endpoints ----

@router.post("/proof-of-residence/issue", summary="Emitir Comprovante de Residência")
async def issue_proof_of_residence(
    body: ProofOfResidenceRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    svc = FinanceService(session)
    tx, pdf_bytes = await svc.issue_proof_of_residence(
        association_id=current.association_id,
        issued_by=current.user_id,
        resident_name=body.resident_name,
        resident_cpf=body.resident_cpf,
        resident_neighborhood=body.resident_neighborhood,
        resident_cep=body.resident_cep,
        amount=body.amount,
        payment_method_id=body.payment_method_id,
        category_id=body.category_id,
        resident_id=body.resident_id,
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="comprovante.pdf"',
            "X-Barcode-Code": tx.reference_number or "",
            "Access-Control-Expose-Headers": "X-Barcode-Code",
        },
    )


@router.get("/proof-of-residence/verify/{code}", summary="Verificar código de comprovante")
async def verify_proof_of_residence(
    code: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as sa_text
    result = await session.execute(
        sa_text("""
            SELECT t.id, t.amount, t.description, t.transaction_at, t.reference_number,
                   t.income_subtype
            FROM transactions t
            WHERE t.association_id = :aid
              AND t.reference_number = :code
              AND t.income_subtype = 'proof_of_residence'
            LIMIT 1
        """),
        {"aid": str(current.association_id), "code": code},
    )
    row = result.fetchone()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Comprovante não encontrado.")
    return {
        "id": str(row[0]),
        "amount": str(row[1]),
        "description": row[2],
        "transaction_at": str(row[3]),
        "reference_number": row[4],
    }


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


@router.post("/sessions/manual", response_model=dict, summary="Criar sessão de caixa manual")
async def create_manual_session(
    body: ManualSessionRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = FinanceService(session)
    cash = await svc.create_manual_session(
        association_id=current.association_id,
        created_by=current.user_id,
        opening_balance=body.opening_balance,
        closing_balance=body.closing_balance,
        opened_at=body.opened_at,
        closed_at=body.closed_at,
        notes=body.notes,
    )
    await session.commit()
    return {"id": str(cash.id), "origin": cash.origin}


@router.get("/sessions/current", summary="Sessão de caixa atual")
async def current_session(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = FinanceService(session)
    cash = await svc.get_open_session(current.association_id)
    from app.models.user import User
    opener = await session.get(User, cash.opened_by)
    return {
        "id": str(cash.id),
        "status": cash.status,
        "opening_balance": str(cash.opening_balance),
        "opened_at": str(cash.opened_at),
        "opened_by": str(cash.opened_by),
        "opened_by_name": opener.full_name if opener else None,
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
        income_subtype=body.income_subtype,
        category_id=body.category_id,
        payment_method_id=body.payment_method_id,
        resident_id=body.resident_id,
        reference_number=body.reference_number,
    )
    return {"id": str(tx.id), "type": tx.type, "amount": str(tx.amount)}


@router.post("/transactions/offline", summary="Registrar saída externa (sem sessão ativa)")
async def register_offline_transaction(
    body: TransactionRequest,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Saída para pagamentos externos que não passam pelo caixa. Não afeta saldo de sessão."""
    from datetime import datetime
    from app.models.finance import Transaction

    if body.type != TransactionType.expense:
        from fastapi import HTTPException
        raise HTTPException(400, "Saída externa só é permitida para despesas (expense).")

    tx = Transaction(
        association_id=current.association_id,
        cash_session_id=None,
        category_id=body.category_id,
        payment_method_id=body.payment_method_id,
        resident_id=body.resident_id,
        type=TransactionType.expense,
        amount=body.amount,
        description=body.description,
        reference_number=body.reference_number,
        approval_status="approved",
        approved_by=current.user_id,
        approved_at=datetime.utcnow(),
        created_by=current.user_id,
    )
    session.add(tx)
    await session.flush()
    await session.commit()
    return {"id": str(tx.id), "type": tx.type, "amount": str(tx.amount), "offline": True}


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
            "approval_status": t.approval_status,
            "is_reversal": t.is_reversal,
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


@router.get("/sessions", summary="Listar todas as sessões de caixa")
async def list_sessions(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text as sa_text
    result = await session.execute(
        sa_text("""
            SELECT
                cs.id,
                cs.status,
                cs.opened_at,
                cs.closed_at,
                cs.opening_balance,
                cs.closing_balance,
                cs.expected_balance,
                cs.difference,
                u_open.full_name  AS operador_name,
                u_close.full_name AS conferido_por,
                cs.origin,
                COALESCE(SUM(CASE WHEN t.type = 'income'
                    AND pm.name ILIKE '%pix%' THEN t.amount ELSE 0 END), 0) AS total_pix,
                COALESCE(SUM(CASE WHEN t.type = 'income'
                    AND (pm.name ILIKE '%dinheiro%' OR pm.name ILIKE '%espécie%'
                         OR pm.name ILIKE '%especie%' OR t.payment_method_id IS NULL)
                    THEN t.amount ELSE 0 END), 0) AS total_dinheiro,
                COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS total_bruto,
                COALESCE(SUM(CASE WHEN t.type = 'sangria' THEN t.amount ELSE 0 END), 0) AS total_baixas
            FROM cash_sessions cs
            LEFT JOIN users u_open  ON u_open.id  = cs.opened_by
            LEFT JOIN users u_close ON u_close.id = cs.closed_by
            LEFT JOIN transactions t
                ON t.cash_session_id = cs.id AND t.association_id = cs.association_id
            LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
            WHERE cs.association_id = :aid
            GROUP BY cs.id, cs.status, cs.opened_at, cs.closed_at,
                     cs.opening_balance, cs.closing_balance, cs.expected_balance,
                     cs.difference, u_open.full_name, u_close.full_name, cs.origin
            ORDER BY cs.opened_at DESC
        """),
        {"aid": str(current.association_id)},
    )
    rows = result.fetchall()
    return [
        {
            "id": str(r[0]),
            "status": r[1],
            "opened_at": str(r[2]),
            "closed_at": str(r[3]) if r[3] else None,
            "opening_balance": str(r[4]),
            "closing_balance": str(r[5]) if r[5] is not None else None,
            "expected_balance": str(r[6]) if r[6] is not None else None,
            "difference": str(r[7]) if r[7] is not None else None,
            "operador_name": r[8],
            "conferido_por": r[9],
            "origin": r[10] or "Sessão de Caixa",
            "total_pix": str(round(float(r[11]), 2)),
            "total_dinheiro": str(round(float(r[12]), 2)),
            "total_bruto": str(round(float(r[13]), 2)),
            "total_baixas": str(round(float(r[14]), 2)),
        }
        for r in rows
    ]


@router.post("/sessions/conferencia", summary="Conferência de caixa (sem fechar)")
async def conferencia_caixa(
    body: ConferenciaRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = FinanceService(session)
    try:
        cash = await svc.get_open_session(current.association_id)
    except Exception:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Nenhuma sessão aberta.")
    txs = await svc.list_transactions(current.association_id, cash.id)
    income = sum(float(t.amount) for t in txs if t.type == "income")
    exits = sum(float(t.amount) for t in txs if t.type != "income")
    expected = float(cash.opening_balance) + income - exits
    counted = float(body.counted_amount)
    return {
        "session_id": str(cash.id),
        "opening_balance": str(cash.opening_balance),
        "income": str(round(income, 2)),
        "exits": str(round(exits, 2)),
        "expected": str(round(expected, 2)),
        "counted": str(round(counted, 2)),
        "difference": str(round(counted - expected, 2)),
    }


class ApproveExpenseRequest(BaseModel):
    signature_url: str | None = None


class RejectExpenseRequest(BaseModel):
    reason: str = Field(min_length=5, description="Motivo da recusa")


@router.get("/transactions/pending-approval", summary="Listar despesas pendentes de aprovação")
async def list_pending_approvals(
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    svc = FinanceService(session)
    return await svc.list_pending_approvals(current.association_id)


@router.post("/transactions/{transaction_id}/approve", summary="Aprovar despesa")
async def approve_transaction(
    transaction_id: UUID,
    body: ApproveExpenseRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = FinanceService(session)
    tx = await svc.approve_transaction(
        transaction_id=transaction_id,
        association_id=current.association_id,
        approved_by=current.user_id,
        signature_url=body.signature_url,
    )
    await session.commit()
    return {"id": str(tx.id), "approval_status": tx.approval_status, "approved_at": str(tx.approved_at)}


@router.post("/transactions/{transaction_id}/reject", summary="Recusar despesa")
async def reject_transaction_approval(
    transaction_id: UUID,
    body: RejectExpenseRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = FinanceService(session)
    tx = await svc.reject_transaction(
        transaction_id=transaction_id,
        association_id=current.association_id,
        rejected_by=current.user_id,
        reason=body.reason,
    )
    await session.commit()
    return {"id": str(tx.id), "approval_status": tx.approval_status}


class ReversalRequest(BaseModel):
    reason: str = Field(min_length=5, description="Motivo do estorno")


@router.post("/transactions/{transaction_id}/reverse", summary="Estornar transação")
async def reverse_transaction(
    transaction_id: UUID,
    body: ReversalRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = FinanceService(session)
    reversal = await svc.reverse_transaction(
        transaction_id=transaction_id,
        association_id=current.association_id,
        reversed_by=current.user_id,
        reason=body.reason,
    )
    await session.commit()
    return {
        "id": str(reversal.id),
        "type": reversal.type,
        "amount": str(reversal.amount),
        "reversal_of_id": str(reversal.reversal_of_id),
    }


@router.get("/audit", summary="Trilha de auditoria financeira")
async def get_audit_trail(
    limit: int = 50,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text as sa_text
    result = await session.execute(
        sa_text("""
            SELECT t.id, t.type, t.income_subtype, t.amount, t.description,
                   t.is_sangria, t.is_reversal, t.reversal_of_id, t.reversal_reason,
                   t.transaction_at, t.created_by,
                   u.full_name AS creator_name,
                   t.reversed_by, ur.full_name AS reverser_name, t.reversed_at
            FROM transactions t
            JOIN users u ON u.id = t.created_by
            LEFT JOIN users ur ON ur.id = t.reversed_by
            WHERE t.association_id = :aid
            ORDER BY t.transaction_at DESC
            LIMIT :lim
        """),
        {"aid": str(current.association_id), "lim": limit},
    )
    rows = result.fetchall()
    return [
        {
            "id": str(r[0]), "type": r[1], "income_subtype": r[2],
            "amount": str(r[3]), "description": r[4],
            "is_sangria": r[5], "is_reversal": r[6],
            "reversal_of_id": str(r[7]) if r[7] else None,
            "reversal_reason": r[8],
            "transaction_at": str(r[9]),
            "created_by": str(r[10]), "creator_name": r[11],
            "reversed_by": str(r[12]) if r[12] else None,
            "reverser_name": r[13],
            "reversed_at": str(r[14]) if r[14] else None,
        }
        for r in rows
    ]


@router.get("/residents/{resident_id}/payment-history", summary="Histórico de mensalidades do morador")
async def get_resident_payment_history(
    resident_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = FinanceService(session)
    return await svc.get_resident_payment_history(current.association_id, resident_id)


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


class CreateCategoryRequest(BaseModel):
    name: str
    type: TransactionType
    color: str | None = None


@router.post("/categories", summary="Criar categoria de transação")
async def create_category(
    body: CreateCategoryRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from datetime import datetime as dt
    cat = TransactionCategory(
        association_id=current.association_id,
        name=body.name,
        type=body.type,
        color=body.color,
        created_at=dt.utcnow(),
        updated_at=dt.utcnow(),
    )
    session.add(cat)
    await session.flush()
    await session.commit()
    return {"id": str(cat.id), "name": cat.name, "type": cat.type, "color": cat.color}


@router.delete("/categories/{category_id}", summary="Desativar categoria")
async def delete_category(
    category_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlmodel import select as sa_select
    from datetime import datetime as dt
    stmt = sa_select(TransactionCategory).where(
        TransactionCategory.id == category_id,
        TransactionCategory.association_id == current.association_id,
    )
    cat = (await session.execute(stmt)).scalar_one_or_none()
    if not cat:
        from fastapi import HTTPException
        raise HTTPException(404, "Categoria não encontrada.")
    cat.is_active = False
    cat.updated_at = dt.utcnow()
    session.add(cat)
    await session.commit()
    return {"deleted": True}


class CreatePaymentMethodRequest(BaseModel):
    name: str


@router.post("/payment-methods", summary="Criar método de pagamento")
async def create_payment_method(
    body: CreatePaymentMethodRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from datetime import datetime as dt
    pm = PaymentMethod(
        association_id=current.association_id,
        name=body.name,
        created_at=dt.utcnow(),
        updated_at=dt.utcnow(),
    )
    session.add(pm)
    await session.flush()
    await session.commit()
    return {"id": str(pm.id), "name": pm.name}


@router.delete("/payment-methods/{pm_id}", summary="Desativar método de pagamento")
async def delete_payment_method(
    pm_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlmodel import select as sa_select
    from datetime import datetime as dt
    stmt = sa_select(PaymentMethod).where(
        PaymentMethod.id == pm_id,
        PaymentMethod.association_id == current.association_id,
    )
    pm = (await session.execute(stmt)).scalar_one_or_none()
    if not pm:
        from fastapi import HTTPException
        raise HTTPException(404, "Método não encontrado.")
    pm.is_active = False
    pm.updated_at = dt.utcnow()
    session.add(pm)
    await session.commit()
    return {"deleted": True}
