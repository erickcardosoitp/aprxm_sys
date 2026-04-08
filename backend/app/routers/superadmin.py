"""
Router /superadmin — painel de TI interno.
Apenas superadmin (role=superadmin) pode acessar.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session

router = APIRouter(prefix="/superadmin", tags=["SuperAdmin TI"])


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
