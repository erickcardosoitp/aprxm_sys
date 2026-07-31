from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def notify_resident(
    session: AsyncSession,
    association_id: UUID,
    resident_id: UUID,
    type_: str,
    title: str,
    body: str | None = None,
    post_id: UUID | None = None,
) -> None:
    """Insere uma notificacao pro morador (sininho do Portal do Morador).
    Nao commita — quem chama decide o commit junto com a operacao principal."""
    await session.execute(
        text("""
            INSERT INTO resident_notifications (association_id, resident_id, type, title, body, post_id)
            VALUES (:aid, :rid, :type, :title, :body, :post_id)
        """),
        {"aid": association_id, "rid": resident_id, "type": type_, "title": title, "body": body, "post_id": post_id},
    )
