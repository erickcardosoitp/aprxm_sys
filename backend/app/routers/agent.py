from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session

router = APIRouter(prefix="/agent", tags=["Simplifica"])


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    reply: str
    data: dict | None = None


# ── Rule-based classifier ─────────────────────────────────────────────────────

def _classify(msg: str) -> tuple[str, dict]:
    m = msg.lower()

    # Financial
    if any(w in m for w in ['entrou', 'entrada', 'receita', 'faturou', 'quanto hoje', 'caixa hoje', 'saldo hoje', 'movimentação']):
        return "financial_summary", {}

    if any(w in m for w in ['saiu', 'saída', 'saidas', 'despesa', 'gasto', 'gastou']):
        return "financial_expenses", {}

    if any(w in m for w in ['sessão', 'sessao', 'caixa aberto', 'caixa fechado', 'caixa está']):
        return "session_status", {}

    # Residents
    if any(w in m for w in ['deve', 'devendo', 'inadimplente', 'inadimplência', 'inadimplencia', 'atrasado', 'em atraso']):
        return "list_delinquent", {}

    if any(w in m for w in ['mensalidade pendente', 'pendente de', 'pendentes de', 'mensalidades de']):
        for kw in ['mensalidades de', 'pendente de', 'pendentes de']:
            if kw in m:
                name = msg.split(kw, 1)[-1].strip()
                if name:
                    return "list_pending_mensalidades", {"name": name}
        return "list_pending_mensalidades", {"name": ""}

    for kw in ['buscar ', 'busca ', 'procurar ', 'encontrar ', 'morador ', 'associado ']:
        if kw in m:
            q = msg.split(kw, 1)[-1].strip()
            if q:
                return "search_resident", {"q": q}

    # OS / service orders
    if any(w in m for w in ['ordem de serviço', 'os aberta', 'os pendente', 'ordens', 'chamado']):
        return "list_service_orders", {}

    # Packages
    if any(w in m for w in ['encomenda', 'pacote', 'entrega', 'pendente para retirar']):
        return "list_packages", {}

    # Stats
    if any(w in m for w in ['total de moradores', 'quantos moradores', 'total de associados', 'quantos associados']):
        return "resident_count", {}

    if any(w in m for w in ['quantas os', 'total de os', 'quantas ordens']):
        return "so_count", {}

    return "unknown", {}


# ── Data queries ──────────────────────────────────────────────────────────────

async def _financial_summary(aid: str, session: AsyncSession) -> dict:
    r = await session.execute(text("""
        SELECT
            COALESCE(SUM(amount) FILTER (WHERE t.type='income'), 0),
            COALESCE(SUM(amount) FILTER (WHERE t.type='expense'), 0),
            COUNT(*) FILTER (WHERE t.type='income')
        FROM transactions t
        JOIN cash_sessions cs ON cs.id = t.cash_session_id
        WHERE cs.association_id = :aid AND cs.opened_at::date = CURRENT_DATE
    """), {"aid": aid})
    row = r.fetchone()
    return {"entradas": float(row[0]), "saidas": float(row[1]), "n_entradas": int(row[2])}


async def _session_status(aid: str, session: AsyncSession) -> dict:
    r = await session.execute(text("""
        SELECT status, opened_at, open_balance FROM cash_sessions
        WHERE association_id = :aid ORDER BY opened_at DESC LIMIT 1
    """), {"aid": aid})
    row = r.fetchone()
    if not row:
        return {"status": "none"}
    return {"status": row[0], "opened_at": str(row[1]), "balance": float(row[2] or 0)}


async def _delinquent(aid: str, session: AsyncSession) -> list[dict]:
    r = await session.execute(text("""
        SELECT r.full_name, m.reference_month, m.amount, m.due_date
        FROM mensalidades m
        JOIN residents r ON r.id = m.resident_id
        WHERE m.association_id = :aid AND m.status = 'pending' AND m.due_date < CURRENT_DATE
        ORDER BY m.due_date LIMIT 20
    """), {"aid": aid})
    return [{"name": x[0], "month": x[1], "amount": float(x[2]), "due": str(x[3])} for x in r.fetchall()]


async def _search_residents(aid: str, q: str, session: AsyncSession) -> list[dict]:
    r = await session.execute(text("""
        SELECT full_name, cpf, phone_primary, status
        FROM residents
        WHERE association_id = :aid AND (
            full_name ILIKE :q OR cpf ILIKE :q OR phone_primary ILIKE :q
        ) LIMIT 10
    """), {"aid": aid, "q": f"%{q}%"})
    return [{"name": x[0], "cpf": x[1], "phone": x[2], "status": x[3]} for x in r.fetchall()]


async def _pending_mensalidades(aid: str, name: str, session: AsyncSession) -> list[dict]:
    r = await session.execute(text("""
        SELECT r.full_name, m.reference_month, m.amount, m.due_date
        FROM mensalidades m
        JOIN residents r ON r.id = m.resident_id
        WHERE m.association_id = :aid AND m.status = 'pending'
          AND (:name = '' OR r.full_name ILIKE :nameq)
        ORDER BY m.due_date LIMIT 15
    """), {"aid": aid, "name": name, "nameq": f"%{name}%"})
    return [{"name": x[0], "month": x[1], "amount": float(x[2]), "due": str(x[3])} for x in r.fetchall()]


