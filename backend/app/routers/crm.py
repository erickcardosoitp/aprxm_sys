from datetime import datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session

router = APIRouter(prefix="/crm", tags=["CRM"])

_ALLOWED_ROLES = {"superadmin", "admin_master", "admin", "diretoria", "conselho", "agente"}


def _check_access(current: CurrentUser) -> None:
    if current.role not in _ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="Acesso negado.")


# ─── DTOs ───────────────────────────────────────────────────────────────────

class RemotePayRequest(BaseModel):
    mensalidade_id: UUID
    payment_method_id: UUID | None = None
    payment_proof_url: str | None = None


class BatchPayRequest(BaseModel):
    payments: list[RemotePayRequest]


class VisitRequest(BaseModel):
    resident_id: UUID
    result: str  # paid | will_pay | absent | refused
    notes: str | None = None


# ─── GET /crm/residents ──────────────────────────────────────────────────────

@router.get("/residents", summary="Tabela CRM — membros com indicadores")
async def crm_residents(
    status_filter: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _check_access(current)

    aid = str(current.association_id)
    offset = (page - 1) * 100

    grace_row = (await session.execute(
        text("SELECT COALESCE(delinquency_grace_days, 2) FROM association_settings WHERE association_id = :aid"),
        {"aid": aid},
    )).fetchone()
    grace_days = grace_row[0] if grace_row else 2

    filters = ["r.association_id = :aid", "r.type = 'member'", "r.status = 'active'"]
    params: dict = {"aid": aid, "grace_days": grace_days, "limit": 100, "offset": offset}

    if search:
        filters.append("(r.full_name ILIKE :search OR r.address_street ILIKE :search)")
        params["search"] = f"%{search}%"

    if status_filter == "adimplente":
        filters.append("""
            NOT EXISTS (
                SELECT 1 FROM mensalidades m2
                WHERE m2.resident_id = r.id AND m2.association_id = r.association_id
                  AND m2.status = 'pending'
                  AND m2.due_date < NOW() - make_interval(days => :grace_days)
            )
        """)
    elif status_filter == "inadimplente":
        filters.append("""
            EXISTS (
                SELECT 1 FROM mensalidades m2
                WHERE m2.resident_id = r.id AND m2.association_id = r.association_id
                  AND m2.status = 'pending'
                  AND m2.due_date < NOW() - make_interval(days => :grace_days)
            )
        """)

    where_clause = " AND ".join(filters)

    sql = text(f"""
        WITH mens AS (
            SELECT
                resident_id,
                COALESCE(SUM(amount) FILTER (
                    WHERE status = 'pending'
                      AND due_date < NOW() - make_interval(days => :grace_days)
                ), 0) AS valor_atrasado,
                COUNT(*) FILTER (WHERE status = 'pending') AS qtd_pendentes
            FROM mensalidades
            WHERE association_id = :aid
            GROUP BY resident_id
        ),
        pkgs AS (
            SELECT
                resident_id,
                MAX(delivered_at)   AS ultima_entrega,
                COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) AS total_entregues,
                MIN(delivered_at)   AS primeira_entrega
            FROM packages
            WHERE association_id = :aid
            GROUP BY resident_id
        )
        SELECT
            r.id,
            r.full_name,
            r.address_street,
            r.address_number,
            r.created_at,
            COALESCE(m.valor_atrasado, 0)  AS valor_atrasado,
            COALESCE(m.qtd_pendentes, 0)   AS qtd_pendentes,
            p.ultima_entrega,
            CASE
                WHEN p.primeira_entrega IS NOT NULL
                THEN ROUND(
                    p.total_entregues::numeric /
                    GREATEST(1,
                        EXTRACT(MONTH FROM AGE(NOW(), p.primeira_entrega)) + 1
                    ), 1)
                ELSE 0
            END AS enc_mes,
            CASE
                WHEN COALESCE(m.valor_atrasado, 0) > 0 THEN 'inadimplente'
                ELSE 'adimplente'
            END AS situacao
        FROM residents r
        LEFT JOIN mens m ON m.resident_id = r.id
        LEFT JOIN pkgs p ON p.resident_id = r.id
        WHERE {where_clause}
        ORDER BY m.valor_atrasado DESC NULLS LAST, r.full_name
        LIMIT :limit OFFSET :offset
    """)

    rows = (await session.execute(sql, params)).fetchall()

    total_sql = text(f"""
        SELECT COUNT(*) FROM residents r
        WHERE {where_clause}
    """)
    total = (await session.execute(total_sql, params)).scalar()

    return {
        "items": [
            {
                "id": str(r.id),
                "full_name": r.full_name,
                "address": f"{r.address_street or ''}, {r.address_number or ''}".strip(", "),
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "valor_atrasado": float(r.valor_atrasado),
                "qtd_pendentes": r.qtd_pendentes,
                "ultima_entrega": r.ultima_entrega.isoformat() if r.ultima_entrega else None,
                "enc_mes": float(r.enc_mes),
                "situacao": r.situacao,
            }
            for r in rows
        ],
        "total": total,
        "page": page,
    }


# ─── POST /crm/mensalidades/{id}/pay ────────────────────────────────────────

@router.post("/mensalidades/{mensalidade_id}/pay", summary="Baixa remota de mensalidade")
async def remote_pay(
    mensalidade_id: UUID,
    body: RemotePayRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _check_access(current)
    if current.role == "agente":
        raise HTTPException(status_code=403, detail="Agente não pode registrar pagamentos.")
    return await _do_remote_pay(
        session=session,
        association_id=current.association_id,
        mensalidade_id=mensalidade_id,
        payment_method_id=body.payment_method_id,
        payment_proof_url=body.payment_proof_url,
        paid_by=current.user_id,
    )


async def _do_remote_pay(
    session: AsyncSession,
    association_id: UUID,
    mensalidade_id: UUID,
    payment_method_id: UUID | None,
    payment_proof_url: str | None,
    paid_by: UUID,
) -> dict:
    from app.models.mensalidade import MensalidadeStatus
    from app.services.finance_service import FinanceService
    from app.models.finance import TransactionType, IncomeSubtype

    row = (await session.execute(
        text("""
            SELECT m.id, m.status, m.amount, m.reference_month, m.resident_id,
                   r.full_name, pm.name AS pm_name
            FROM mensalidades m
            JOIN residents r ON r.id = m.resident_id
            LEFT JOIN payment_methods pm ON pm.id = :pmid
            WHERE m.id = :mid AND m.association_id = :aid
        """),
        {"mid": str(mensalidade_id), "aid": str(association_id), "pmid": str(payment_method_id) if payment_method_id else None},
    )).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Mensalidade não encontrada.")
    if row.status == MensalidadeStatus.paid:
        raise HTTPException(status_code=422, detail="Mensalidade já está paga.")

    # Validate PIX requires proof
    is_pix = row.pm_name and "pix" in row.pm_name.lower() if row.pm_name else False
    if is_pix and not payment_proof_url:
        raise HTTPException(status_code=422, detail="Comprovante PIX obrigatório.")

    finance_svc = FinanceService(session)
    tx = await finance_svc.register_transaction(
        association_id=association_id,
        cash_session_id=None,
        tx_type=TransactionType.income,
        amount=row.amount,
        description=f"Mensalidade {row.reference_month} — {row.full_name} [remoto]",
        created_by=paid_by,
        income_subtype=IncomeSubtype.mensalidade,
        payment_method_id=payment_method_id,
        resident_id=row.resident_id,
    )

    await session.execute(
        text("""
            UPDATE mensalidades
            SET status = 'paid',
                paid_at = NOW(),
                transaction_id = :txid,
                payment_channel = 'remote',
                payment_proof_url = :proof_url,
                updated_at = NOW()
            WHERE id = :mid AND association_id = :aid
        """),
        {
            "txid": str(tx.id),
            "proof_url": payment_proof_url,
            "mid": str(mensalidade_id),
            "aid": str(association_id),
        },
    )
    await session.commit()

    return {"mensalidade_id": str(mensalidade_id), "transaction_id": str(tx.id), "status": "paid"}


# ─── POST /crm/mensalidades/pay-batch ───────────────────────────────────────

@router.post("/mensalidades/pay-batch", summary="Baixa remota em lote")
async def remote_pay_batch(
    body: BatchPayRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _check_access(current)
    if current.role == "agente":
        raise HTTPException(status_code=403, detail="Agente não pode registrar pagamentos.")

    results = []
    errors = []
    for p in body.payments:
        try:
            r = await _do_remote_pay(
                session=session,
                association_id=current.association_id,
                mensalidade_id=p.mensalidade_id,
                payment_method_id=p.payment_method_id,
                payment_proof_url=p.payment_proof_url,
                paid_by=current.user_id,
            )
            results.append(r)
        except HTTPException as e:
            errors.append({"mensalidade_id": str(p.mensalidade_id), "error": e.detail})

    return {"paid": results, "errors": errors}


# ─── GET /crm/agentes/ranking ────────────────────────────────────────────────

@router.get("/agentes/ranking", summary="Ranking mensal de agentes")
async def agentes_ranking(
    year: int = Query(default=None),
    month: int = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _check_access(current)

    now = datetime.utcnow()
    target_year = year or now.year
    target_month = month or now.month
    ref_month = f"{target_year:04d}-{target_month:02d}"

    aid = str(current.association_id)

    # Cobranças registradas por cada agente no mês (baixa remota)
    cobrancas_rows = (await session.execute(
        text("""
            SELECT t.created_by AS agent_id,
                   u.full_name  AS agent_name,
                   COUNT(*)     AS cobrancas
            FROM transactions t
            JOIN users u ON u.id = t.created_by
            JOIN mensalidades m ON m.transaction_id = t.id
            WHERE t.association_id = :aid
              AND t.income_subtype = 'mensalidade'
              AND m.payment_channel = 'remote'
              AND DATE_TRUNC('month', t.created_at) = DATE_TRUNC('month', :ref::date)
            GROUP BY t.created_by, u.full_name
        """),
        {"aid": aid, "ref": f"{ref_month}-01"},
    )).fetchall()

    # Novos associados cadastrados por cada agente no mês
    novos_rows = (await session.execute(
        text("""
            SELECT r.created_by AS agent_id,
                   COUNT(*)     AS novos
            FROM residents r
            WHERE r.association_id = :aid
              AND r.type = 'member'
              AND DATE_TRUNC('month', r.created_at) = DATE_TRUNC('month', :ref::date)
            GROUP BY r.created_by
        """),
        {"aid": aid, "ref": f"{ref_month}-01"},
    )).fetchall()

    novos_map = {str(r.agent_id): r.novos for r in novos_rows}

    # Build ranking — score: 60% cobranças + 40% novos (normalized to max)
    agents = {}
    for row in cobrancas_rows:
        aid_str = str(row.agent_id)
        agents[aid_str] = {
            "agent_id": aid_str,
            "agent_name": row.agent_name,
            "cobrancas": row.cobrancas,
            "novos": novos_map.get(aid_str, 0),
        }
    for aid_str, novos in novos_map.items():
        if aid_str not in agents:
            agents[aid_str] = {"agent_id": aid_str, "agent_name": "?", "cobrancas": 0, "novos": novos}

    ranked = sorted(
        agents.values(),
        key=lambda a: a["cobrancas"] * 0.6 + a["novos"] * 0.4,
        reverse=True,
    )
    prizes = [150, 100, 75]
    for i, a in enumerate(ranked):
        a["position"] = i + 1
        a["prize"] = prizes[i] if i < len(prizes) else 0

    # Bônus de equipe
    all_novos = [a["novos"] for a in ranked]
    agentes_com_5 = sum(1 for n in all_novos if n >= 5)
    total_agentes = len(ranked)

    adimplencia_row = (await session.execute(
        text("""
            SELECT
                COUNT(*) FILTER (WHERE NOT EXISTS (
                    SELECT 1 FROM mensalidades m2
                    WHERE m2.resident_id = r.id
                      AND m2.association_id = r.association_id
                      AND m2.status = 'pending'
                      AND m2.due_date < NOW() - INTERVAL '2 days'
                )) AS adimplentes,
                COUNT(*) AS total
            FROM residents r
            WHERE r.association_id = :aid AND r.type = 'member' AND r.status = 'active'
        """),
        {"aid": str(current.association_id)},
    )).fetchone()

    adimplencia_pct = (adimplencia_row.adimplentes / adimplencia_row.total * 100) if adimplencia_row.total else 0
    bonus_novos_ok = total_agentes >= 5 and agentes_com_5 == total_agentes
    bonus_adimplencia_ok = adimplencia_pct >= 80
    bonus_liberado = bonus_novos_ok and bonus_adimplencia_ok

    if bonus_liberado:
        for a in ranked:
            a["prize"] = (a["prize"] or 0) + 30

    return {
        "ref_month": ref_month,
        "ranking": ranked,
        "bonus": {
            "liberado": bonus_liberado,
            "novos_ok": bonus_novos_ok,
            "adimplencia_pct": round(adimplencia_pct, 1),
            "adimplencia_ok": bonus_adimplencia_ok,
            "agentes_com_5_novos": agentes_com_5,
            "total_agentes": total_agentes,
        },
    }


# ─── POST /crm/visitas ───────────────────────────────────────────────────────

@router.post("/visitas", summary="Registrar visita porta a porta")
async def register_visit(
    body: VisitRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _check_access(current)

    valid_results = {"paid", "will_pay", "absent", "refused"}
    if body.result not in valid_results:
        raise HTTPException(status_code=422, detail=f"Resultado inválido. Use: {', '.join(valid_results)}")

    result = await session.execute(
        text("""
            INSERT INTO agent_visits (association_id, agent_id, resident_id, result, notes)
            VALUES (:aid, :agent_id, :resident_id, :result, :notes)
            RETURNING id, visited_at
        """),
        {
            "aid": str(current.association_id),
            "agent_id": str(current.user_id),
            "resident_id": str(body.resident_id),
            "result": body.result,
            "notes": body.notes,
        },
    )
    row = result.fetchone()
    await session.commit()

    return {
        "id": str(row.id),
        "visited_at": row.visited_at.isoformat(),
        "result": body.result,
    }


# ─── GET /crm/visitas ────────────────────────────────────────────────────────

@router.get("/visitas", summary="Listar visitas por morador ou agente")
async def list_visits(
    resident_id: UUID | None = Query(default=None),
    agent_id: UUID | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _check_access(current)

    filters = ["v.association_id = :aid"]
    params: dict = {"aid": str(current.association_id), "limit": 50, "offset": (page - 1) * 50}

    if current.role == "agente":
        filters.append("v.agent_id = :agent_id")
        params["agent_id"] = str(current.user_id)
    elif agent_id:
        filters.append("v.agent_id = :agent_id")
        params["agent_id"] = str(agent_id)

    if resident_id:
        filters.append("v.resident_id = :resident_id")
        params["resident_id"] = str(resident_id)

    where = " AND ".join(filters)

    rows = (await session.execute(
        text(f"""
            SELECT v.id, v.agent_id, u.full_name AS agent_name,
                   v.resident_id, r.full_name AS resident_name,
                   v.visited_at, v.result, v.notes
            FROM agent_visits v
            JOIN users u ON u.id = v.agent_id
            JOIN residents r ON r.id = v.resident_id
            WHERE {where}
            ORDER BY v.visited_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )).fetchall()

    return {
        "items": [
            {
                "id": str(r.id),
                "agent_id": str(r.agent_id),
                "agent_name": r.agent_name,
                "resident_id": str(r.resident_id),
                "resident_name": r.resident_name,
                "visited_at": r.visited_at.isoformat(),
                "result": r.result,
                "notes": r.notes,
            }
            for r in rows
        ],
        "page": page,
    }
