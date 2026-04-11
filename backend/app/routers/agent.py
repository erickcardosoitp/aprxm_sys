import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session

router = APIRouter(prefix="/agent", tags=["Agente IA"])

WRITE_ACTIONS = {"pay_mensalidade", "create_service_order", "create_resident"}


class ChatRequest(BaseModel):
    message: str
    confirmed_action: dict | None = None  # set when user confirms a pending action


class ChatResponse(BaseModel):
    reply: str
    requires_confirmation: bool = False
    pending_action: dict | None = None
    data: dict | None = None


# ── Data helpers ─────────────────────────────────────────────────────────────

async def _finance_summary(aid: str, session: AsyncSession) -> dict:
    r = await session.execute(text("""
        SELECT
            COALESCE(SUM(amount) FILTER (WHERE type='income'), 0) AS entradas,
            COALESCE(SUM(amount) FILTER (WHERE type='expense'), 0) AS saidas,
            COUNT(*) FILTER (WHERE type='income') AS n_entradas
        FROM transactions t
        JOIN cash_sessions cs ON cs.id = t.cash_session_id
        WHERE cs.association_id = :aid
          AND cs.opened_at::date = CURRENT_DATE
    """), {"aid": aid})
    row = r.fetchone()
    return {"entradas": float(row[0]), "saidas": float(row[1]), "n_entradas": row[2]}


async def _delinquent_list(aid: str, session: AsyncSession) -> list[dict]:
    r = await session.execute(text("""
        SELECT r.full_name, m.reference_month, m.amount
        FROM mensalidades m
        JOIN residents r ON r.id = m.resident_id
        WHERE m.association_id = :aid AND m.status = 'pending'
          AND m.due_date < CURRENT_DATE
        ORDER BY m.due_date LIMIT 20
    """), {"aid": aid})
    return [{"name": x[0], "month": x[1], "amount": float(x[2])} for x in r.fetchall()]


async def _search_residents(aid: str, q: str, session: AsyncSession) -> list[dict]:
    r = await session.execute(text("""
        SELECT id, full_name, cpf, phone_primary, unit, block, status
        FROM residents
        WHERE association_id = :aid AND (
            full_name ILIKE :q OR cpf ILIKE :q OR phone_primary ILIKE :q
        ) LIMIT 10
    """), {"aid": aid, "q": f"%{q}%"})
    return [{"id": str(x[0]), "name": x[1], "cpf": x[2], "phone": x[3],
             "unit": x[4], "block": x[5], "status": x[6]} for x in r.fetchall()]


async def _pending_mensalidades(aid: str, name_q: str, session: AsyncSession) -> list[dict]:
    r = await session.execute(text("""
        SELECT m.id, r.full_name, m.reference_month, m.amount, m.due_date
        FROM mensalidades m
        JOIN residents r ON r.id = m.resident_id
        WHERE m.association_id = :aid AND m.status = 'pending'
          AND r.full_name ILIKE :q
        ORDER BY m.due_date LIMIT 10
    """), {"aid": aid, "q": f"%{name_q}%"})
    return [{"id": str(x[0]), "name": x[1], "month": x[2], "amount": float(x[3]),
             "due": str(x[4])} for x in r.fetchall()]


# ── Intent classifier (Claude) ────────────────────────────────────────────────

SYSTEM_PROMPT = """Você é o agente do sistema APROXIMA — ERP para associações comunitárias.
Interprete o comando do usuário e responda com JSON válido neste formato:
{
  "intent": "<intent>",
  "params": {},
  "reply": "<resposta curta em pt-BR>"
}

Intents disponíveis:
- "financial_summary": perguntas sobre dinheiro hoje (entradas, saídas)
- "list_delinquent": quem está devendo
- "search_resident": buscar morador — params: {"q": "..."}
- "list_pending_mensalidades": mensalidades pendentes de um morador — params: {"name": "..."}
- "pay_mensalidade": pagar mensalidade — params: {"mensalidade_id": "...", "name": "..."} — REQUER CONFIRMAÇÃO
- "create_service_order": criar OS — params: {"title": "...", "description": "...", "service_impacted": "..."} — REQUER CONFIRMAÇÃO
- "unknown": intenção não reconhecida

Regras:
- Nunca invente dados
- Para ações de escrita diga que precisa de confirmação
- Seja conciso"""