async def _service_orders(aid: str, session: AsyncSession) -> list[dict]:
    r = await session.execute(text("""
        SELECT number, title, status, priority, created_at
        FROM service_orders
        WHERE association_id = :aid AND status NOT IN ('resolved','cancelled','archived')
        ORDER BY created_at DESC LIMIT 10
    """), {"aid": aid})
    return [{"number": x[0], "title": x[1], "status": x[2], "priority": x[3]} for x in r.fetchall()]


async def _packages(aid: str, session: AsyncSession) -> list[dict]:
    r = await session.execute(text("""
        SELECT resident_name, carrier_name, status, received_at
        FROM packages
        WHERE association_id = :aid AND status IN ('received','notified')
        ORDER BY received_at DESC LIMIT 10
    """), {"aid": aid})
    return [{"name": x[0], "carrier": x[1], "status": x[2]} for x in r.fetchall()]


async def _resident_count(aid: str, session: AsyncSession) -> dict:
    r = await session.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE type='member' AND status='active'),
            COUNT(*) FILTER (WHERE type='member'),
            COUNT(*) FILTER (WHERE type='guest')
        FROM residents WHERE association_id = :aid
    """), {"aid": aid})
    row = r.fetchone()
    return {"ativos": int(row[0]), "total_membros": int(row[1]), "visitantes": int(row[2])}


async def _so_count(aid: str, session: AsyncSession) -> dict:
    r = await session.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status IN ('open','in_progress','pending')),
            COUNT(*) FILTER (WHERE status='resolved' AND updated_at::date = CURRENT_DATE),
            COUNT(*)
        FROM service_orders WHERE association_id = :aid
    """), {"aid": aid})
    row = r.fetchone()
    return {"abertas": int(row[0]), "resolvidas_hoje": int(row[1]), "total": int(row[2])}


# ── Main endpoint ─────────────────────────────────────────────────────────────

@router.post("/chat", summary="Simplifica — agente de consulta")
async def agent_chat(
    body: ChatRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ChatResponse:
    aid = str(current.association_id)
    intent, params = _classify(body.message)

    if intent == "financial_summary":
        d = await _financial_summary(aid, session)
        e, s = d["entradas"], d["saidas"]
        reply = f"Hoje: {d['n_entradas']} entrada(s) somando R$ {e:,.2f}. Saídas: R$ {s:,.2f}. Saldo líquido: R$ {e-s:,.2f}."
        return ChatResponse(reply=reply, data=d)

    if intent == "financial_expenses":
        d = await _financial_summary(aid, session)
        reply = f"Saídas de hoje: R$ {d['saidas']:,.2f}."
        return ChatResponse(reply=reply, data=d)

    if intent == "session_status":
        d = await _session_status(aid, session)
        if d["status"] == "none":
            reply = "Nenhuma sessão de caixa encontrada."
        elif d["status"] == "open":
            reply = f"Caixa aberto. Saldo inicial: R$ {d['balance']:,.2f}."
        else:
            reply = "Caixa fechado."
        return ChatResponse(reply=reply, data=d)

    if intent == "list_delinquent":
        items = await _delinquent(aid, session)
        if not items:
            reply = "Nenhum inadimplente no momento."
        else:
            total = sum(i["amount"] for i in items)
            reply = f"{len(items)} inadimplente(s). Total em aberto: R$ {total:,.2f}."
        return ChatResponse(reply=reply, data={"items": items})

    if intent == "search_resident":
        q = params.get("q", "")
        if not q:
            return ChatResponse(reply="Informe o nome ou CPF para buscar.")
        items = await _search_residents(aid, q, session)
        if not items:
            reply = f"Nenhum morador encontrado para '{q}'."
        else:
            reply = f"{len(items)} morador(es) encontrado(s)."
        return ChatResponse(reply=reply, data={"items": items})

    if intent == "list_pending_mensalidades":
        name = params.get("name", "")
        items = await _pending_mensalidades(aid, name, session)
        if not items:
            reply = "Nenhuma mensalidade pendente encontrada."
        else:
            total = sum(i["amount"] for i in items)
            reply = f"{len(items)} mensalidade(s) pendente(s). Total: R$ {total:,.2f}."
        return ChatResponse(reply=reply, data={"items": items})

    if intent == "list_service_orders":
        items = await _service_orders(aid, session)
        reply = f"{len(items)} OS aberta(s)." if items else "Nenhuma OS aberta."
        return ChatResponse(reply=reply, data={"items": items})

    if intent == "list_packages":
        items = await _packages(aid, session)
        reply = f"{len(items)} encomenda(s) aguardando retirada." if items else "Nenhuma encomenda pendente."
        return ChatResponse(reply=reply, data={"items": items})

    if intent == "resident_count":
        d = await _resident_count(aid, session)
        reply = f"{d['ativos']} associado(s) ativo(s) de {d['total_membros']} cadastrado(s). Visitantes: {d['visitantes']}."
        return ChatResponse(reply=reply, data=d)

    if intent == "so_count":
        d = await _so_count(aid, session)
        reply = f"{d['abertas']} OS aberta(s). Resolvidas hoje: {d['resolvidas_hoje']}. Total histórico: {d['total']}."
        return ChatResponse(reply=reply, data=d)

    return ChatResponse(
        reply="Não entendi. Tente: 'quanto entrou hoje?', 'quem está devendo?', 'buscar morador João', 'encomendas pendentes', 'quantas OS abertas'."
    )
