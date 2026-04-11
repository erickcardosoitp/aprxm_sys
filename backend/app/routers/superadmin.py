"""
Router /superadmin — painel de TI interno.
Apenas superadmin (role=superadmin) pode acessar.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session

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
    rows = await session.execute(text("""
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
    """))
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
    rows = await session.execute(text("""
        SELECT u.id, u.full_name, u.email, u.role, u.is_active, u.last_login_at
          FROM users u
          JOIN associations a ON a.id = u.association_id
         WHERE a.slug = :slug
         ORDER BY u.full_name
    """), {"slug": slug})
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
    rows = await session.execute(text("""
        SELECT cs.id, cs.opened_at, cs.opening_balance,
               u.full_name AS opened_by_name, u.email AS opened_by_email,
               a.name AS association_name, a.slug
          FROM cash_sessions cs
          JOIN users u ON u.id = cs.opened_by
          JOIN associations a ON a.id = cs.association_id
         WHERE cs.status = 'open'
         ORDER BY cs.opened_at DESC
    """))
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
    row = (await session.execute(
        text("""
            SELECT default_cash_balance, max_cash_before_sangria,
                   default_mensalidade_amount, delinquency_grace_days, permitir_transferencia
            FROM association_settings WHERE association_id = :id
        """),
        {"id": org_id},
    )).fetchone()
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
    stats = await session.execute(text("""
        SELECT
          (SELECT COUNT(*) FROM associations WHERE is_active = true) AS active_orgs,
          (SELECT COUNT(*) FROM users WHERE is_active = true) AS active_users,
          (SELECT COUNT(*) FROM residents) AS total_residents,
          (SELECT COUNT(*) FROM packages WHERE status NOT IN ('delivered','returned')) AS pending_packages,
          (SELECT COUNT(*) FROM transactions WHERE created_at > NOW() - INTERVAL '24 hours') AS tx_last_24h,
          (SELECT COUNT(*) FROM cash_sessions WHERE status = 'open') AS open_sessions,
          (SELECT COUNT(*) FROM mensalidades WHERE status != 'paid') AS pending_mensalidades
    """))
    r = stats.fetchone()
    return {
        "active_orgs": r[0], "active_users": r[1], "total_residents": r[2],
        "pending_packages": r[3], "tx_last_24h": r[4],
        "open_sessions": r[5], "pending_mensalidades": r[6],
    }
