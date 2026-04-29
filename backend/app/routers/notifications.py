from __future__ import annotations

import json
import asyncio
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from app.config import get_settings
from app.core.tenant import CurrentUser, get_current_user
from app.database import AsyncSessionLocal, get_session
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/notifications", tags=["Notificações"])


class PushSubscriptionRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


class NotificationIn(BaseModel):
    title: str
    body: str
    type: str = "info"
    data: dict = {}


# ─── Push helpers ─────────────────────────────────────────────────────────────

def _raw_b64_to_pem(raw_b64: str) -> str:
    import base64
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption
    raw = base64.urlsafe_b64decode(raw_b64 + "==")
    key = ec.derive_private_key(int.from_bytes(raw, "big"), ec.SECP256R1(), default_backend())
    return key.private_bytes(Encoding.PEM, PrivateFormat.TraditionalOpenSSL, NoEncryption()).decode()


def _send_push_sync(endpoint: str, p256dh: str, auth: str, payload: dict) -> None:
    import logging
    try:
        from pywebpush import webpush, WebPushException
        s = get_settings()
        if not s.vapid_private_key:
            logging.error("PUSH: vapid_private_key não configurado")
            return
        pem_key = _raw_b64_to_pem(s.vapid_private_key)
        webpush(
            subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
            data=json.dumps(payload),
            vapid_private_key=pem_key,
            vapid_claims={"sub": s.vapid_claims_sub},
        )
        logging.info("PUSH: enviado com sucesso para %s", endpoint[:50])
    except Exception as e:
        logging.error("PUSH ERROR: %s", str(e))


async def send_push_to_user(user_id: str, title: str, body: str, data: dict | None = None) -> None:
    async with AsyncSessionLocal() as session:
        rows = (await session.execute(text("""
            SELECT endpoint, p256dh, auth FROM push_subscriptions
            WHERE user_id = :uid
            ORDER BY created_at DESC LIMIT 3
        """), {"uid": user_id})).fetchall()

    payload = {"title": title, "body": body, "data": data or {}}
    loop = asyncio.get_running_loop()
    for r in rows:
        await loop.run_in_executor(None, _send_push_sync, r[0], r[1], r[2], payload)


async def create_notification(
    association_id: str,
    user_id: str,
    title: str,
    body: str,
    notif_type: str = "info",
    data: dict | None = None,
    session=None,
) -> None:
    use_session = session is not None
    s = session if use_session else AsyncSessionLocal()
    try:
        if not use_session:
            s = AsyncSessionLocal()
            await s.__aenter__()
        await s.execute(text("""
            INSERT INTO notifications (association_id, user_id, title, body, type, data)
            VALUES (:aid, :uid, :title, :body, :type, CAST(:data AS jsonb))
        """), {
            "aid": association_id, "uid": user_id,
            "title": title, "body": body, "type": notif_type,
            "data": json.dumps(data or {}),
        })
        if not use_session:
            await s.commit()
    finally:
        if not use_session:
            await s.__aexit__(None, None, None)

    await send_push_to_user(user_id, title, body, data)


# ─── Subscription endpoints ───────────────────────────────────────────────────

@router.post("/subscribe")
async def subscribe(
    body: PushSubscriptionRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    # Max 3 devices — remove oldest if exceeded
    count_row = (await session.execute(text(
        "SELECT COUNT(*) FROM push_subscriptions WHERE user_id = :uid"
    ), {"uid": str(current.user_id)})).scalar()

    if (count_row or 0) >= 3:
        await session.execute(text("""
            DELETE FROM push_subscriptions
            WHERE id = (
                SELECT id FROM push_subscriptions WHERE user_id = :uid
                ORDER BY created_at ASC LIMIT 1
            )
        """), {"uid": str(current.user_id)})

    await session.execute(text("""
        INSERT INTO push_subscriptions (user_id, association_id, endpoint, p256dh, auth)
        VALUES (:uid, :aid, :ep, :p256, :auth)
        ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = :p256, auth = :auth
    """), {
        "uid": str(current.user_id), "aid": str(current.association_id),
        "ep": body.endpoint, "p256": body.p256dh, "auth": body.auth,
    })
    await session.commit()
    return {"ok": True}


@router.delete("/subscribe")
async def unsubscribe(
    body: PushSubscriptionRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(text(
        "DELETE FROM push_subscriptions WHERE user_id = :uid AND endpoint = :ep"
    ), {"uid": str(current.user_id), "ep": body.endpoint})
    await session.commit()
    return {"ok": True}


@router.get("/vapid-public-key")
async def vapid_public_key() -> dict:
    return {"key": get_settings().vapid_public_key}


# ─── In-app notifications ─────────────────────────────────────────────────────

@router.get("")
async def list_notifications(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    rows = (await session.execute(text("""
        SELECT id, title, body, type, read_at, data, created_at
        FROM notifications
        WHERE user_id = :uid AND association_id = :aid
        ORDER BY created_at DESC
        LIMIT 50
    """), {"uid": str(current.user_id), "aid": str(current.association_id)})).fetchall()
    return [
        {
            "id": str(r[0]), "title": r[1], "body": r[2], "type": r[3],
            "read": r[4] is not None,
            "data": r[5] or {},
            "created_at": r[6].isoformat() if r[6] else None,
        }
        for r in rows
    ]


@router.get("/unread-count")
async def unread_count(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    count = (await session.execute(text("""
        SELECT COUNT(*) FROM notifications
        WHERE user_id = :uid AND association_id = :aid AND read_at IS NULL
    """), {"uid": str(current.user_id), "aid": str(current.association_id)})).scalar()
    return {"count": count or 0}


@router.patch("/{notif_id}/read")
async def mark_read(
    notif_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(text("""
        UPDATE notifications SET read_at = NOW()
        WHERE id = :id AND user_id = :uid
    """), {"id": str(notif_id), "uid": str(current.user_id)})
    await session.commit()
    return {"ok": True}


@router.patch("/read-all")
async def mark_all_read(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(text("""
        UPDATE notifications SET read_at = NOW()
        WHERE user_id = :uid AND association_id = :aid AND read_at IS NULL
    """), {"uid": str(current.user_id), "aid": str(current.association_id)})
    await session.commit()
    return {"ok": True}
