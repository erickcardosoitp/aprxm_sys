"""
Router /esc — leituras agregadas por empresa para o ambiente Escritório (ESC).

Cada endpoint retorna dado de TODAS as associacoes da empresa do usuario
(nao so a association_id do token) — visao agregada, conforme o modelo de
governanca (empresa -> unidades de negocio). Guardado por require_empresa_admin
(admin_master/superadmin escopados a empresa).

TEMPORARIO/em construcao: alguns modulos do esboco do ESC ainda nao tem
tabela/logica correspondente (Plano de Metas, Monitor de Sincronizacao,
Data Analytics, Banco de Dados, Fotos e Videos, Posts Website) — ausentes
deste router de proposito, o frontend mostra placeholder pra eles.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, require_empresa_admin
from app.database import get_session

router = APIRouter(prefix="/esc", tags=["Escritório"])


# ──────────────────────────────────────────────────────────────────────────
# Cadastros
# ──────────────────────────────────────────────────────────────────────────

@router.get("/cadastros/associacoes", summary="Associações da empresa")
async def list_associacoes(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT id, name, slug, is_active, plan_name, created_at
        FROM associations WHERE empresa_id = :eid ORDER BY name
    """), {"eid": str(current.empresa_id)})).fetchall()
    return [{"id": str(r[0]), "name": r[1], "slug": r[2], "is_active": r[3],
             "plan_name": r[4], "created_at": str(r[5])} for r in rows]


@router.get("/cadastros/usuarios", summary="Usuários da empresa (todas as unidades)")
async def list_usuarios(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT u.id, u.full_name, u.email, u.role, u.is_active, u.last_login_at,
               COALESCE(a.name, 'Escritório') AS unidade
        FROM users u
        LEFT JOIN associations a ON a.id = u.association_id
        WHERE u.empresa_id = :eid
        ORDER BY u.full_name
    """), {"eid": str(current.empresa_id)})).fetchall()
    return [{"id": str(r[0]), "full_name": r[1], "email": r[2], "role": r[3],
             "is_active": r[4], "last_login_at": str(r[5]) if r[5] else None,
             "unidade": r[6]} for r in rows]


@router.get("/cadastros/grupos-usuarios", summary="Grupos de usuários (templates de acesso por cargo)")
async def list_grupos_usuarios(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT a.id, a.name, s.access_groups
        FROM associations a
        LEFT JOIN association_settings s ON s.association_id = a.id
        WHERE a.empresa_id = :eid ORDER BY a.name
    """), {"eid": str(current.empresa_id)})).fetchall()
    out = []
    for r in rows:
        groups = r[2] or {}
        for role, perms in groups.items():
            out.append({"unidade": r[1], "grupo": role, "modulos": perms})
    return out


@router.get("/cadastros/encomendas", summary="Encomendas — todas as unidades")
async def list_encomendas(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT p.id, p.status, p.sender_name, p.carrier_name, p.received_at,
               a.name AS unidade
        FROM packages p JOIN associations a ON a.id = p.association_id
        WHERE a.empresa_id = :eid
        ORDER BY p.received_at DESC LIMIT 200
    """), {"eid": str(current.empresa_id)})).fetchall()
    return [{"id": str(r[0]), "status": r[1], "sender_name": r[2], "carrier_name": r[3],
             "received_at": str(r[4]), "unidade": r[5]} for r in rows]


@router.get("/cadastros/ordens-servico", summary="Ordens de Serviço — todas as unidades")
async def list_ordens_servico(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT os.id, os.number, os.title, os.priority, os.status, os.created_at,
               a.name AS unidade
        FROM service_orders os JOIN associations a ON a.id = os.association_id
        WHERE a.empresa_id = :eid
        ORDER BY os.created_at DESC LIMIT 200
    """), {"eid": str(current.empresa_id)})).fetchall()
    return [{"id": str(r[0]), "number": r[1], "title": r[2], "priority": r[3],
             "status": r[4], "created_at": str(r[5]), "unidade": r[6]} for r in rows]


@router.get("/cadastros/comprovantes-residencia", summary="Estoque de comprovante de residência por unidade")
async def list_comprovantes_estoque(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT a.id, a.name, COALESCE(s.proof_stock, 0) AS estoque
        FROM associations a
        LEFT JOIN association_settings s ON s.association_id = a.id
        WHERE a.empresa_id = :eid ORDER BY a.name
    """), {"eid": str(current.empresa_id)})).fetchall()
    return [{"id": str(r[0]), "unidade": r[1], "estoque": r[2]} for r in rows]


# ──────────────────────────────────────────────────────────────────────────
# Moradores
# ──────────────────────────────────────────────────────────────────────────

async def _list_residents_by_type(session: AsyncSession, empresa_id, resident_type: str) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT r.id, r.full_name, r.cpf, r.status, r.created_at, a.name AS unidade
        FROM residents r JOIN associations a ON a.id = r.association_id
        WHERE a.empresa_id = :eid AND r.type = :rtype
        ORDER BY r.full_name LIMIT 300
    """), {"eid": str(empresa_id), "rtype": resident_type})).fetchall()
    return [{"id": str(r[0]), "full_name": r[1], "cpf": r[2], "status": r[3],
             "created_at": str(r[4]), "unidade": r[5]} for r in rows]


