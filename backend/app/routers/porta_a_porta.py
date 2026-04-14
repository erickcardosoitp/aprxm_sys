import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.config import get_settings
from app.core.tenant import CurrentUser, get_current_user, require_admin
from app.database import get_session
from app.models.porta_a_porta import PortaAPortaLead, PortaAPortaPayment

router = APIRouter(prefix="/porta-a-porta", tags=["Porta a Porta"])

_ALGO = "HS256"
_TOKEN_EXP_DAYS = 365


def _make_public_token(association_id: str, operator_id: str, secret: str) -> str:
    payload = {
        "assoc": association_id,
        "op": operator_id,
        "exp": datetime.utcnow() + timedelta(days=_TOKEN_EXP_DAYS),
    }
    return jwt.encode(payload, secret, algorithm=_ALGO)


def _decode_public_token(token: str, secret: str) -> dict:
    try:
        return jwt.decode(token, secret, algorithms=[_ALGO])
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado.")


# ── Request schemas ──────────────────────────────────────────────────────────

class DependentIn(BaseModel):
    name: str
    phone: str | None = None
    cpf: str | None = None


class LeadIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    phone: str | None = None
    cpf: str | None = None
    address_street: str = Field(min_length=1, max_length=200)
    address_number: str = Field(min_length=1, max_length=20)
    address_complement: str | None = None
    dependents: list[DependentIn] = Field(default_factory=list)
    payment_type: str = Field(default="avista")   # avista | parcelado
    total_installments: int = Field(default=1, ge=1, le=12)
    monthly_fee: Decimal = Field(default=Decimal("20.00"), gt=0)
    notes: str | None = None


class PayInstallmentIn(BaseModel):
    installment_id: str
    payment_method: str | None = None
    paid_at: datetime | None = None


class PayLeadIn(BaseModel):
    payment_method: str | None = None
    paid_at: datetime | None = None


class PublicLeadIn(BaseModel):
    token: str
    full_name: str = Field(min_length=2, max_length=200)
    phone: str | None = None
    cpf: str | None = None
    address_street: str = Field(min_length=1, max_length=200)
    address_number: str = Field(min_length=1, max_length=20)
    address_complement: str | None = None
    dependents: list[DependentIn] = Field(default_factory=list, max_length=3)
    notes: str | None = None


# ── Helper ───────────────────────────────────────────────────────────────────

def _serialize_lead(lead: PortaAPortaLead, operator_name: str | None = None) -> dict:
    deps = json.loads(lead.dependents) if isinstance(lead.dependents, str) else (lead.dependents or [])
    return {
        "id": str(lead.id),
        "full_name": lead.full_name,
        "phone": lead.phone,
        "cpf": lead.cpf,
        "address_street": lead.address_street,
        "address_number": lead.address_number,
        "address_complement": lead.address_complement,
        "dependents": deps,
        "status": lead.status,
        "payment_type": lead.payment_type,
        "total_installments": lead.total_installments,
        "monthly_fee": str(lead.monthly_fee),
        "notes": lead.notes,
        "resident_id": str(lead.resident_id) if lead.resident_id else None,
        "operator_id": str(lead.operator_id),
        "operator_name": operator_name,
        "created_at": str(lead.created_at),
    }


def _commission(paid_count: int, monthly_fee: float = 20.0) -> float:
    """Every 5 paid leads → operator earns 2 monthly fees."""
    batches = paid_count // 5
    return round(batches * 2 * monthly_fee, 2)


# ── Operator / admin endpoints ────────────────────────────────────────────────

@router.get("/public-token", summary="Gerar token para link público")
async def get_public_token(
    current: CurrentUser = Depends(get_current_user),
) -> dict:
    settings = get_settings()
    token = _make_public_token(str(current.association_id), str(current.user_id), settings.secret_key)
    return {"token": token}


