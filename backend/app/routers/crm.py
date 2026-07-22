from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user, financeiro_scope
from app.database import get_session
from app.services.scoring_service import run_scoring_all

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
    unidade: UUID | None = Query(default=None),
    rua: str | None = Query(default=None),
    dependentes: bool | None = Query(default=None),
    min_atrasado: float | None = Query(default=None),
    max_atrasado: float | None = Query(default=None),
    min_meses_atrasado: int | None = Query(default=None),
    tempo_associado_meses: int | None = Query(default=None, description="Mínimo de meses como associado"),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _check_access(current)

    ids = [str(i) for i in await financeiro_scope(current, session, unidade)]
    offset = (page - 1) * 100

    # grace_days por linha (join association_settings) - unidades diferentes podem ter carência diferente
    filters = ["r.association_id = ANY(:ids)", "r.type = 'member'", "r.status = 'active'"]
    params: dict = {"ids": ids, "limit": 100, "offset": offset}

    if search:
        filters.append("(unaccent(lower(r.full_name)) LIKE unaccent(lower(:search)) OR r.address_street ILIKE :search)")
        params["search"] = f"%{search}%"
    if rua:
        filters.append("r.address_street ILIKE :rua")
        params["rua"] = f"%{rua}%"
    if dependentes is not None:
        dep_sub = "EXISTS (SELECT 1 FROM residents dep WHERE dep.responsible_id = r.id AND dep.type = 'dependent')"
        filters.append(dep_sub if dependentes else f"NOT {dep_sub}")
    if tempo_associado_meses:
        filters.append("COALESCE(r.move_in_date, r.created_at::date) <= (CURRENT_DATE - (:tam || ' months')::interval)")
        params["tam"] = tempo_associado_meses

    if status_filter == "adimplente":
        filters.append("""
            NOT EXISTS (
                SELECT 1 FROM mensalidades m2
                JOIN association_settings s2 ON s2.association_id = m2.association_id
                WHERE m2.resident_id = r.id AND m2.association_id = r.association_id
                  AND m2.status = 'pending'
                  AND m2.due_date < NOW() - make_interval(days => COALESCE(s2.delinquency_grace_days, 2))
            )
        """)
    elif status_filter == "inadimplente":
        filters.append("""
            EXISTS (
                SELECT 1 FROM mensalidades m2
                JOIN association_settings s2 ON s2.association_id = m2.association_id
                WHERE m2.resident_id = r.id AND m2.association_id = r.association_id
                  AND m2.status = 'pending'
                  AND m2.due_date < NOW() - make_interval(days => COALESCE(s2.delinquency_grace_days, 2))
            )
        """)

    where_clause = " AND ".join(filters)

    sql = text(f"""
        WITH mens AS (
            SELECT
                m.resident_id,
                COALESCE(SUM(m.amount) FILTER (
                    WHERE m.status = 'pending'
                      AND m.due_date < NOW() - make_interval(days => COALESCE(s.delinquency_grace_days, 2))
                ), 0) AS valor_atrasado,
                COUNT(*) FILTER (
                    WHERE m.status = 'pending'
                      AND m.due_date < NOW() - make_interval(days => COALESCE(s.delinquency_grace_days, 2))
                ) AS qtd_pendentes
            FROM mensalidades m
            JOIN association_settings s ON s.association_id = m.association_id
            WHERE m.association_id = ANY(:ids)
            GROUP BY m.resident_id
        ),
        pkgs AS (
            SELECT
                resident_id,
                MAX(delivered_at)   AS ultima_entrega,
                COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) AS total_entregues,
                MIN(delivered_at)   AS primeira_entrega
            FROM packages
            WHERE association_id = ANY(:ids)
            GROUP BY resident_id
        ),
        acoes_eventos AS (
            SELECT COALESCE(men.resident_id, t.resident_id) AS resident_id, t.transaction_at AS event_at
            FROM transactions t
            LEFT JOIN mensalidades men ON men.transaction_id = t.id
            WHERE t.association_id = ANY(:ids) AND t.type = 'income' AND NOT t.is_reversal
              AND t.income_subtype IN ('mensalidade', 'proof_of_residence')
            UNION ALL
            SELECT resident_id, delivered_at AS event_at
            FROM packages
            WHERE association_id = ANY(:ids) AND delivered_at IS NOT NULL
        ),
        acoes AS (
            SELECT resident_id, COUNT(*) AS total_acoes, MIN(event_at) AS primeiro_evento
            FROM acoes_eventos WHERE resident_id IS NOT NULL GROUP BY resident_id
        ),
        pgto AS (
            SELECT DISTINCT ON (resident_id) resident_id, forma
            FROM (
                SELECT COALESCE(men.resident_id, t.resident_id) AS resident_id, pm.name AS forma, COUNT(*) AS qtd
                FROM transactions t
                LEFT JOIN mensalidades men ON men.transaction_id = t.id
                LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
                WHERE t.association_id = ANY(:ids) AND t.type = 'income' AND NOT t.is_reversal
                GROUP BY 1, 2
            ) x
            WHERE resident_id IS NOT NULL
            ORDER BY resident_id, qtd DESC
        )
        SELECT
            r.id,
            r.full_name,
            r.address_street,
            r.address_number,
            r.created_at,
            r.phone_primary,
            a.name AS unidade,
            COALESCE(r.move_in_date, r.created_at::date) AS associado_desde,
            COALESCE(m.valor_atrasado, 0)  AS valor_atrasado,
            COALESCE(m.qtd_pendentes, 0)   AS qtd_pendentes,
            p.ultima_entrega,
            CASE
                WHEN p.primeira_entrega IS NOT NULL
                THEN ROUND(p.total_entregues::numeric / GREATEST(1, EXTRACT(MONTH FROM AGE(NOW(), p.primeira_entrega)) + 1), 1)
                ELSE 0
            END AS enc_mes,
            CASE
                WHEN ac.primeiro_evento IS NOT NULL
                THEN ROUND(ac.total_acoes::numeric / GREATEST(1, EXTRACT(MONTH FROM AGE(NOW(), ac.primeiro_evento)) + 1), 1)
                ELSE 0
            END AS acoes_mes,
            pg.forma AS forma_pagamento_recorrente,
            CASE
                WHEN COALESCE(m.valor_atrasado, 0) > 0 THEN 'inadimplente'
                ELSE 'adimplente'
            END AS situacao
        FROM residents r
        JOIN associations a ON a.id = r.association_id
        LEFT JOIN mens m ON m.resident_id = r.id
        LEFT JOIN pkgs p ON p.resident_id = r.id
        LEFT JOIN acoes ac ON ac.resident_id = r.id
        LEFT JOIN pgto pg ON pg.resident_id = r.id
        WHERE {where_clause}
          {"AND COALESCE(m.valor_atrasado, 0) >= :min_atrasado" if min_atrasado is not None else ""}
          {"AND COALESCE(m.valor_atrasado, 0) <= :max_atrasado" if max_atrasado is not None else ""}
          {"AND COALESCE(m.qtd_pendentes, 0) >= :min_meses_atrasado" if min_meses_atrasado is not None else ""}
        ORDER BY m.valor_atrasado DESC NULLS LAST, r.full_name
        LIMIT :limit OFFSET :offset
    """)
    if min_atrasado is not None:
        params["min_atrasado"] = min_atrasado
    if max_atrasado is not None:
        params["max_atrasado"] = max_atrasado
    if min_meses_atrasado is not None:
        params["min_meses_atrasado"] = min_meses_atrasado

    rows = (await session.execute(sql, params)).fetchall()

    extra_conds = (
        ("AND COALESCE(m.valor_atrasado, 0) >= :min_atrasado" if min_atrasado is not None else "")
        + (" AND COALESCE(m.valor_atrasado, 0) <= :max_atrasado" if max_atrasado is not None else "")
        + (" AND COALESCE(m.qtd_pendentes, 0) >= :min_meses_atrasado" if min_meses_atrasado is not None else "")
    )
    total = (await session.execute(text(f"""
        WITH mens AS (
            SELECT m.resident_id,
                COALESCE(SUM(m.amount) FILTER (
                    WHERE m.status = 'pending'
                      AND m.due_date < NOW() - make_interval(days => COALESCE(s.delinquency_grace_days, 2))
                ), 0) AS valor_atrasado,
                COUNT(*) FILTER (
                    WHERE m.status = 'pending'
                      AND m.due_date < NOW() - make_interval(days => COALESCE(s.delinquency_grace_days, 2))
                ) AS qtd_pendentes
            FROM mensalidades m
            JOIN association_settings s ON s.association_id = m.association_id
            WHERE m.association_id = ANY(:ids)
            GROUP BY m.resident_id
        )
        SELECT COUNT(*) FROM residents r
        JOIN associations a ON a.id = r.association_id
        LEFT JOIN mens m ON m.resident_id = r.id
        WHERE {where_clause} {extra_conds}
    """), params)).scalar()

    return {
        "items": [
            {
                "id": str(r.id),
                "full_name": r.full_name,
                "address": f"{r.address_street or ''}, {r.address_number or ''}".strip(", "),
                "unidade": r.unidade,
                "associado_desde": r.associado_desde.isoformat() if r.associado_desde else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "phone_primary": r.phone_primary,
                "valor_atrasado": float(r.valor_atrasado),
                "qtd_pendentes": r.qtd_pendentes,
                "ultima_entrega": r.ultima_entrega.isoformat() if r.ultima_entrega else None,
                "enc_mes": float(r.enc_mes),
                "acoes_mes": float(r.acoes_mes),
                "forma_pagamento_recorrente": r.forma_pagamento_recorrente,
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


# ─── POST /crm/cron-scoring ──────────────────────────────────────────────────

@router.post("/cron-scoring", include_in_schema=False)
async def cron_scoring(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    auth = request.headers.get("authorization", "")
    from app.config import get_settings
    settings = get_settings()
    if auth != f"Bearer {settings.cron_secret}":
        raise HTTPException(status_code=401)
    result = await run_scoring_all(session)
    return result


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

    # Todas as associações visíveis para este usuário (VL + Congonha para admin)
    all_aids = [str(i) for i in (current.scoped_ids() or [current.association_id])]
    aids_tuple = tuple(all_aids)

    params_month = {"yr": target_year, "mo": target_month}

    # Cobranças registradas por cada operador/agente no mês — todas as associações
    cobrancas_rows = (await session.execute(
        text(f"""
            SELECT t.created_by AS agent_id,
                   u.full_name  AS agent_name,
                   COUNT(*)     AS cobrancas,
                   array_agg(DISTINCT r.full_name ORDER BY r.full_name) AS residents
            FROM transactions t
            JOIN users u ON u.id = t.created_by
            JOIN mensalidades m ON m.transaction_id = t.id
            JOIN residents r ON r.id = m.resident_id
            WHERE t.association_id IN ({','.join(f"'{a}'" for a in aids_tuple)})
              AND t.income_subtype = 'mensalidade'
              AND EXTRACT(YEAR  FROM t.created_at) = :yr
              AND EXTRACT(MONTH FROM t.created_at) = :mo
            GROUP BY t.created_by, u.full_name
        """),
        params_month,
    )).fetchall()

    # Novos associados cadastrados por cada agente no mês — todas as associações
    novos_rows = (await session.execute(
        text(f"""
            SELECT r.created_by AS agent_id,
                   COUNT(*)     AS novos,
                   array_agg(r.full_name ORDER BY r.full_name) AS novos_residents
            FROM residents r
            WHERE r.association_id IN ({','.join(f"'{a}'" for a in aids_tuple)})
              AND r.type = 'member'
              AND EXTRACT(YEAR  FROM r.created_at) = :yr
              AND EXTRACT(MONTH FROM r.created_at) = :mo
            GROUP BY r.created_by
        """),
        params_month,
    )).fetchall()

    novos_map = {str(r.agent_id): {"novos": r.novos, "novos_residents": list(r.novos_residents or [])} for r in novos_rows}

    # Build ranking
    agents = {}
    for row in cobrancas_rows:
        aid_str = str(row.agent_id)
        nd = novos_map.get(aid_str, {"novos": 0, "novos_residents": []})
        agents[aid_str] = {
            "agent_id": aid_str,
            "agent_name": row.agent_name,
            "cobrancas": row.cobrancas,
            "residents": list(row.residents or []),
            "novos": nd["novos"],
            "novos_residents": nd["novos_residents"],
        }
    for aid_str, nd in novos_map.items():
        if aid_str not in agents:
            agents[aid_str] = {"agent_id": aid_str, "agent_name": "?", "cobrancas": 0, "residents": [], "novos": nd["novos"], "novos_residents": nd["novos_residents"]}

    ranked = sorted(
        agents.values(),
        key=lambda a: a["cobrancas"] * 0.6 + a["novos"] * 0.4,
        reverse=True,
    )
    prizes = [150, 100, 75]
    for i, a in enumerate(ranked):
        a["position"] = i + 1
        a["prize"] = prizes[i] if i < len(prizes) else 0

    # Totais de membros por associação + adimplência global
    per_assoc_rows = (await session.execute(
        text(f"""
            SELECT r.association_id::text AS assoc_id,
                   a.name AS assoc_name,
                   COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE NOT EXISTS (
                       SELECT 1 FROM mensalidades m2
                       WHERE m2.resident_id = r.id
                         AND m2.association_id = r.association_id
                         AND m2.status = 'pending'
                         AND m2.due_date < NOW() - INTERVAL '2 days'
                   )) AS adimplentes
            FROM residents r
            JOIN associations a ON a.id = r.association_id
            WHERE r.association_id IN ({','.join(f"'{a}'" for a in aids_tuple)})
              AND r.type = 'member' AND r.status = 'active'
            GROUP BY r.association_id, a.name
        """),
        {},
    )).fetchall()

    totals_by_assoc = {row.assoc_id: {"name": row.assoc_name, "total": row.total, "adimplentes": row.adimplentes} for row in per_assoc_rows}
    grand_total = sum(v["total"] for v in totals_by_assoc.values())
    grand_adimplentes = sum(v["adimplentes"] for v in totals_by_assoc.values())
    adimplencia_pct = (grand_adimplentes / grand_total * 100) if grand_total else 0

    # Bônus de equipe
    all_novos = [a["novos"] for a in ranked]
    agentes_com_5 = sum(1 for n in all_novos if n >= 5)
    total_agentes = 6
    bonus_novos_ok = agentes_com_5 == total_agentes
    bonus_adimplencia_ok = adimplencia_pct >= 80
    bonus_liberado = bonus_novos_ok and bonus_adimplencia_ok

    if bonus_liberado:
        for a in ranked:
            a["prize"] = (a["prize"] or 0) + 30

    return {
        "ref_month": ref_month,
        "totals_by_assoc": {v["name"]: v["total"] for v in totals_by_assoc.values()},
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


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC AGENT PAYMENT LINK
# ═══════════════════════════════════════════════════════════════════════════════

class AgentLinkRequest(BaseModel):
    resident_id: UUID


@router.post("/agent-link", summary="Gerar link de pagamento para morador")
async def generate_agent_link(
    body: AgentLinkRequest,
    request: Request,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _check_access(current)
    from app.config import get_settings
    settings = get_settings()
    from jose import jwt as jose_jwt

    resident = (await session.execute(
        text("SELECT id, full_name FROM residents WHERE id = :rid AND association_id = :aid"),
        {"rid": str(body.resident_id), "aid": str(current.association_id)},
    )).fetchone()
    if not resident:
        raise HTTPException(404, "Morador não encontrado.")

    payload = {
        "association_id": str(current.association_id),
        "agent_id": str(current.user_id),
        "resident_id": str(body.resident_id),
        "exp": datetime.utcnow() + timedelta(hours=48),
    }
    token = jose_jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)
    base = str(request.base_url).rstrip("/").replace("api/v1", "").rstrip("/")
    return {"token": token, "url": f"{base}/associar?token={token}", "resident_name": resident.full_name}


def _decode_agent_token(token: str) -> dict:
    from app.config import get_settings
    settings = get_settings()
    from jose import jwt as jose_jwt, JWTError
    try:
        return jose_jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        raise HTTPException(401, "Token inválido ou expirado.")


@router.get("/public/member", summary="Dados do morador para link público")
async def public_member_data(
    token: str = Query(...),
    session: AsyncSession = Depends(get_session),
) -> dict:
    payload = _decode_agent_token(token)
    aid = payload["association_id"]
    rid = payload["resident_id"]

    resident = (await session.execute(text("""
        SELECT r.id, r.full_name, r.phone_primary, r.address_street, r.address_number,
               r.unit, r.status, r.created_at
        FROM residents r
        WHERE r.id = :rid AND r.association_id = :aid
    """), {"rid": rid, "aid": aid})).fetchone()
    if not resident:
        raise HTTPException(404, "Morador não encontrado.")

    mensalidades = (await session.execute(text("""
        SELECT id, reference_month, due_date, amount, status, paid_at
        FROM mensalidades
        WHERE resident_id = :rid AND association_id = :aid
          AND status != 'paid'
        ORDER BY reference_month DESC
        LIMIT 24
    """), {"rid": rid, "aid": aid})).fetchall()

    payment_methods = (await session.execute(text("""
        SELECT id, name FROM payment_methods
        WHERE association_id = :aid AND is_active = TRUE
        ORDER BY name
    """), {"aid": aid})).fetchall()

    return {
        "resident": {
            "id": str(resident.id),
            "full_name": resident.full_name,
            "phone": resident.phone_primary,
            "address": f"{resident.address_street or ''}, {resident.address_number or ''}".strip(", "),
            "unit": resident.unit,
            "status": resident.status,
        },
        "mensalidades": [
            {
                "id": str(m.id),
                "reference_month": m.reference_month,
                "due_date": str(m.due_date) if m.due_date else None,
                "amount": str(m.amount),
                "status": m.status,
            }
            for m in mensalidades
        ],
        "payment_methods": [{"id": str(pm.id), "name": pm.name} for pm in payment_methods],
    }


class PublicPayRequest(BaseModel):
    mensalidade_id: UUID
    payment_method_id: UUID
    payment_proof_url: str | None = None


@router.post("/public/pay", summary="Registrar pagamento via link público")
async def public_pay(
    body: PublicPayRequest,
    token: str = Query(...),
    session: AsyncSession = Depends(get_session),
) -> dict:
    payload = _decode_agent_token(token)
    aid = UUID(payload["association_id"])
    agent_id = UUID(payload["agent_id"])

    pm_name = (await session.execute(
        text("SELECT name FROM payment_methods WHERE id = :id"),
        {"id": str(body.payment_method_id)},
    )).scalar()
    is_pix = pm_name and "pix" in pm_name.lower()
    if is_pix and not body.payment_proof_url:
        raise HTTPException(422, "Comprovante obrigatório para pagamento PIX.")

    return await _do_remote_pay(
        session=session,
        association_id=aid,
        mensalidade_id=body.mensalidade_id,
        payment_method_id=body.payment_method_id,
        payment_proof_url=body.payment_proof_url,
        paid_by=agent_id,
    )


class PublicAcordoRequest(BaseModel):
    date_from: str
    date_to: str
    installments: int
    monthly_amount: str
    payment_method_id: UUID | None = None


@router.post("/public/acordo", summary="Registrar acordo via link público")
async def public_acordo(
    body: PublicAcordoRequest,
    token: str = Query(...),
    session: AsyncSession = Depends(get_session),
) -> dict:
    payload = _decode_agent_token(token)
    aid = payload["association_id"]
    rid = payload["resident_id"]
    agent_id = payload["agent_id"]

    # Get all overdue pending mensalidades in range
    rows = (await session.execute(text("""
        SELECT id FROM mensalidades
        WHERE resident_id = :rid AND association_id = :aid
          AND status = 'pending'
          AND reference_month BETWEEN :df AND :dt
        ORDER BY reference_month
    """), {"rid": rid, "aid": aid, "df": body.date_from, "dt": body.date_to})).fetchall()

    if not rows:
        raise HTTPException(404, "Nenhuma mensalidade encontrada no período.")

    await session.execute(text("""
        UPDATE mensalidades
        SET notes = CONCAT(COALESCE(notes, ''), ' | Acordo: ', :installments, 'x R$', :amount, ' registrado em ', NOW()::date),
            updated_at = NOW()
        WHERE resident_id = :rid AND association_id = :aid
          AND status = 'pending'
          AND reference_month BETWEEN :df AND :dt
    """), {
        "rid": rid, "aid": aid,
        "df": body.date_from, "dt": body.date_to,
        "installments": body.installments,
        "amount": body.monthly_amount,
    })

    # Register a CRM visit with result = acordo
    await session.execute(text("""
        INSERT INTO crm_visitas (association_id, agent_id, resident_id, visited_at, result, notes)
        VALUES (:aid, :agid, :rid, NOW(), 'acordo', :notes)
    """), {
        "aid": aid, "agid": agent_id, "rid": rid,
        "notes": f"Acordo: {body.installments}x R${body.monthly_amount} ({body.date_from} a {body.date_to})",
    })

    await session.commit()
    return {"ok": True, "mensalidades_updated": len(rows)}


# ═══════════════════════════════════════════════════════════════════════════════
# AGENT PORTAL
# ═══════════════════════════════════════════════════════════════════════════════

class PortalPayRequest(BaseModel):
    resident_id: UUID
    mensalidade_id: UUID
    payment_method_id: UUID
    payment_proof_url: str | None = None


class PortalRegisterRequest(BaseModel):
    full_name: str
    cpf: str
    phone_primary: str | None = None
    address_cep: str | None = None
    address_street: str | None = None
    address_number: str | None = None
    address_complement: str | None = None
    address_neighborhood: str | None = None


def _decode_portal_token(token: str) -> dict:
    from app.config import get_settings
    settings = get_settings()
    from jose import jwt as jose_jwt, JWTError
    try:
        payload = jose_jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        if payload.get("type") != "portal":
            raise HTTPException(401, "Token inválido.")
        return payload
    except JWTError:
        raise HTTPException(401, "Token inválido ou expirado.")


@router.get("/portal-token", summary="Gerar token de portal para agente")
async def get_portal_token(
    request: Request,
    current: CurrentUser = Depends(get_current_user),
) -> dict:
    _check_access(current)
    from app.config import get_settings
    settings = get_settings()
    from jose import jwt as jose_jwt

    payload = {
        "type": "portal",
        "association_id": str(current.association_id),
        "agent_id": str(current.user_id),
        "exp": datetime.utcnow() + timedelta(days=365),
    }
    token = jose_jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)
    base = str(request.base_url).rstrip("/").replace("api/v1", "").rstrip("/")
    return {"token": token, "url": f"{base}/agente?token={token}"}


@router.get("/public/portal/init", summary="Inicializar portal de agente")
async def portal_init(
    token: str = Query(...),
    session: AsyncSession = Depends(get_session),
) -> dict:
    payload = _decode_portal_token(token)
    aid = payload["association_id"]

    assoc = (await session.execute(
        text("SELECT name, logo_url FROM associations WHERE id = :aid"),
        {"aid": aid},
    )).fetchone()

    payment_methods = (await session.execute(
        text("SELECT id, name FROM payment_methods WHERE association_id = :aid AND is_active = TRUE ORDER BY name"),
        {"aid": aid},
    )).fetchall()

    return {
        "association": {
            "name": assoc.name if assoc else "",
            "logo_url": assoc.logo_url if assoc else None,
        },
        "payment_methods": [{"id": str(pm.id), "name": pm.name} for pm in payment_methods],
    }


@router.get("/public/portal/search", summary="Buscar associados no portal")
async def portal_search(
    token: str = Query(...),
    q: str = Query(...),
    session: AsyncSession = Depends(get_session),
) -> list:
    payload = _decode_portal_token(token)
    aid = payload["association_id"]

    q_clean = q.strip()
    rows = (await session.execute(text("""
        SELECT id, full_name, cpf, address_street, address_number, status, type
        FROM residents
        WHERE association_id = :aid
          AND status = 'active'
          AND type = 'member'
          AND (unaccent(lower(full_name)) LIKE unaccent(lower(:q)) OR regexp_replace(cpf, '[^0-9]', '', 'g') LIKE :q_digits)
        ORDER BY full_name
        LIMIT 8
    """), {
        "aid": aid,
        "q": f"%{q_clean}%",
        "q_digits": f"%{q_clean.replace('.', '').replace('-', '').replace(' ', '')}%",
    })).fetchall()

    def mask_cpf(cpf: str | None) -> str | None:
        if not cpf:
            return None
        digits = ''.join(c for c in cpf if c.isdigit())
        if len(digits) < 3:
            return cpf
        return digits[:3] + "****"

    return [
        {
            "id": str(r.id),
            "full_name": r.full_name,
            "cpf": mask_cpf(r.cpf),
            "address_street": r.address_street,
            "address_number": r.address_number,
            "status": r.status,
            "type": r.type,
        }
        for r in rows
    ]


@router.get("/public/portal/member", summary="Dados do morador para portal")
async def portal_member(
    token: str = Query(...),
    resident_id: str = Query(...),
    session: AsyncSession = Depends(get_session),
) -> dict:
    payload = _decode_portal_token(token)
    aid = payload["association_id"]

    resident = (await session.execute(text("""
        SELECT id, full_name, address_street, address_number
        FROM residents
        WHERE id = :rid AND association_id = :aid
    """), {"rid": resident_id, "aid": aid})).fetchone()

    if not resident:
        raise HTTPException(404, "Morador não encontrado.")

    mensalidades = (await session.execute(text("""
        SELECT id, reference_month, due_date, amount, status
        FROM mensalidades
        WHERE resident_id = :rid AND association_id = :aid
          AND status != 'paid'
        ORDER BY reference_month DESC
        LIMIT 24
    """), {"rid": resident_id, "aid": aid})).fetchall()

    return {
        "resident": {
            "id": str(resident.id),
            "full_name": resident.full_name,
            "address": f"{resident.address_street or ''}, {resident.address_number or ''}".strip(", "),
        },
        "mensalidades": [
            {
                "id": str(m.id),
                "reference_month": m.reference_month,
                "due_date": str(m.due_date) if m.due_date else None,
                "amount": str(m.amount),
                "status": m.status,
            }
            for m in mensalidades
        ],
    }


@router.post("/public/portal/pay", summary="Registrar pagamento via portal")
async def portal_pay(
    body: PortalPayRequest,
    token: str = Query(...),
    session: AsyncSession = Depends(get_session),
) -> dict:
    payload = _decode_portal_token(token)
    aid = UUID(payload["association_id"])
    agent_id = UUID(payload["agent_id"])

    # Verify resident belongs to this association
    resident_check = (await session.execute(
        text("SELECT id FROM residents WHERE id = :rid AND association_id = :aid"),
        {"rid": str(body.resident_id), "aid": str(aid)},
    )).fetchone()
    if not resident_check:
        raise HTTPException(404, "Morador não encontrado.")

    pm_name = (await session.execute(
        text("SELECT name FROM payment_methods WHERE id = :id"),
        {"id": str(body.payment_method_id)},
    )).scalar()
    is_pix = pm_name and "pix" in pm_name.lower()
    if is_pix and not body.payment_proof_url:
        raise HTTPException(422, "Comprovante obrigatório para pagamento PIX.")

    return await _do_remote_pay(
        session=session,
        association_id=aid,
        mensalidade_id=body.mensalidade_id,
        payment_method_id=body.payment_method_id,
        payment_proof_url=body.payment_proof_url,
        paid_by=agent_id,
    )


@router.post("/public/portal/register", summary="Cadastrar novo associado via portal")
async def portal_register(
    body: PortalRegisterRequest,
    token: str = Query(...),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from uuid import uuid4
    from datetime import date as date_type

    payload = _decode_portal_token(token)
    aid = payload["association_id"]

    # Strip non-digits from CPF
    cpf_clean = ''.join(c for c in body.cpf if c.isdigit()) if body.cpf else None

    resident_id = str(uuid4())
    await session.execute(text("""
        INSERT INTO residents (
            id, association_id, type, status, full_name, cpf, phone_primary,
            address_cep, address_street, address_number, address_complement, address_neighborhood,
            is_member_confirmed, terms_accepted, lgpd_accepted, created_at, updated_at
        ) VALUES (
            :id, :aid, 'member', 'active', :full_name, :cpf, :phone,
            :cep, :street, :number, :complement, :neighborhood,
            FALSE, FALSE, TRUE, NOW(), NOW()
        )
    """), {
        "id": resident_id,
        "aid": aid,
        "full_name": body.full_name,
        "cpf": cpf_clean,
        "phone": body.phone_primary,
        "cep": body.address_cep,
        "street": body.address_street,
        "number": body.address_number,
        "complement": body.address_complement,
        "neighborhood": body.address_neighborhood,
    })

    # Get default mensalidade amount and due day from settings
    settings_row = (await session.execute(
        text("SELECT COALESCE(default_mensalidade_amount, 0), COALESCE(default_due_day, 10) FROM association_settings WHERE association_id = :aid"),
        {"aid": aid},
    )).fetchone()
    default_amount = settings_row[0] if settings_row else 0
    default_due_day = settings_row[1] if settings_row else 10

    today = date_type.today()
    reference_month = today.strftime("%Y-%m")
    import calendar
    last_day = calendar.monthrange(today.year, today.month)[1]
    due_day = min(int(default_due_day), last_day)
    due_date = date_type(today.year, today.month, due_day)

    mensalidade_id = str(uuid4())
    # Use a dummy created_by — the agent_id from token
    agent_id = payload["agent_id"]
    await session.execute(text("""
        INSERT INTO mensalidades (
            id, association_id, resident_id, reference_month, due_date, amount, status,
            payment_channel, created_by, created_at, updated_at
        ) VALUES (
            :id, :aid, :rid, :ref_month, :due_date, :amount, 'pending',
            'remote', :created_by, NOW(), NOW()
        )
    """), {
        "id": mensalidade_id,
        "aid": aid,
        "rid": resident_id,
        "ref_month": reference_month,
        "due_date": str(due_date),
        "amount": str(default_amount),
        "created_by": agent_id,
    })

    payment_methods = (await session.execute(
        text("SELECT id, name FROM payment_methods WHERE association_id = :aid AND is_active = TRUE ORDER BY name"),
        {"aid": aid},
    )).fetchall()

    await session.commit()

    return {
        "resident_id": resident_id,
        "mensalidade_id": mensalidade_id,
        "mensalidade_amount": str(default_amount),
        "payment_methods": [{"id": str(pm.id), "name": pm.name} for pm in payment_methods],
    }
