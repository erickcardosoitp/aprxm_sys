from datetime import datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_password
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
    reviewed_by_id: UUID | None = None
    session_id: UUID | None = None  # admin: fechar caixa de outro operador


class ManualSessionRequest(BaseModel):
    opening_balance: Decimal = Field(ge=0)
    closing_balance: Decimal = Field(ge=0)
    opened_at: datetime
    closed_at: datetime
    notes: str | None = None
    manual_pix: Decimal | None = Field(default=None, ge=0)
    manual_dinheiro: Decimal | None = Field(default=None, ge=0)
    manual_total_baixas: Decimal | None = Field(default=None, ge=0)
    operated_by_id: UUID | None = None
    reviewed_by_id: UUID | None = None


class TransactionReview(BaseModel):
    transaction_id: str
    conferido: bool
    observacao: str | None = None


class ReviewsRequest(BaseModel):
    reviews: list[TransactionReview]
    reviewed_by_id: UUID | None = None
    closing_balance: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None


class SangriaDestinationRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class SangriaRequest(BaseModel):
    amount: Decimal = Field(gt=0, description="Valor da sangria")
    reason: str = Field(min_length=5, description="Justificativa")
    destination: str = Field(min_length=3, description="Destino do valor (ex: banco, cofre)")
    receipt_photo_url: str = Field(description="URL da foto do recibo")
    category_id: UUID | None = None
    cash_box_id: UUID | None = None


class TransactionRequest(BaseModel):
    type: TransactionType
    amount: Decimal = Field(gt=0)
    description: str
    income_subtype: IncomeSubtype | None = None
    category_id: UUID | None = None
    payment_method_id: UUID | None = None
    resident_id: UUID | None = None
    reference_number: str | None = None
    cash_session_id: UUID | None = None


class ConferenciaRequest(BaseModel):
    counted_amount: Decimal = Field(ge=0)


class PatchTransactionPaymentMethodRequest(BaseModel):
    payment_method_id: UUID | None = None
    cash_session_id: str
    observacao: str | None = None
    reviewed_by_id: UUID | None = None


class ProofOfResidenceRequest(BaseModel):
    resident_name: str
    resident_cpf: str
    resident_neighborhood: str
    resident_cep: str
    resident_address_street: str = ""
    resident_address_number: str = ""
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
        resident_address_street=body.resident_address_street,
        resident_address_number=body.resident_address_number,
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


