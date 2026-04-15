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
) -> dict:
    _require_superadmin(current)

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

    # ── Package SLA ─────────────────────────────────────────────────────────
    sla_row = (await _exec_ro(session, """
        SELECT
            COUNT(*) FILTER (WHERE status = 'delivered') AS total_delivered,
            ROUND(AVG(
                EXTRACT(EPOCH FROM (delivered_at - received_at)) / 3600
            ) FILTER (WHERE status = 'delivered' AND delivered_at IS NOT NULL AND received_at IS NOT NULL), 1)
                AS avg_hours_to_deliver,
            COUNT(*) FILTER (
                WHERE status = 'delivered'
                  AND delivered_at IS NOT NULL
                  AND received_at IS NOT NULL
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
    """)).fetchone()

    # ── Activity last 7 days (transactions per day) ─────────────────────────
    activity = (await _exec_ro(session, """
        SELECT DATE(created_at) AS day, COUNT(*) AS cnt
          FROM transactions
         WHERE created_at > NOW() - INTERVAL '7 days'
         GROUP BY 1 ORDER BY 1
    """)).fetchall()

    # ── Logins last 7 days ──────────────────────────────────────────────────
    logins = (await _exec_ro(session, """
        SELECT DATE(last_login_at) AS day, COUNT(*) AS cnt
          FROM users
         WHERE last_login_at > NOW() - INTERVAL '7 days'
         GROUP BY 1 ORDER BY 1
    """)).fetchall()

    # ── Errors / audit last 24h ─────────────────────────────────────────────
    audit_row = (await _exec_ro(session, """
        SELECT COUNT(*) AS total_actions,
               COUNT(*) FILTER (WHERE acao ILIKE '%estorno%' OR acao ILIKE '%cancel%') AS reversals
          FROM audit_log
         WHERE created_at > NOW() - INTERVAL '24 hours'
    """)).fetchone()

    # ── Top orgs by activity (last 30 days) ─────────────────────────────────
    top_orgs = (await _exec_ro(session, """
        SELECT a.name, COUNT(t.id) AS tx_count, COUNT(DISTINCT DATE(t.created_at)) AS active_days
          FROM transactions t
          JOIN associations a ON a.id = t.association_id
         WHERE t.created_at > NOW() - INTERVAL '30 days'
         GROUP BY a.name ORDER BY tx_count DESC LIMIT 5
    """)).fetchall()

    # ── Uptime proxy: sessions opened per day last 7 days ───────────────────
    sessions_daily = (await _exec_ro(session, """
        SELECT DATE(opened_at) AS day, COUNT(*) AS cnt
          FROM cash_sessions
         WHERE opened_at > NOW() - INTERVAL '7 days'
         GROUP BY 1 ORDER BY 1
    """)).fetchall()

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
            "total_delivered": int(sla_row[0]),
            "avg_hours_to_deliver": float(sla_row[1]) if sla_row[1] else None,
            "delivered_within_48h": int(sla_row[2]),
            "pct_within_48h": round(int(sla_row[2]) / int(sla_row[0]) * 100, 1) if sla_row[0] else 0,
            "overdue_packages": int(sla_row[3]),
            "pending_packages": int(sla_row[4]),
            "overdue_notified": int(sla_row[5]),
        },
        "activity": {
            "transactions_7d": [{"day": str(r[0]), "count": int(r[1])} for r in activity],
            "logins_7d": [{"day": str(r[0]), "count": int(r[1])} for r in logins],
            "sessions_7d": [{"day": str(r[0]), "count": int(r[1])} for r in sessions_daily],
        },
        "audit": {
            "total_actions_24h": int(audit_row[0]) if audit_row else 0,
            "reversals_24h": int(audit_row[1]) if audit_row else 0,
        },
        "top_orgs_30d": [
            {"name": r[0], "tx_count": int(r[1]), "active_days": int(r[2])}
            for r in top_orgs
        ],
    }
