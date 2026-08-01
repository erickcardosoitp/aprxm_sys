"""
Router /presidencia — painel executivo read-only, substitui o Excel
Consolidado APRXM.xlsm. Alimentado pelo Neon Analytics (dim_/fact_).
Ver docs/superpowers/specs/2026-08-01-painel-presidencia-design.md.

Acesso: mesma credencial/JWT do app operacional, gate por role
(require_presidencia_access — admin/conselho/admin_master/superadmin).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, require_presidencia_access
from app.database import get_session
from app.services.presidencia_service import PresidenciaService, get_analytics_session

router = APIRouter(prefix="/presidencia", tags=["Presidência"])


def _get_service(
    session: AsyncSession = Depends(get_session),
    analytics: AsyncSession = Depends(get_analytics_session),
) -> PresidenciaService:
    return PresidenciaService(session, analytics)


@router.get("/status", summary="Fundacao: frescor do dado + conectividade com o Analytics")
async def get_status(
    current: CurrentUser = Depends(require_presidencia_access),
    svc: PresidenciaService = Depends(_get_service),
) -> dict:
    freshness = await svc.freshness()
    reachable = await svc.analytics_reachable()
    return {**freshness, "analytics_reachable": reachable}
