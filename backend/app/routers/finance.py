import asyncio
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import CashSessionError
from app.core.security import verify_password
from app.core.tenant import CurrentUser, get_current_user, require_admin, require_conferente
from app.database import AsyncSessionLocal, get_session
from app.models.finance import CashSession, IncomeSubtype, PaymentMethod, Transaction, TransactionCategory, TransactionType
from app.services.finance_service import FinanceService

router = APIRouter(prefix="/finance", tags=["Finanças"])


# ---- Request / Response schemas ----

class OpenSessionRequest(BaseModel):
    opening_balance: Decimal = Field(default=Decimal("0.00"), ge=0)
    notes: str | None = None
    device_token: str | None = None
    session_type: str = "pdv"


class CloseSessionRequest(BaseModel):
    closing_balance: Decimal = Field(ge=0)
    notes: str | None = None
    reviewed_by_id: UUID | None = None
    session_id: UUID | None = None  # admin: fechar caixa de outro operador
    blind_pix: Decimal | None = Field(default=None, ge=0)
    blind_dinheiro: Decimal | None = Field(default=None, ge=0)
    troco_deixado: Decimal | None = Field(default=None, ge=0)


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
    dinheiro_contado: Decimal | None = None
    pix_contado: Decimal | None = None
    quebra_motivo: str | None = None
    assinatura_url: str | None = None


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
    payment_status: str | None = None  # "paid" | "pending"
    is_acordo: bool = False
    acordo_installments: int = Field(default=2, ge=1, le=12)
    acordo_months: int = Field(default=1, ge=1, le=24)
    acordo_entrada: Decimal | None = None
    payer_name: str | None = None
    payer_entity_id: UUID | None = None
    mensalidade_months: list[str] | None = None
    signature_url: str | None = None


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
    resident_address_complement: str = ""
    amount: Decimal = Field(ge=0)
    isento: bool = False
    payment_method_id: UUID | None = None
    category_id: UUID | None = None
    resident_id: UUID | None = None
    cash_session_id: UUID | None = None


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
        resident_address_complement=body.resident_address_complement,
        amount=body.amount,
        isento=body.isento,
        payment_method_id=body.payment_method_id,
        category_id=body.category_id,
        resident_id=body.resident_id,
        cash_session_id=body.cash_session_id,
    )
    barcode = tx.reference_number if tx else ""
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="comprovante.pdf"',
            "X-Barcode-Code": barcode or "",
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
                   r.full_name as resident_name, r.cpf,
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
    import json as _json

    def _parse_proof(r) -> dict:
        desc = r[2] or ""
        r_name = r[7]  # from residents JOIN (NULL if resident_id is NULL)
        r_cpf = r[8]
        display_desc = desc
        try:
            meta = _json.loads(desc)
            label = meta.get("label", "Comprovante de Residência")
            name = meta.get("name", "")
            display_desc = f"{label} — {name}" if name else label
            r_name = r_name or name
            r_cpf = r_cpf or meta.get("cpf")
        except (_json.JSONDecodeError, TypeError):
            if not r_name:
                parts = desc.split(" — ", 1)
                if len(parts) == 2:
                    r_name = parts[1]
        return {
            "id": str(r[0]), "amount": str(r[1]), "description": display_desc,
            "created_at": str(r[3]), "reference_number": r[4],
            "reversed_at": str(r[5]) if r[5] else None,
            "payment_method": r[6], "resident_name": r_name,
            "cpf": r_cpf, "issued_by": r[9],
        }

    rows = result.fetchall()
    return [_parse_proof(r) for r in rows]


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
        resident_address_complement=body.resident_address_complement,
        amount=body.amount,
        isento=body.isento,
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
    import json as _json
    from sqlalchemy import text as sa_text
    row = (await session.execute(sa_text("""
        SELECT t.reference_number, t.resident_id, t.reversed_at, t.income_subtype,
               t.description, t.association_id
          FROM transactions t
         WHERE t.id = :tid
    """), {"tid": str(tx_id)})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Comprovante não encontrado.")
    if row[2] is not None:
        raise HTTPException(status_code=400, detail="Comprovante já estornado.")
    if row[3] != "proof_of_residence":
        raise HTTPException(status_code=400, detail="Transação não é um comprovante.")

    barcode_code = row[0] or ""
    resident_id = row[1]
    description = row[4] or ""
    tx_assoc_id = str(row[5])

    # Resolve resident data: prefer JSON metadata in description, fallback to residents table
    def _s(v) -> str:
        return str(v) if v is not None else ""

    r_name = "(nao identificado)"
    r_cpf = r_neighborhood = r_cep = r_street = r_number = ""

    try:
        meta = _json.loads(description)
        r_name = meta.get("name") or r_name
        r_cpf = meta.get("cpf", "")
        r_neighborhood = meta.get("neighborhood", "")
        r_cep = meta.get("cep", "")
        r_street = meta.get("street", "")
        r_number = meta.get("number", "")
    except (_json.JSONDecodeError, TypeError):
        # Legacy plain-text description: "Comprovante de Residência — Name"
        parts = description.split(" — ", 1)
        if len(parts) == 2:
            r_name = parts[1].strip()

        # Try to resolve resident data by resident_id or by name match
        res_row = None
        if resident_id:
            res_row = (await session.execute(sa_text("""
                SELECT full_name, cpf, address_neighborhood, address_cep, address_street, address_number
                  FROM residents WHERE id = :rid
            """), {"rid": str(resident_id)})).fetchone()
        if not res_row and r_name != "(nao identificado)":
            res_row = (await session.execute(sa_text("""
                SELECT full_name, cpf, address_neighborhood, address_cep, address_street, address_number
                  FROM residents
                 WHERE association_id = :aid
                   AND LOWER(full_name) = LOWER(:name)
                 LIMIT 1
            """), {"aid": tx_assoc_id, "name": r_name})).fetchone()
        if res_row:
            r_name = _s(res_row[0]) or r_name
            r_cpf = _s(res_row[1])
            r_neighborhood = _s(res_row[2])
            r_cep = _s(res_row[3])
            r_street = _s(res_row[4])
            r_number = _s(res_row[5])

    cfg = (await session.execute(sa_text("""
        SELECT s.assoc_logo_url, s.community_name, s.assoc_address, s.assoc_cep, a.name
          FROM association_settings s
          JOIN associations a ON a.id = s.association_id
         WHERE s.association_id = :aid
    """), {"aid": tx_assoc_id})).fetchone()

    if not cfg or not cfg[0]:
        raise HTTPException(status_code=422, detail="Logo da associação não configurado.")

    import httpx
    async with httpx.AsyncClient(timeout=10) as client:
        logo_resp = await client.get(cfg[0])
    if logo_resp.status_code != 200:
        raise HTTPException(status_code=422, detail="Falha ao baixar logo.")

    svc = FinanceService(session)
    barcode_bytes = svc._build_barcode_image(barcode_code)
    pdf_bytes = svc._build_proof_pdf(
        resident_name=r_name,
        resident_cpf=r_cpf,
        resident_neighborhood=r_neighborhood,
        resident_cep=r_cep,
        resident_address_street=r_street,
        resident_address_number=r_number,
        community_name=cfg[1] or "",
        assoc_name=cfg[4] or "",
        assoc_address=cfg[2] or "",
        assoc_cep=cfg[3] or "",
        logo_bytes=logo_resp.content,
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
        device_token=body.device_token,
        session_type=body.session_type,
    )
    return {"id": str(cash.id), "status": cash.status, "opened_at": str(cash.opened_at), "session_type": cash.session_type}


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
    except CashSessionError:
        return {"session": None}
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
        "session_type": cash.session_type,
    }