@router.post("/leads", summary="Registrar lead (operador)")
async def create_lead(
    body: LeadIn,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    lead = PortaAPortaLead(
        association_id=current.association_id,
        operator_id=current.user_id,
        full_name=body.full_name,
        phone=body.phone,
        cpf=body.cpf,
        address_street=body.address_street,
        address_number=body.address_number,
        address_complement=body.address_complement,
        dependents=json.dumps([d.model_dump() for d in body.dependents]),
        payment_type=body.payment_type,
        total_installments=body.total_installments,
        monthly_fee=body.monthly_fee,
        notes=body.notes,
    )
    session.add(lead)
    await session.flush()  # get id

    # Create installments
    n = body.total_installments
    per_installment = round(float(body.monthly_fee) / n, 2)
    for i in range(1, n + 1):
        pmt = PortaAPortaPayment(
            association_id=current.association_id,
            lead_id=lead.id,
            installment_number=i,
            total_installments=n,
            amount=Decimal(str(per_installment)),
            due_date=date.today().replace(day=1) + timedelta(days=30 * i),
        )
        session.add(pmt)

    await session.commit()
    return _serialize_lead(lead)


@router.get("/leads", summary="Listar leads")
async def list_leads(
    status: str | None = Query(default=None),
    operator_id: str | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text as sa_text
    q = """
        SELECT l.*, u.full_name AS operator_name
        FROM porta_a_porta_leads l
        LEFT JOIN users u ON u.id = l.operator_id
        WHERE l.association_id = :aid
    """
    params: dict = {"aid": str(current.association_id)}
    if status:
        q += " AND l.status = :status"
        params["status"] = status
    if operator_id:
        q += " AND l.operator_id = :op_id"
        params["op_id"] = operator_id
    q += " ORDER BY l.created_at DESC"

    result = await session.execute(sa_text(q), params)
    rows = result.mappings().all()
    return [
        {
            "id": str(r["id"]),
            "full_name": r["full_name"],
            "phone": r["phone"],
            "cpf": r["cpf"],
            "address_street": r["address_street"],
            "address_number": r["address_number"],
            "address_complement": r["address_complement"],
            "dependents": json.loads(r["dependents"]) if r["dependents"] else [],
            "status": r["status"],
            "payment_type": r["payment_type"],
            "total_installments": r["total_installments"],
            "monthly_fee": str(r["monthly_fee"]),
            "notes": r["notes"],
            "operator_id": str(r["operator_id"]),
            "operator_name": r["operator_name"],
            "created_at": str(r["created_at"]),
        }
        for r in rows
    ]


@router.get("/leads/{lead_id}/payments", summary="Parcelas do lead")
async def get_lead_payments(
    lead_id: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    result = await session.execute(
        select(PortaAPortaPayment)
        .where(
            PortaAPortaPayment.lead_id == UUID(lead_id),
            PortaAPortaPayment.association_id == current.association_id,
        )
        .order_by(PortaAPortaPayment.installment_number)
    )
    pmts = result.scalars().all()
    return [
        {
            "id": str(p.id),
            "installment_number": p.installment_number,
            "total_installments": p.total_installments,
            "amount": str(p.amount),
            "due_date": str(p.due_date),
            "paid_at": str(p.paid_at) if p.paid_at else None,
            "status": p.status,
            "payment_method": p.payment_method,
        }
        for p in pmts
    ]


@router.post("/leads/{lead_id}/pay", summary="Registrar pagamento de parcela ou lead avista")
async def pay_lead(
    lead_id: str,
    body: PayLeadIn,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    lead = (await session.execute(
        select(PortaAPortaLead).where(
            PortaAPortaLead.id == UUID(lead_id),
            PortaAPortaLead.association_id == current.association_id,
        )
    )).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead não encontrado.")

    pmts = (await session.execute(
        select(PortaAPortaPayment)
        .where(PortaAPortaPayment.lead_id == lead.id)
        .order_by(PortaAPortaPayment.installment_number)
    )).scalars().all()

    paid_at = body.paid_at or datetime.utcnow()

    # Pay all pending installments (avista) or next pending (parcelado)
    if lead.payment_type == "avista":
        for p in pmts:
            if p.status == "pending":
                p.status = "paid"
                p.paid_at = paid_at
                p.payment_method = body.payment_method
                session.add(p)
        lead.status = "paid"
    else:
        # Pay next pending installment
        for p in pmts:
            if p.status == "pending":
                p.status = "paid"
                p.paid_at = paid_at
                p.payment_method = body.payment_method
                session.add(p)
                break
        all_paid = all(p.status == "paid" for p in pmts)
        lead.status = "paid" if all_paid else "agreement"

    lead.updated_at = datetime.utcnow()
    session.add(lead)
    await session.commit()
    return {"ok": True, "lead_status": lead.status}


@router.delete("/leads/{lead_id}", summary="Cancelar lead")
async def cancel_lead(
    lead_id: str,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    lead = (await session.execute(
        select(PortaAPortaLead).where(
            PortaAPortaLead.id == UUID(lead_id),
            PortaAPortaLead.association_id == current.association_id,
        )
    )).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead não encontrado.")
    lead.status = "cancelled"
    lead.updated_at = datetime.utcnow()
    session.add(lead)
    await session.commit()
    return {"ok": True}


@router.get("/summary", summary="Resumo do Porta a Porta")
async def get_summary(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as sa_text
    result = await session.execute(sa_text("""
        SELECT
            COUNT(*) FILTER (WHERE status IN ('paid', 'agreement')) AS total_leads,
            COUNT(*) FILTER (WHERE status = 'paid') AS paid_leads,
            COUNT(*) FILTER (WHERE status = 'pending') AS pending_leads,
            COUNT(*) FILTER (WHERE status = 'agreement') AS agreement_leads,
            COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_leads,
            COALESCE(SUM(monthly_fee) FILTER (WHERE status IN ('paid', 'agreement')), 0) AS gross_revenue
        FROM porta_a_porta_leads
        WHERE association_id = :aid
    """), {"aid": str(current.association_id)})
    row = result.fetchone()

    # Payments received
    pay_result = await session.execute(sa_text("""
        SELECT COALESCE(SUM(p.amount), 0) AS total_received
        FROM porta_a_porta_payments p
        JOIN porta_a_porta_leads l ON l.id = p.lead_id
        WHERE l.association_id = :aid AND p.status = 'paid'
    """), {"aid": str(current.association_id)})
    pay_row = pay_result.fetchone()

    # Per-operator commission breakdown
    op_result = await session.execute(sa_text("""
        SELECT
            l.operator_id,
            u.full_name AS operator_name,
            COUNT(*) FILTER (WHERE l.status = 'paid') AS paid_count,
            COALESCE(SUM(l.monthly_fee) FILTER (WHERE l.status = 'paid'), 0) AS total_fee
        FROM porta_a_porta_leads l
        LEFT JOIN users u ON u.id = l.operator_id
        WHERE l.association_id = :aid
        GROUP BY l.operator_id, u.full_name
        ORDER BY paid_count DESC
    """), {"aid": str(current.association_id)})

    commissions = []
    for r in op_result.fetchall():
        paid = int(r[2] or 0)
        avg_fee = float(r[3] or 0) / paid if paid else 20.0
        earned = _commission(paid, avg_fee)
        commissions.append({
            "operator_id": str(r[0]),
            "operator_name": r[1],
            "paid_count": paid,
            "commission_earned": earned,
            "next_commission_in": 5 - (paid % 5) if paid % 5 != 0 else 5,
        })

    paid_leads = int(row[1] or 0)
    monthly_fee_avg = 20.0
    total_commission = _commission(paid_leads, monthly_fee_avg)

    return {
        "total_leads": int(row[0] or 0),
        "paid_leads": paid_leads,
        "pending_leads": int(row[2] or 0),
        "agreement_leads": int(row[3] or 0),
        "cancelled_leads": int(row[4] or 0),
        "gross_revenue": str(round(float(row[5] or 0), 2)),
        "total_received": str(round(float(pay_row[0] or 0), 2)),
        "total_commission": str(total_commission),
        "commissions": commissions,
    }


# ── Public endpoint (no auth) ─────────────────────────────────────────────────

@router.post("/public-register", summary="Cadastro público via link do operador")
async def public_register(
    body: PublicLeadIn,
    session: AsyncSession = Depends(get_session),
) -> dict:
    if len(body.dependents) > 3:
        raise HTTPException(status_code=400, detail="Máximo de 3 dependentes.")

    settings = get_settings()
    payload = _decode_public_token(body.token, settings.secret_key)

    assoc_id = UUID(payload["assoc"])
    operator_id = UUID(payload["op"])

    lead = PortaAPortaLead(
        association_id=assoc_id,
        operator_id=operator_id,
        full_name=body.full_name,
        phone=body.phone,
        cpf=body.cpf,
        address_street=body.address_street,
        address_number=body.address_number,
        address_complement=body.address_complement,
        dependents=json.dumps([d.model_dump() for d in body.dependents]),
        payment_type="avista",
        total_installments=1,
        notes=body.notes,
    )
    session.add(lead)
    await session.flush()

    pmt = PortaAPortaPayment(
        association_id=assoc_id,
        lead_id=lead.id,
        installment_number=1,
        total_installments=1,
        amount=lead.monthly_fee,
        due_date=date.today(),
    )
    session.add(pmt)
    await session.commit()

    return {"ok": True, "lead_id": str(lead.id), "message": "Cadastro realizado! Aguarde confirmação do pagamento."}
