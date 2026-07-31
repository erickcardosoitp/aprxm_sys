import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user, require_conferente
from app.database import get_session
from app.services.resident_notification_service import notify_resident

router = APIRouter(prefix="/community", tags=["Comunidade"])

_VALID_STATUS = {"pending", "approved", "rejected", "removed", "resolved"}
_VALID_CATEGORIES = {"anuncio", "aviso", "outro", "solicitacao"}


async def _scoped_association_ids(current: CurrentUser, session: AsyncSession) -> list[UUID]:
    """Mesma resolucao de escopo do financeiro (tenant.financeiro_scope): staff
    empresa-wide (ESC) enxerga todas as unidades da empresa, os demais só a(s)
    propria(s) associacao(oes) (scoped_ids)."""
    if current.is_empresa_wide and current.empresa_id is not None:
        rows = (await session.execute(
            text("SELECT id FROM associations WHERE empresa_id = :eid"),
            {"eid": str(current.empresa_id)},
        )).fetchall()
        return [r[0] for r in rows]
    return current.scoped_ids()


def _post_row_to_dict(r) -> dict:
    return {
        "id": str(r[0]), "association_id": str(r[1]), "author_type": r[2], "author_name": r[3],
        "category": r[4], "title": r[5], "body": r[6], "image_urls": r[7] or [], "status": r[8],
        "moderation_reason": r[9], "moderated_by_ai": r[10], "pinned": r[11],
        "created_at": r[12].isoformat() if r[12] else None,
        "comment_count": r[13],
        "admin_reply": r[14], "admin_reply_at": r[15].isoformat() if r[15] else None,
        "author_resident_id": str(r[16]) if r[16] else None,
        "like_count": r[17],
    }


