import json

import httpx

from app.config import get_settings
from app.core.resilience import http_cb

settings = get_settings()

GROQ_MODEL = "llama-3.3-70b-versatile"

SYSTEM_PROMPT = (
    "Você modera o feed de comunidade de uma associação de moradores (anúncios, "
    "reclamações, avisos). Responda SOMENTE um JSON: "
    '{"approved": true|false, "reason": "..."}\n\n'
    "Reprove (approved=false) apenas se o texto for:\n"
    "- ofensivo, discurso de ódio, ameaça ou ataque pessoal nominal a um vizinho/funcionário;\n"
    "- spam, propaganda enganosa ou completamente sem sentido/ilegível;\n"
    "- conteúdo sexual, ou dados sensíveis de terceiros expostos sem necessidade.\n\n"
    "Aprove (approved=true) reclamações legítimas sobre serviços/estrutura/administração, "
    "mesmo em tom negativo ou insatisfeito — crítica não é ofensa. Na dúvida, aprove.\n"
    "'reason' deve ter no máximo 1 frase curta em português, explicando a decisão."
)


async def _call_groq(payload: dict) -> dict:
    async def _do() -> dict:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                json=payload,
            )
        if r.status_code != 200:
            raise ValueError(f"Groq HTTP {r.status_code}: {r.text[:300]}")
        return r.json()

    return await http_cb.call_async(_do)


async def moderate_post(category: str, title: str | None, body: str) -> tuple[str, str, bool]:
    """
    Avalia um post via LLM. Retorna (status, reason, moderated_by_ai).

    status: 'approved' | 'rejected' | 'pending'
    'pending' = moderação automática indisponível/falhou — cai pra fila manual do staff,
    nunca publica sem alguma checagem (fail-safe, não fail-open).
    """
    if not settings.groq_api_key:
        return "pending", "Moderação automática não configurada — aguardando revisão manual.", False

    content = f"Categoria: {category}\nTítulo: {title or '(sem título)'}\nTexto: {body}"
    try:
        resp = await _call_groq({
            "model": GROQ_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
            "temperature": 0,
            "response_format": {"type": "json_object"},
        })
        raw = resp["choices"][0]["message"]["content"]
        data = json.loads(raw)
        approved = bool(data.get("approved"))
        reason = str(data.get("reason") or "").strip()[:500]
        return ("approved" if approved else "rejected"), reason, True
    except Exception:
        return "pending", "Moderação automática indisponível no momento — aguardando revisão manual.", False
