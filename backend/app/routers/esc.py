"""
Router /esc — leituras agregadas por empresa para o ambiente Escritório (ESC).

Cada endpoint retorna dado de TODAS as associacoes da empresa do usuario
(nao so a association_id do token) — visao agregada, conforme o modelo de
governanca (empresa -> unidades de negocio). Guardado por require_empresa_admin
(admin_master/superadmin escopados a empresa).

Este router so faz parsing de request/resposta, chamada de EscService e
auditoria/commit — toda query mora em app/services/esc_service.py.

TEMPORARIO/em construcao: alguns modulos do esboco do ESC ainda nao tem
tabela/logica correspondente (Plano de Metas, Monitor de Sincronizacao,
Data Analytics, Banco de Dados, Fotos e Videos, Posts Website) — ausentes
deste router de proposito, o frontend mostra placeholder pra eles.
"""
import logging
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.security import hash_password
from app.core.tenant import CurrentUser, require_empresa_admin, _DEFAULT_ACCESS_GROUPS, financeiro_scope, require_esc_module
from app.database import get_session
from app.services.esc_service import EscService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/esc", tags=["Escritório"])


# Era uma copia local identica a core.audit.audit (mesma assinatura, mesmo INSERT),
# so com uma divergencia sutil: nao tratava association_id=None como NULL. Trocado
# por alias do helper compartilhado em vez de manter 2 implementacoes da mesma coisa —
# os call sites abaixo continuam iguais (_audit(...)), so muda de onde vem.
from app.core.audit import audit as _audit  # noqa: E402


async def _assert_assoc_da_empresa(session: AsyncSession, association_id: UUID, empresa_id) -> None:
    await EscService(session).assert_assoc_da_empresa(association_id, empresa_id)


# ──────────────────────────────────────────────────────────────────────────
# Cadastros
# ──────────────────────────────────────────────────────────────────────────

