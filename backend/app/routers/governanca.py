"""
Router /governanca — provisionamento no-code de empresas e associações
(ambiente ESC). Ver docs/superpowers/specs/2026-07-15-governanca-empresa-esc-design.md
"""
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.exceptions import ForbiddenError, NotFoundError
from app.core.tenant import CurrentUser, assert_same_empresa, get_current_user, require_empresa_admin, require_platform_admin
from app.database import get_session
from app.models.association import Association
from app.models.empresa import Empresa
from app.models.provisioning_run import ProvisioningRun
from app.services.association_provisioning_service import AssociationProvisioningService
from app.services.empresa_service import EmpresaService

router = APIRouter(prefix="/governanca", tags=["Governança"])


class CreateEmpresaRequest(BaseModel):
    name: str
    slug: str
    admin_first_name: str
    admin_last_name: str
    admin_email: EmailStr
    admin_cargo: str
    financeiro_centralizado: bool = False


class EmpresaResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    financeiro_centralizado: bool
    is_active: bool

    @staticmethod
    def from_model(e: Empresa) -> "EmpresaResponse":
        return EmpresaResponse(id=e.id, name=e.name, slug=e.slug, financeiro_centralizado=e.financeiro_centralizado, is_active=e.is_active)


class CreateAssociacaoRequest(BaseModel):
    name: str
    slug: str
    community_name: str
    default_mensalidade_amount: Decimal
    default_cash_balance: Decimal
    inventory_day_of_month: int = 1
    president_name: str | None = None
    admin_first_name: str
    admin_last_name: str
    admin_email: EmailStr
    admin_cargo: str


class AssociacaoResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    empresa_id: UUID


class ProvisioningRunResponse(BaseModel):
    id: UUID
    empresa_id: UUID | None
    run_type: str
    status: str
    steps: list
    error_detail: str | None
    started_at: datetime
    finished_at: datetime | None

    @staticmethod
    def from_model(r: ProvisioningRun) -> "ProvisioningRunResponse":
        return ProvisioningRunResponse(
            id=r.id, empresa_id=r.empresa_id, run_type=r.run_type.value, status=r.status.value,
            steps=r.steps, error_detail=r.error_detail, started_at=r.started_at, finished_at=r.finished_at,
        )


@router.post("/empresas", response_model=EmpresaResponse, summary="Criar empresa (Form 1)")
async def create_empresa(
    body: CreateEmpresaRequest,
    current: CurrentUser = Depends(require_platform_admin),
    session: AsyncSession = Depends(get_session),
) -> EmpresaResponse:
    svc = EmpresaService(session)
    empresa, _admin = await svc.create_empresa(
        name=body.name, slug=body.slug,
        admin_first_name=body.admin_first_name, admin_last_name=body.admin_last_name,
        admin_email=body.admin_email, admin_cargo=body.admin_cargo,
        financeiro_centralizado=body.financeiro_centralizado, started_by=current.user_id,
    )
    return EmpresaResponse.from_model(empresa)


@router.get("/empresas", response_model=list[EmpresaResponse], summary="Listar empresas")
async def list_empresas(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[EmpresaResponse]:
    if current.is_platform_admin:
        stmt = select(Empresa)
    elif current.is_empresa_admin and current.empresa_id:
        stmt = select(Empresa).where(Empresa.id == current.empresa_id)
    else:
        raise ForbiddenError("Sem acesso a empresas.")
    rows = (await session.execute(stmt.order_by(Empresa.name))).scalars().all()
    return [EmpresaResponse.from_model(e) for e in rows]


@router.post("/empresas/{empresa_id}/associacoes", response_model=AssociacaoResponse, summary="Criar associação (Form 2)")
async def create_associacao(
    empresa_id: UUID,
    body: CreateAssociacaoRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> AssociacaoResponse:
    assert_same_empresa(current, empresa_id)
    svc = AssociationProvisioningService(session)
    assoc, _admin = await svc.create_associacao(
        empresa_id=empresa_id, name=body.name, slug=body.slug, community_name=body.community_name,
        default_mensalidade_amount=body.default_mensalidade_amount, default_cash_balance=body.default_cash_balance,
        inventory_day_of_month=body.inventory_day_of_month, president_name=body.president_name,
        admin_first_name=body.admin_first_name, admin_last_name=body.admin_last_name,
        admin_email=body.admin_email, admin_cargo=body.admin_cargo, started_by=current.user_id,
    )
    return AssociacaoResponse(id=assoc.id, name=assoc.name, slug=assoc.slug, empresa_id=assoc.empresa_id)


@router.patch("/associacoes/{association_id}/desativar", summary="Desativar associação (soft delete em cascata)")
async def deactivate_associacao(
    association_id: UUID,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    assoc = (await session.execute(select(Association).where(Association.id == association_id))).scalar_one_or_none()
    if not assoc:
        raise NotFoundError("Associação")
    assert_same_empresa(current, assoc.empresa_id)

    assoc.is_active = False
    session.add(assoc)

    # Desativa a membership desta associacao pra todo mundo (mesmo quem mantem
    # acesso a outras associacoes ativas nao deve mais ver esta como opcao).
    await session.execute(
        text("UPDATE user_association_roles SET is_active = FALSE WHERE association_id = :aid"),
        {"aid": str(association_id)},
    )
    # Soft delete em cascata: so desativa o USUARIO se ele nao tiver mais
    # nenhuma outra membership ativa em outra associacao (admin_master/superadmin
    # tem association_id NULL e nunca caem aqui).
    await session.execute(text("""
        UPDATE users SET is_active = FALSE
        WHERE association_id = :aid
          AND NOT EXISTS (
              SELECT 1 FROM user_association_roles uar
              WHERE uar.user_id = users.id AND uar.association_id != :aid AND uar.is_active = TRUE
          )
    """), {"aid": str(association_id)})

    await session.commit()
    return {"ok": True}


@router.get("/provisioning-runs", response_model=list[ProvisioningRunResponse], summary="Listar execuções de provisionamento")
async def list_provisioning_runs(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ProvisioningRunResponse]:
    if current.is_platform_admin:
        stmt = select(ProvisioningRun)
    elif current.is_empresa_admin and current.empresa_id:
        stmt = select(ProvisioningRun).where(ProvisioningRun.empresa_id == current.empresa_id)
    else:
        raise ForbiddenError("Sem acesso a execuções de provisionamento.")
    rows = (await session.execute(stmt.order_by(ProvisioningRun.started_at.desc()))).scalars().all()
    return [ProvisioningRunResponse.from_model(r) for r in rows]


@router.get("/provisioning-runs/{run_id}", response_model=ProvisioningRunResponse, summary="Detalhe de uma execução de provisionamento")
async def get_provisioning_run(
    run_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProvisioningRunResponse:
    run = (await session.execute(select(ProvisioningRun).where(ProvisioningRun.id == run_id))).scalar_one_or_none()
    if not run:
        raise NotFoundError("Execução de provisionamento")
    if not current.is_platform_admin:
        assert_same_empresa(current, run.empresa_id)
    return ProvisioningRunResponse.from_model(run)