async def _classify(message: str) -> dict:
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise HTTPException(503, "Agente IA não configurado (ANTHROPIC_API_KEY ausente).")

    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        resp = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": message}],
        )
        text_content = resp.content[0].text.strip()
        # Extract JSON from response
        if "```" in text_content:
            text_content = text_content.split("```")[1].replace("json", "").strip()
        return json.loads(text_content)
    except Exception as e:
        return {"intent": "unknown", "params": {}, "reply": f"Não consegui interpretar: {e}"}


# ── Main endpoint ─────────────────────────────────────────────────────────────

@router.post("/chat", summary="Agente IA — chat")
async def agent_chat(
    body: ChatRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ChatResponse:
    aid = str(current.association_id)

    # Handle confirmed action
    if body.confirmed_action:
        return await _execute_action(body.confirmed_action, current, session, aid)

    parsed = await _classify(body.message)
    intent = parsed.get("intent", "unknown")
    params = parsed.get("params", {})
    reply = parsed.get("reply", "")

    # Read-only intents — execute immediately
    if intent == "financial_summary":
        data = await _finance_summary(aid, session)
        e = data["entradas"]
        s = data["saidas"]
        reply = f"Hoje: R$ {e:,.2f} em entradas, R$ {s:,.2f} em saídas. Saldo: R$ {e-s:,.2f}."
        return ChatResponse(reply=reply, data=data)

    if intent == "list_delinquent":
        data = await _delinquent_list(aid, session)
        if not data:
            return ChatResponse(reply="Nenhum inadimplente encontrado.", data={"items": []})
        names = ", ".join(d["name"] for d in data[:5])
        reply = f"{len(data)} inadimplente(s): {names}{'…' if len(data) > 5 else ''}."
        return ChatResponse(reply=reply, data={"items": data})

    if intent == "search_resident":
        q = params.get("q", body.message)
        data = await _search_residents(aid, q, session)
        if not data:
            return ChatResponse(reply="Nenhum morador encontrado.", data={"items": []})
        names = ", ".join(d["name"] for d in data[:3])
        reply = f"Encontrei {len(data)} morador(es): {names}."
        return ChatResponse(reply=reply, data={"items": data})

    if intent == "list_pending_mensalidades":
        name = params.get("name", body.message)
        data = await _pending_mensalidades(aid, name, session)
        if not data:
            return ChatResponse(reply="Nenhuma mensalidade pendente encontrada.", data={"items": []})
        reply = f"{len(data)} mensalidade(s) pendente(s) para '{name}'."
        return ChatResponse(reply=reply, data={"items": data})

    # Write intents — require confirmation
    if intent in WRITE_ACTIONS:
        action = {"intent": intent, "params": params}
        return ChatResponse(
            reply=reply or f"Confirmar: {intent}?",
            requires_confirmation=True,
            pending_action=action,
        )

    return ChatResponse(reply=reply or "Não entendi. Tente: 'quanto entrou hoje?', 'quem está devendo?', 'buscar morador João'.")


async def _execute_action(action: dict, current: CurrentUser, session: AsyncSession, aid: str) -> ChatResponse:
    intent = action.get("intent")
    params = action.get("params", {})

    if intent == "pay_mensalidade":
        mid = params.get("mensalidade_id")
        if not mid:
            return ChatResponse(reply="ID da mensalidade não informado.")
        await session.execute(text("""
            UPDATE mensalidades SET status = 'paid', paid_at = NOW(), paid_by = :uid
            WHERE id = :mid AND association_id = :aid AND status = 'pending'
        """), {"mid": mid, "aid": aid, "uid": str(current.user_id)})
        await session.commit()
        return ChatResponse(reply="Mensalidade paga com sucesso.")

    if intent == "create_service_order":
        title = params.get("title", "OS via Agente")
        desc = params.get("description", "Criado pelo agente IA.")
        service = params.get("service_impacted")
        num_row = await session.execute(text(
            "SELECT COALESCE(MAX(number), 0) + 1 FROM service_orders WHERE association_id = :aid"
        ), {"aid": aid})
        num = num_row.scalar()
        await session.execute(text("""
            INSERT INTO service_orders
              (association_id, number, title, description, status, priority,
               service_impacted, created_by, created_at, updated_at)
            VALUES (:aid, :num, :title, :desc, 'pending', 'medium',
                    :service, :uid, NOW(), NOW())
        """), {"aid": aid, "num": num, "title": title, "desc": desc,
               "service": service, "uid": str(current.user_id)})
        await session.commit()
        return ChatResponse(reply=f"OS #{num} criada: '{title}'.")

    return ChatResponse(reply="Ação não reconhecida.")