@router.get("/sessions/open", summary="Todas as sessões de caixa abertas")
async def list_open_sessions(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    where_extra = "" if current.is_conferente else "AND cs.opened_by = :uid"
    params: dict = {"aid": str(current.association_id)}
    if not current.is_conferente:
        params["uid"] = str(current.user_id)

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


@router.get("/sessions/open-picker", summary="Sessões abertas para seleção de destino de lançamento")
async def list_open_sessions_picker(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    result = await session.execute(
        text(
            "SELECT cs.id, cs.opened_at, u.full_name, cs.opened_by "
            "FROM cash_sessions cs LEFT JOIN users u ON u.id = cs.opened_by "
            "WHERE cs.association_id = :aid AND cs.status = 'open' "
            "ORDER BY cs.opened_at DESC"
        ),
        {"aid": str(current.association_id)},
    )
    return [
        {
            "id": str(r[0]),
            "opened_at": str(r[1]),
            "opened_by_name": r[2] or "—",
            "is_mine": str(r[3]) == str(current.user_id),
        }
        for r in result.fetchall()
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
        blind_pix=body.blind_pix,
        blind_dinheiro=body.blind_dinheiro,
        troco_deixado=body.troco_deixado,
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
    if body.cash_box_id:
        await svc.credit_cash_box(
            association_id=current.association_id,
            cash_box_id=body.cash_box_id,
            amount=body.amount,
            description=f"Transferência do caixa: {body.reason}",
            created_by=current.user_id,
        )
    return {"id": str(tx.id), "amount": str(tx.amount), "type": tx.type}


def _is_deadlock(exc: Exception) -> bool:
    return "DeadlockDetectedError" in type(exc.__cause__).__name__ if exc.__cause__ else False


@router.post("/transactions", summary="Registrar transação")
async def register_transaction(
    body: TransactionRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    x_device_token: str | None = Header(default=None),
) -> dict:
    async def _attempt(sess: AsyncSession) -> dict:
        svc = FinanceService(sess)
        can_pick_session = current.is_conferente
        if body.cash_session_id:
            cash = await svc.get_open_session(current.association_id, session_id=body.cash_session_id)
            if not can_pick_session and cash.opened_by != current.user_id:
                raise HTTPException(status_code=403, detail="Você não pode lançar em sessão de outro operador.")
            is_own_session = cash.opened_by == current.user_id
            if not current.is_admin and not is_own_session and cash.device_token and x_device_token and cash.device_token != x_device_token:
                raise HTTPException(status_code=403, detail="Dispositivo não autorizado para esta sessão.")
        else:
            try:
                cash = await svc.get_open_session(current.association_id, preferred_by=current.user_id)
                if cash.opened_by != current.user_id:
                    raise HTTPException(status_code=422, detail="NO_SESSION")
            except CashSessionError:
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
            is_acordo=body.is_acordo,
            acordo_installments=body.acordo_installments,
            acordo_months=body.acordo_months,
            payer_name=body.payer_name,
            payer_entity_id=body.payer_entity_id,
            mensalidade_months=body.mensalidade_months,
            signature_url=body.signature_url,
        )
        return {"id": str(tx.id), "type": tx.type, "amount": str(tx.amount)}

    # First attempt uses the injected session (managed by get_session dependency)
    try:
        return await _attempt(session)
    except HTTPException:
        raise
    except DBAPIError as exc:
        if not _is_deadlock(exc):
            raise
        await session.rollback()

    # Retry attempts with fresh sessions on deadlock
    for attempt in range(1, 3):
        await asyncio.sleep(0.15 * attempt)
        async with AsyncSessionLocal() as retry_session:
            try:
                result = await _attempt(retry_session)
                await retry_session.commit()
                return result
            except HTTPException:
                raise
            except DBAPIError as exc:
                await retry_session.rollback()
                if not _is_deadlock(exc):
                    raise
                if attempt == 2:
                    raise HTTPException(status_code=503, detail="Conflito temporário no banco. Tente novamente.")


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


class ApuracaoQuebraRequest(BaseModel):
    responsavel: str = Field(min_length=2, max_length=200)
    assinatura_url: str | None = None


@router.patch("/sessions/{session_id}/apuracao-quebra", summary="Registrar apuração de quebra (responsável + assinatura)")
async def apuracao_quebra(
    session_id: UUID,
    body: ApuracaoQuebraRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as sa_text
    row = (await session.execute(sa_text(
        "SELECT id FROM cash_sessions WHERE id=:id AND association_id=:aid"
    ), {"id": str(session_id), "aid": str(current.association_id)})).fetchone()
    if not row:
        raise HTTPException(404, "Sessão não encontrada.")
    await session.execute(sa_text("""
        UPDATE cash_sessions
           SET quebra_responsavel=:resp, quebra_assinatura_url=:sig, quebra_apurada_at=NOW()
         WHERE id=:id AND association_id=:aid
    """), {"resp": body.responsavel, "sig": body.assinatura_url, "id": str(session_id), "aid": str(current.association_id)})
    await session.commit()
    return {"ok": True}


class TransferToCashboxRequest(BaseModel):
    cash_box_id: UUID
    amount: Decimal = Field(ge=0)
    troco: Decimal = Field(default=Decimal("0"), ge=0)
    close_session: bool = False


@router.post("/sessions/{session_id}/transfer-to-cashbox", summary="Desativado — caixinhas removidas", deprecated=True)
async def transfer_to_cashbox(
    session_id: UUID,
    body: TransferToCashboxRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    raise HTTPException(410, "Funcionalidade de caixinhas foi removida.")
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

    if body.amount == 0:
        await session.commit()
        return {"ok": True, "transaction_id": None, "new_cashbox_balance": str(box[1]), "troco": "0", "closed": False}

    sid_str = str(session_id)
    desc = f"Repasse para caixinha — sessão {sid_str}"

    # Validate: total repasses cannot exceed dinheiro available (PIX excluded)
    if row[1] == "conferido":
        closing_bal = (await session.execute(sa_text(
            "SELECT closing_balance FROM cash_sessions WHERE id=:id"
        ), {"id": sid_str})).scalar()
        already_transferred = (await session.execute(sa_text("""
            SELECT COALESCE(SUM(amount),0) FROM transactions
            WHERE association_id=:aid AND type='sangria'
              AND description = :desc_pattern
              AND reversed_at IS NULL
        """), {
            "aid": str(current.association_id),
            "desc_pattern": desc,
        })).scalar()
        if closing_bal is not None:
            available = float(closing_bal) - float(already_transferred or 0)
            if float(body.amount) > round(available + 0.005, 2):
                raise HTTPException(400, f"Valor excede o disponível para repasse (R$ {available:.2f}).")
    svc = FinanceService(session)
    tx_session_id = None if row[1] == "conferido" else session_id
    tx = await svc.register_transaction(
        association_id=current.association_id,
        cash_session_id=tx_session_id,
        tx_type=TransactionType.sangria,
        amount=body.amount,
        description=desc,
        created_by=current.user_id,
    )
    new_bal = Decimal(str(box[1])) + body.amount
    await session.execute(sa_text("UPDATE cash_boxes SET balance=:b, updated_at=NOW() WHERE id=:id"),
                          {"b": str(new_bal), "id": str(body.cash_box_id)})
    await session.execute(sa_text("""
        INSERT INTO cash_box_movements (id, association_id, cash_box_id, amount, movement_type, description, created_by)
        VALUES (gen_random_uuid(), :aid, :bid, :amt, 'credit', :desc, :usr)
    """), {"aid": str(current.association_id), "bid": str(body.cash_box_id),
           "amt": str(body.amount), "desc": desc, "usr": str(current.user_id)})

    if body.close_session:
        from datetime import datetime as _dt
        await session.execute(sa_text(
            "UPDATE cash_sessions SET status='closed', closed_at=NOW(), closed_by=:uid WHERE id=:id AND association_id=:aid"
        ), {"uid": str(current.user_id), "id": str(session_id), "aid": str(current.association_id)})

    await session.commit()
    return {
        "ok": True,
        "transaction_id": str(tx.id),
        "new_cashbox_balance": str(new_bal),
        "troco": str(body.troco),
        "closed": body.close_session,
    }


@router.post("/sessions/{session_id}/send-to-malote", summary="Desativado — caixinhas removidas", deprecated=True)
async def send_to_malote(session_id: UUID, current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)) -> dict:
    raise HTTPException(410, "Funcionalidade de caixinhas foi removida.")


@router.get("/pix/pending", summary="Transações de entrada com status de conciliação PIX")
async def list_pix_pending(
    incluir_enviados: bool = Query(default=False),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    svc = FinanceService(session)
    return await svc.list_pix_pending(current.association_id, incluir_enviados)


@router.post("/transactions/offline", summary="Registrar saída externa (sem sessão ativa)")
async def register_offline_transaction(
    body: TransactionRequest,
    current: CurrentUser = Depends(get_current_user),
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
        income_subtype=body.income_subtype,
        reference_number=body.reference_number,
        approval_status="pending" if body.payment_status == "pending" else "approved",
        approved_by=current.user_id if body.payment_status != "pending" else None,
        approved_at=datetime.utcnow() if body.payment_status != "pending" else None,
        created_by=current.user_id,
        payer_name=body.payer_name,
        payer_entity_id=body.payer_entity_id,
    )
    session.add(tx)
    await session.flush()

    # Se income_subtype == mensalidade com morador e status pago, quita a mensalidade pendente mais antiga
    if (
        body.income_subtype == IncomeSubtype.mensalidade
        and body.resident_id is not None
        and body.payment_status != "pending"
    ):
        from app.models.mensalidade import Mensalidade, MensalidadeStatus
        from sqlmodel import select as sa_select
        men_result = await session.execute(
            sa_select(Mensalidade)
            .where(
                Mensalidade.association_id == current.association_id,
                Mensalidade.resident_id == body.resident_id,
                Mensalidade.status == MensalidadeStatus.pending,
            )
            .order_by(Mensalidade.reference_month.asc())
            .limit(1)
        )
        men = men_result.scalar_one_or_none()
        if men:
            men.status = MensalidadeStatus.paid
            men.paid_at = datetime.utcnow()
            men.transaction_id = tx.id
            men.updated_at = datetime.utcnow()
            session.add(men)

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
                   u.full_name AS created_by_name,
                   COALESCE(res.full_name, res2.full_name) AS resident_name
            FROM transactions t
            LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
            LEFT JOIN users u ON u.id = t.created_by
            LEFT JOIN mensalidades men ON men.transaction_id = t.id
            LEFT JOIN residents res ON res.id = men.resident_id
            LEFT JOIN residents res2 ON res2.id = t.resident_id
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
            "resident_name": r[13],
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
    svc = FinanceService(session)
    return await svc.get_tesouraria(current.association_id)


@router.get("/sessions", summary="Listar todas as sessões de caixa")
async def list_sessions(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    svc = FinanceService(session)
    return await svc.list_sessions(current.association_id, current.user_id, current.is_conferente)


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


@router.post("/sessions/{session_id}/reopen", summary="Reabrir caixa fechado para correção de lançamentos")
async def reopen_session(
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
    if cash.status == "open":
        raise HTTPException(400, "Sessão já está aberta.")
    cash.status = "open"
    cash.closed_at = None
    cash.closed_by = None
    cash.closing_balance = None
    cash.expected_balance = None
    cash.difference = None
    cash.quebra_caixa = None
    cash.malote_sent_at = None
    session.add(cash)
    await session.commit()
    return {"ok": True, "session_id": str(cash.id), "status": "open"}


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
    except CashSessionError:
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
    cash_session_id: UUID | None = None


@router.patch("/transactions/{transaction_id}/correct", summary="Corrigir lançamento com senha admin")
async def correct_transaction(
    transaction_id: UUID,
    body: CorrectTransactionRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlmodel import select as sq_select
    from app.models.user import User, UserRole
    admin_roles = {UserRole.admin, UserRole.admin_master, UserRole.superadmin}
    admins = await session.execute(
        sq_select(User).where(
            User.association_id == current.association_id,
            User.role.in_(admin_roles),
            User.is_active == True,
        )
    )
    if not any(verify_password(body.admin_password, u.hashed_password) for u in admins.scalars().all()):
        raise HTTPException(status_code=403, detail="Senha de administrador incorreta.")

    from sqlalchemy import text as sa_text

    sets, params = [], {"tid": str(transaction_id), "aid": str(current.association_id)}
    if body.amount is not None:
        sets.append("amount = :amount"); params["amount"] = body.amount
    if body.payment_method_id is not None:
        sets.append("payment_method_id = :pm"); params["pm"] = str(body.payment_method_id)
    if body.resident_id is not None:
        sets.append("resident_id = :rid"); params["rid"] = str(body.resident_id)
    if body.description is not None:
        sets.append("description = :desc"); params["desc"] = body.description
    if body.cash_session_id is not None:
        # Validate target session belongs to this association
        cs_row = (await session.execute(
            sa_text("SELECT id FROM cash_sessions WHERE id = :csid AND association_id = :aid"),
            {"csid": str(body.cash_session_id), "aid": str(current.association_id)},
        )).fetchone()
        if not cs_row:
            raise HTTPException(404, "Sessão de caixa não encontrada.")
        sets.append("cash_session_id = :csid"); params["csid"] = str(body.cash_session_id)
    if not sets:
        raise HTTPException(422, "Nenhum campo para atualizar.")

    await session.execute(
        sa_text(f"UPDATE transactions SET {', '.join(sets)}, updated_at = NOW() WHERE id = :tid AND association_id = :aid"),
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
    from app.models.user import User, UserRole
    admin_roles = {UserRole.admin, UserRole.admin_master, UserRole.superadmin}
    admins = await session.execute(
        sq_select(User).where(
            User.association_id == current.association_id,
            User.role.in_(admin_roles),
            User.is_active == True,
        )
    )
    authorized = any(
        verify_password(body.admin_password, u.hashed_password)
        for u in admins.scalars().all()
    )
    if not authorized:
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
                   COUNT(*) OVER() AS total_count,
                   res.full_name AS resident_name
            FROM transactions t
            JOIN users u ON u.id = t.created_by
            LEFT JOIN users ur ON ur.id = t.reversed_by
            LEFT JOIN mensalidades men ON men.transaction_id = t.id
            LEFT JOIN residents res ON res.id = men.resident_id
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
                "resident_name": r[17],
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
               t.reversed_at,
               COALESCE(res_direct.full_name, res_men.full_name) AS resident_name
          FROM transactions t
          LEFT JOIN users u ON u.id = t.created_by
          LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
          LEFT JOIN session_transaction_reviews r
                 ON r.transaction_id = t.id AND r.cash_session_id = :sid
          LEFT JOIN residents res_direct ON res_direct.id = t.resident_id
          LEFT JOIN mensalidades men ON men.transaction_id = t.id
          LEFT JOIN residents res_men ON res_men.id = men.resident_id
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
        "resident_name": r[14],
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
    # COALESCE ensures closed_by/closed_at stay filled after a reopen (constraint requires NOT NULL)
    update_fields = (
        "reviewed_by=:rev, status='conferido',"
        " closed_by=COALESCE(closed_by, :cur_user),"
        " closed_at=COALESCE(closed_at, NOW())"
    )
    params: dict = {
        "rev": str(body.reviewed_by_id) if body.reviewed_by_id else None,
        "cur_user": str(current.user_id),
        "sid": session_id,
        "aid": str(current.association_id),
    }
    if body.closing_balance is not None:
        cs_row = (await session.execute(t("""
            SELECT expected_balance FROM cash_sessions WHERE id=:sid AND association_id=:aid
        """), {"sid": session_id, "aid": str(current.association_id)})).fetchone()
        expected = Decimal(str(cs_row[0])) if cs_row and cs_row[0] else Decimal("0")
        diff = body.closing_balance - expected
        update_fields += ", closing_balance=:cb, difference=:diff, quebra_caixa=:qc"
        params["cb"] = float(body.closing_balance)
        params["diff"] = float(diff)
        params["qc"] = float(diff)
    if body.dinheiro_contado is not None:
        update_fields += ", dinheiro_contado=:dc"
        params["dc"] = float(body.dinheiro_contado)
    if body.pix_contado is not None:
        update_fields += ", pix_contado=:pc"
        params["pc"] = float(body.pix_contado)
    if body.quebra_motivo is not None:
        update_fields += ", quebra_motivo=:qm"
        params["qm"] = body.quebra_motivo
    if body.assinatura_url is not None:
        update_fields += ", assinatura_conferencia_url=:assin"
        params["assin"] = body.assinatura_url
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


@router.get("/esteira", summary="Esteira financeira: onde está cada R$ agora")
async def esteira(
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = FinanceService(session)
    return await svc.get_esteira(current.association_id)


# ── Saldo Unificado e Relatórios Financeiros ──────────────────────────────────

@router.get("/balance-summary", summary="Saldo esperado unificado do caixa")
async def balance_summary(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    aid = str(current.association_id)
    row = (await session.execute(text(
        "SELECT balance_start_date FROM associations WHERE id = :aid"
    ), {"aid": aid})).fetchone()
    from datetime import date as _date
    raw = row[0] if row and row[0] else None
    if isinstance(raw, _date):
        start_date = raw
    elif raw:
        start_date = _date.fromisoformat(str(raw))
    else:
        start_date = _date(2026, 6, 1)

    r = (await session.execute(text("""
        SELECT
            COALESCE(SUM(amount) FILTER (WHERE type='income' AND cash_session_id IS NOT NULL), 0) AS entradas_caixa,
            COALESCE(SUM(amount) FILTER (WHERE type='income' AND cash_session_id IS NULL),     0) AS entradas_manual,
            COALESCE(SUM(amount) FILTER (WHERE type IN ('expense','sangria') AND cash_session_id IS NOT NULL), 0) AS saidas_caixa,
            COALESCE(SUM(amount) FILTER (WHERE type='expense' AND cash_session_id IS NULL),    0) AS saidas_manual
        FROM transactions
        WHERE association_id = :aid
          AND is_reversal = FALSE AND reversed_at IS NULL
          AND transaction_at::date >= :start
    """), {"aid": aid, "start": start_date})).fetchone()

    ec  = float(r[0] or 0)
    em  = float(r[1] or 0)
    sc  = float(r[2] or 0)
    sm  = float(r[3] or 0)
    return {
        "entradas_caixa":    round(ec, 2),
        "entradas_manual":   round(em, 2),
        "saidas_caixa":      round(sc, 2),
        "saidas_manual":     round(sm, 2),
        "total_entradas":    round(ec + em, 2),
        "total_saidas":      round(sc + sm, 2),
        "saldo_esperado":    round((ec + em) - (sc + sm), 2),
        "balance_start_date": str(start_date),
    }


@router.get("/report/by-operator", summary="Relatorio financeiro agrupado por operador")
async def report_by_operator(
    date_from: str | None = None,
    date_to:   str | None = None,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    aid = str(current.association_id)
    conds = ["t.association_id = :aid", "t.is_reversal = FALSE", "t.reversed_at IS NULL",
             "t.type IN ('income','expense','sangria')", "cs.opened_by IS NOT NULL"]
    params: dict = {"aid": aid}
    if date_from: conds.append("t.transaction_at::date >= :df"); params["df"] = date_from
    if date_to:   conds.append("t.transaction_at::date <= :dt"); params["dt"] = date_to
    where = " AND ".join(conds)

    rows = (await session.execute(text(f"""
        SELECT
            u.id AS user_id,
            u.full_name AS operador,
            COUNT(DISTINCT cs.id)                                                AS sessoes,
            COALESCE(SUM(t.amount) FILTER (WHERE t.type='income'), 0)           AS entradas,
            COALESCE(SUM(t.amount) FILTER (WHERE t.type IN ('expense','sangria')), 0) AS saidas
        FROM transactions t
        JOIN cash_sessions cs ON cs.id = t.cash_session_id
        JOIN users u ON u.id = cs.opened_by
        WHERE {where}
        GROUP BY u.id, u.full_name
        ORDER BY entradas DESC
    """), params)).fetchall()

    result = [
        {
            "user_id":  str(r[0]),
            "operador": r[1],
            "sessoes":  r[2],
            "entradas": round(float(r[3]), 2),
            "saidas":   round(float(r[4]), 2),
            "resultado":round(float(r[3]) - float(r[4]), 2),
        }
        for r in rows
    ]
    total_e = sum(x["entradas"] for x in result)
    total_s = sum(x["saidas"]   for x in result)
    result.append({
        "user_id": None, "operador": "TOTAL",
        "sessoes": sum(x["sessoes"] for x in result),
        "entradas": round(total_e, 2),
        "saidas":   round(total_s, 2),
        "resultado":round(total_e - total_s, 2),
    })
    return result


@router.get("/report/period-summary", summary="Apuracao do periodo: entradas, saidas, resultado")
async def report_period_summary(
    date_from: str | None = None,
    date_to:   str | None = None,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    aid = str(current.association_id)
    conds = ["association_id = :aid", "is_reversal = FALSE", "reversed_at IS NULL"]
    params: dict = {"aid": aid}
    if date_from: conds.append("transaction_at::date >= :df"); params["df"] = date_from
    if date_to:   conds.append("transaction_at::date <= :dt"); params["dt"] = date_to
    where = " AND ".join(conds)

    r = (await session.execute(text(f"""
        SELECT
            COALESCE(SUM(amount) FILTER (WHERE type='income' AND cash_session_id IS NOT NULL), 0),
            COALESCE(SUM(amount) FILTER (WHERE type='income' AND cash_session_id IS NULL),     0),
            COALESCE(SUM(amount) FILTER (WHERE type IN ('expense','sangria') AND cash_session_id IS NOT NULL), 0),
            COALESCE(SUM(amount) FILTER (WHERE type='expense' AND cash_session_id IS NULL), 0)
        FROM transactions WHERE {where}
    """), params)).fetchone()

    ec, em, sc, sm = (float(x or 0) for x in r)
    return {
        "entradas_caixa":  round(ec, 2),
        "entradas_manual": round(em, 2),
        "saidas_caixa":    round(sc, 2),
        "saidas_manual":   round(sm, 2),
        "total_entradas":  round(ec + em, 2),
        "total_saidas":    round(sc + sm, 2),
        "resultado":       round((ec + em) - (sc + sm), 2),
        "date_from": date_from,
        "date_to":   date_to,
    }


# ── Conferência PDF ───────────────────────────────────────────────────────────

class ConferenciaPDFRequest(BaseModel):
    conferente_nome: str
    dinheiro_contado: float
    pix_contado: float
    quebra_motivo: str | None = None
    assinatura_url: str | None = None


@router.post("/sessions/{session_id}/conferencia-pdf", summary="Gerar comprovante PDF da conferência")
async def generate_conferencia_pdf(
    session_id: UUID,
    body: ConferenciaPDFRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> Response:
    from datetime import datetime
    from io import BytesIO
    from fpdf import FPDF

    aid = str(current.association_id)

    # Dados da sessão
    cs = (await session.execute(text("""
        SELECT cs.opened_at, cs.closed_at, cs.expected_balance, cs.total_pix,
               cs.total_dinheiro, cs.total_bruto, cs.total_baixas, cs.total_expense,
               u.full_name AS operador, a.name AS assoc
        FROM cash_sessions cs
        LEFT JOIN users u ON u.id = cs.opened_by
        LEFT JOIN associations a ON a.id = cs.association_id
        WHERE cs.id = :sid AND cs.association_id = :aid
    """), {"sid": str(session_id), "aid": aid})).fetchone()

    if not cs:
        raise HTTPException(404, "Sessão não encontrada.")

    # Transações
    txs = (await session.execute(text("""
        SELECT t.type, t.income_subtype, t.description, t.amount,
               pm.name AS pgto, r.full_name AS morador, t.transaction_at
        FROM transactions t
        LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
        LEFT JOIN residents r ON r.id = t.resident_id
        WHERE t.cash_session_id = :sid
          AND t.is_reversal = FALSE AND t.reversed_at IS NULL
        ORDER BY t.transaction_at
    """), {"sid": str(session_id)})).fetchall()

    esperado = float(cs[2] or 0)
    total_contado = body.dinheiro_contado + body.pix_contado
    diferenca = total_contado - esperado

    SUBTYPE_PT = {
        "mensalidade": "Mensalidade", "delivery_fee": "Taxa de entrega",
        "proof_of_residence": "Comprovante", "other": "Outros",
    }
    TYPE_PT = {"income": "Entrada", "expense": "Saída", "sangria": "Sangria"}

    HDR = (26, 63, 111)
    CINZA = (243, 244, 246)

    pdf = FPDF()
    pdf.set_auto_page_break(True, 14)
    pdf.add_page()
    pdf.set_margins(12, 14, 12)

    # Cabeçalho
    pdf.set_fill_color(*HDR)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, "Comprovante de Conferencia de Caixa", fill=True, ln=True, align="C")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 6, cs[9], ln=True, align="C")
    pdf.set_text_color(0, 0, 0)
    pdf.ln(3)

    # Info da sessão
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(*CINZA)
    pdf.cell(0, 6, "  Informacoes da Sessao", fill=True, ln=True)
    pdf.set_font("Helvetica", "", 8.5)
    opened = cs[0].strftime("%d/%m/%Y %H:%M") if cs[0] else "-"
    closed = cs[1].strftime("%d/%m/%Y %H:%M") if cs[1] else "-"
    for label, val in [
        ("Operador", cs[8] or "-"),
        ("Abertura", opened),
        ("Fechamento", closed),
        ("Conferente", body.conferente_nome),
        ("Gerado em", datetime.now().strftime("%d/%m/%Y %H:%M")),
    ]:
        pdf.cell(45, 5.5, label + ":"); pdf.cell(0, 5.5, str(val), ln=True)
    pdf.ln(3)

    # Resumo financeiro
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(*CINZA)
    pdf.cell(0, 6, "  Resumo Financeiro", fill=True, ln=True)
    pdf.set_font("Helvetica", "", 8.5)
    total_rec = float(cs[5] or 0)
    baixas = float(cs[6] or 0)
    expense = float(cs[7] or 0)
    liquido = total_rec - baixas - expense
    for label, val, bold in [
        ("Total bruto lancado", f"R$ {total_rec:.2f}", False),
        ("Sangrias/saidas", f"R$ {(baixas + expense):.2f}", False),
        ("Saldo esperado", f"R$ {esperado:.2f}", True),
        ("Dinheiro contado", f"R$ {body.dinheiro_contado:.2f}", False),
        ("PIX contado", f"R$ {body.pix_contado:.2f}", False),
        ("Total contado", f"R$ {total_contado:.2f}", True),
        ("Diferenca (quebra)", f"R$ {diferenca:+.2f}", True),
    ]:
        pdf.set_font("Helvetica", "B" if bold else "", 8.5)
        pdf.cell(60, 5.5, label + ":"); pdf.cell(0, 5.5, val, ln=True)

    if diferenca != 0 and body.quebra_motivo:
        pdf.set_font("Helvetica", "BI", 8.5)
        pdf.set_text_color(220, 38, 38)
        pdf.cell(60, 5.5, "Motivo da quebra:"); pdf.cell(0, 5.5, body.quebra_motivo, ln=True)
        pdf.set_text_color(0, 0, 0)
    pdf.ln(3)

    # Transações
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(*CINZA)
    pdf.cell(0, 6, f"  Movimentacoes ({len(txs)} lancamentos)", fill=True, ln=True)
    # Header tabela
    pdf.set_fill_color(*HDR)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 7.5)
    for h, w in [("Tipo", 22), ("Descricao/Morador", 72), ("Pgto", 30), ("Valor", 30), ("Data", 32)]:
        pdf.cell(w, 6, " " + h, fill=True, border=0)
    pdf.ln()
    pdf.set_text_color(0, 0, 0)
    for i, tx in enumerate(txs):
        pdf.set_fill_color(*(CINZA if i % 2 == 0 else (255, 255, 255)))
        pdf.set_font("Helvetica", "", 7.5)
        tipo = TYPE_PT.get(tx[0], tx[0])
        sub = SUBTYPE_PT.get(tx[1] or "", "")
        label = sub if sub else tipo
        desc = (tx[3] or "")[:38] if not tx[5] else f"{tx[5][:20]} — {tx[3] or ''}"[:38]
        amt = float(tx[4] or 0)
        dt = tx[6].strftime("%d/%m %H:%M") if tx[6] else "-"
        color = (15, 122, 77) if tx[0] == "income" else (220, 38, 38)
        pdf.cell(22, 5, " " + label[:14], fill=True, border=0)
        pdf.cell(72, 5, " " + desc, fill=True, border=0)
        pdf.cell(30, 5, " " + (tx[4] or "-")[:14], fill=True, border=0)
        pdf.set_text_color(*color)
        pdf.cell(30, 5, f" R$ {amt:.2f}", fill=True, border=0)
        pdf.set_text_color(0, 0, 0)
        pdf.cell(32, 5, " " + dt, fill=True, border=0)
        pdf.ln()
    pdf.ln(4)

    # Assinatura
    if body.assinatura_url:
        try:
            import urllib.request
            with urllib.request.urlopen(body.assinatura_url, timeout=5) as resp:
                img_data = resp.read()
            buf = BytesIO(img_data)
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_fill_color(*CINZA)
            pdf.cell(0, 6, "  Assinatura do Conferente", fill=True, ln=True)
            pdf.image(buf, x=12, w=80)
            pdf.ln(2)
        except Exception:
            pass

    pdf.set_font("Helvetica", "", 7.5)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(0, 5, f"Conferente: {body.conferente_nome}  |  Gerado: {datetime.now().strftime('%d/%m/%Y %H:%M')}", ln=True, align="C")

    buf_out = BytesIO()
    pdf.output(buf_out)
    buf_out.seek(0)
    return Response(
        content=buf_out.read(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="conferencia_{str(session_id)[:8]}.pdf"'},
    )


@router.get("/balance-breakdown", summary="Detalhamento do saldo esperado por dia/sessao/operador")
async def balance_breakdown(
    by: str = Query(default="day"),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from datetime import date as _date
    aid = str(current.association_id)
    row = (await session.execute(text(
        "SELECT balance_start_date FROM associations WHERE id = :aid"
    ), {"aid": aid})).fetchone()
    raw = row[0] if row and row[0] else None
    if isinstance(raw, _date): start_date = raw
    elif raw: start_date = _date.fromisoformat(str(raw))
    else: start_date = _date(2026, 6, 1)

    BASE = """
        FROM transactions t
        LEFT JOIN cash_sessions cs ON cs.id = t.cash_session_id
        LEFT JOIN users u ON u.id = cs.opened_by
        WHERE t.association_id = :aid
          AND t.is_reversal = FALSE AND t.reversed_at IS NULL
          AND t.type IN ('income','expense','sangria')
          AND t.transaction_at::date >= :start
    """
    params = {"aid": aid, "start": start_date}

    if by == "day":
        rows = (await session.execute(text(f"""
            SELECT
                t.transaction_at::date AS label,
                COALESCE(SUM(t.amount) FILTER (WHERE t.type='income'), 0) AS entradas,
                COALESCE(SUM(t.amount) FILTER (WHERE t.type IN ('expense','sangria')), 0) AS saidas
            {BASE}
            GROUP BY t.transaction_at::date
            ORDER BY t.transaction_at::date DESC
        """), params)).fetchall()
        return [{"label": str(r[0]), "entradas": round(float(r[1]),2),
                 "saidas": round(float(r[2]),2), "saldo": round(float(r[1])-float(r[2]),2)} for r in rows]

    elif by == "session":
        rows = (await session.execute(text(f"""
            SELECT
                cs.id AS sessao_id,
                COALESCE(u.full_name, 'Manual') AS operador,
                cs.opened_at::date AS data,
                COALESCE(SUM(t.amount) FILTER (WHERE t.type='income'), 0) AS entradas,
                COALESCE(SUM(t.amount) FILTER (WHERE t.type IN ('expense','sangria')), 0) AS saidas,
                cs.status
            {BASE}
            GROUP BY cs.id, u.full_name, cs.opened_at, cs.status
            ORDER BY cs.opened_at DESC NULLS LAST
        """), params)).fetchall()
        return [{"label": f"{r[1]} — {r[2]}", "sessao_id": str(r[0]) if r[0] else None,
                 "operador": r[1], "data": str(r[2]), "status": r[5],
                 "entradas": round(float(r[3]),2), "saidas": round(float(r[4]),2),
                 "saldo": round(float(r[3])-float(r[4]),2)} for r in rows]

    elif by == "operator":
        rows = (await session.execute(text(f"""
            SELECT
                COALESCE(u.full_name, 'Manual / Sem caixa') AS operador,
                COALESCE(SUM(t.amount) FILTER (WHERE t.type='income'), 0) AS entradas,
                COALESCE(SUM(t.amount) FILTER (WHERE t.type IN ('expense','sangria')), 0) AS saidas
            {BASE}
            GROUP BY u.full_name
            ORDER BY entradas DESC
        """), params)).fetchall()
        return [{"label": r[0], "operador": r[0],
                 "entradas": round(float(r[1]),2), "saidas": round(float(r[2]),2),
                 "saldo": round(float(r[1])-float(r[2]),2)} for r in rows]

    return []