@router.get("/proof-of-residence/list", summary="Listar todos os comprovantes emitidos")
async def list_proof_of_residence(
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text as sa_text
    result = await session.execute(
        sa_text("""
            SELECT t.id, t.amount, t.description, t.created_at, t.reference_number,
                   t.reversed_at, pm.name as payment_method,
                   r.full_name as resident_name, r.unit, r.cpf,
                   u.full_name as issued_by
            FROM transactions t
            LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
            LEFT JOIN residents r ON r.id = t.resident_id
            LEFT JOIN users u ON u.id = t.created_by
            WHERE t.association_id = :aid
              AND t.income_subtype = 'proof_of_residence'
            ORDER BY t.created_at DESC
            LIMIT :lim OFFSET :off
        """),
        {"aid": str(current.association_id), "lim": limit, "off": offset},
    )
    rows = result.fetchall()
    return [
        {
            "id": str(r[0]), "amount": str(r[1]), "description": r[2],
            "created_at": str(r[3]), "reference_number": r[4],
            "reversed_at": str(r[5]) if r[5] else None,
            "payment_method": r[6], "resident_name": r[7],
            "unit": r[8], "cpf": r[9], "issued_by": r[10],
        }
        for r in rows
    ]


@router.post("/proof-of-residence/{tx_id}/reissue", summary="Re-emitir comprovante corrigido (estorna o anterior)")
async def reissue_proof_of_residence(
    tx_id: UUID,
    body: ProofOfResidenceRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    svc = FinanceService(session)
    # Reverse the old transaction
    await svc.reverse_transaction(
        transaction_id=tx_id,
        association_id=current.association_id,
        reversed_by=current.user_id,
        reason="Re-emissão com dados corrigidos",
    )
    await session.flush()
    # Issue a new one
    tx, pdf_bytes = await svc.issue_proof_of_residence(
        association_id=current.association_id,
        issued_by=current.user_id,
        resident_name=body.resident_name,
        resident_cpf=body.resident_cpf,
        resident_neighborhood=body.resident_neighborhood,
        resident_cep=body.resident_cep,
        resident_address_street=body.resident_address_street,
        resident_address_number=body.resident_address_number,
        amount=body.amount,
        payment_method_id=body.payment_method_id,
        category_id=body.category_id,
        resident_id=body.resident_id,
    )
    await session.commit()
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


@router.get("/proof-of-residence/{tx_id}/reprint", summary="Reimprimir comprovante sem estornar")
async def reprint_proof_of_residence(
    tx_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    from sqlalchemy import text as sa_text
    row = (await session.execute(sa_text("""
        SELECT t.reference_number, t.resident_id, t.reversed_at, t.income_subtype
          FROM transactions t
         WHERE t.id = :tid AND t.association_id = :aid
    """), {"tid": str(tx_id), "aid": str(current.association_id)})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Comprovante não encontrado.")
    if row[2] is not None:
        raise HTTPException(status_code=400, detail="Comprovante já estornado.")
    if row[3] != "proof_of_residence":
        raise HTTPException(status_code=400, detail="Transação não é um comprovante.")

    barcode_code = row[0] or ""
    resident_id = row[1]

    res_row = None
    if resident_id:
        res_row = (await session.execute(sa_text("""
            SELECT full_name, cpf, address_neighborhood, address_cep, address_street, address_number
              FROM residents WHERE id = :rid AND association_id = :aid
        """), {"rid": str(resident_id), "aid": str(current.association_id)})).fetchone()

    cfg = (await session.execute(sa_text("""
        SELECT assoc_logo_url, president_signature_url, president_name,
               community_name, assoc_address, assoc_cep
          FROM association_settings WHERE association_id = :aid
    """), {"aid": str(current.association_id)})).fetchone()

    if not cfg or not cfg[0] or not cfg[1]:
        raise HTTPException(status_code=422, detail="Configurações da associação incompletas.")

    import httpx
    async with httpx.AsyncClient(timeout=10) as client:
        logo_resp = await client.get(cfg[0])
        sig_resp = await client.get(cfg[1])
    if logo_resp.status_code != 200 or sig_resp.status_code != 200:
        raise HTTPException(status_code=422, detail="Falha ao baixar logo/assinatura.")

    svc = FinanceService(session)
    barcode_bytes = svc._build_barcode_image(barcode_code)
    pdf_bytes = svc._build_proof_pdf(
        resident_name=res_row[0] if res_row else "(nao identificado)",
        resident_cpf=res_row[1] if res_row else "",
        resident_neighborhood=res_row[2] if res_row else "",
        resident_cep=res_row[3] if res_row else "",
        resident_address_street=res_row[4] if res_row else "",
        resident_address_number=res_row[5] if res_row else "",
        community_name=cfg[3] or "",
        assoc_address=cfg[4] or "",
        assoc_cep=cfg[5] or "",
        president_name=cfg[2] or "PRESIDENTE",
        logo_bytes=logo_resp.content,
        sig_bytes=sig_resp.content,
        barcode_code=barcode_code,
        barcode_bytes=barcode_bytes,
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="comprovante_2via.pdf"'},
    )


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
        opened_at=body.opened_at.replace(tzinfo=None),
        closed_at=body.closed_at.replace(tzinfo=None),
        notes=body.notes,
        manual_pix=body.manual_pix,
        manual_dinheiro=body.manual_dinheiro,
        manual_total_baixas=body.manual_total_baixas,
        operated_by=body.operated_by_id,
        reviewed_by=body.reviewed_by_id,
    )
    await session.commit()
    return {"id": str(cash.id), "origin": cash.origin}


@router.get("/sessions/current", summary="Sessão de caixa atual")
async def current_session(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = FinanceService(session)
    try:
        cash = await svc.get_open_session(
            current.association_id, preferred_by=current.user_id
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Nenhuma sessão de caixa aberta.")
    from app.models.user import User
    opener = await session.get(User, cash.opened_by)
    is_mine = cash.opened_by == current.user_id
    return {
        "id": str(cash.id),
        "status": cash.status,
        "opening_balance": str(cash.opening_balance),
        "opened_at": str(cash.opened_at),
        "opened_by": str(cash.opened_by),
        "opened_by_name": opener.full_name if opener else None,
        "is_mine": is_mine,
    }


@router.get("/sessions/open", summary="Todas as sessões de caixa abertas")
async def list_open_sessions(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    # admin/conferente see all; operators see all (to pick when they have no own session)
    where_extra = ""
    params: dict = {"aid": str(current.association_id)}

    result = await session.execute(
        text(
            "SELECT cs.id, cs.opened_by, cs.opening_balance, cs.opened_at, u.full_name "
            "FROM cash_sessions cs LEFT JOIN users u ON u.id = cs.opened_by "
            f"WHERE cs.association_id = :aid AND cs.status = 'open' {where_extra} "
            "ORDER BY cs.opened_at DESC"
        ),
        params,
    )
    rows = result.fetchall()
    return [
        {
            "id": str(r[0]),
            "opened_by": str(r[1]),
            "opening_balance": str(r[2]),
            "opened_at": str(r[3]),
            "opened_by_name": r[4],
            "is_mine": str(r[1]) == str(current.user_id),
        }
        for r in rows
    ]


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
        reviewed_by=body.reviewed_by_id,
        session_id=body.session_id,
        is_admin=current.is_admin,
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
    # Credit the cash box if specified
    if body.cash_box_id:
        box = (await session.execute(text(
            "SELECT id, balance FROM cash_boxes WHERE id=:id AND association_id=:aid AND is_active=true"
        ), {"id": str(body.cash_box_id), "aid": str(current.association_id)})).fetchone()
        if box:
            await session.execute(text(
                "UPDATE cash_boxes SET balance=balance+:amt, updated_at=NOW() WHERE id=:id"
            ), {"amt": float(body.amount), "id": str(body.cash_box_id)})
            await session.execute(text("""
                INSERT INTO cash_box_movements (id, association_id, cash_box_id, amount, movement_type, description, created_by)
                VALUES (gen_random_uuid(), :aid, :bid, :amt, 'credit', :desc, :usr)
            """), {"aid": str(current.association_id), "bid": str(body.cash_box_id),
                   "amt": float(body.amount), "desc": f"Transferência do caixa: {body.reason}",
                   "usr": str(current.user_id)})
    await session.commit()
    return {"id": str(tx.id), "amount": str(tx.amount), "type": tx.type}


@router.post("/transactions", summary="Registrar transação")
async def register_transaction(
    body: TransactionRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = FinanceService(session)
    can_pick_session = current.is_conferente  # admin/conferente/superadmin can redirect to any session
    if body.cash_session_id:
        cash = await svc.get_open_session(current.association_id, session_id=body.cash_session_id)
    else:
        try:
            cash = await svc.get_open_session(current.association_id, preferred_by=current.user_id)
            if cash.opened_by != current.user_id:
                raise HTTPException(status_code=422, detail="NO_SESSION")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=422, detail="NO_SESSION")
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


class SyncPixRequest(BaseModel):
    session_id: UUID | None = None
    auto_reconcile: bool = False


@router.post("/sessions/sync-pix", summary="Sincronizar lançamentos PIX para o extrato")
async def sync_pix(
    body: SyncPixRequest = Body(default=SyncPixRequest()),
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    params: dict = {"aid": str(current.association_id), "conciliado": body.auto_reconcile}
    session_filter = ""
    if body.session_id:
        session_filter = "AND t.cash_session_id = :sid "
        params["sid"] = str(body.session_id)
    r = await session.execute(text(f"""
        INSERT INTO bank_statements (association_id, bank, date, amount, name, description, tipo, conciliado, transaction_id)
        SELECT t.association_id, 'PIX', t.created_at::date, t.amount, t.description, t.description,
               'entrada', :conciliado, t.id
        FROM transactions t
        JOIN payment_methods pm ON pm.id = t.payment_method_id
        WHERE t.association_id = :aid
          AND t.type = 'income'
          AND LOWER(pm.name) LIKE '%pix%'
          AND t.reversed_at IS NULL
          {session_filter}
          AND NOT EXISTS (SELECT 1 FROM bank_statements bs WHERE bs.transaction_id = t.id)
        RETURNING id
    """), params)
    count = len(r.fetchall())
    await session.commit()
    return {"synced": count}


class QuebraCaixaRequest(BaseModel):
    tipo: str
    amount: Decimal = Field(gt=0)
    funcionario_id: UUID | None = None


@router.post("/sessions/{session_id}/quebra", summary="Registrar quebra de caixa")
async def registrar_quebra(
    session_id: UUID,
    body: QuebraCaixaRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as sa_text
    row = (await session.execute(sa_text(
        "SELECT id, status FROM cash_sessions WHERE id=:id AND association_id=:aid"
    ), {"id": str(session_id), "aid": str(current.association_id)})).fetchone()
    if not row:
        raise HTTPException(404, "Sessão não encontrada.")
    svc = FinanceService(session)
    desc = "Sobra de Caixa" if body.tipo == 'sobra' else "Quebra de Caixa — desconto"
    if body.funcionario_id:
        fn = (await session.execute(sa_text("SELECT full_name FROM users WHERE id=:id AND association_id=:aid"),
              {"id": str(body.funcionario_id), "aid": str(current.association_id)})).scalar()
        if fn:
            desc += f" ({fn})"
    tx = await svc.register_transaction(
        association_id=current.association_id,
        cash_session_id=session_id,
        tx_type=TransactionType.income if body.tipo == 'sobra' else TransactionType.expense,
        amount=body.amount,
        description=desc,
        created_by=current.user_id,
    )
    await session.commit()
    return {"id": str(tx.id), "description": tx.description, "amount": str(tx.amount), "type": tx.type}


class TransferToCashboxRequest(BaseModel):
    cash_box_id: UUID
    amount: Decimal = Field(gt=0)
    troco: Decimal = Field(default=Decimal("0"), ge=0)
    close_session: bool = False


@router.post("/sessions/{session_id}/transfer-to-cashbox", summary="Transferir valor conferido para caixinha (sangria + crédito)")
async def transfer_to_cashbox(
    session_id: UUID,
    body: TransferToCashboxRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as sa_text
    row = (await session.execute(sa_text(
        "SELECT id, status, opened_at FROM cash_sessions WHERE id=:id AND association_id=:aid"
    ), {"id": str(session_id), "aid": str(current.association_id)})).fetchone()
    if not row:
        raise HTTPException(404, "Sessão não encontrada.")
    if row[1] not in ("open", "conferido"):
        raise HTTPException(400, "Sessão deve estar aberta ou conferida para transferir.")

    box = (await session.execute(sa_text(
        "SELECT id, balance FROM cash_boxes WHERE id=:id AND association_id=:aid AND is_active=true"
    ), {"id": str(body.cash_box_id), "aid": str(current.association_id)})).fetchone()
    if not box:
        raise HTTPException(404, "Caixinha não encontrada.")

    # Validate: total repasses cannot exceed closing_balance
    if row[1] == "conferido":
        closing_bal = (await session.execute(sa_text(
            "SELECT closing_balance FROM cash_sessions WHERE id=:id"
        ), {"id": str(session_id)})).scalar()
        already_transferred = (await session.execute(sa_text("""
            SELECT COALESCE(SUM(amount),0) FROM transactions
            WHERE association_id=:aid AND type='sangria'
              AND description LIKE :desc_pattern
              AND reversed_at IS NULL
              AND (cash_session_id=:sid OR (cash_session_id IS NULL
                   AND description LIKE :sess_date_pattern))
        """), {
            "aid": str(current.association_id),
            "sid": str(session_id),
            "desc_pattern": "Repasse para caixinha%",
            "sess_date_pattern": f"%conferência {str(row[2])[:10]}%",
        })).scalar()
        if closing_bal is not None:
            available = float(closing_bal) - float(already_transferred or 0)
            if float(body.amount) > round(available + 0.005, 2):
                raise HTTPException(400, f"Valor excede o disponível para repasse (R$ {available:.2f}).")

    svc = FinanceService(session)
    sess_date = str(row[2])[:10]
    desc = f"Repasse para caixinha — conferência {sess_date}"
    # Sessão já conferida: não vincular a sangria à sessão para não alterar o saldo conferido.
    # A transação fica como registro de auditoria sem cash_session_id.
    tx_session_id = None if row[1] == "conferido" else session_id
    tx = await svc.register_transaction(
        association_id=current.association_id,
        cash_session_id=tx_session_id,
        tx_type=TransactionType.sangria,
        amount=body.amount,
        description=desc,
        created_by=current.user_id,
    )
    new_bal = float(box[1]) + float(body.amount)
    await session.execute(sa_text("UPDATE cash_boxes SET balance=:b, updated_at=NOW() WHERE id=:id"),
                          {"b": new_bal, "id": str(body.cash_box_id)})
    await session.execute(sa_text("""
        INSERT INTO cash_box_movements (id, association_id, cash_box_id, amount, movement_type, description, created_by)
        VALUES (gen_random_uuid(), :aid, :bid, :amt, 'credit', :desc, :usr)
    """), {"aid": str(current.association_id), "bid": str(body.cash_box_id),
           "amt": float(body.amount), "desc": desc, "usr": str(current.user_id)})

    if body.close_session:
        from datetime import datetime as _dt
        await session.execute(sa_text(
            "UPDATE cash_sessions SET status='closed', closed_at=NOW(), closed_by=:uid WHERE id=:id AND association_id=:aid"
        ), {"uid": str(current.user_id), "id": str(session_id), "aid": str(current.association_id)})

    await session.commit()
    return {
        "ok": True,
        "transaction_id": str(tx.id),
        "new_cashbox_balance": str(round(new_bal, 2)),
        "troco": str(body.troco),
        "closed": body.close_session,
    }


@router.post("/sessions/{session_id}/send-to-malote", summary="Operador envia dinheiro físico para o malote")
async def send_to_malote(
    session_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    cs = (await session.execute(text(
        "SELECT status, closing_balance, malote_sent_at FROM cash_sessions WHERE id=:id AND association_id=:aid"
    ), {"id": str(session_id), "aid": str(current.association_id)})).fetchone()
    if not cs:
        raise HTTPException(404, "Sessão não encontrada.")
    if cs[0] != "closed":
        raise HTTPException(400, "Sessão deve estar fechada.")
    if cs[2] is not None:
        raise HTTPException(400, "Dinheiro já enviado para o malote.")
    if cs[1] is None or float(cs[1]) <= 0:
        raise HTTPException(400, "Valor de fechamento (conf. cega) inválido.")

    malote = (await session.execute(text(
        "SELECT id, balance FROM cash_boxes WHERE association_id=:aid AND is_malote=true AND is_active=true ORDER BY created_at LIMIT 1"
    ), {"aid": str(current.association_id)})).fetchone()
    if not malote:
        raise HTTPException(404, "Nenhuma caixinha malote ativa. Crie uma em Caixinhas e marque como Malote.")

    amount = float(cs[1])
    new_bal = float(malote[1]) + amount
    await session.execute(text("UPDATE cash_boxes SET balance=:b, updated_at=NOW() WHERE id=:id"),
                          {"b": new_bal, "id": str(malote[0])})
    await session.execute(text("""
        INSERT INTO cash_box_movements (id, association_id, cash_box_id, amount, movement_type, description, created_by)
        VALUES (gen_random_uuid(), :aid, :bid, :amt, 'credit', :desc, :usr)
    """), {"aid": str(current.association_id), "bid": str(malote[0]),
           "amt": amount, "desc": f"Malote — sessão {str(session_id)[:8]}", "usr": str(current.user_id)})
    await session.execute(text(
        "UPDATE cash_sessions SET malote_sent_at=NOW() WHERE id=:id AND association_id=:aid"
    ), {"id": str(session_id), "aid": str(current.association_id)})
    await session.commit()
    return {"ok": True, "amount": str(round(amount, 2)), "malote_balance": str(round(new_bal, 2))}


@router.get("/pix/pending", summary="Transações de entrada com status de conciliação PIX")
async def list_pix_pending(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT
            t.id, t.amount, t.description, t.transaction_at, t.reversed_at,
            r.full_name AS resident_name,
            rec.status AS recon_status, rec.score,
            bs.id AS statement_id, bs.bank, bs.name AS payer_name,
            cs.opened_at AS session_opened_at, cs.id AS session_id,
            u_op.full_name AS operador_name,
            u_rev.full_name AS conferente_name
        FROM transactions t
        LEFT JOIN residents r ON r.id = t.resident_id
        LEFT JOIN reconciliations rec ON rec.transaction_id = t.id
        LEFT JOIN bank_statements bs ON bs.id = rec.statement_id
        LEFT JOIN cash_sessions cs ON cs.id = t.cash_session_id
        LEFT JOIN users u_op ON u_op.id = cs.opened_by
        LEFT JOIN users u_rev ON u_rev.id = cs.reviewed_by
        WHERE t.association_id = :aid
          AND t.type = 'income'
        ORDER BY t.transaction_at DESC
        LIMIT 300
    """), {"aid": str(current.association_id)})).fetchall()

    def derive_status(r) -> str:
        if r[4]:  # reversed_at
            return "cancelado"
        rs = r[6]  # recon_status
        if rs == "automatico":
            return "conciliado"
        if rs == "sugestao":
            return "pendente"
        return "nao_conciliado"

    return [{
        "id": str(r[0]),
        "amount": str(r[1]),
        "description": r[2],
        "date": str(r[3])[:10],
        "status": derive_status(r),
        "recon_score": r[7],
        "resident_name": r[5],
        "bank_statement_id": str(r[8]) if r[8] else None,
        "bank": r[9],
        "payer_name": r[10],
        "session_opened_at": str(r[11]) if r[11] else None,
        "session_id": str(r[12]) if r[12] else None,
        "operador_name": r[13],
        "conferente_name": r[14],
    } for r in rows]


@router.post("/transactions/offline", summary="Registrar saída externa (sem sessão ativa)")
async def register_offline_transaction(
    body: TransactionRequest,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Saída para pagamentos externos que não passam pelo caixa. Não afeta saldo de sessão."""
    from datetime import datetime
    from app.models.finance import Transaction

    if body.type not in (TransactionType.expense, TransactionType.income):
        from fastapi import HTTPException
        raise HTTPException(400, "Tipo deve ser income ou expense.")

    tx = Transaction(
        association_id=current.association_id,
        cash_session_id=None,
        category_id=body.category_id,
        payment_method_id=body.payment_method_id,
        resident_id=body.resident_id,
        type=body.type,
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
    filters = "t.association_id = :aid"
    params: dict = {"aid": str(current.association_id)}
    if session_id:
        filters += " AND t.cash_session_id = :sid"
        params["sid"] = str(session_id)
    result = await session.execute(
        text(f"""
            SELECT t.id, t.type, t.income_subtype, t.amount, t.description,
                   t.transaction_at, t.is_sangria, t.approval_status,
                   t.is_reversal, t.reversed_at, t.payment_method_id,
                   pm.name AS payment_method_name,
                   u.full_name AS created_by_name
            FROM transactions t
            LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
            LEFT JOIN users u ON u.id = t.created_by
            WHERE {filters}
            ORDER BY t.transaction_at DESC
        """),
        params,
    )
    rows = result.fetchall()
    return [
        {
            "id": str(r[0]),
            "type": r[1],
            "income_subtype": r[2],
            "amount": str(r[3]),
            "description": r[4],
            "transaction_at": str(r[5]),
            "is_sangria": r[6],
            "approval_status": r[7],
            "is_reversal": r[8],
            "reversed_at": str(r[9]) if r[9] else None,
            "payment_method_id": str(r[10]) if r[10] else None,
            "payment_method_name": r[11],
            "created_by_name": r[12],
        }
        for r in rows
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


@router.get("/tesouraria", summary="Visão unificada da tesouraria")
async def tesouraria_summary(
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as sa_text
    aid = str(current.association_id)

    open_rows = (await session.execute(sa_text("""
        SELECT cs.id, cs.opened_at, cs.opening_balance,
               u.full_name AS operador,
               COALESCE(cs.opening_balance, 0)
               + COALESCE((SELECT SUM(t.amount) FROM transactions t
                           WHERE t.cash_session_id=cs.id AND t.type='income'
                             AND t.reversed_at IS NULL AND t.is_reversal=false), 0)
               - COALESCE((SELECT SUM(t.amount) FROM transactions t
                           WHERE t.cash_session_id=cs.id AND t.type IN ('expense','sangria')
                             AND t.reversed_at IS NULL AND t.is_reversal=false), 0) AS expected
          FROM cash_sessions cs
          LEFT JOIN users u ON u.id = cs.opened_by
         WHERE cs.association_id=:aid AND cs.status='open'
         ORDER BY cs.opened_at DESC
    """), {"aid": aid})).fetchall()

    conf_rows = (await session.execute(sa_text("""
        SELECT cs.id, cs.opened_at, cs.closing_balance, cs.expected_balance,
               cs.difference, u.full_name AS operador
          FROM cash_sessions cs
          LEFT JOIN users u ON u.id = cs.opened_by
         WHERE cs.association_id=:aid AND cs.status='conferido'
         ORDER BY cs.opened_at DESC
    """), {"aid": aid})).fetchall()

    pap_row = (await session.execute(sa_text("""
        SELECT COALESCE(SUM(p.amount),0), COUNT(*)
          FROM porta_a_porta_payments p
          JOIN porta_a_porta_leads l ON l.id = p.lead_id
         WHERE l.association_id=:aid AND p.status='paid'
           AND DATE(p.paid_at) = CURRENT_DATE
           AND NOT EXISTS (
               SELECT 1 FROM transactions t
               WHERE t.description LIKE '%Porta a Porta%'
                 AND t.association_id=:aid
                 AND DATE(t.transaction_at) = CURRENT_DATE
                 AND t.amount = p.amount
           )
    """), {"aid": aid})).fetchone()

    boxes = (await session.execute(sa_text(
        "SELECT id, name, balance FROM cash_boxes WHERE association_id=:aid AND is_active=true ORDER BY name"
    ), {"aid": aid})).fetchall()

    # Faturamento líquido: all non-reversed income minus expenses (all time, active sessions)
    faturamento_row = (await session.execute(sa_text("""
        SELECT
          COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END), 0) AS bruto,
          COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS saidas
        FROM transactions t
        WHERE t.association_id=:aid AND t.reversed_at IS NULL AND t.is_reversal=false
          AND DATE(t.transaction_at) = CURRENT_DATE
    """), {"aid": aid})).fetchone()
    faturamento = round(float(faturamento_row[0]) - float(faturamento_row[1]), 2) if faturamento_row else 0.0

    # Per-cashbox movement breakdown by payment method (from cash_box_movements)
    box_breakdown_rows = (await session.execute(sa_text("""
        SELECT cbm.cash_box_id, COALESCE(pm.name, 'Dinheiro') AS pm_name,
               SUM(CASE WHEN cbm.movement_type='credit' THEN cbm.amount ELSE -cbm.amount END) AS total
          FROM cash_box_movements cbm
          LEFT JOIN transactions t ON t.description = cbm.description
            AND t.association_id = cbm.association_id
          LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
         WHERE cbm.association_id=:aid AND cbm.movement_type='credit'
         GROUP BY cbm.cash_box_id, COALESCE(pm.name, 'Dinheiro')
    """), {"aid": aid})).fetchall()
    breakdown_by_box: dict = {}
    for r in box_breakdown_rows:
        bid = str(r[0])
        if bid not in breakdown_by_box:
            breakdown_by_box[bid] = []
        breakdown_by_box[bid].append({"pm": r[1], "total": str(round(float(r[2]), 2))})

    return {
        "open_sessions": [{"id": str(r[0]), "opened_at": str(r[1]), "opening_balance": str(r[2]),
                            "operador": r[3], "expected_balance": str(round(float(r[4]),2))} for r in open_rows],
        "conferido_sessions": [{"id": str(r[0]), "opened_at": str(r[1]),
                                  "closing_balance": str(r[2]) if r[2] else None,
                                  "expected_balance": str(r[3]) if r[3] else None,
                                  "difference": str(r[4]) if r[4] else None,
                                  "operador": r[5]} for r in conf_rows],
        "pap_today": {"total": str(round(float(pap_row[0]),2)), "count": pap_row[1]},
        "caixinhas": [{"id": str(r[0]), "name": r[1], "balance": str(round(float(r[2]),2)),
                       "breakdown": breakdown_by_box.get(str(r[0]), [])} for r in boxes],
        "total_limbo": str(round(sum(float(r[2] or 0) for r in conf_rows), 2)),
        "faturamento_hoje": str(faturamento),
    }


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
                u_open.full_name   AS operador_name,
                u_close.full_name  AS fechado_por,
                u_review.full_name AS conferido_por,
                cs.origin,
                a.name            AS association_name,
                cs.quebra_caixa,
                cs.malote_sent_at,
                CASE WHEN cs.origin = 'Manual' THEN COALESCE(cs.manual_pix, 0)
                     ELSE COALESCE(SUM(CASE WHEN t.type = 'income'
                          AND (t.reversed_at IS NULL AND t.is_reversal = false)
                          AND pm.name ILIKE '%pix%' THEN t.amount ELSE 0 END), 0)
                END AS total_pix,
                CASE WHEN cs.origin = 'Manual' THEN COALESCE(cs.manual_dinheiro, 0)
                     ELSE COALESCE(SUM(CASE WHEN t.type = 'income'
                          AND (t.reversed_at IS NULL AND t.is_reversal = false)
                          AND (pm.name ILIKE '%dinheiro%' OR pm.name ILIKE '%espécie%'
                               OR pm.name ILIKE '%especie%' OR t.payment_method_id IS NULL)
                          THEN t.amount ELSE 0 END), 0)
                END AS total_dinheiro,
                CASE WHEN cs.origin = 'Manual' THEN COALESCE(cs.manual_total_bruto, 0)
                     ELSE COALESCE(SUM(CASE WHEN t.type = 'income'
                          AND (t.reversed_at IS NULL AND t.is_reversal = false)
                          THEN t.amount ELSE 0 END), 0)
                END AS total_bruto,
                CASE WHEN cs.origin = 'Manual' THEN COALESCE(cs.manual_total_baixas, 0)
                     ELSE COALESCE(SUM(CASE WHEN t.type = 'sangria'
                          AND (t.reversed_at IS NULL AND t.is_reversal = false)
                          THEN t.amount ELSE 0 END), 0)
                END AS total_baixas
            FROM cash_sessions cs
            LEFT JOIN users u_open   ON u_open.id   = cs.opened_by
            LEFT JOIN users u_close  ON u_close.id  = cs.closed_by
            LEFT JOIN users u_review ON u_review.id = cs.reviewed_by
            LEFT JOIN associations a ON a.id = cs.association_id
            LEFT JOIN transactions t
                ON t.cash_session_id = cs.id AND t.association_id = cs.association_id
            LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
            WHERE cs.association_id = :aid
            {uid_filter}
            GROUP BY cs.id, cs.status, cs.opened_at, cs.closed_at,
                     cs.opening_balance, cs.closing_balance, cs.expected_balance,
                     cs.difference, u_open.full_name, u_close.full_name, u_review.full_name,
                     cs.origin, a.name, cs.quebra_caixa, cs.malote_sent_at, cs.manual_pix, cs.manual_dinheiro,
                     cs.manual_total_bruto, cs.manual_total_baixas
            ORDER BY cs.opened_at DESC
        """.replace("{uid_filter}", "" if current.is_conferente else "AND cs.opened_by = :uid")),
        {"aid": str(current.association_id)} if current.is_conferente else {"aid": str(current.association_id), "uid": str(current.user_id)},
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
            "fechado_por": r[9],
            "conferido_por": r[10],
            "origin": r[11] or "Sessão de Caixa",
            "association_name": r[12],
            "quebra_caixa": str(round(float(r[13]), 2)) if r[13] is not None else None,
            "malote_sent_at": str(r[14]) if r[14] is not None else None,
            "total_pix": str(round(float(r[15]), 2)),
            "total_dinheiro": str(round(float(r[16]), 2)),
            "total_bruto": str(round(float(r[17]), 2)),
            "total_baixas": str(round(float(r[18]), 2)),
        }
        for r in rows
    ]


class PatchSessionRequest(BaseModel):
    closing_balance: Decimal | None = Field(default=None, ge=0)
    manual_pix: Decimal | None = Field(default=None, ge=0)
    manual_dinheiro: Decimal | None = Field(default=None, ge=0)
    manual_total_baixas: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None


@router.patch("/sessions/{session_id}", summary="Corrigir valores de uma sessão fechada")
async def patch_session(
    session_id: UUID,
    body: PatchSessionRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlmodel import select as sql_select
    result = await session.execute(
        sql_select(CashSession).where(
            CashSession.id == session_id,
            CashSession.association_id == current.association_id,
        )
    )
    cash = result.scalar_one_or_none()
    if not cash:
        raise HTTPException(status_code=404, detail="Sessão não encontrada.")
    if cash.status == "open":
        raise HTTPException(status_code=400, detail="Não é possível editar sessão aberta.")
    if body.closing_balance is not None:
        cash.closing_balance = body.closing_balance
    if body.manual_pix is not None:
        cash.manual_pix = body.manual_pix
    if body.manual_dinheiro is not None:
        cash.manual_dinheiro = body.manual_dinheiro
    if body.manual_total_baixas is not None:
        cash.manual_total_baixas = body.manual_total_baixas
    cash.reviewed_by = current.user_id
    session.add(cash)
    await session.commit()
    return {"ok": True}


@router.post("/sessions/{session_id}/recalculate", summary="Recalcular quebra de caixa")
async def recalculate_session(
    session_id: UUID,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlmodel import select as sql_select
    result = await session.execute(
        sql_select(CashSession).where(
            CashSession.id == session_id,
            CashSession.association_id == current.association_id,
        )
    )
    cash = result.scalar_one_or_none()
    if not cash:
        raise HTTPException(status_code=404, detail="Sessão não encontrada.")
    svc = FinanceService(session)
    expected, bruto, baixas = await svc._compute_expected_balance(cash)
    cash.expected_balance = expected
    cash.manual_total_bruto = bruto
    cash.manual_total_baixas = baixas
    if cash.closing_balance is not None:
        cash.difference = cash.closing_balance - expected
        if cash.quebra_caixa is not None:
            cash.quebra_caixa = cash.closing_balance - expected
    cash.reviewed_by = current.user_id
    session.add(cash)
    await session.commit()
    return {
        "expected_balance": str(expected),
        "total_bruto": str(bruto),
        "total_baixas": str(baixas),
        "difference": str(cash.difference) if cash.difference is not None else None,
    }


@router.post("/sessions/{session_id}/revert-conferencia", summary="Desfazer conferência — volta ao status closed")
async def revert_conferencia(
    session_id: UUID,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlmodel import select as sql_select
    result = await session.execute(
        sql_select(CashSession).where(
            CashSession.id == session_id,
            CashSession.association_id == current.association_id,
        )
    )
    cash = result.scalar_one_or_none()
    if not cash:
        raise HTTPException(404, "Sessão não encontrada.")
    if cash.status != "conferido":
        raise HTTPException(400, "Apenas sessões conferidas podem ser revertidas.")
    cash.status = CashSessionStatus.closed
    session.add(cash)
    await session.commit()
    return {"ok": True, "session_id": str(cash.id), "status": "closed"}


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
    income = sum(float(t.amount) for t in txs if t.type == "income" and not t.is_reversal and t.reversed_at is None)
    exits = sum(float(t.amount) for t in txs if t.type != "income" and not t.is_reversal and t.reversed_at is None)
    expected = float(cash.opening_balance) + income - exits
    counted = float(body.counted_amount)
    diff = round(counted - expected, 2)
    cash.status = "conferido"
    cash.closing_balance = Decimal(str(round(counted, 2)))
    cash.difference = Decimal(str(diff))
    session.add(cash)
    await session.commit()
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


class CorrectTransactionRequest(BaseModel):
    admin_password: str = Field(min_length=1)
    amount: str | None = None
    payment_method_id: UUID | None = None
    resident_id: UUID | None = None
    description: str | None = None


@router.patch("/transactions/{transaction_id}/correct", summary="Corrigir lançamento com senha admin")
async def correct_transaction(
    transaction_id: UUID,
    body: CorrectTransactionRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlmodel import select as sq_select
    from app.models.user import User
    user_row = await session.execute(sq_select(User).where(User.id == current.user_id))
    user = user_row.scalar_one_or_none()
    if not user or not verify_password(body.admin_password, user.hashed_password):
        raise HTTPException(status_code=403, detail="Senha de administrador incorreta.")

    sets, params = [], {"tid": str(transaction_id), "aid": str(current.association_id)}
    if body.amount is not None:
        sets.append("amount = :amount"); params["amount"] = body.amount
    if body.payment_method_id is not None:
        sets.append("payment_method_id = :pm"); params["pm"] = str(body.payment_method_id)
    if body.resident_id is not None:
        sets.append("resident_id = :rid"); params["rid"] = str(body.resident_id)
    if body.description is not None:
        sets.append("description = :desc"); params["desc"] = body.description
    if not sets:
        raise HTTPException(422, "Nenhum campo para atualizar.")

    from sqlalchemy import text as sa_text
    await session.execute(
        sa_text(f"UPDATE transactions SET {', '.join(sets)} WHERE id = :tid AND association_id = :aid"),
        params,
    )
    await session.commit()
    return {"ok": True}


class ReversalRequest(BaseModel):
    reason: str = Field(min_length=5, description="Motivo do estorno")
    admin_password: str = Field(min_length=1, description="Senha do administrador")


@router.post("/transactions/{transaction_id}/reverse", summary="Estornar transação")
async def reverse_transaction(
    transaction_id: UUID,
    body: ReversalRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlmodel import select as sq_select
    from app.models.user import User
    user_row = await session.execute(sq_select(User).where(User.id == current.user_id))
    user = user_row.scalar_one_or_none()
    if not user or not verify_password(body.admin_password, user.hashed_password):
        raise HTTPException(status_code=403, detail="Senha de administrador incorreta.")

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
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    tx_type: str | None = Query(default=None, alias="type"),
    is_reversal: bool | None = Query(default=None),
    q: str | None = Query(default=None, description="Busca em descrição ou nome"),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as sa_text
    conditions = ["t.association_id = :aid"]
    params: dict = {"aid": str(current.association_id), "lim": limit, "off": offset}

    if date_from:
        from datetime import datetime as _dt
        conditions.append("t.transaction_at >= :date_from")
        params["date_from"] = _dt.fromisoformat(f"{date_from} 00:00:00")
    if date_to:
        from datetime import datetime as _dt
        conditions.append("t.transaction_at <= :date_to")
        params["date_to"] = _dt.fromisoformat(f"{date_to} 23:59:59")
    if tx_type:
        conditions.append("t.type = :tx_type")
        params["tx_type"] = tx_type
    if is_reversal is not None:
        conditions.append("t.is_reversal = :is_reversal")
        params["is_reversal"] = is_reversal
    if q:
        conditions.append("(t.description ILIKE :q OR u.full_name ILIKE :q)")
        params["q"] = f"%{q}%"

    where = " AND ".join(conditions)
    result = await session.execute(
        sa_text(f"""
            SELECT t.id, t.type, t.income_subtype, t.amount, t.description,
                   t.is_sangria, t.is_reversal, t.reversal_of_id, t.reversal_reason,
                   t.transaction_at, t.created_by,
                   u.full_name AS creator_name,
                   t.reversed_by, ur.full_name AS reverser_name, t.reversed_at,
                   t.reversed_at IS NOT NULL AS is_reversed,
                   COUNT(*) OVER() AS total_count
            FROM transactions t
            JOIN users u ON u.id = t.created_by
            LEFT JOIN users ur ON ur.id = t.reversed_by
            WHERE {where}
            ORDER BY t.transaction_at DESC
            LIMIT :lim OFFSET :off
        """),
        params,
    )
    rows = result.fetchall()
    total = rows[0][16] if rows else 0
    return {
        "total": total,
        "items": [
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
                "is_reversed": r[15],
            }
            for r in rows
        ],
    }


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


# ── Conferentes ──────────────────────────────────────────────────────────────

@router.get("/operadores", summary="Usuários com papel de operador ou superior")
async def list_operadores(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text as t
    ROLES = ['operator', 'conferente', 'diretoria_adjunta', 'diretoria', 'admin', 'superadmin']
    rows = (await session.execute(t("""
        SELECT id, full_name, role FROM users
         WHERE association_id = :aid AND is_active = true
           AND role = ANY(:roles) ORDER BY full_name
    """), {"aid": str(current.association_id), "roles": ROLES})).fetchall()
    return [{"id": str(r[0]), "full_name": r[1], "role": r[2]} for r in rows]


@router.get("/conferentes", summary="Usuários com papel de conferente ou superior")
async def list_conferentes(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text as t
    ROLES = ['conferente', 'diretoria_adjunta', 'diretoria', 'admin', 'superadmin']
    rows = (await session.execute(t("""
        SELECT id, full_name, role FROM users
         WHERE association_id = :aid AND is_active = true
           AND role = ANY(:roles) ORDER BY full_name
    """), {"aid": str(current.association_id), "roles": ROLES})).fetchall()
    return [{"id": str(r[0]), "full_name": r[1], "role": r[2]} for r in rows]


# ── Session Transaction Reviews ───────────────────────────────────────────────

@router.get("/sessions/{session_id}/transactions", summary="Transações da sessão com status de conferência")
async def get_session_transactions(
    session_id: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text as t
    rows = (await session.execute(t("""
        SELECT t.id, t.type, t.income_subtype, t.amount, t.description,
               t.transaction_at, t.is_sangria, t.created_by,
               u.full_name AS created_by_name,
               COALESCE(r.conferido, false) AS conferido,
               r.observacao,
               t.payment_method_id,
               pm.name AS payment_method_name,
               t.reversed_at
          FROM transactions t
          LEFT JOIN users u ON u.id = t.created_by
          LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
          LEFT JOIN session_transaction_reviews r
                 ON r.transaction_id = t.id AND r.cash_session_id = :sid
         WHERE t.cash_session_id = :sid AND t.association_id = :aid
         ORDER BY t.transaction_at
    """), {"sid": session_id, "aid": str(current.association_id)})).fetchall()
    return [{
        "id": str(r[0]), "type": r[1], "income_subtype": r[2],
        "amount": str(r[3]), "description": r[4],
        "transaction_at": str(r[5]), "is_sangria": r[6],
        "created_by_name": r[8], "conferido": r[9], "observacao": r[10],
        "payment_method_id": str(r[11]) if r[11] else None,
        "payment_method_name": r[12],
        "reversed_at": str(r[13]) if r[13] else None,
    } for r in rows]


@router.patch("/transactions/{tx_id}/payment-method", summary="Conferente corrige forma de pagamento de uma transação")
async def patch_transaction_payment_method(
    tx_id: str,
    body: PatchTransactionPaymentMethodRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as t
    await session.execute(t("""
        UPDATE transactions SET payment_method_id = :pm
         WHERE id = :tid AND association_id = :aid
    """), {
        "pm": str(body.payment_method_id) if body.payment_method_id else None,
        "tid": tx_id, "aid": str(current.association_id),
    })
    await session.execute(t("""
        INSERT INTO session_transaction_reviews
            (id, association_id, cash_session_id, transaction_id, conferido, observacao, reviewed_by, updated_at)
        VALUES (gen_random_uuid(), :aid, :sid, :tid, true, :obs, :rev, NOW())
        ON CONFLICT (cash_session_id, transaction_id)
        DO UPDATE SET observacao=:obs, reviewed_by=:rev, updated_at=NOW()
    """), {
        "aid": str(current.association_id), "sid": body.cash_session_id,
        "tid": tx_id, "obs": body.observacao,
        "rev": str(body.reviewed_by_id) if body.reviewed_by_id else None,
    })
    await session.commit()
    return {"ok": True}


class ReassignRequest(BaseModel):
    cash_session_id: str


@router.patch("/transactions/{tx_id}/reassign", summary="Admin: redirecionar transação para outra sessão")
async def reassign_transaction(
    tx_id: str,
    body: ReassignRequest,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    new_session_id = body.cash_session_id
    from sqlalchemy import text as t
    result = await session.execute(t(
        "UPDATE transactions SET cash_session_id = :sid "
        "WHERE id = :tid AND association_id = :aid RETURNING id"
    ), {"sid": new_session_id, "tid": tx_id, "aid": str(current.association_id)})
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Transação não encontrada.")
    await session.commit()
    return {"ok": True}


@router.put("/sessions/{session_id}/reviews", summary="Salvar revisões de transações")
async def save_session_reviews(
    session_id: str,
    body: ReviewsRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as t
    for rev in body.reviews:
        await session.execute(t("""
            INSERT INTO session_transaction_reviews
                (id, association_id, cash_session_id, transaction_id, conferido, observacao, reviewed_by, updated_at)
            VALUES (gen_random_uuid(), :aid, :sid, :tid, :conf, :obs, :rev, NOW())
            ON CONFLICT (cash_session_id, transaction_id)
            DO UPDATE SET conferido=:conf, observacao=:obs, reviewed_by=:rev, updated_at=NOW()
        """), {
            "aid": str(current.association_id), "sid": session_id,
            "tid": rev.transaction_id, "conf": rev.conferido,
            "obs": rev.observacao, "rev": str(body.reviewed_by_id) if body.reviewed_by_id else None,
        })
    # Mark session as conferido and optionally update closing_balance
    update_fields = "reviewed_by=:rev, status='conferido'"
    params: dict = {
        "rev": str(body.reviewed_by_id) if body.reviewed_by_id else None,
        "sid": session_id,
        "aid": str(current.association_id),
    }
    if body.closing_balance is not None:
        # Recalculate expected balance to compute difference
        cs_row = (await session.execute(t("""
            SELECT expected_balance FROM cash_sessions WHERE id=:sid AND association_id=:aid
        """), {"sid": session_id, "aid": str(current.association_id)})).fetchone()
        expected = Decimal(str(cs_row[0])) if cs_row and cs_row[0] else Decimal("0")
        diff = body.closing_balance - expected
        update_fields += ", closing_balance=:cb, difference=:diff, quebra_caixa=:qc"
        params["cb"] = float(body.closing_balance)
        params["diff"] = float(diff)
        params["qc"] = float(diff)
    await session.execute(t(f"""
        UPDATE cash_sessions SET {update_fields} WHERE id=:sid AND association_id=:aid
    """), params)
    await session.commit()
    return {"ok": True, "status": "conferido"}


# ── Sangria Destinations ─────────────────────────────────────────────────────

@router.get("/sangria-destinations", summary="Destinos de sangria configurados")
async def list_sangria_destinations(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text as t
    rows = (await session.execute(t("""
        SELECT id, name FROM sangria_destinations
         WHERE association_id=:aid AND is_active=true ORDER BY name
    """), {"aid": str(current.association_id)})).fetchall()
    return [{"id": str(r[0]), "name": r[1]} for r in rows]


@router.post("/sangria-destinations", summary="Criar destino de sangria")
async def create_sangria_destination(
    body: SangriaDestinationRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as t
    r = (await session.execute(t("""
        INSERT INTO sangria_destinations (id, association_id, name)
        VALUES (gen_random_uuid(), :aid, :name) RETURNING id, name
    """), {"aid": str(current.association_id), "name": body.name})).fetchone()
    await session.commit()
    return {"id": str(r[0]), "name": r[1]}


@router.delete("/sangria-destinations/{dest_id}", summary="Remover destino de sangria")
async def delete_sangria_destination(
    dest_id: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as t
    await session.execute(t("""
        UPDATE sangria_destinations SET is_active=false WHERE id=:id AND association_id=:aid
    """), {"id": dest_id, "aid": str(current.association_id)})
    await session.commit()
    return {"ok": True}
