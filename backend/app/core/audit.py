from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser


async def audit(
    session: AsyncSession,
    current: CurrentUser,
    action: str,
    entity: str,
    entity_id,
    detail: str,
) -> None:
    """Registra uma acao de escrita em audit_log (fica visivel em Administracao > Auditoria).

    Chamar ANTES do commit — faz parte da mesma transacao da acao que esta sendo auditada.
    association_id fica NULL quando a acao nao pertence a uma unidade especifica (ex: acao do ESC).
    """
    await session.execute(text("""
        INSERT INTO audit_log (association_id, empresa_id, user_id, action, entity, entity_id, detail)
        VALUES (:a, :e, :u, :action, :entity, :eid, :d)
    """), {
        "a": str(current.association_id) if current.association_id else None,
        "e": str(current.empresa_id) if current.empresa_id else None,
        "u": str(current.user_id),
        "action": action, "entity": entity,
        "eid": str(entity_id) if entity_id else None,
        "d": detail,
    })