@router.get("/moradores/associados", summary="Associados — todas as unidades")
async def list_associados(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await _list_residents_by_type(session, current.empresa_id, "member")


@router.get("/moradores/visitantes", summary="Visitantes — todas as unidades")
async def list_visitantes(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await _list_residents_by_type(session, current.empresa_id, "guest")


@router.get("/moradores/dependentes", summary="Dependentes — todas as unidades")
async def list_dependentes(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await _list_residents_by_type(session, current.empresa_id, "dependent")


# ──────────────────────────────────────────────────────────────────────────
# Financeiro
# ──────────────────────────────────────────────────────────────────────────

@router.get("/financeiro/movimentacoes", summary="Movimentações — todas as unidades")
async def list_movimentacoes(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT t.id, t.type, t.amount, t.description, t.transaction_at, a.name AS unidade
        FROM transactions t JOIN associations a ON a.id = t.association_id
        WHERE a.empresa_id = :eid
        ORDER BY t.transaction_at DESC LIMIT 200
    """), {"eid": str(current.empresa_id)})).fetchall()
    return [{"id": str(r[0]), "type": r[1], "amount": str(r[2]), "description": r[3],
             "transaction_at": str(r[4]), "unidade": r[5]} for r in rows]


@router.get("/financeiro/sangrias", summary="Sangrias — todas as unidades")
async def list_sangrias(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT t.id, t.amount, t.sangria_reason, t.sangria_destination, t.transaction_at, a.name AS unidade
        FROM transactions t JOIN associations a ON a.id = t.association_id
        WHERE a.empresa_id = :eid AND t.is_sangria = true
        ORDER BY t.transaction_at DESC LIMIT 200
    """), {"eid": str(current.empresa_id)})).fetchall()
    return [{"id": str(r[0]), "amount": str(r[1]), "reason": r[2], "destination": r[3],
             "transaction_at": str(r[4]), "unidade": r[5]} for r in rows]


@router.get("/financeiro/sessoes-conferidas", summary="Sessões de caixa conferidas (fechadas) — todas as unidades")
async def list_sessoes_conferidas(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT cs.id, cs.opening_balance, cs.opened_at, cs.status, a.name AS unidade
        FROM cash_sessions cs JOIN associations a ON a.id = cs.association_id
        WHERE a.empresa_id = :eid AND cs.status != 'open'
        ORDER BY cs.opened_at DESC LIMIT 200
    """), {"eid": str(current.empresa_id)})).fetchall()
    return [{"id": str(r[0]), "opening_balance": str(r[1]), "opened_at": str(r[2]),
             "status": r[3], "unidade": r[4]} for r in rows]


# ──────────────────────────────────────────────────────────────────────────
# Administração
# ──────────────────────────────────────────────────────────────────────────

@router.get("/administracao/permissoes", summary="Permissões por cargo e unidade")
async def list_permissoes(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT rp.role, rp.module, rp.can_view, rp.can_write, a.name AS unidade
        FROM role_permissions rp JOIN associations a ON a.id = rp.association_id
        WHERE a.empresa_id = :eid
        ORDER BY a.name, rp.role, rp.module
    """), {"eid": str(current.empresa_id)})).fetchall()
    return [{"role": r[0], "module": r[1], "can_view": r[2], "can_write": r[3],
             "unidade": r[4]} for r in rows]


@router.get("/administracao/estoque", summary="Estoque (comprovante de residência) por unidade")
async def list_estoque(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await list_comprovantes_estoque(current, session)


# ──────────────────────────────────────────────────────────────────────────
# TI (reaproveita a logica de /ti/health, escopo empresa)
# ──────────────────────────────────────────────────────────────────────────

@router.get("/ti/infra", summary="Saúde da infraestrutura (reaproveita /ti/health)")
async def infra_health(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    import time as _time
    t0 = _time.monotonic()
    try:
        await session.execute(text("SELECT 1"))
        db_ms = round((_time.monotonic() - t0) * 1000)
        db_ok = True
    except Exception:
        db_ms = -1
        db_ok = False
    open_sessions = (await session.execute(
        text("SELECT COUNT(*) FROM cash_sessions cs JOIN associations a ON a.id = cs.association_id WHERE a.empresa_id = :eid AND cs.status = 'open'"),
        {"eid": str(current.empresa_id)},
    )).scalar() or 0
    return {"db_ok": db_ok, "db_latency_ms": db_ms, "open_cash_sessions": open_sessions}
