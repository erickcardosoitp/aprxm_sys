"""
Router /superadmin — painel de TI interno.
Apenas superadmin (role=superadmin) pode acessar.
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session


async def _exec_ro(session: AsyncSession, query: str, params: dict | None = None):
    """Execute a read-only query with retry on transient deadlocks."""
    for attempt in range(3):
        try:
            await session.execute(text("SET TRANSACTION READ ONLY"))
            return await session.execute(text(query), params or {})
        except DBAPIError as e:
            await session.rollback()
            if "deadlock" in str(e).lower() and attempt < 2:
                await asyncio.sleep(0.15 * (attempt + 1))
                continue
            raise

router = APIRouter(prefix="/superadmin", tags=["SuperAdmin TI"])


class UpdateOrgRequest(BaseModel):
    name: str | None = None
    slug: str | None = None
    plan_name: str | None = None
    is_active: bool | None = None


class UpdateOrgSettingsRequest(BaseModel):
    default_cash_balance: float | None = None
    max_cash_before_sangria: float | None = None
    default_mensalidade_amount: float | None = None
    delinquency_grace_days: int | None = None
    permitir_transferencia: bool | None = None


def _require_superadmin(current: CurrentUser) -> CurrentUser:
    if current.role not in ("superadmin",):
        raise HTTPException(status_code=403, detail="Apenas superadmin.")
    return current


@router.get("/organizations", summary="Todas as organizações ativas")
async def list_organizations(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    _require_superadmin(current)
    rows = await _exec_ro(session, """
        SELECT a.id, a.name, a.slug, a.plan_name, a.is_active,
               a.plan_expires_at, a.created_at,
               COUNT(DISTINCT u.id) AS user_count,
               COUNT(DISTINCT r.id) AS resident_count,
               COUNT(DISTINCT p.id) FILTER (WHERE p.status != 'delivered') AS open_packages,
               MAX(u.last_login_at) AS last_login_at
          FROM associations a
          LEFT JOIN users u ON u.association_id = a.id AND u.is_active = true
          LEFT JOIN residents r ON r.association_id = a.id
          LEFT JOIN packages p ON p.association_id = a.id
         GROUP BY a.id
         ORDER BY a.name
    """)
    return [
        {
            "id": str(r[0]), "name": r[1], "slug": r[2],
            "plan_name": r[3], "is_active": r[4],
            "plan_expires_at": str(r[5]) if r[5] else None,
            "created_at": str(r[6]),
            "user_count": r[7],
            "resident_count": r[8],
            "open_packages": r[9],
            "last_login_at": str(r[10]) if r[10] else None,
        }
        for r in rows.fetchall()
    ]


@router.get("/organizations/{slug}/users", summary="Usuários de uma organização")
async def org_users(
    slug: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    _require_superadmin(current)
    rows = await _exec_ro(session, """
        SELECT u.id, u.full_name, u.email, u.role, u.is_active, u.last_login_at
          FROM users u
          JOIN associations a ON a.id = u.association_id
         WHERE a.slug = :slug
         ORDER BY u.full_name
    """, {"slug": slug})
    return [
        {
            "id": str(r[0]), "full_name": r[1], "email": r[2],
            "role": r[3], "is_active": r[4],
            "last_login_at": str(r[5]) if r[5] else None,
        }
        for r in rows.fetchall()
    ]


@router.get("/organizations/{slug}/overview", summary="KPIs de uma organização para superadmin")
async def org_overview(
    slug: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _require_superadmin(current)
    row = (await _exec_ro(session, """
        SELECT
            a.id,
            a.name,
            (SELECT COUNT(*) FROM residents r WHERE r.association_id = a.id AND r.status = 'active' AND r.type = 'member' AND r.responsible_id IS NULL) AS associados,
            (SELECT COUNT(*) FROM residents r WHERE r.association_id = a.id AND r.status = 'active' AND r.type = 'guest') AS visitantes,
            (SELECT COUNT(*) FROM packages p WHERE p.association_id = a.id AND p.status IN ('received','notified')) AS enc_pendentes,
            (SELECT COUNT(*) FROM service_orders so WHERE so.association_id = a.id AND so.status IN ('open','in_progress')) AS os_abertas,
            (SELECT COUNT(*) FROM mensalidades m WHERE m.association_id = a.id AND m.status = 'pending') AS mens_pendentes,
            (SELECT COALESCE(SUM(m.amount),0) FROM mensalidades m WHERE m.association_id = a.id AND m.status = 'pending') AS mens_valor,
            (SELECT COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END),0)
               FROM transactions t WHERE t.association_id = a.id
                 AND t.transaction_at >= date_trunc('month', NOW())) AS receita_mes,
            (SELECT COALESCE(SUM(CASE WHEN t.type IN ('expense','sangria') THEN t.amount ELSE 0 END),0)
               FROM transactions t WHERE t.association_id = a.id
                 AND t.transaction_at >= date_trunc('month', NOW())) AS despesa_mes,
            (SELECT cs.status = 'open' FROM cash_sessions cs WHERE cs.association_id = a.id ORDER BY cs.opened_at DESC LIMIT 1) AS caixa_aberto
          FROM associations a
         WHERE a.slug = :slug
    """, {"slug": slug})).fetchone()
    if not row:
        raise HTTPException(404, "Organização não encontrada.")
    return {
        "id": str(row[0]), "name": row[1],
        "associados": int(row[2]), "visitantes": int(row[3]),
        "enc_pendentes": int(row[4]), "os_abertas": int(row[5]),
        "mens_pendentes": int(row[6]),
        "mens_valor": round(float(row[7] or 0), 2),
        "receita_mes": round(float(row[8] or 0), 2),
        "despesa_mes": round(float(row[9] or 0), 2),
        "saldo_mes": round(float(row[8] or 0) - float(row[9] or 0), 2),
        "caixa_aberto": bool(row[10]) if row[10] is not None else False,
    }


@router.get("/active-sessions", summary="Caixas abertos em todas as orgs")
async def active_sessions(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    _require_superadmin(current)
    rows = await _exec_ro(session, """
        SELECT cs.id, cs.opened_at, cs.opening_balance,
               u.full_name AS opened_by_name, u.email AS opened_by_email,
               a.name AS association_name, a.slug
          FROM cash_sessions cs
          JOIN users u ON u.id = cs.opened_by
          JOIN associations a ON a.id = cs.association_id
         WHERE cs.status = 'open'
         ORDER BY cs.opened_at DESC
    """)
    return [
        {
            "id": str(r[0]),
            "opened_at": str(r[1]),
            "opening_balance": float(r[2]),
            "opened_by_name": r[3],
            "opened_by_email": r[4],
            "association_name": r[5],
            "slug": r[6],
        }
        for r in rows.fetchall()
    ]


@router.put("/organizations/{org_id}", summary="Editar organização")
async def update_org(
    org_id: str,
    body: UpdateOrgRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _require_superadmin(current)
    updates = {k: v for k, v in body.model_dump().items() if k in body.model_fields_set and v is not None}
    if not updates:
        raise HTTPException(400, "Nenhum campo para atualizar.")
    set_clauses = ", ".join(f"{k} = :{k}" for k in updates)
    updates["org_id"] = org_id
    await session.execute(
        text(f"UPDATE associations SET {set_clauses} WHERE id = :org_id"),
        updates,
    )
    await session.commit()
    return {"ok": True}


@router.delete("/organizations/{org_id}", summary="Desativar organização")
async def deactivate_org(
    org_id: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _require_superadmin(current)
    await session.execute(
        text("UPDATE associations SET is_active = FALSE WHERE id = :id"),
        {"id": org_id},
    )
    await session.commit()
    return {"ok": True}


@router.get("/organizations/{org_id}/settings", summary="Configurações de uma organização")
async def get_org_settings(
    org_id: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _require_superadmin(current)
    row = (await _exec_ro(session, """
            SELECT default_cash_balance, max_cash_before_sangria,
                   default_mensalidade_amount, delinquency_grace_days, permitir_transferencia
            FROM association_settings WHERE association_id = :id
        """, {"id": org_id})).fetchone()
    if not row:
        return {"default_cash_balance": 200, "max_cash_before_sangria": 500,
                "default_mensalidade_amount": 0, "delinquency_grace_days": 2,
                "permitir_transferencia": False}
    return {
        "default_cash_balance": float(row[0] or 200),
        "max_cash_before_sangria": float(row[1] or 500),
        "default_mensalidade_amount": float(row[2] or 0),
        "delinquency_grace_days": row[3] or 2,
        "permitir_transferencia": row[4] or False,
    }


@router.put("/organizations/{org_id}/settings", summary="Atualizar configurações de uma organização")
async def update_org_settings(
    org_id: str,
    body: UpdateOrgSettingsRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _require_superadmin(current)
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        return {"ok": True}
    set_clauses = ", ".join(f"{k} = :{k}" for k in data)
    data["org_id"] = org_id
    await session.execute(
        text(f"""
            INSERT INTO association_settings (association_id, {', '.join(k for k in data if k != 'org_id')})
            VALUES (:org_id, {', '.join(f':{k}' for k in data if k != 'org_id')})
            ON CONFLICT (association_id) DO UPDATE SET {set_clauses}, updated_at = NOW()
        """),
        data,
    )
    await session.commit()
    return {"ok": True}


@router.get("/health-summary", summary="Resumo de saúde do sistema")
async def health_summary(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _require_superadmin(current)
    stats = await _exec_ro(session, """
        SELECT
          (SELECT COUNT(*) FROM associations WHERE is_active = true) AS active_orgs,
          (SELECT COUNT(*) FROM users WHERE is_active = true) AS active_users,
          (SELECT COUNT(*) FROM residents) AS total_residents,
          (SELECT COUNT(*) FROM packages WHERE status NOT IN ('delivered','returned')) AS pending_packages,
          (SELECT COUNT(*) FROM transactions WHERE created_at > NOW() - INTERVAL '24 hours') AS tx_last_24h,
          (SELECT COUNT(*) FROM cash_sessions WHERE status = 'open') AS open_sessions,
          (SELECT COUNT(*) FROM mensalidades WHERE status != 'paid') AS pending_mensalidades
    """)
    r = stats.fetchone()
    return {
        "active_orgs": r[0], "active_users": r[1], "total_residents": r[2],
        "pending_packages": r[3], "tx_last_24h": r[4],
        "open_sessions": r[5], "pending_mensalidades": r[6],
    }


@router.get("/it-metrics", summary="Métricas técnicas de TI")
async def it_metrics(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    days: int = 7,
    association_ids: str | None = None,
) -> dict:
    _require_superadmin(current)
    days = max(1, min(days, 365))

    # ── Database size ───────────────────────────────────────────────────────
    db_size_row = (await _exec_ro(session,
        "SELECT pg_database_size(current_database()) AS db_bytes"
    )).fetchone()

    table_sizes = (await _exec_ro(session, """
        SELECT relname AS tbl,
               pg_total_relation_size(relid) AS bytes,
               n_live_tup AS rows
          FROM pg_stat_user_tables
         ORDER BY bytes DESC
         LIMIT 12
    """)).fetchall()

    # Parse and validate association IDs (UUID validation prevents SQL injection)
    from uuid import UUID as _UUID
    _ids: list[str] = []
    if association_ids:
        for s in association_ids.split(','):
            try: _ids.append(str(_UUID(s.strip())))
            except ValueError: pass
    if _ids:
        _csv = "', '".join(_ids)
        assoc_filter = f"AND association_id IN ('{_csv}')"
    else:
        assoc_filter = ""
    assoc_params: dict = {}

    # ── Package SLA ─────────────────────────────────────────────────────────
    sla_row = (await _exec_ro(session, f"""
        SELECT
            COUNT(*) FILTER (WHERE status = 'delivered') AS total_delivered,
            ROUND(AVG(EXTRACT(EPOCH FROM (delivered_at - received_at)) / 3600)
                FILTER (WHERE status = 'delivered' AND delivered_at IS NOT NULL AND received_at IS NOT NULL), 1)
                AS avg_hours_to_deliver,
            ROUND(AVG(EXTRACT(EPOCH FROM (delivered_at - received_at)))
                FILTER (WHERE status = 'delivered' AND delivered_at IS NOT NULL AND received_at IS NOT NULL), 0)
                AS avg_delivery_s,
            COUNT(*) FILTER (
                WHERE status = 'delivered'
                  AND delivered_at IS NOT NULL AND received_at IS NOT NULL
                  AND EXTRACT(EPOCH FROM (delivered_at - received_at)) / 3600 <= 48
            ) AS delivered_within_48h,
            COUNT(*) FILTER (
                WHERE status NOT IN ('delivered','returned')
                  AND received_at < NOW() - INTERVAL '48 hours'
            ) AS overdue_packages,
            COUNT(*) FILTER (WHERE status NOT IN ('delivered','returned')) AS pending_packages,
            COUNT(*) FILTER (WHERE status = 'notified'
                  AND updated_at < NOW() - INTERVAL '72 hours') AS overdue_notified
        FROM packages
        WHERE 1=1 {assoc_filter}
    """)).fetchone()

    # ── Activity (transactions per day) ────────────────────────────────────
    activity = (await _exec_ro(session, f"""
        SELECT DATE(created_at) AS day, COUNT(*) AS cnt
          FROM transactions
         WHERE created_at > NOW() - INTERVAL '{days} days'
         {assoc_filter}
         GROUP BY 1 ORDER BY 1
    """, assoc_params)).fetchall()

    # ── Logins ──────────────────────────────────────────────────────────────
    logins = (await _exec_ro(session, f"""
        SELECT DATE(last_login_at) AS day, COUNT(*) AS cnt
          FROM users
         WHERE last_login_at > NOW() - INTERVAL '{days} days'
         {assoc_filter}
         GROUP BY 1 ORDER BY 1
    """)).fetchall()

    # ── Errors / audit ──────────────────────────────────────────────────────
    audit_row = (await _exec_ro(session, f"""
        SELECT COUNT(*) AS total_actions,
               COUNT(*) FILTER (WHERE action ILIKE '%estorno%' OR action ILIKE '%cancel%' OR action ILIKE '%revers%') AS reversals
          FROM audit_log
         WHERE created_at > NOW() - INTERVAL '{days} days'
         {assoc_filter}
    """, assoc_params)).fetchone()

    # ── Top orgs by activity ─────────────────────────────────────────────────
    top_orgs = (await _exec_ro(session, f"""
        SELECT a.name, COUNT(t.id) AS tx_count, COUNT(DISTINCT DATE(t.created_at)) AS active_days
          FROM transactions t
          JOIN associations a ON a.id = t.association_id
         WHERE t.created_at > NOW() - INTERVAL '{days} days'
         {assoc_filter}
         GROUP BY a.name ORDER BY tx_count DESC LIMIT 5
    """, assoc_params)).fetchall()

    # ── Sessions per day ─────────────────────────────────────────────────────
    sessions_daily = (await _exec_ro(session, f"""
        SELECT DATE(opened_at) AS day, COUNT(*) AS cnt
          FROM cash_sessions
         WHERE opened_at > NOW() - INTERVAL '{days} days'
         {assoc_filter}
         GROUP BY 1 ORDER BY 1
    """, assoc_params)).fetchall()

    # ── Packages received per day ────────────────────────────────────────────
    pkg_daily = (await _exec_ro(session, f"""
        SELECT DATE(received_at) AS day, COUNT(*) AS cnt
          FROM packages
         WHERE received_at > NOW() - INTERVAL '{days} days'
         {assoc_filter}
         GROUP BY 1 ORDER BY 1
    """)).fetchall()

    # ── Revenue per day ──────────────────────────────────────────────────────
    revenue_daily = (await _exec_ro(session, f"""
        SELECT DATE(created_at) AS day, ROUND(SUM(amount)::numeric, 2) AS total
          FROM transactions
         WHERE created_at > NOW() - INTERVAL '{days} days'
           AND amount > 0 AND is_reversal = FALSE
         {assoc_filter}
         GROUP BY 1 ORDER BY 1
    """)).fetchall()

    # ── Delivery time trend per day ──────────────────────────────────────────
    delivery_trend = (await _exec_ro(session, f"""
        SELECT DATE(delivered_at) AS day,
               ROUND(AVG(EXTRACT(EPOCH FROM (delivered_at - received_at)))::numeric, 0) AS avg_s
          FROM packages
         WHERE delivered_at IS NOT NULL
           AND delivered_at > NOW() - INTERVAL '{days} days'
         {assoc_filter}
         GROUP BY 1 ORDER BY 1
    """)).fetchall()

    # ── Slow queries (pg_stat_statements — fails gracefully if unavailable) ──
    try:
        slow_q_rows = (await _exec_ro(session, """
            SELECT SUBSTR(query, 1, 80) AS q,
                   calls,
                   ROUND((total_exec_time / NULLIF(calls, 0))::numeric, 1) AS avg_ms
              FROM pg_stat_statements
             WHERE calls > 3
             ORDER BY avg_ms DESC NULLS LAST
             LIMIT 5
        """)).fetchall()
        slow_queries = [{"query": r[0], "calls": int(r[1]), "avg_ms": float(r[2])} for r in slow_q_rows]
    except Exception:
        slow_queries = []

    # ── Critical operations count ────────────────────────────────────────────
    critical_ops_row = (await _exec_ro(session, f"""
        SELECT
            COUNT(*) FILTER (WHERE cs.status NOT IN ('cancelled')) AS cash_open,
            COUNT(*) FILTER (WHERE cs.closed_at IS NOT NULL)       AS cash_close,
            COUNT(*) FILTER (WHERE cs.status = 'conferido')        AS cash_conference
        FROM cash_sessions cs
        WHERE cs.opened_at > NOW() - INTERVAL '{days} days'
        {assoc_filter.replace('association_id', 'cs.association_id')}
    """, assoc_params)).fetchone()

    residents_reg_row = (await _exec_ro(session, f"""
        SELECT COUNT(*) FROM residents r
        WHERE r.created_at > NOW() - INTERVAL '{days} days'
        {assoc_filter.replace('association_id', 'r.association_id')}
    """)).fetchone()

    pkg_ops_row = (await _exec_ro(session, f"""
        SELECT
            COUNT(*) FILTER (WHERE p.received_at > NOW() - INTERVAL '{days} days') AS pkg_received,
            COUNT(*) FILTER (WHERE p.delivered_at IS NOT NULL AND p.delivered_at > NOW() - INTERVAL '{days} days') AS pkg_delivered
        FROM packages p
        WHERE 1=1 {assoc_filter.replace('association_id', 'p.association_id')}
    """)).fetchone()

    os_row = (await _exec_ro(session, f"""
        SELECT COUNT(*) FROM service_orders s
        WHERE s.created_at > NOW() - INTERVAL '{days} days'
        {assoc_filter.replace('association_id', 's.association_id')}
    """)).fetchone()

    sangria_row = (await _exec_ro(session, f"""
        SELECT COUNT(*) FROM transactions t
        WHERE t.type = 'sangria'
          AND t.created_at > NOW() - INTERVAL '{days} days'
        {assoc_filter.replace('association_id', 't.association_id')}
    """, assoc_params)).fetchone()

    pix_row = (await _exec_ro(session, f"""
        SELECT COUNT(*) FROM bank_statements bs
        WHERE bs.created_at > NOW() - INTERVAL '{days} days'
        {assoc_filter.replace('association_id', 'bs.association_id')}
    """)).fetchone()

    # ── Operational timing ───────────────────────────────────────────────────
    bulk_timing_row = (await _exec_ro(session, """
        SELECT
            ROUND(AVG(EXTRACT(EPOCH FROM (max_t - min_t))), 1) AS avg_bulk_scan_seconds,
            ROUND(AVG(cnt)::numeric, 1) AS avg_items_per_batch,
            COUNT(*) AS total_batches
        FROM (
            SELECT receive_batch_id,
                   MAX(received_at) AS max_t,
                   MIN(received_at) AS min_t,
                   COUNT(*)        AS cnt
            FROM packages
            WHERE receive_batch_id IS NOT NULL
            GROUP BY receive_batch_id
        ) sub
    """)).fetchone()

    session_timing_row = (await _exec_ro(session, f"""
        SELECT
            ROUND(AVG(EXTRACT(EPOCH FROM (closed_at - opened_at))/3600)::numeric, 2) AS avg_session_h,
            ROUND(MAX(EXTRACT(EPOCH FROM (closed_at - opened_at))/3600)::numeric, 2) AS max_session_h,
            COUNT(*)::int AS total_closed
        FROM cash_sessions cs
        WHERE cs.closed_at IS NOT NULL
          AND cs.opened_at > NOW() - INTERVAL '{days} days'
        {assoc_filter.replace('association_id', 'cs.association_id')}
    """, assoc_params)).fetchone()

    # ── DB health detail ──────────────────────────────────────────────────────
    db_cache_row = (await _exec_ro(session, """
        SELECT ROUND(100.0 * SUM(blks_hit) / NULLIF(SUM(blks_hit) + SUM(blks_read), 0), 2)
        FROM pg_stat_database
    """)).fetchone()

    db_conn_row = (await _exec_ro(session, """
        SELECT COUNT(*) FILTER (WHERE state = 'active'),
               COUNT(*) FILTER (WHERE state = 'idle'),
               COUNT(*)
        FROM pg_stat_activity
        WHERE datname = current_database()
    """)).fetchone()

    # ── APDEXX Rating ─────────────────────────────────────────────────────────
    total_sessions_row = (await _exec_ro(session, f"""
        SELECT COUNT(*), COUNT(*) FILTER (WHERE closed_at IS NOT NULL)
        FROM cash_sessions cs
        WHERE cs.opened_at > NOW() - INTERVAL '{days} days'
        {assoc_filter.replace('association_id', 'cs.association_id')}
    """, assoc_params)).fetchone()

    total_tx_row = (await _exec_ro(session, f"""
        SELECT COUNT(*),
               COUNT(*) FILTER (WHERE is_reversal = TRUE)
        FROM transactions t
        WHERE t.created_at > NOW() - INTERVAL '{days} days'
        {assoc_filter.replace('association_id', 't.association_id')}
    """, assoc_params)).fetchone()

    sla_score = float(sla_row[3]) / float(sla_row[0]) if sla_row[0] else 1.0
    total_sess = float(total_sessions_row[0]) if total_sessions_row else 0
    closed_sess = float(total_sessions_row[1]) if total_sessions_row else 0
    session_hygiene = closed_sess / total_sess if total_sess > 0 else 1.0
    total_tx = float(total_tx_row[0]) if total_tx_row else 0
    reversal_tx = float(total_tx_row[1]) if total_tx_row else 0
    error_score = 1.0 - min(1.0, reversal_tx / total_tx) if total_tx > 0 else 1.0
    overdue = float(sla_row[4]) if sla_row else 0
    pending = float(sla_row[5]) if sla_row else 0
    overdue_score = 1.0 - min(1.0, overdue / pending) if pending > 0 else 1.0

    apdexx = round(sla_score * 0.30 + session_hygiene * 0.20 + error_score * 0.20 + overdue_score * 0.30, 3)

    return {
        "database": {
            "total_bytes": int(db_size_row[0]) if db_size_row else 0,
            "total_mb": round(int(db_size_row[0]) / 1024 / 1024, 1) if db_size_row else 0,
            "tables": [
                {"name": r[0], "bytes": int(r[1]), "mb": round(int(r[1]) / 1024 / 1024, 2), "rows": int(r[2])}
                for r in table_sizes
            ],
        },
        "package_sla": {
            "total_delivered": int(sla_row[0]) if sla_row else 0,
            "avg_hours_to_deliver": float(sla_row[1]) if sla_row and sla_row[1] else None,
            "avg_delivery_s": float(sla_row[2]) if sla_row and sla_row[2] else None,
            "delivered_within_48h": int(sla_row[3]) if sla_row else 0,
            "pct_within_48h": round(int(sla_row[3]) / int(sla_row[0]) * 100, 1) if sla_row and sla_row[0] else 0,
            "overdue_packages": int(sla_row[4]) if sla_row else 0,
            "pending_packages": int(sla_row[5]) if sla_row else 0,
            "overdue_notified": int(sla_row[6]) if sla_row else 0,
        },
        "activity": {
            "transactions_7d": [{"day": str(r[0]), "count": int(r[1])} for r in activity],
            "logins_7d": [{"day": str(r[0]), "count": int(r[1])} for r in logins],
            "sessions_7d": [{"day": str(r[0]), "count": int(r[1])} for r in sessions_daily],
            "packages_7d": [{"day": str(r[0]), "count": int(r[1])} for r in pkg_daily],
        },
        "audit": {
            "total_actions": int(audit_row[0]) if audit_row else 0,
            "reversals": int(audit_row[1]) if audit_row else 0,
            "period_days": days,
        },
        "top_orgs_30d": [
            {"name": r[0], "tx_count": int(r[1]), "active_days": int(r[2])}
            for r in top_orgs
        ],
        "critical_ops": {
            "cash_open": int(critical_ops_row[0]) if critical_ops_row else 0,
            "cash_close": int(critical_ops_row[1]) if critical_ops_row else 0,
            "cash_conference": int(critical_ops_row[2]) if critical_ops_row else 0,
            "resident_register": int(residents_reg_row[0]) if residents_reg_row else 0,
            "pkg_received": int(pkg_ops_row[0]) if pkg_ops_row else 0,
            "pkg_delivered": int(pkg_ops_row[1]) if pkg_ops_row else 0,
            "os_open": int(os_row[0]) if os_row else 0,
            "sangria": int(sangria_row[0]) if sangria_row else 0,
            "pix_conference": int(pix_row[0]) if pix_row else 0,
        },
        "operational_timing": {
            "bulk_receive_avg_scan_s": float(bulk_timing_row[0]) if bulk_timing_row and bulk_timing_row[0] else None,
            "bulk_receive_avg_items": float(bulk_timing_row[1]) if bulk_timing_row and bulk_timing_row[1] else None,
            "bulk_receive_total_batches": int(bulk_timing_row[2]) if bulk_timing_row else 0,
            "cash_session_avg_h": float(session_timing_row[0]) if session_timing_row and session_timing_row[0] else None,
            "cash_session_max_h": float(session_timing_row[1]) if session_timing_row and session_timing_row[1] else None,
            "cash_session_total_closed": int(session_timing_row[2]) if session_timing_row else 0,
        },
        "db_health": {
            "cache_hit_rate_pct": float(db_cache_row[0]) if db_cache_row and db_cache_row[0] else None,
            "connections_active": int(db_conn_row[0]) if db_conn_row else 0,
            "connections_idle": int(db_conn_row[1]) if db_conn_row else 0,
            "connections_total": int(db_conn_row[2]) if db_conn_row else 0,
        },
        "apdexx": apdexx,
        "apdexx_components": {
            "sla": round(sla_score, 3),
            "session_hygiene": round(session_hygiene, 3),
            "error_score": round(error_score, 3),
            "overdue_score": round(overdue_score, 3),
        },
        "trends": {
            "revenue": [{"day": str(r[0]), "value": float(r[1])} for r in revenue_daily],
            "delivery_seconds": [{"day": str(r[0]), "value": float(r[1])} for r in delivery_trend],
        },
        "slow_queries": slow_queries,
    }


@router.get("/all-residents", summary="Todos os moradores — visão superadmin")
async def all_residents(
    q: str | None = None,
    association_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    _require_superadmin(current)
    filters = ["1=1"]
    params: dict = {"lim": limit, "off": offset}
    if q:
        filters.append("(r.full_name ILIKE :q OR r.cpf ILIKE :q OR r.unit ILIKE :q)")
        params["q"] = f"%{q}%"
    if association_id:
        filters.append("r.association_id = :aid")
        params["aid"] = association_id
    where = " AND ".join(filters)
    result = await session.execute(text(f"""
        SELECT r.id, r.full_name, r.type, r.unit, r.block, r.cpf,
               r.status, r.phone_primary, r.created_at,
               a.name AS association_name
        FROM residents r
        JOIN associations a ON a.id = r.association_id
        WHERE {where}
        ORDER BY a.name, r.full_name
        LIMIT :lim OFFSET :off
    """), params)
    rows = result.mappings().all()
    return [dict(r) for r in rows]


@router.get("/all-residents/count", summary="Contagem total de moradores por org")
async def all_residents_count(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    _require_superadmin(current)
    result = await session.execute(text("""
        SELECT a.name AS association_name, a.id AS association_id,
               COUNT(r.id)::int AS total,
               COUNT(r.id) FILTER (WHERE r.type = 'member')::int AS members,
               COUNT(r.id) FILTER (WHERE r.type = 'guest')::int AS guests,
               COUNT(r.id) FILTER (WHERE r.status = 'active')::int AS active
        FROM associations a
        LEFT JOIN residents r ON r.association_id = a.id
        WHERE a.name NOT ILIKE '%geral%'
        GROUP BY a.id, a.name
        ORDER BY a.name
    """))
    return [dict(r) for r in result.mappings().all()]
