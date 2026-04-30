from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

from app.core.tenant import CurrentUser, get_current_user
from app.database import AsyncSessionLocal

router = APIRouter(prefix="/chat", tags=["Chat"])

RETENTION_DAYS = 15


class MessageRequest(BaseModel):
    content: Optional[str] = None
    message_type: str = "text"
    media_url: Optional[str] = None
    mention_ids: list[str] = []
    reply_to_id: Optional[str] = None


ROLE_LABELS: dict[str, str] = {
    "superadmin": "Super Admin",
    "admin_master": "Admin Master",
    "admin": "Admin",
    "diretoria": "Diretoria",
    "conferente": "Conferente",
    "diretoria_adjunta": "Diretoria Adjunta",
    "operator": "Operador",
    "viewer": "Visualizador",
}


async def _get_chat_group(association_id: str, session) -> str | None:
    row = (await session.execute(
        text("SELECT chat_group FROM associations WHERE id = :aid"),
        {"aid": association_id}
    )).fetchone()
    return row[0] if row else None


async def _assoc_filter(association_id: str, session) -> tuple[str, dict]:
    """Returns (where_clause, params) filtering by chat_group if set, else by association_id."""
    group = await _get_chat_group(association_id, session)
    if group:
        return (
            "m.association_id IN (SELECT id FROM associations WHERE chat_group = :group)",
            {"group": group}
        )
    return "m.association_id = :assoc", {"assoc": association_id}


def _row_to_dict(r) -> dict:
    t = tuple(r)
    return {
        "id": str(t[0]),
        "sender_id": str(t[1]) if t[1] else None,
        "sender_name": t[2],
        "sender_role": ROLE_LABELS.get(t[8], t[8]) if t[8] else None,
        "content": t[3],
        "message_type": t[4],
        "media_url": t[5],
        "mention_ids": t[6] or [],
        "created_at": t[7].isoformat() if t[7] else None,
        "sender_association": t[9] if len(t) > 9 else None,
        "reply_to_id": str(t[10]) if len(t) > 10 and t[10] else None,
        "reply_to_sender_name": t[11] if len(t) > 11 else None,
        "reply_to_content": t[12] if len(t) > 12 else None,
        "reply_to_type": t[13] if len(t) > 13 else None,
    }


