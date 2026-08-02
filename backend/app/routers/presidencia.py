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
    current: CurrentUser = Depends(require_presidencia_access),
) -> PresidenciaService:
    # Isolamento multi-empresa: o painel so' pode ver a empresa do usuario
    # logado, nunca as gold tables inteiras (compartilhadas entre empresas).
    return PresidenciaService(session, dw, current.empresa_id)


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
    periodo: str = Query(default="mes", pattern="^(mes|trimestre|semestre|ano)$"),
    ate: str | None = Query(default=None, pattern="^[0-9]{4}-[0-9]{2}$", description="Mes-ancora YYYY-MM, omitido = mes atual"),
    current: CurrentUser = Depends(require_presidencia_access),
    svc: PresidenciaService = Depends(_get_service),
) -> dict:
    freshness = await svc.freshness()
    data = await svc.get_inicio(unidade, periodo, ate)
    return {**freshness, "data": data}


@router.get("/resumo", summary="9 KPIs mensais com comparativo mes a mes")
async def get_resumo(
    unidade: str | None = Query(default=None, description="Nome da associacao (Congonha/Vaz Lobo) ou omitido para Todos"),
    periodo: str = Query(default="mes", pattern="^(mes|trimestre|semestre|ano)$", description="Controla quantos meses aparecem no mini-grafico"),
    ate: str | None = Query(default=None, pattern="^[0-9]{4}-[0-9]{2}$", description="Mes-ancora YYYY-MM, omitido = mes atual"),
    current: CurrentUser = Depends(require_presidencia_access),
    svc: PresidenciaService = Depends(_get_service),
) -> dict:
    freshness = await svc.freshness()
    data = await svc.get_resumo(unidade, periodo, ate)
    return {**freshness, "data": data}


_PERIODO_PARAMS = dict(
    unidade=Query(default=None, description="Nome da associacao (Congonha/Vaz Lobo) ou omitido para Todos"),
    periodo=Query(default="mes", pattern="^(mes|trimestre|semestre|ano)$"),
    ate=Query(default=None, pattern="^[0-9]{4}-[0-9]{2}$", description="Mes-ancora YYYY-MM, omitido = mes atual"),
)


@router.get("/financeiro", summary="Financeiro detalhado: margem, runway, inadimplencia, sangrias")
async def get_financeiro(
    unidade: str | None = _PERIODO_PARAMS["unidade"],
    periodo: str = _PERIODO_PARAMS["periodo"],
    ate: str | None = _PERIODO_PARAMS["ate"],
    current: CurrentUser = Depends(require_presidencia_access),
    svc: PresidenciaService = Depends(_get_service),
) -> dict:
    freshness = await svc.freshness()
    data = await svc.get_financeiro(unidade, periodo, ate)
    return {**freshness, "data": data}


@router.get("/moradores", summary="Moradores: panorama, crescimento, nunca pagaram, por rua")
async def get_moradores(
    unidade: str | None = _PERIODO_PARAMS["unidade"],
    periodo: str = _PERIODO_PARAMS["periodo"],
    ate: str | None = _PERIODO_PARAMS["ate"],
    current: CurrentUser = Depends(require_presidencia_access),
    svc: PresidenciaService = Depends(_get_service),
) -> dict:
    freshness = await svc.freshness()
    data = await svc.get_moradores(unidade, periodo, ate)
    return {**freshness, "data": data}


@router.get("/mensalidades", summary="Mensalidades: cobranca, recuperacao, devedores, por rua")
async def get_mensalidades(
    unidade: str | None = _PERIODO_PARAMS["unidade"],
    periodo: str = _PERIODO_PARAMS["periodo"],
    ate: str | None = _PERIODO_PARAMS["ate"],
    current: CurrentUser = Depends(require_presidencia_access),
    svc: PresidenciaService = Depends(_get_service),
) -> dict:
    freshness = await svc.freshness()
    data = await svc.get_mensalidades(unidade, periodo, ate)
    return {**freshness, "data": data}


@router.get("/pacotes", summary="Pacotes: volume, paradas, ranking de moradores, por rua")
async def get_pacotes(
    unidade: str | None = _PERIODO_PARAMS["unidade"],
    periodo: str = _PERIODO_PARAMS["periodo"],
    ate: str | None = _PERIODO_PARAMS["ate"],
    current: CurrentUser = Depends(require_presidencia_access),
    svc: PresidenciaService = Depends(_get_service),
) -> dict:
    freshness = await svc.freshness()
    data = await svc.get_pacotes(unidade, periodo, ate)
    return {**freshness, "data": data}


@router.get("/os", summary="Ordens de servico: abertas/fechadas, SLA por tipo")
async def get_os(
    unidade: str | None = _PERIODO_PARAMS["unidade"],
    periodo: str = _PERIODO_PARAMS["periodo"],
    ate: str | None = _PERIODO_PARAMS["ate"],
    current: CurrentUser = Depends(require_presidencia_access),
    svc: PresidenciaService = Depends(_get_service),
) -> dict:
    freshness = await svc.freshness()
    data = await svc.get_os(unidade, periodo, ate)
    return {**freshness, "data": data}


@router.get("/operadores", summary="Operadores: ranking de score, desempenho, feedback")
async def get_operadores_endpoint(
    unidade: str | None = _PERIODO_PARAMS["unidade"],
    periodo: str = _PERIODO_PARAMS["periodo"],
    ate: str | None = _PERIODO_PARAMS["ate"],
    current: CurrentUser = Depends(require_presidencia_access),
    svc: PresidenciaService = Depends(_get_service),
) -> dict:
    freshness = await svc.freshness()
    data = await svc.get_operadores(unidade, periodo, ate)
    return {**freshness, "data": data}


@router.get("/senso", summary="Senso: perfil dos moradores por rua (pragas, internet, problemas)")
async def get_senso(
    unidade: str | None = _PERIODO_PARAMS["unidade"],
    periodo: str = _PERIODO_PARAMS["periodo"],
    ate: str | None = _PERIODO_PARAMS["ate"],
    current: CurrentUser = Depends(require_presidencia_access),
    svc: PresidenciaService = Depends(_get_service),
) -> dict:
    freshness = await svc.freshness()
    data = await svc.get_senso(unidade, periodo, ate)
    return {**freshness, "data": data}