@router.get("/posts", summary="Fila de posts da comunidade")
async def listar_posts(
    status_filter: str | None = Query(default=None, alias="status"),
    category: str | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    if status_filter and status_filter not in _VALID_STATUS:
        raise HTTPException(422, "Status inválido.")
    if category and category not in _VALID_CATEGORIES:
        raise HTTPException(422, "Categoria inválida.")

    where = ["p.association_id = ANY(:aids)"]
    params: dict = {"aids": await _scoped_association_ids(current, session)}
    if status_filter:
        where.append("p.status = :status")
        params["status"] = status_filter
    else:
        where.append("p.status NOT IN ('removed', 'resolved')")
    if category:
        where.append("p.category = :category")
        params["category"] = category

    rows = (await session.execute(
        text(f"""
            SELECT p.id, p.association_id, p.author_type, p.author_name, p.category, p.title, p.body,
                   p.image_urls, p.status, p.moderation_reason, p.moderated_by_ai, p.pinned, p.created_at,
                   (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id),
                   p.admin_reply, p.admin_reply_at, p.author_resident_id,
                   (SELECT COUNT(*) FROM community_post_likes l WHERE l.post_id = p.id)
            FROM community_posts p
            WHERE {' AND '.join(where)}
            ORDER BY p.pinned DESC, p.created_at DESC
            LIMIT 200
        """),
        params,
    )).fetchall()
    return [_post_row_to_dict(r) for r in rows]


_STAFF_BROADCAST_CATEGORIES = {"anuncio", "aviso"}


class NovoAvisoRequest(BaseModel):
    association_id: UUID
    category: str = "aviso"
    title: str | None = None
    body: str
    image_urls: list[str] = []
    pinned: bool = False


@router.post("/posts", summary="Publicar anúncio/aviso oficial (staff) — notifica todos os moradores")
async def criar_aviso(
    body: NovoAvisoRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.category not in _STAFF_BROADCAST_CATEGORIES:
        raise HTTPException(422, "Categoria inválida — use 'anuncio' ou 'aviso'.")
    if body.association_id not in await _scoped_association_ids(current, session):
        raise HTTPException(403, "Sem acesso a essa associação.")
    if not body.body.strip():
        raise HTTPException(422, "O texto é obrigatório.")

    author_name = current.association_name or "Administração"
    result = (await session.execute(
        text("""
            INSERT INTO community_posts
                (association_id, author_type, author_user_id, author_name,
                 category, title, body, image_urls, status, moderated_by_user_id, pinned)
            VALUES
                (:aid, 'staff', :uid, :author_name,
                 :category, :title, :body, CAST(:image_urls AS jsonb), 'approved', :uid, :pinned)
            RETURNING id, created_at
        """),
        {
            "aid": body.association_id, "uid": current.user_id, "author_name": author_name, "category": body.category,
            "title": body.title, "body": body.body, "image_urls": json.dumps(body.image_urls), "pinned": body.pinned,
        },
    )).fetchone()
    post_id = result[0]

    notif_title = "Novo aviso oficial" if body.category == "aviso" else "Novo anúncio"
    notif_body = (body.title or body.body)[:200]
    await session.execute(
        text("""
            INSERT INTO resident_notifications (association_id, resident_id, type, title, body, post_id)
            SELECT :aid, id, 'staff_broadcast', :ntitle, :nbody, :pid
            FROM residents WHERE association_id = :aid AND status = 'active'
        """),
        {"aid": body.association_id, "ntitle": notif_title, "nbody": notif_body, "pid": post_id},
    )

    await session.commit()
    return {"id": str(result[0]), "created_at": result[1].isoformat()}


class ModeratePostRequest(BaseModel):
    status: str
    reason: str | None = None


@router.patch("/posts/{post_id}/moderate", summary="Aprovar/reprovar/remover post (override do staff)")
async def moderar_post(
    post_id: UUID,
    body: ModeratePostRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.status not in _VALID_STATUS:
        raise HTTPException(422, "Status inválido.")

    post = (await session.execute(
        text("SELECT association_id, author_resident_id FROM community_posts WHERE id = :pid"),
        {"pid": post_id},
    )).fetchone()
    if not post:
        raise HTTPException(404, "Post não encontrado.")
    if post[0] not in await _scoped_association_ids(current, session):
        raise HTTPException(403, "Sem acesso a essa associação.")

    await session.execute(
        text("""
            UPDATE community_posts
            SET status = :status, moderation_reason = :reason, moderated_by_ai = FALSE,
                moderated_by_user_id = :uid, updated_at = now()
            WHERE id = :pid
        """),
        {"status": body.status, "reason": body.reason, "uid": current.user_id, "pid": post_id},
    )

    if body.status == "rejected" and post[1]:
        await notify_resident(
            session, post[0], post[1], "rejected",
            "Sua publicação não foi aprovada", body.reason, post_id,
        )
    elif body.status == "approved" and post[1]:
        await notify_resident(
            session, post[0], post[1], "approved",
            "Sua publicação foi aprovada", "Já está visível no feed da comunidade.", post_id,
        )

    await session.commit()
    return {"ok": True}


class ReplyPostRequest(BaseModel):
    reply: str
    mark_resolved: bool = False


@router.patch("/posts/{post_id}/reply", summary="Responder a um post (staff)")
async def responder_post(
    post_id: UUID,
    body: ReplyPostRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if not body.reply.strip():
        raise HTTPException(422, "A resposta não pode ser vazia.")

    post = (await session.execute(
        text("SELECT association_id, author_resident_id FROM community_posts WHERE id = :pid"),
        {"pid": post_id},
    )).fetchone()
    if not post:
        raise HTTPException(404, "Post não encontrado.")
    if post[0] not in await _scoped_association_ids(current, session):
        raise HTTPException(403, "Sem acesso a essa associação.")

    new_status_sql = ", status = 'resolved'" if body.mark_resolved else ""
    await session.execute(
        text(f"""
            UPDATE community_posts
            SET admin_reply = :reply, admin_reply_at = now(), admin_reply_by = :uid,
                updated_at = now()
                {new_status_sql}
            WHERE id = :pid
        """),
        {"reply": body.reply, "uid": current.user_id, "pid": post_id},
    )

    if post[1]:
        title = "Sua solicitação foi concluída" if body.mark_resolved else "Você recebeu uma resposta da administração"
        await notify_resident(session, post[0], post[1], "admin_reply", title, body.reply, post_id)

    await session.commit()
    return {"ok": True}


@router.delete("/posts/{post_id}", summary="Excluir post definitivamente (staff)")
async def excluir_post(
    post_id: UUID,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    post = (await session.execute(
        text("SELECT association_id FROM community_posts WHERE id = :pid"),
        {"pid": post_id},
    )).fetchone()
    if not post:
        raise HTTPException(404, "Post não encontrado.")
    if post[0] not in await _scoped_association_ids(current, session):
        raise HTTPException(403, "Sem acesso a essa associação.")

    await session.execute(text("DELETE FROM community_posts WHERE id = :pid"), {"pid": post_id})
    await session.commit()
    return {"ok": True}


class PurgePostsRequest(BaseModel):
    older_than_days: int = 30
    statuses: list[str] = ["removed", "resolved"]


@router.post("/posts/purge", summary="Limpar posts antigos em lote (staff)")
async def limpar_posts_antigos(
    body: PurgePostsRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.older_than_days < 1:
        raise HTTPException(422, "Informe pelo menos 1 dia.")
    invalid = set(body.statuses) - _VALID_STATUS
    if invalid or not body.statuses:
        raise HTTPException(422, f"Status inválido(s): {invalid or 'nenhum status informado'}.")

    result = await session.execute(
        text("""
            DELETE FROM community_posts
            WHERE association_id = ANY(:aids)
              AND status = ANY(:statuses)
              AND created_at < now() - make_interval(days => :days)
        """),
        {"aids": await _scoped_association_ids(current, session), "statuses": body.statuses, "days": body.older_than_days},
    )
    await session.commit()
    return {"deleted": result.rowcount}


@router.get("/posts/{post_id}/comments", summary="Comentários de um post (staff)")
async def listar_comentarios_staff(
    post_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    post = (await session.execute(
        text("SELECT association_id FROM community_posts WHERE id = :pid"),
        {"pid": post_id},
    )).fetchone()
    if not post or post[0] not in await _scoped_association_ids(current, session):
        raise HTTPException(404, "Post não encontrado.")

    rows = (await session.execute(
        text("""
            SELECT c.id, c.author_name, c.body, c.created_at,
                   (SELECT COUNT(*) FROM community_comment_likes l WHERE l.comment_id = c.id)
            FROM community_comments c WHERE c.post_id = :pid ORDER BY c.created_at
        """),
        {"pid": post_id},
    )).fetchall()
    return [{"id": str(r[0]), "author_name": r[1], "body": r[2], "created_at": r[3].isoformat(), "like_count": r[4]} for r in rows]


@router.delete("/comments/{comment_id}", summary="Remover comentário (staff)")
async def remover_comentario(
    comment_id: UUID,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = (await session.execute(
        text("SELECT association_id FROM community_comments WHERE id = :cid"),
        {"cid": comment_id},
    )).fetchone()
    if not row:
        raise HTTPException(404, "Comentário não encontrado.")
    if row[0] not in await _scoped_association_ids(current, session):
        raise HTTPException(403, "Sem acesso a essa associação.")

    await session.execute(text("DELETE FROM community_comments WHERE id = :cid"), {"cid": comment_id})
    await session.commit()
    return {"ok": True}
