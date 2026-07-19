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
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.tenant import CurrentUser, require_empresa_admin
from app.database import get_session

router = APIRouter(prefix="/esc", tags=["Escritório"])


async def _assert_assoc_da_empresa(session: AsyncSession, association_id: UUID, empresa_id) -> None:
    """Garante que a associacao alvo pertence a empresa do usuario (escopo)."""
    ok = (await session.execute(text(
        "SELECT 1 FROM associations WHERE id = :aid AND empresa_id = :eid"
    ), {"aid": str(association_id), "eid": str(empresa_id)})).scalar()
    if not ok:
        raise HTTPException(status_code=403, detail="Associação fora da sua empresa.")


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
    # association_id: None => estaciona no ESC (association_id = empresa_id).
    # Caso contrario, valida que a unidade e da empresa.
    target_assoc = current.empresa_id if body.association_id is None else body.association_id
    if body.association_id is not None:
        await _assert_assoc_da_empresa(session, body.association_id, current.empresa_id)

    dup = (await session.execute(text(
        "SELECT 1 FROM users WHERE email = :e AND is_active = TRUE"
    ), {"e": body.email})).scalar()
    if dup:
        raise HTTPException(status_code=409, detail="Já existe usuário ativo com este e-mail.")

    row = (await session.execute(text("""
        INSERT INTO users (id, empresa_id, association_id, full_name, email, phone, hashed_password, role, is_active)
        VALUES (gen_random_uuid(), :eid, :aid, :name, :email, :phone, :pw, CAST(:role AS user_role), TRUE)
        RETURNING id
    """), {
        "eid": str(current.empresa_id), "aid": str(target_assoc), "name": body.full_name,
        "email": body.email, "phone": body.phone, "pw": hash_password(body.password), "role": body.role,
    })).fetchone()
    await session.commit()
    return {"id": str(row[0]), "ok": True}