@router.get("/cadastros/associacoes", summary="Associações da empresa")
async def list_associacoes(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await EscService(session).list_associacoes(current.empresa_id)


class EditarAssociacaoRequest(BaseModel):
    name: str | None = None
    slug: str | None = None
    plan_name: str | None = None
    is_active: bool | None = None


@router.put("/cadastros/associacoes/{association_id}", summary="Editar associação da empresa")
async def editar_associacao(
    association_id: UUID,
    body: EditarAssociacaoRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = EscService(session)
    params = await svc.editar_associacao(association_id, current.empresa_id, body, current.user_id)
    if params is None:
        return {"ok": True, "noop": True}
    await _audit(session, current, "editar_associacao", "associations", association_id, ", ".join(f"{k}={v}" for k, v in params.items() if k not in ("id", "uid")))
    await session.commit()
    return {"ok": True}


@router.get("/cadastros/usuarios", summary="Usuários da empresa (todas as unidades)")
async def list_usuarios(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await EscService(session).list_usuarios(current.empresa_id)


@router.get("/cadastros/encomendas", summary="Encomendas — todas as unidades")
async def list_encomendas(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    search: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict:
    items, total = await EscService(session).list_encomendas(
        current.empresa_id, date_from, date_to, skip, limit, search,
    )
    return {"total": total, "items": items}


@router.get("/cadastros/ordens-servico", summary="Ordens de Serviço — todas as unidades")
async def list_ordens_servico(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    search: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict:
    items, total = await EscService(session).list_ordens_servico(
        current.empresa_id, date_from, date_to, skip, limit, search,
    )
    return {"total": total, "items": items}


class CriarOrdemServicoRequest(BaseModel):
    association_id: UUID
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1)
    priority: str = "medium"
    area: str | None = None
    location_detail: str | None = None


class EditarOrdemServicoRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: str | None = None
    area: str | None = None
    location_detail: str | None = None


@router.post("/cadastros/ordens-servico", summary="Criar Ordem de Serviço (empresa, qualquer unidade)")
async def criar_ordem_servico(
    body: CriarOrdemServicoRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from app.models.service_order import ServiceOrderPriority
    from app.services.service_order_service import ServiceOrderService

    await _assert_assoc_da_empresa(session, body.association_id, current.empresa_id)
    svc = ServiceOrderService(session)
    so = await svc.create(
        association_id=body.association_id,
        created_by=current.user_id,
        title=body.title,
        description=body.description,
        priority=ServiceOrderPriority(body.priority),
        area=body.area,
        location_detail=body.location_detail,
    )
    await _audit(session, current, "criar_ordem_servico", "service_orders", so.id, f"OS #{so.number}: {body.title}")
    await session.commit()
    return {"id": str(so.id), "number": so.number, "status": so.status}


@router.put("/cadastros/ordens-servico/{so_id}", summary="Editar Ordem de Serviço (empresa)")
async def editar_ordem_servico(
    so_id: UUID,
    body: EditarOrdemServicoRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from app.services.service_order_service import ServiceOrderService

    ids = await EscService(session).empresa_assoc_ids(current.empresa_id)
    svc = ServiceOrderService(session)
    data = body.model_dump(exclude_none=True)
    if not data:
        return {"ok": True, "noop": True}
    data["updated_by"] = current.user_id
    so = await svc.update(so_id, current.empresa_id, data, association_ids=ids)
    await _audit(session, current, "editar_ordem_servico", "service_orders", so_id, ", ".join(f"{k}={v}" for k, v in data.items()))
    await session.commit()
    return {"id": str(so.id), "number": so.number, "status": so.status}


@router.delete("/cadastros/ordens-servico/{so_id}", summary="Excluir Ordem de Serviço (empresa)")
async def excluir_ordem_servico(
    so_id: UUID,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    number, title = await EscService(session).excluir_ordem_servico(so_id, current.empresa_id)
    await _audit(session, current, "excluir_ordem_servico", "service_orders", so_id, f"OS #{number}: {title}")
    await session.commit()
    return {"ok": True}


@router.get("/cadastros/comprovantes-residencia", summary="Estoque de comprovante de residência por unidade")
async def list_comprovantes_estoque(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await EscService(session).list_comprovantes_estoque(current.empresa_id)


class EditarEstoqueComprovanteRequest(BaseModel):
    estoque: int = Field(ge=0)


@router.put("/cadastros/comprovantes-residencia/{association_id}", summary="Editar estoque de comprovante de residência de uma unidade")
async def editar_comprovante_estoque(
    association_id: UUID,
    body: EditarEstoqueComprovanteRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = EscService(session)
    await svc.editar_comprovante_estoque(association_id, current.empresa_id, body.estoque)
    await _audit(session, current, "editar_estoque_comprovante", "association_settings", association_id, f"estoque -> {body.estoque}")
    await session.commit()
    return {"ok": True}


# ──────────────────────────────────────────────────────────────────────────
# Moradores
# ──────────────────────────────────────────────────────────────────────────

@router.get("/moradores/associados", summary="Associados — todas as unidades")
async def list_associados(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await EscService(session).list_residents_by_type(current.empresa_id, "member")


@router.get("/moradores/visitantes", summary="Visitantes — todas as unidades")
async def list_visitantes(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await EscService(session).list_residents_by_type(current.empresa_id, "guest")


@router.get("/moradores/dependentes", summary="Dependentes — todas as unidades")
async def list_dependentes(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await EscService(session).list_residents_by_type(current.empresa_id, "dependent")


# ──────────────────────────────────────────────────────────────────────────
# Financeiro
# ──────────────────────────────────────────────────────────────────────────

# Movimentações: substituído por GET /financeiro/movimentacoes (financeiro.py),
# que já nasce com financeiro_scope, filtros completos e export xlsx.


@router.get("/financeiro/sangrias", summary="Sangrias — todas as unidades")
async def list_sangrias(
    unidade: UUID | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    current: CurrentUser = Depends(require_esc_module("financeiro")),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    ids = [str(i) for i in await financeiro_scope(current, session, unidade)]
    return await EscService(session).list_sangrias(ids, date_from, date_to)


@router.get("/financeiro/sessoes-conferidas", summary="Sessões de caixa conferidas — todas as unidades")
async def list_sessoes_conferidas(
    unidade: UUID | None = Query(default=None),
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    ids = [str(i) for i in await financeiro_scope(current, session, unidade)]
    return await EscService(session).list_sessoes_conferidas(ids)


# ──────────────────────────────────────────────────────────────────────────
# Contas a Pagar (Fase 5 do Financeiro Centralizado)
# ──────────────────────────────────────────────────────────────────────────

class CriarContaPagarTemplateRequest(BaseModel):
    association_id: UUID
    payable_category_id: UUID | None = None
    name: str = Field(min_length=1, max_length=255)
    amount: Decimal = Field(gt=0)
    due_day: int = Field(ge=1, le=28)


class CriarContaPagarRequest(BaseModel):
    association_id: UUID
    payable_category_id: UUID | None = None
    description: str = Field(min_length=1, max_length=255)
    amount: Decimal = Field(gt=0)
    due_date: date


class CriarPayableCategoriaRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


@router.get("/cadastros/categorias-contas-pagar", summary="Categorias de contas a pagar da empresa")
async def list_payable_categorias(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await EscService(session).list_payable_categorias(current.empresa_id)


@router.post("/cadastros/categorias-contas-pagar", summary="Criar categoria de conta a pagar (empresa)")
async def criar_payable_categoria(
    body: CriarPayableCategoriaRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    cat_id = await EscService(session).criar_payable_categoria(current.empresa_id, body.name, current.user_id)
    await _audit(session, current, "criar_categoria_contas_pagar", "payable_categories", cat_id, body.name)
    await session.commit()
    return {"id": str(cat_id), "ok": True}


class EditarPayableCategoriaRequest(BaseModel):
    name: str | None = None
    is_active: bool | None = None


@router.put("/cadastros/categorias-contas-pagar/{categoria_id}", summary="Editar/desativar categoria de conta a pagar")
async def editar_payable_categoria(
    categoria_id: UUID,
    body: EditarPayableCategoriaRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = EscService(session)
    params = await svc.editar_payable_categoria(categoria_id, current.empresa_id, body, current.user_id)
    if not params:
        return {"ok": True, "noop": True}
    await _audit(session, current, "editar_categoria_contas_pagar", "payable_categories", categoria_id, ", ".join(f"{k}={v}" for k, v in params.items() if k not in ("id", "eid", "uid")))
    await session.commit()
    return {"ok": True}


@router.get("/cadastros/produtos", summary="Produtos da empresa (mensalidade, taxa de entrega, comprovante)")
async def list_produtos(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await EscService(session).list_produtos(current.empresa_id)


class EditarProdutoRequest(BaseModel):
    preco_associado: Decimal = Field(ge=0)
    preco_nao_associado: Decimal = Field(ge=0)
    is_active: bool | None = None
    force: bool = False
    aplicar_divergentes: bool = False  # só usado quando force=True e code='mensalidade'


@router.put("/cadastros/produtos/{produto_id}", summary="Editar preço de um produto (com checagem de conflito p/ mensalidade)")
async def editar_produto(
    produto_id: UUID,
    body: EditarProdutoRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    resultado = await EscService(session).editar_produto(produto_id, current.empresa_id, body, current.user_id)
    if resultado.get("conflito"):
        return resultado
    await _audit(session, current, "editar_produto", "products", produto_id, f"preco_associado={body.preco_associado} preco_nao_associado={body.preco_nao_associado}")
    await session.commit()
    return resultado


class BaixaContaPagarRequest(BaseModel):
    amount: Decimal = Field(gt=0)
    cash_session_id: UUID | None = None  # None = "sem caixa", mesmo mecanismo da devolucao


@router.get("/financeiro/contas-pagar-templates", summary="Templates de conta a pagar recorrente")
async def list_contas_pagar_templates(
    unidade: UUID | None = Query(default=None),
    current: CurrentUser = Depends(require_esc_module("financeiro")),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    ids = [str(i) for i in await financeiro_scope(current, session, unidade)]
    return await EscService(session).list_contas_pagar_templates(ids)


@router.post("/financeiro/contas-pagar-templates", summary="Criar template de conta a pagar recorrente")
async def criar_conta_pagar_template(
    body: CriarContaPagarTemplateRequest,
    current: CurrentUser = Depends(require_esc_module("financeiro")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await _assert_assoc_da_empresa(session, body.association_id, current.empresa_id)
    tpl_id = await EscService(session).criar_conta_pagar_template(body, current.user_id)
    await _audit(session, current, "criar_conta_pagar_template", "contas_pagar_templates", tpl_id, body.name)
    await session.commit()
    return {"id": str(tpl_id), "ok": True}


@router.put("/financeiro/contas-pagar-templates/{template_id}", summary="Ativar/desativar template")
async def atualizar_conta_pagar_template(
    template_id: UUID,
    is_active: bool,
    current: CurrentUser = Depends(require_esc_module("financeiro")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    ids = [str(i) for i in await financeiro_scope(current, session)]
    await EscService(session).atualizar_conta_pagar_template(template_id, ids, is_active, current.user_id)
    await _audit(session, current, "atualizar_conta_pagar_template", "contas_pagar_templates", template_id, f"is_active -> {is_active}")
    await session.commit()
    return {"ok": True}


@router.post("/financeiro/contas-pagar-templates/{template_id}/gerar", summary="Gerar conta do mês a partir do template")
async def gerar_conta_pagar_do_template(
    template_id: UUID,
    reference_month: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    current: CurrentUser = Depends(require_esc_module("financeiro")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    ids = [str(i) for i in await financeiro_scope(current, session)]
    conta_id = await EscService(session).gerar_conta_pagar_do_template(template_id, ids, reference_month, current.user_id)
    await _audit(session, current, "gerar_conta_pagar_do_template", "contas_pagar", conta_id, f"template={template_id} mes={reference_month}")
    await session.commit()
    return {"id": str(conta_id), "ok": True}


@router.get("/financeiro/contas-pagar", summary="Contas a pagar — todas as unidades no escopo")
async def list_contas_pagar(
    unidade: UUID | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    current: CurrentUser = Depends(require_esc_module("financeiro")),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    ids = [str(i) for i in await financeiro_scope(current, session, unidade)]
    return await EscService(session).list_contas_pagar(ids, status_filter)


@router.post("/financeiro/contas-pagar", summary="Lançar conta a pagar avulsa")
async def criar_conta_pagar(
    body: CriarContaPagarRequest,
    current: CurrentUser = Depends(require_esc_module("financeiro")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await _assert_assoc_da_empresa(session, body.association_id, current.empresa_id)
    conta_id = await EscService(session).criar_conta_pagar(body, current.user_id)
    await _audit(session, current, "criar_conta_pagar", "contas_pagar", conta_id, body.description)
    await session.commit()
    return {"id": str(conta_id), "ok": True}


@router.post("/financeiro/contas-pagar/{conta_id}/baixa", summary="Registrar baixa (total ou parcial)")
async def baixar_conta_pagar(
    conta_id: UUID,
    body: BaixaContaPagarRequest,
    current: CurrentUser = Depends(require_esc_module("financeiro")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    ids = [str(i) for i in await financeiro_scope(current, session)]
    resultado = await EscService(session).baixar_conta_pagar(conta_id, ids, body.amount, body.cash_session_id, current.user_id)
    await _audit(session, current, "baixar_conta_pagar", "contas_pagar", conta_id, f"R$ {body.amount} -> status {resultado['status']}")
    await session.commit()
    return {"ok": True, "status": resultado["status"], "amount_paid": resultado["amount_paid"]}


class EstornarBaixaRequest(BaseModel):
    reason: str = Field(min_length=5, max_length=255)


@router.post("/financeiro/contas-pagar/baixas/{baixa_id}/estornar", summary="Estornar uma baixa de conta a pagar (lançamento errado)")
async def estornar_baixa_conta_pagar(
    baixa_id: UUID,
    body: EstornarBaixaRequest,
    current: CurrentUser = Depends(require_esc_module("financeiro")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from app.services.finance_service import FinanceService

    ids = [str(i) for i in await financeiro_scope(current, session)]
    finance_svc = FinanceService(session)
    resultado = await EscService(session).estornar_baixa_conta_pagar(baixa_id, ids, body.reason, current, finance_svc)
    await _audit(session, current, "estornar_baixa_conta_pagar", "contas_pagar", resultado["conta_id"], f"Estorno R$ {resultado['baixa_amount']} — {body.reason}")
    await session.commit()
    return {"ok": True, "status": resultado["status"], "amount_paid": resultado["amount_paid"]}


@router.delete("/financeiro/contas-pagar/{conta_id}", summary="Excluir conta a pagar lançada errada (sem baixas)")
async def excluir_conta_pagar(
    conta_id: UUID,
    current: CurrentUser = Depends(require_esc_module("financeiro")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    ids = [str(i) for i in await financeiro_scope(current, session)]
    descricao = await EscService(session).excluir_conta_pagar(conta_id, ids)
    await _audit(session, current, "excluir_conta_pagar", "contas_pagar", conta_id, descricao)
    await session.commit()
    return {"ok": True}


# ──────────────────────────────────────────────────────────────────────────
# Contas a Receber (Fase 6) — mensalidade (reaproveita CRM) + taxa de entrega
# de morador nao-associado, prevista 1x por morador (nao por encomenda).
# ──────────────────────────────────────────────────────────────────────────

@router.get("/financeiro/contas-receber/taxa-entrega", summary="Taxa de entrega prevista — 1 por morador não-associado com encomenda parada")
async def list_taxa_entrega_prevista(
    unidade: UUID | None = Query(default=None),
    current: CurrentUser = Depends(require_esc_module("financeiro")),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    ids = [str(i) for i in await financeiro_scope(current, session, unidade)]
    fee_default = Decimal(str(get_settings().delivery_fee_default))
    return await EscService(session).list_taxa_entrega_prevista(ids, fee_default)


# ──────────────────────────────────────────────────────────────────────────
# Administração
# ──────────────────────────────────────────────────────────────────────────

@router.get("/administracao/estoque", summary="Estoque (comprovante de residência) por unidade")
async def list_estoque(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await EscService(session).list_comprovantes_estoque(current.empresa_id)


# ──────────────────────────────────────────────────────────────────────────
# TI (reaproveita a logica de /ti/health, escopo empresa)
# ──────────────────────────────────────────────────────────────────────────

@router.get("/ti/infra", summary="Saúde da infraestrutura (reaproveita /ti/health)")
async def infra_health(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    import time as _time
    from sqlalchemy import text as _text
    t0 = _time.monotonic()
    try:
        await session.execute(_text("SELECT 1"))
        db_ms = round((_time.monotonic() - t0) * 1000)
        db_ok = True
    except Exception:
        logger.exception("Falha no healthcheck de banco (SELECT 1)")
        db_ms = -1
        db_ok = False
    open_sessions = await EscService(session).open_cash_sessions_count(current.empresa_id)
    return {"db_ok": db_ok, "db_latency_ms": db_ms, "open_cash_sessions": open_sessions}


# ══════════════════════════════════════════════════════════════════════════
# ESCRITA — Fase 11 (centralizacao administrativa)
# Tudo escopado a current.empresa_id. Aditivo: nao remove endpoints antigos.
# ══════════════════════════════════════════════════════════════════════════

# ── Gestao de usuario (Cadastros) ─────────────────────────────────────────

class CriarUsuarioRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=6)
    role: str
    association_id: UUID | None = None  # None = estacionar no ESC (empresa-wide)
    phone: str | None = None


class EditarUsuarioRequest(BaseModel):
    full_name: str | None = None
    email: str | None = None
    role: str | None = None
    association_id: UUID | None = None
    phone: str | None = None
    is_active: bool | None = None


@router.post("/cadastros/usuarios", summary="Criar usuário na empresa (ESC)")
async def criar_usuario(
    body: CriarUsuarioRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    user_id = await EscService(session).criar_usuario(body, current.role, current.empresa_id, current.user_id, hash_password(body.password))
    await _audit(session, current, "criar_usuario", "user", user_id, f"{body.full_name} ({body.role})")
    await session.commit()
    return {"id": str(user_id), "ok": True}


@router.put("/cadastros/usuarios/{user_id}", summary="Editar usuário da empresa (ESC)")
async def editar_usuario(
    user_id: UUID,
    body: EditarUsuarioRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = EscService(session)
    params = await svc.editar_usuario(user_id, body, current, current.empresa_id)
    if params is None:
        return {"ok": True, "noop": True}
    await _audit(session, current, "editar_usuario", "user", user_id, ", ".join(f"{k}={v}" for k, v in params.items() if k not in ("id", "uid")))
    await session.commit()
    return {"ok": True}


@router.delete("/cadastros/usuarios/{user_id}", summary="Desativar usuário da empresa (ESC)")
async def desativar_usuario(
    user_id: UUID,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await EscService(session).desativar_usuario(user_id, current.user_id, current.empresa_id)
    await _audit(session, current, "desativar_usuario", "user", user_id, "")
    await session.commit()
    return {"ok": True}


@router.delete("/cadastros/usuarios/{user_id}/permanente", summary="Excluir usuário sem movimentação (ESC)")
async def excluir_usuario(
    user_id: UUID,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = EscService(session)
    # As checagens de negocio (auto-exclusao, empresa, movimentacao vinculada)
    # ja levantam HTTPException de dentro do service -- aqui so protegemos
    # contra falha inesperada do driver na hora do DELETE em si.
    try:
        await svc.excluir_usuario(user_id, current.user_id, current.empresa_id)
    except HTTPException:
        raise
    except IntegrityError:
        await session.rollback()
        logger.exception("IntegrityError ao excluir usuário %s (empresa %s)", user_id, current.empresa_id)
        raise HTTPException(status_code=409, detail="Usuário possui registros vinculados — use Desativar.")
    except Exception:
        await session.rollback()
        logger.exception("Falha inesperada ao excluir usuário %s (empresa %s)", user_id, current.empresa_id)
        raise HTTPException(status_code=500, detail="Erro inesperado ao excluir usuário.")
    await _audit(session, current, "excluir_usuario_permanente", "user", user_id, "")
    await session.commit()
    return {"ok": True}


# ── Categoria de transacao + forma de pagamento (nivel empresa) ───────────

class CategoriaRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: str  # income | expense
    description: str | None = None
    color: str | None = None


class FormaPagamentoRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


@router.get("/cadastros/categorias", summary="Categorias de transação da empresa")
async def list_categorias(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await EscService(session).list_categorias(current.empresa_id)


@router.post("/cadastros/categorias", summary="Criar categoria de transação (empresa)")
async def criar_categoria(
    body: CategoriaRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    cat_id = await EscService(session).criar_categoria(current.empresa_id, body, current.user_id)
    await _audit(session, current, "criar_categoria", "transaction_categories", cat_id, f"{body.name} ({body.type})")
    await session.commit()
    return {"id": str(cat_id), "ok": True}


class EditarCategoriaRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None
    is_active: bool | None = None


@router.put("/cadastros/categorias/{categoria_id}", summary="Editar/desativar categoria de transação")
async def editar_categoria(
    categoria_id: UUID,
    body: EditarCategoriaRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = EscService(session)
    params = await svc.editar_categoria(categoria_id, current.empresa_id, body, current.user_id)
    if not params:
        return {"ok": True, "noop": True}
    await _audit(session, current, "editar_categoria", "transaction_categories", categoria_id, ", ".join(f"{k}={v}" for k, v in params.items() if k not in ("id", "eid", "uid")))
    await session.commit()
    return {"ok": True}


@router.get("/cadastros/formas-pagamento", summary="Formas de pagamento da empresa")
async def list_formas(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await EscService(session).list_formas(current.empresa_id)


@router.post("/cadastros/formas-pagamento", summary="Criar forma de pagamento (empresa)")
async def criar_forma(
    body: FormaPagamentoRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    forma_id = await EscService(session).criar_forma(current.empresa_id, body.name, current.user_id)
    await _audit(session, current, "criar_forma_pagamento", "payment_methods", forma_id, body.name)
    await session.commit()
    return {"id": str(forma_id), "ok": True}


class EditarFormaRequest(BaseModel):
    name: str | None = None
    is_active: bool | None = None


@router.put("/cadastros/formas-pagamento/{forma_id}", summary="Editar/desativar forma de pagamento")
async def editar_forma(
    forma_id: UUID,
    body: EditarFormaRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = EscService(session)
    params = await svc.editar_forma(forma_id, current.empresa_id, body, current.user_id)
    if not params:
        return {"ok": True, "noop": True}
    await _audit(session, current, "editar_forma_pagamento", "payment_methods", forma_id, ", ".join(f"{k}={v}" for k, v in params.items() if k not in ("id", "eid", "uid")))
    await session.commit()
    return {"ok": True}


# ── Permissoes (template unico da empresa) ────────────────────────────────

class AccessGroupsRequest(BaseModel):
    access_groups: dict


# _DEFAULT_ACCESS_GROUPS agora vive em app.core.tenant (reaproveitado por
# require_esc_module sem risco de import circular).


@router.get("/administracao/access-groups", summary="Grupos de acesso (template da empresa)")
async def get_access_groups(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    groups = await EscService(session).get_access_groups(current.empresa_id)
    return groups if groups is not None else _DEFAULT_ACCESS_GROUPS


@router.put("/administracao/access-groups", summary="Salvar grupos de acesso da empresa")
async def put_access_groups(
    body: AccessGroupsRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await EscService(session).put_access_groups(current.empresa_id, body.access_groups)
    await _audit(session, current, "atualizar_access_groups", "empresas", current.empresa_id, "grid de permissoes atualizado")
    await session.commit()
    return {"ok": True}


# ── Auditoria centralizada (leitura) ──────────────────────────────────────

@router.get("/administracao/auditoria", summary="Auditoria consolidada da empresa")
async def list_auditoria(
    limit: int = 200,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await EscService(session).list_auditoria(current.empresa_id, limit)


# ── Central de avisos (broadcast) ─────────────────────────────────────────

class AvisoRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1)


@router.post("/administracao/avisos", summary="Enviar aviso a todas as unidades (broadcast)")
async def enviar_aviso(
    body: AvisoRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    enviados = await EscService(session).enviar_aviso(current.empresa_id, body.title, body.body)
    await _audit(session, current, "enviar_aviso", "notifications", None, f"{body.title} -> {enviados} destinatario(s)")
    await session.commit()
    return {"ok": True, "enviados": enviados}


@router.get("/administracao/avisos", summary="Histórico de avisos (broadcasts) da empresa")
async def list_avisos(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await EscService(session).list_avisos(current.empresa_id)


# ── Inventário de encomendas (snapshot pontual) ───────────────────────────

class InventarioEncomendaRequest(BaseModel):
    association_id: UUID
    reference_at: str  # ISO datetime (dia + hora escolhidos)


@router.post("/administracao/inventario-encomendas", summary="Gerar inventário de encomendas (snapshot)")
async def gerar_inventario_encomendas(
    body: InventarioEncomendaRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await _assert_assoc_da_empresa(session, body.association_id, current.empresa_id)
    try:
        ref = datetime.fromisoformat(body.reference_at)
    except ValueError:
        raise HTTPException(status_code=422, detail="Data/hora inválida.")
    inv_id, total = await EscService(session).gerar_inventario_encomendas(current.empresa_id, body.association_id, ref, current.user_id)
    await _audit(session, current, "gerar_inventario_encomendas", "package_inventories", inv_id, f"{total} item(ns)")
    await session.commit()
    return {"id": str(inv_id), "total": total, "ok": True}


@router.get("/administracao/inventario-encomendas", summary="Histórico de inventários de encomendas")
async def list_inventario_encomendas(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await EscService(session).list_inventario_encomendas(current.empresa_id)


@router.get("/administracao/inventario-encomendas/{inv_id}", summary="Detalhe (itens) do inventário")
async def detalhe_inventario_encomendas(
    inv_id: UUID,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await EscService(session).detalhe_inventario_encomendas(inv_id, current.empresa_id)
