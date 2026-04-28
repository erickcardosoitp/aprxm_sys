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


def _row_to_dict(r) -> dict:
    return {
        "id": str(r[0]),
        "sender_id": str(r[1]) if r[1] else None,
        "sender_name": r[2],
        "content": r[3],
        "message_type": r[4],
        "media_url": r[5],
        "mention_ids": r[6] or [],
        "created_at": r[7].isoformat() if r[7] else None,
    }


@router.get("/messages")
async def list_messages(
    before_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    current: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    async with AsyncSessionLocal() as session:
        if before_id:
            result = await session.execute(text("""
                SELECT id, sender_id, sender_name, content, message_type, media_url, mention_ids, created_at
                FROM chat_messages
                WHERE association_id = :assoc
                  AND created_at >= :cutoff
                  AND created_at < (SELECT created_at FROM chat_messages WHERE id = :bid)
                ORDER BY created_at DESC
                LIMIT :limit
            """), {"assoc": str(current.association_id), "cutoff": cutoff, "bid": before_id, "limit": limit})
        else:
            result = await session.execute(text("""
                SELECT id, sender_id, sender_name, content, message_type, media_url, mention_ids, created_at
                FROM chat_messages
                WHERE association_id = :assoc
                  AND created_at >= :cutoff
                ORDER BY created_at DESC
                LIMIT :limit
            """), {"assoc": str(current.association_id), "cutoff": cutoff, "limit": limit})
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
        result = await session.execute(text("""
            SELECT id, sender_id, sender_name, content, message_type, media_url, mention_ids, created_at
            FROM chat_messages
            WHERE association_id = :assoc
              AND created_at > :since
            ORDER BY created_at ASC
            LIMIT 200
        """), {"assoc": str(current.association_id), "since": since_dt})
        rows = result.fetchall()
    return [_row_to_dict(r) for r in rows]


@router.post("/messages")
async def send_message(
    body: MessageRequest,
    current: CurrentUser = Depends(get_current_user),
) -> dict:
    if not body.content and not body.media_url:
        raise HTTPException(400, "Mensagem sem conteúdo")
    async with AsyncSessionLocal() as session:
        name_row = await session.execute(
            text("SELECT full_name FROM users WHERE id = :uid"),
            {"uid": str(current.user_id)},
        )
        sender_name = name_row.scalar() or "Usuário"
        result = await session.execute(text("""
            INSERT INTO chat_messages
                (association_id, sender_id, sender_name, content, message_type, media_url, mention_ids)
            VALUES (:assoc, :sender, :name, :content, :mtype, :media, :mentions::jsonb)
            RETURNING id, created_at
        """), {
            "assoc": str(current.association_id),
            "sender": str(current.user_id),
            "name": sender_name,
            "content": body.content,
            "mtype": body.message_type,
            "media": body.media_url,
            "mentions": json.dumps(body.mention_ids),
        })
        row = result.fetchone()
        await session.commit()

    # notify mentioned users
    if body.mention_ids:
        import asyncio
        from app.routers.notifications import create_notification
        preview = (body.content or "")[:100]
        for uid in body.mention_ids:
            asyncio.create_task(create_notification(
                str(current.association_id), uid,
                f"💬 {sender_name} mencionou você",
                preview, "mention",
            ))

    return {
        "id": str(row[0]),
        "sender_id": str(current.user_id),
        "sender_name": sender_name,
        "content": body.content,
        "message_type": body.message_type,
        "media_url": body.media_url,
        "mention_ids": body.mention_ids,
        "created_at": row[1].isoformat(),
    }


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
