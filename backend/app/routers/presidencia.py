"""
Router /presidencia — painel executivo read-only, substitui o Excel
Consolidado APRXM.xlsm. Alimentado pelo data warehouse dedicado (projeto
Neon "aprxm-analytics").
Ver docs/superpowers/specs/2026-08-01-painel-presidencia-design.md.

Acesso: mesma credencial/JWT do app operacional, gate por role
(require_presidencia_access — admin/conselho/admin_master/superadmin).
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, require_presidencia_access
from app.database import get_session
from app.services.presidencia_service import PresidenciaService, get_dw_session

router = APIRouter(prefix="/presidencia", tags=["Presidência"])


def _get_service(
    session: AsyncSession = Depends(get_session),
    dw: AsyncSession = Depends(get_dw_session),
) -> PresidenciaService:
    return PresidenciaService(session, dw)


@router.get("/status", summary="Fundacao: frescor do dado + conectividade com o data warehouse")
async def get_status(
    current: CurrentUser = Depends(require_presidencia_access),
    svc: PresidenciaService = Depends(_get_service),
) -> dict:
    freshness = await svc.freshness()
    reachable = await svc.dw_reachable()
    return {**freshness, "dw_reachable": reachable}


@router.get("/inicio", summary="Resumo 1-tela: saude da associacao hoje")
async def get_inicio(
    unidade: str | None = Query(default=None, description="Nome da associacao (Congonha/Vaz Lobo) ou omitido para Todos"),
    current: CurrentUser = Depends(require_presidencia_access),
    svc: PresidenciaService = Depends(_get_service),
) -> dict:
    freshness = await svc.freshness()
    data = await svc.get_inicio(unidade)
    return {**freshness, "data": data}


@router.get("/resumo", summary="9 KPIs com WoW/MoM/YoY/ToT")
async def get_resumo(
    current: CurrentUser = Depends(require_presidencia_access),
    svc: PresidenciaService = Depends(_get_service),
) -> dict:
    freshness = await svc.freshness()
    data = await svc.get_resumo()
    return {**freshness, "data": data}