@router.put("/cadastros/usuarios/{user_id}", summary="Editar usuário da empresa (ESC)")
async def editar_usuario(
    user_id: UUID,
    body: EditarUsuarioRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    alvo = (await session.execute(text(
        "SELECT empresa_id FROM users WHERE id = :id"
    ), {"id": str(user_id)})).fetchone()
    if not alvo or str(alvo[0]) != str(current.empresa_id):
        raise HTTPException(status_code=404, detail="Usuário não encontrado na sua empresa.")

    sets, params = [], {"id": str(user_id)}
    if body.full_name is not None:
        sets.append("full_name = :name"); params["name"] = body.full_name
    if body.phone is not None:
        sets.append("phone = :phone"); params["phone"] = body.phone
    if body.role is not None:
        sets.append("role = CAST(:role AS user_role)"); params["role"] = body.role
    if body.is_active is not None:
        sets.append("is_active = :active"); params["active"] = body.is_active
    if body.association_id is not None:
        await _assert_assoc_da_empresa(session, body.association_id, current.empresa_id)
        sets.append("association_id = :aid"); params["aid"] = str(body.association_id)
    if not sets:
        return {"ok": True, "noop": True}
    # Mudanca de estacao/role/ativo invalida sessoes vivas (token desatualizado).
    sets.append("token_version = token_version + 1")
    sets.append("updated_at = NOW()")
    await session.execute(text(f"UPDATE users SET {', '.join(sets)} WHERE id = :id"), params)
    await session.commit()
    return {"ok": True}


@router.delete("/cadastros/usuarios/{user_id}", summary="Desativar usuário da empresa (ESC)")
async def desativar_usuario(
    user_id: UUID,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if str(user_id) == str(current.user_id):
        raise HTTPException(status_code=400, detail="Você não pode desativar a si mesmo.")
    r = await session.execute(text("""
        UPDATE users SET is_active = FALSE, token_version = token_version + 1, updated_at = NOW()
        WHERE id = :id AND empresa_id = :eid
    """), {"id": str(user_id), "eid": str(current.empresa_id)})
    await session.commit()
    if r.rowcount == 0:
        raise HTTPException(status_code=404, detail="Usuário não encontrado na sua empresa.")
    return {"ok": True}


# tabelas de "movimentacao" que impedem exclusao definitiva
_ACTIVITY = [
    ("transactions", "created_by"), ("cash_sessions", "opened_by"),
    ("packages", "received_by"), ("service_orders", "created_by"),
    ("mensalidades", "created_by"),
]


@router.delete("/cadastros/usuarios/{user_id}/permanente", summary="Excluir usuário sem movimentação (ESC)")
async def excluir_usuario(
    user_id: UUID,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if str(user_id) == str(current.user_id):
        raise HTTPException(status_code=400, detail="Você não pode excluir a si mesmo.")
    alvo = (await session.execute(text(
        "SELECT empresa_id FROM users WHERE id = :id"
    ), {"id": str(user_id)})).fetchone()
    if not alvo or str(alvo[0]) != str(current.empresa_id):
        raise HTTPException(status_code=404, detail="Usuário não encontrado na sua empresa.")

    # movimentacao => nao pode excluir, so desativar
    for tbl, col in _ACTIVITY:
        n = (await session.execute(text(
            f"SELECT 1 FROM {tbl} WHERE {col} = :id LIMIT 1"
        ), {"id": str(user_id)})).scalar()
        if n:
            raise HTTPException(status_code=409, detail="Usuário possui movimentação — use Desativar em vez de Excluir.")

    # remove vinculos incidentais e o usuario; FK residual (ex.: auditoria) aborta com 409
    try:
        await session.execute(text("DELETE FROM refresh_tokens WHERE user_id = :id"), {"id": str(user_id)})
        await session.execute(text("DELETE FROM user_association_roles WHERE user_id = :id"), {"id": str(user_id)})
        await session.execute(text("DELETE FROM users WHERE id = :id AND empresa_id = :eid"),
                              {"id": str(user_id), "eid": str(current.empresa_id)})
        await session.commit()
    except Exception:
        await session.rollback()
        raise HTTPException(status_code=409, detail="Usuário possui registros vinculados — use Desativar.")
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
    rows = (await session.execute(text("""
        SELECT id, name, type, description, is_active FROM transaction_categories
        WHERE empresa_id = :eid ORDER BY type, name
    """), {"eid": str(current.empresa_id)})).fetchall()
    return [{"id": str(r[0]), "name": r[1], "type": r[2], "description": r[3], "is_active": r[4]} for r in rows]


@router.post("/cadastros/categorias", summary="Criar categoria de transação (empresa)")
async def criar_categoria(
    body: CategoriaRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = (await session.execute(text("""
        INSERT INTO transaction_categories (id, association_id, empresa_id, name, type, description, color, is_active)
        VALUES (gen_random_uuid(), NULL, :eid, :name, CAST(:type AS transaction_type), :desc, :color, TRUE)
        RETURNING id
    """), {"eid": str(current.empresa_id), "name": body.name, "type": body.type,
           "desc": body.description, "color": body.color})).fetchone()
    await session.commit()
    return {"id": str(row[0]), "ok": True}


@router.get("/cadastros/formas-pagamento", summary="Formas de pagamento da empresa")
async def list_formas(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT id, name, is_active FROM payment_methods
        WHERE empresa_id = :eid ORDER BY name
    """), {"eid": str(current.empresa_id)})).fetchall()
    return [{"id": str(r[0]), "name": r[1], "is_active": r[2]} for r in rows]


@router.post("/cadastros/formas-pagamento", summary="Criar forma de pagamento (empresa)")
async def criar_forma(
    body: FormaPagamentoRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = (await session.execute(text("""
        INSERT INTO payment_methods (id, association_id, empresa_id, name, is_active)
        VALUES (gen_random_uuid(), NULL, :eid, :name, TRUE)
        RETURNING id
    """), {"eid": str(current.empresa_id), "name": body.name})).fetchone()
    await session.commit()
    return {"id": str(row[0]), "ok": True}


# ── Permissoes (template unico da empresa) ────────────────────────────────

class AccessGroupsRequest(BaseModel):
    access_groups: dict


# Template padrao exibido quando a empresa ainda nao configurou permissoes
# (empresas.access_groups vazio). O admin ve um ponto de partida e salva.
_DEFAULT_ACCESS_GROUPS = {
    "operator":          {"residents": ["view"], "packages": ["view", "create"], "service_orders": ["view"], "finance": ["view", "create"], "admin": [], "settings": []},
    "conferente":        {"residents": ["view", "create", "edit"], "packages": ["view", "create", "edit"], "service_orders": ["view", "create", "edit"], "finance": ["view", "create", "edit"], "admin": [], "settings": ["view"]},
    "diretoria_adjunta": {"residents": ["view"], "packages": ["view"], "service_orders": ["view", "create", "edit"], "finance": ["view"], "admin": [], "settings": []},
    "diretoria":         {"residents": ["view"], "packages": ["view"], "service_orders": ["view"], "finance": ["view"], "admin": ["view"], "settings": ["view"]},
    "conselho":          {"residents": ["view"], "packages": ["view"], "service_orders": ["view"], "finance": ["view"], "admin": ["view"], "settings": ["view"]},
    "admin":             {"residents": ["view", "create", "edit", "delete"], "packages": ["view", "create", "edit", "delete"], "service_orders": ["view", "create", "edit", "delete"], "finance": ["view", "create", "edit", "delete"], "admin": ["view", "create", "edit", "delete"], "settings": ["view", "edit"]},
}


@router.get("/administracao/access-groups", summary="Grupos de acesso (template da empresa)")
async def get_access_groups(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = (await session.execute(text(
        "SELECT access_groups FROM empresas WHERE id = :eid"
    ), {"eid": str(current.empresa_id)})).fetchone()
    if row and row[0]:
        return row[0]
    return _DEFAULT_ACCESS_GROUPS


@router.put("/administracao/access-groups", summary="Salvar grupos de acesso da empresa")
async def put_access_groups(
    body: AccessGroupsRequest,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    import json as _json
    await session.execute(text(
        "UPDATE empresas SET access_groups = CAST(:ag AS JSONB), updated_at = NOW() WHERE id = :eid"
    ), {"ag": _json.dumps(body.access_groups), "eid": str(current.empresa_id)})
    await session.commit()
    return {"ok": True}


# ── Auditoria centralizada (leitura) ──────────────────────────────────────

@router.get("/administracao/auditoria", summary="Auditoria consolidada da empresa")
async def list_auditoria(
    limit: int = 200,
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT al.created_at, al.action, al.entity, u.full_name, a.name AS unidade
        FROM audit_log al
        LEFT JOIN users u ON u.id = al.user_id
        LEFT JOIN associations a ON a.id = al.association_id
        WHERE a.empresa_id = :eid OR al.empresa_id = :eid
        ORDER BY al.created_at DESC LIMIT :lim
    """), {"eid": str(current.empresa_id), "lim": min(limit, 500)})).fetchall()
    return [{"created_at": str(r[0]), "action": r[1], "entity": r[2],
             "user": r[3], "unidade": r[4]} for r in rows]


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
    # Fan-out: 1 notificacao por usuario ativo de toda associacao da empresa,
    # marcada com empresa_id (rastreio de broadcast).
    r = await session.execute(text("""
        INSERT INTO notifications (id, association_id, empresa_id, user_id, title, body, type)
        SELECT gen_random_uuid(), u.association_id, :eid, u.id, :title, :body, 'broadcast'
        FROM users u
        WHERE u.empresa_id = :eid AND u.is_active = TRUE
    """), {"eid": str(current.empresa_id), "title": body.title, "body": body.body})
    await session.commit()
    return {"ok": True, "enviados": r.rowcount}


@router.get("/administracao/avisos", summary="Histórico de avisos (broadcasts) da empresa")
async def list_avisos(
    current: CurrentUser = Depends(require_empresa_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT title, body, MIN(created_at) AS enviado_em, COUNT(*) AS destinatarios
        FROM notifications
        WHERE empresa_id = :eid AND type = 'broadcast'
        GROUP BY title, body ORDER BY enviado_em DESC LIMIT 100
    """), {"eid": str(current.empresa_id)})).fetchall()
    return [{"title": r[0], "body": r[1], "enviado_em": str(r[2]), "destinatarios": r[3]} for r in rows]