@router.get("/messages")
async def list_messages(
    before_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    current: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    async with AsyncSessionLocal() as session:
        where, params = await _assoc_filter(str(current.association_id), session)
        params["cutoff"] = cutoff
        params["limit"] = limit
        if before_id:
            params["bid"] = before_id
            result = await session.execute(text(f"""
                SELECT m.id, m.sender_id, m.sender_name, m.content, m.message_type, m.media_url, m.mention_ids, m.created_at, u.role, a.name AS sender_association, m.reply_to_id, m.reply_to_sender_name, m.reply_to_content, m.reply_to_type
                FROM chat_messages m
                LEFT JOIN users u ON u.id = m.sender_id
                LEFT JOIN associations a ON a.id = m.association_id
                WHERE {where}
                  AND m.created_at >= :cutoff
                  AND m.created_at < (SELECT created_at FROM chat_messages WHERE id = :bid)
                ORDER BY m.created_at DESC
                LIMIT :limit
            """), params)
        else:
            result = await session.execute(text(f"""
                SELECT m.id, m.sender_id, m.sender_name, m.content, m.message_type, m.media_url, m.mention_ids, m.created_at, u.role, a.name AS sender_association, m.reply_to_id, m.reply_to_sender_name, m.reply_to_content, m.reply_to_type
                FROM chat_messages m
                LEFT JOIN users u ON u.id = m.sender_id
                LEFT JOIN associations a ON a.id = m.association_id
                WHERE {where}
                  AND m.created_at >= :cutoff
                ORDER BY m.created_at DESC
                LIMIT :limit
            """), params)
        rows = result.fetchall()
    return [_row_to_dict(r) for r in reversed(rows)]


@router.get("/messages/since")
async def messages_since(
    since: str = Query(...),
    current: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    try:
        since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
    except ValueError:
        since_dt = datetime.now(timezone.utc) - timedelta(minutes=1)
    async with AsyncSessionLocal() as session:
        where, params = await _assoc_filter(str(current.association_id), session)
        params["since"] = since_dt
        result = await session.execute(text(f"""
            SELECT m.id, m.sender_id, m.sender_name, m.content, m.message_type, m.media_url, m.mention_ids, m.created_at, u.role, a.name AS sender_association
            FROM chat_messages m
            LEFT JOIN users u ON u.id = m.sender_id
            LEFT JOIN associations a ON a.id = m.association_id
            WHERE {where}
              AND m.created_at > :since
            ORDER BY m.created_at ASC
            LIMIT 200
        """), params)
        rows = result.fetchall()
    return [_row_to_dict(r) for r in rows]


@router.post("/mark-read")
async def mark_read(
    current: CurrentUser = Depends(get_current_user),
) -> dict:
    """Mark all messages in the group as read by the current user (excluding own messages)."""
    async with AsyncSessionLocal() as session:
        where, params = await _assoc_filter(str(current.association_id), session)
        params["uid"] = str(current.user_id)
        name_row = await session.execute(
            text("SELECT full_name FROM users WHERE id = :uid"), {"uid": str(current.user_id)}
        )
        user_name = name_row.scalar() or "Usuário"
        params["uname"] = user_name
        await session.execute(text(f"""
            INSERT INTO chat_message_reads (message_id, user_id, user_name, read_at)
            SELECT m.id, :uid, :uname, NOW()
            FROM chat_messages m
            WHERE {where}
              AND (m.sender_id IS NULL OR m.sender_id != :uid)
            ON CONFLICT (message_id, user_id) DO NOTHING
        """), params)
        await session.commit()
    return {"ok": True}


@router.get("/reads")
async def get_reads(
    current: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    """Returns readers per message for the last 15 days."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    async with AsyncSessionLocal() as session:
        where, params = await _assoc_filter(str(current.association_id), session)
        params["cutoff"] = cutoff
        rows = await session.execute(text(f"""
            SELECT r.message_id, r.user_name, r.user_id
            FROM chat_message_reads r
            JOIN chat_messages m ON m.id = r.message_id
            WHERE {where}
              AND m.created_at >= :cutoff
            ORDER BY r.read_at ASC
        """), params)
        reads: dict[str, list[dict]] = {}
        for r in rows.fetchall():
            mid = str(r[0])
            if mid not in reads:
                reads[mid] = []
            reads[mid].append({"name": r[1], "user_id": str(r[2])})
    return [{"message_id": mid, "readers": readers} for mid, readers in reads.items()]


@router.get("/unread-count")
async def unread_count(
    since: str = Query(...),
    current: CurrentUser = Depends(get_current_user),
) -> dict:
    try:
        since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
    except ValueError:
        since_dt = datetime.now(timezone.utc) - timedelta(minutes=5)
    async with AsyncSessionLocal() as session:
        where, params = await _assoc_filter(str(current.association_id), session)
        params["since"] = since_dt
        params["sender"] = str(current.user_id)
        result = await session.execute(text(f"""
            SELECT COUNT(*) FROM chat_messages m
            WHERE {where}
              AND m.created_at > :since
              AND (m.sender_id IS NULL OR m.sender_id != :sender)
        """), params)
        count = result.scalar() or 0
    return {"count": int(count)}


@router.post("/messages")
async def send_message(
    body: MessageRequest,
    current: CurrentUser = Depends(get_current_user),
) -> dict:
    if not body.content and not body.media_url:
        raise HTTPException(400, "Mensagem sem conteúdo")
    import asyncio as _aio
    reply_sender: str | None = None
    reply_content: str | None = None
    reply_type: str | None = None
    for attempt in range(3):
        try:
            async with AsyncSessionLocal() as session:
                name_row = await session.execute(
                    text("SELECT full_name FROM users WHERE id = :uid"),
                    {"uid": str(current.user_id)},
                )
                sender_name = name_row.scalar() or "Usuário"
                if body.reply_to_id:
                    ref = (await session.execute(
                        text("SELECT sender_name, content, message_type FROM chat_messages WHERE id = :rid"),
                        {"rid": body.reply_to_id},
                    )).fetchone()
                    if ref:
                        reply_sender = ref[0]
                        reply_content = ref[1]
                        reply_type = ref[2]
                result = await session.execute(text("""
                    INSERT INTO chat_messages
                        (association_id, sender_id, sender_name, content, message_type, media_url, mention_ids,
                         reply_to_id, reply_to_sender_name, reply_to_content, reply_to_type)
                    VALUES (:assoc, :sender, :name, :content, :mtype, :media, CAST(:mentions AS jsonb),
                            :reply_id, :reply_sender, :reply_content, :reply_type)
                    RETURNING id, created_at
                """), {
                    "assoc": str(current.association_id),
                    "sender": str(current.user_id),
                    "name": sender_name,
                    "content": body.content,
                    "mtype": body.message_type,
                    "media": body.media_url,
                    "mentions": json.dumps(body.mention_ids),
                    "reply_id": body.reply_to_id,
                    "reply_sender": reply_sender,
                    "reply_content": reply_content,
                    "reply_type": reply_type,
                })
                row = result.fetchone()
                await session.commit()
            break
        except Exception:
            if attempt == 2:
                raise
            await _aio.sleep(0.1 * (attempt + 1))

    import asyncio
    from app.routers.notifications import create_notification

    preview = (body.content or "")[:100]

    # notify all active users in the chat_group (or just the association if no group)
    async with AsyncSessionLocal() as ns:
        group = await _get_chat_group(str(current.association_id), ns)
        if group:
            other_users = (await ns.execute(text("""
                SELECT id FROM users
                WHERE association_id IN (SELECT id FROM associations WHERE chat_group = :group)
                  AND is_active = true AND id != :sender
            """), {"group": group, "sender": str(current.user_id)})).fetchall()
        else:
            other_users = (await ns.execute(text("""
                SELECT id FROM users
                WHERE association_id = :assoc AND is_active = true AND id != :sender
            """), {"assoc": str(current.association_id), "sender": str(current.user_id)})).fetchall()

    mentioned = set(body.mention_ids)
    for (uid,) in other_users:
        uid_str = str(uid)
        title = f"💬 {sender_name} mencionou você" if uid_str in mentioned else f"💬 {sender_name}"
        await create_notification(
            str(current.association_id), uid_str, title, preview, "chat",
        )

    return {
        "id": str(row[0]),
        "sender_id": str(current.user_id),
        "sender_name": sender_name,
        "content": body.content,
        "message_type": body.message_type,
        "media_url": body.media_url,
        "mention_ids": body.mention_ids,
        "created_at": row[1].isoformat(),
        "reply_to_id": body.reply_to_id,
        "reply_to_sender_name": reply_sender,
        "reply_to_content": reply_content,
        "reply_to_type": reply_type,
    }


@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: str,
    current: CurrentUser = Depends(get_current_user),
) -> dict:
    async with AsyncSessionLocal() as session:
        row = (await session.execute(
            text("SELECT sender_id FROM chat_messages WHERE id = :mid"),
            {"mid": message_id},
        )).fetchone()
        if not row:
            raise HTTPException(404, "Mensagem não encontrada")
        if str(row[0]) != str(current.user_id) and current.role not in ("admin", "superadmin", "admin_master"):
            raise HTTPException(403, "Sem permissão para apagar esta mensagem")
        await session.execute(
            text("DELETE FROM chat_messages WHERE id = :mid"),
            {"mid": message_id},
        )
        await session.commit()
    return {"deleted": message_id}


@router.get("/users")
async def list_users(
    current: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(text("""
            SELECT id, full_name
            FROM users
            WHERE association_id = :assoc AND is_active = true
            ORDER BY full_name
        """), {"assoc": str(current.association_id)})
        return [{"id": str(r[0]), "name": r[1]} for r in result.fetchall()]


async def post_system_message(association_id: str, content: str, session) -> None:
    """Called from other routers to post automated chat messages."""
    await session.execute(text("""
        INSERT INTO chat_messages (association_id, sender_id, sender_name, content, message_type)
        VALUES (:assoc, NULL, 'Sistema', :content, 'system')
    """), {"assoc": association_id, "content": content})
