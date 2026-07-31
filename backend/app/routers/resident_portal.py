import json
import re
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.limiter import limiter
from app.core.resident_auth import CurrentResident, create_resident_token, get_current_resident
from app.core.security import hash_password, verify_password
from app.database import get_session
from app.services.moderation_service import moderate_post
from app.services.resident_notification_service import notify_resident
from app.services.storage_service import StorageService

router = APIRouter(prefix="/portal", tags=["Portal do Morador"])

_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
_MAX_IMAGE_SIZE = 8 * 1024 * 1024
_RESIDENT_CATEGORIES = {"solicitacao", "outro"}
_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.]{3,30}$")


async def _assert_username_available(session: AsyncSession, assoc_id: UUID, username: str, exclude_resident_id: UUID | None = None) -> None:
    if not _USERNAME_RE.match(username):
        raise HTTPException(422, "Nome de usuário deve ter 3-30 caracteres: letras, números, ponto ou underline.")
    row = (await session.execute(
        text("""
            SELECT id FROM residents
            WHERE association_id = :aid AND LOWER(username) = LOWER(:username)
              AND (CAST(:exclude AS uuid) IS NULL OR id != CAST(:exclude AS uuid))
        """),
        {"aid": assoc_id, "username": username, "exclude": str(exclude_resident_id) if exclude_resident_id else None},
    )).fetchone()
    if row:
        raise HTTPException(409, "Esse nome de usuário já está em uso.")


def _digits(value: str) -> str:
    return "".join(c for c in value if c.isdigit())


async def _find_association(session: AsyncSession, slug: str) -> UUID:
    row = (await session.execute(
        text("SELECT id FROM associations WHERE slug = :slug AND is_active = TRUE"),
        {"slug": slug},
    )).fetchone()
    if not row:
        raise HTTPException(404, "Associação não encontrada.")
    return row[0]


class SetSenhaRequest(BaseModel):
    full_name: str
    phone_primary: str
    cpf: str
    password: str
    username: str | None = None


class LoginRequest(BaseModel):
    login: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/{slug}/set-senha", response_model=TokenResponse, summary="Ativar/redefinir acesso do morador")
@limiter.limit("5/minute")
async def set_senha(
    request: Request,
    slug: str,
    body: SetSenhaRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    if len(body.password) < 6:
        raise HTTPException(422, "A senha deve ter pelo menos 6 caracteres.")

    assoc_id = await _find_association(session, slug)
    cpf_clean = _digits(body.cpf)
    if not cpf_clean:
        raise HTTPException(422, "CPF é obrigatório para ativar o acesso.")

    row = (await session.execute(
        text("""
            SELECT id, token_version FROM residents
            WHERE association_id = :aid
              AND TRIM(LOWER(full_name)) = TRIM(LOWER(:name))
              AND regexp_replace(COALESCE(phone_primary, ''), '\\D', '', 'g') = :phone
              AND cpf = :cpf
        """),
        {"aid": str(assoc_id), "name": body.full_name, "phone": _digits(body.phone_primary), "cpf": cpf_clean},
    )).fetchone()
    if not row:
        raise HTTPException(404, "Não encontramos um cadastro com esses dados. Confira nome, telefone e CPF.")

    if body.username:
        await _assert_username_available(session, assoc_id, body.username, exclude_resident_id=row[0])

    new_hash = hash_password(body.password)
    await session.execute(
        text("""
            UPDATE residents
            SET password_hash = :hash, token_version = token_version + 1, username = COALESCE(:username, username)
            WHERE id = :rid
        """),
        {"hash": new_hash, "rid": row[0], "username": body.username},
    )
    await session.commit()

    token = create_resident_token(row[0], assoc_id, body.full_name, row[1] + 1)
    return TokenResponse(access_token=token)


@router.post("/{slug}/login", response_model=TokenResponse, summary="Login do morador")
@limiter.limit("10/minute")
async def login(
    request: Request,
    slug: str,
    body: LoginRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    assoc_id = await _find_association(session, slug)
    login_value = body.login.strip()

    candidates = (await session.execute(
        text("""
            SELECT id, full_name, password_hash, token_version FROM residents
            WHERE association_id = :aid AND password_hash IS NOT NULL
              AND (
                TRIM(LOWER(full_name)) = TRIM(LOWER(:login))
                OR LOWER(email) = LOWER(:login)
                OR LOWER(username) = LOWER(:login)
              )
        """),
        {"aid": str(assoc_id), "login": login_value},
    )).fetchall()

    invalid = HTTPException(401, "Login ou senha incorretos.")
    for row in candidates:
        if verify_password(body.password, row[2]):
            token = create_resident_token(row[0], assoc_id, row[1], row[3])
            return TokenResponse(access_token=token)
    raise invalid


@router.get("/me", summary="Perfil do morador logado")
async def me(
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = (await session.execute(
        text("""
            SELECT r.full_name, r.type, r.status, r.email, r.phone_primary, r.phone_secondary,
                   r.address_street, r.address_number, r.address_complement, r.address_neighborhood,
                   r.address_city, r.address_state, r.address_cep, a.name AS association_name, r.username
            FROM residents r JOIN associations a ON a.id = r.association_id
            WHERE r.id = :rid
        """),
        {"rid": current.resident_id},
    )).fetchone()
    if not row:
        raise HTTPException(404, "Morador não encontrado.")
    return {
        "full_name": row[0], "type": row[1], "status": row[2], "email": row[3],
        "phone_primary": row[4], "phone_secondary": row[5],
        "address_street": row[6], "address_number": row[7], "address_complement": row[8],
        "address_neighborhood": row[9], "address_city": row[10], "address_state": row[11],
        "address_cep": row[12], "association_name": row[13], "username": row[14],
    }


class SetUsernameRequest(BaseModel):
    username: str


@router.patch("/me/username", summary="Definir/trocar nome de usuário")
async def definir_username(
    body: SetUsernameRequest,
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await _assert_username_available(session, current.association_id, body.username, exclude_resident_id=current.resident_id)
    await session.execute(
        text("UPDATE residents SET username = :username WHERE id = :rid"),
        {"username": body.username, "rid": current.resident_id},
    )
    await session.commit()
    return {"username": body.username}


@router.get("/encomendas", summary="Encomendas do morador logado")
async def minhas_encomendas(
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(
        text("""
            SELECT id, status, sender_name, carrier_name, object_type,
                   received_at, delivered_at, has_delivery_fee, delivery_fee_paid
            FROM packages
            WHERE resident_id = :rid AND association_id = :aid
            ORDER BY received_at DESC
            LIMIT 100
        """),
        {"rid": current.resident_id, "aid": current.association_id},
    )).fetchall()
    return [
        {
            "id": str(r[0]), "status": r[1], "sender_name": r[2], "carrier_name": r[3], "object_type": r[4],
            "received_at": r[5].isoformat() if r[5] else None,
            "delivered_at": r[6].isoformat() if r[6] else None,
            "has_delivery_fee": r[7], "delivery_fee_paid": r[8],
        }
        for r in rows
    ]


@router.get("/mensalidades", summary="Mensalidades do morador logado")
async def minhas_mensalidades(
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    rows = (await session.execute(
        text("""
            SELECT reference_month, due_date, amount, status, paid_at
            FROM mensalidades
            WHERE resident_id = :rid AND association_id = :aid
            ORDER BY reference_month DESC
            LIMIT 36
        """),
        {"rid": current.resident_id, "aid": current.association_id},
    )).fetchall()
    items = [
        {
            "reference_month": r[0], "due_date": r[1].isoformat() if r[1] else None,
            "amount": float(r[2]), "status": r[3], "paid_at": r[4].isoformat() if r[4] else None,
        }
        for r in rows
    ]
    em_aberto = [i for i in items if i["status"] in ("pending", "overdue")]
    return {
        "items": items,
        "total_em_aberto": round(sum(i["amount"] for i in em_aberto), 2),
        "quantidade_em_aberto": len(em_aberto),
    }


class NovoPostRequest(BaseModel):
    category: str
    title: str | None = None
    body: str
    image_urls: list[str] = []


def _post_row_to_dict(r) -> dict:
    return {
        "id": str(r[0]), "author_type": r[1], "author_name": r[2], "category": r[3],
        "title": r[4], "body": r[5], "image_urls": r[6] or [], "status": r[7],
        "moderation_reason": r[8], "pinned": r[9], "created_at": r[10].isoformat() if r[10] else None,
        "is_mine": r[11],
        "comment_count": r[12],
        "admin_reply": r[13], "admin_reply_at": r[14].isoformat() if r[14] else None,
        "like_count": r[15], "liked_by_me": r[16],
    }


@router.get("/feed", summary="Feed da comunidade")
async def listar_feed(
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Feed publico: so o que ja foi aprovado, de qualquer morador (inclusive
    voce mesmo). Pra ver seus proprios posts pendentes/reprovados/concluidos,
    use GET /portal/feed/mine."""
    rows = (await session.execute(
        text("""
            SELECT p.id, p.author_type, p.author_name, p.category, p.title, p.body,
                   p.image_urls, p.status, p.moderation_reason, p.pinned, p.created_at,
                   (p.author_resident_id = :rid) AS is_mine,
                   (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id),
                   p.admin_reply, p.admin_reply_at,
                   (SELECT COUNT(*) FROM community_post_likes l WHERE l.post_id = p.id),
                   EXISTS (SELECT 1 FROM community_post_likes l WHERE l.post_id = p.id AND l.resident_id = :rid)
            FROM community_posts p
            WHERE p.association_id = :aid AND p.status = 'approved'
            ORDER BY p.pinned DESC, p.created_at DESC
            LIMIT 60
        """),
        {"aid": current.association_id, "rid": current.resident_id},
    )).fetchall()
    return [_post_row_to_dict(r) for r in rows]


@router.get("/feed/mine", summary="Minhas publicações")
async def listar_meus_posts(
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Todos os posts do proprio morador, qualquer status (pending/approved/
    rejected/resolved/removed) — historico completo, diferente do feed publico."""
    rows = (await session.execute(
        text("""
            SELECT p.id, p.author_type, p.author_name, p.category, p.title, p.body,
                   p.image_urls, p.status, p.moderation_reason, p.pinned, p.created_at,
                   TRUE AS is_mine,
                   (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id),
                   p.admin_reply, p.admin_reply_at,
                   (SELECT COUNT(*) FROM community_post_likes l WHERE l.post_id = p.id),
                   EXISTS (SELECT 1 FROM community_post_likes l WHERE l.post_id = p.id AND l.resident_id = :rid)
            FROM community_posts p
            WHERE p.association_id = :aid AND p.author_resident_id = :rid
            ORDER BY p.created_at DESC
            LIMIT 100
        """),
        {"aid": current.association_id, "rid": current.resident_id},
    )).fetchall()
    return [_post_row_to_dict(r) for r in rows]


@router.post("/feed/{post_id}/like", summary="Curtir/descurtir um post")
async def curtir_post(
    post_id: UUID,
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    post = (await session.execute(
        text("""
            SELECT 1 FROM community_posts
            WHERE id = :pid AND association_id = :aid
              AND (status = 'approved' OR author_resident_id = :rid)
        """),
        {"pid": post_id, "aid": current.association_id, "rid": current.resident_id},
    )).fetchone()
    if not post:
        raise HTTPException(404, "Post não encontrado.")

    existing = (await session.execute(
        text("SELECT id FROM community_post_likes WHERE post_id = :pid AND resident_id = :rid"),
        {"pid": post_id, "rid": current.resident_id},
    )).fetchone()

    if existing:
        await session.execute(text("DELETE FROM community_post_likes WHERE id = :id"), {"id": existing[0]})
        liked = False
    else:
        await session.execute(
            text("INSERT INTO community_post_likes (post_id, resident_id) VALUES (:pid, :rid)"),
            {"pid": post_id, "rid": current.resident_id},
        )
        liked = True

    count = (await session.execute(
        text("SELECT COUNT(*) FROM community_post_likes WHERE post_id = :pid"), {"pid": post_id},
    )).scalar_one()
    await session.commit()
    return {"liked": liked, "like_count": count}


@router.post("/feed", summary="Publicar no feed")
@limiter.limit("10/minute")
async def criar_post(
    request: Request,
    body: NovoPostRequest,
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.category not in _RESIDENT_CATEGORIES:
        raise HTTPException(422, "Categoria inválida.")
    if not body.body.strip():
        raise HTTPException(422, "O texto do post é obrigatório.")
    if len(body.image_urls) > 4:
        raise HTTPException(422, "No máximo 4 imagens por post.")

    status_, reason, by_ai = await moderate_post(body.category, body.title, body.body)

    row = (await session.execute(
        text("SELECT full_name FROM residents WHERE id = :rid"),
        {"rid": current.resident_id},
    )).fetchone()
    author_name = row[0] if row else current.full_name

    result = (await session.execute(
        text("""
            INSERT INTO community_posts
                (association_id, author_type, author_resident_id, author_name,
                 category, title, body, image_urls, status, moderation_reason, moderated_by_ai)
            VALUES
                (:aid, 'resident', :rid, :author_name,
                 :category, :title, :body, CAST(:image_urls AS jsonb), :status, :reason, :by_ai)
            RETURNING id, created_at
        """),
        {
            "aid": current.association_id, "rid": current.resident_id, "author_name": author_name,
            "category": body.category, "title": body.title, "body": body.body,
            "image_urls": json.dumps(body.image_urls), "status": status_, "reason": reason, "by_ai": by_ai,
        },
    )).fetchone()
    await session.commit()

    return {
        "id": str(result[0]), "status": status_, "moderation_reason": reason,
        "created_at": result[1].isoformat(),
    }


@router.patch("/feed/{post_id}", summary="Editar o próprio post")
@limiter.limit("10/minute")
async def editar_post(
    request: Request,
    post_id: UUID,
    body: NovoPostRequest,
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.category not in _RESIDENT_CATEGORIES:
        raise HTTPException(422, "Categoria inválida.")
    if not body.body.strip():
        raise HTTPException(422, "O texto do post é obrigatório.")
    if len(body.image_urls) > 4:
        raise HTTPException(422, "No máximo 4 imagens por post.")

    post = (await session.execute(
        text("SELECT status FROM community_posts WHERE id = :pid AND association_id = :aid AND author_resident_id = :rid"),
        {"pid": post_id, "aid": current.association_id, "rid": current.resident_id},
    )).fetchone()
    if not post:
        raise HTTPException(404, "Post não encontrado.")

    if post[0] in ("resolved", "removed"):
        await session.execute(
            text("""
                UPDATE community_posts
                SET category = :category, title = :title, body = :body,
                    image_urls = CAST(:image_urls AS jsonb), updated_at = now()
                WHERE id = :pid
            """),
            {"pid": post_id, "category": body.category, "title": body.title, "body": body.body, "image_urls": json.dumps(body.image_urls)},
        )
        await session.commit()
        return {"id": str(post_id), "status": post[0], "moderation_reason": None}

    status_, reason, by_ai = await moderate_post(body.category, body.title, body.body)
    await session.execute(
        text("""
            UPDATE community_posts
            SET category = :category, title = :title, body = :body,
                image_urls = CAST(:image_urls AS jsonb), status = :status,
                moderation_reason = :reason, moderated_by_ai = :by_ai, updated_at = now()
            WHERE id = :pid
        """),
        {
            "pid": post_id, "category": body.category, "title": body.title, "body": body.body,
            "image_urls": json.dumps(body.image_urls), "status": status_, "reason": reason, "by_ai": by_ai,
        },
    )
    await session.commit()
    return {"id": str(post_id), "status": status_, "moderation_reason": reason}


@router.delete("/feed/{post_id}", summary="Excluir o próprio post")
async def excluir_post_proprio(
    post_id: UUID,
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        text("DELETE FROM community_posts WHERE id = :pid AND association_id = :aid AND author_resident_id = :rid"),
        {"pid": post_id, "aid": current.association_id, "rid": current.resident_id},
    )
    if result.rowcount == 0:
        raise HTTPException(404, "Post não encontrado.")
    await session.commit()
    return {"ok": True}


@router.post("/feed/upload", summary="Upload de imagem do post")
@limiter.limit("20/minute")
async def upload_imagem_post(
    request: Request,
    file: UploadFile = File(...),
    current: CurrentResident = Depends(get_current_resident),
) -> dict:
    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, "Tipo de arquivo não permitido. Use JPG, PNG ou WEBP.")
    file_bytes = await file.read()
    if len(file_bytes) > _MAX_IMAGE_SIZE:
        raise HTTPException(400, "Imagem muito grande (máx. 8 MB).")

    svc = StorageService(str(current.association_id))
    url = await svc.upload(file_bytes, file.filename or "post.jpg", "feed")
    return {"url": url}


@router.get("/feed/{post_id}/comments", summary="Comentários de um post")
async def listar_comentarios(
    post_id: UUID,
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    visible = (await session.execute(
        text("""
            SELECT 1 FROM community_posts
            WHERE id = :pid AND association_id = :aid
              AND (status = 'approved' OR author_resident_id = :rid)
        """),
        {"pid": post_id, "aid": current.association_id, "rid": current.resident_id},
    )).fetchone()
    if not visible:
        raise HTTPException(404, "Post não encontrado.")

    rows = (await session.execute(
        text("""
            SELECT c.id, c.author_name, c.body, c.created_at,
                   (SELECT COUNT(*) FROM community_comment_likes l WHERE l.comment_id = c.id),
                   EXISTS (SELECT 1 FROM community_comment_likes l WHERE l.comment_id = c.id AND l.resident_id = :rid),
                   (c.author_resident_id = :rid)
            FROM community_comments c
            WHERE c.post_id = :pid
            ORDER BY c.created_at
        """),
        {"pid": post_id, "rid": current.resident_id},
    )).fetchall()
    return [
        {
            "id": str(r[0]), "author_name": r[1], "body": r[2], "created_at": r[3].isoformat(),
            "like_count": r[4], "liked_by_me": r[5], "is_mine": r[6],
        }
        for r in rows
    ]


@router.post("/feed/comments/{comment_id}/like", summary="Curtir/descurtir um comentário")
async def curtir_comentario(
    comment_id: UUID,
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    comment = (await session.execute(
        text("""
            SELECT 1 FROM community_comments c
            JOIN community_posts p ON p.id = c.post_id
            WHERE c.id = :cid AND p.association_id = :aid
              AND (p.status = 'approved' OR p.author_resident_id = :rid)
        """),
        {"cid": comment_id, "aid": current.association_id, "rid": current.resident_id},
    )).fetchone()
    if not comment:
        raise HTTPException(404, "Comentário não encontrado.")

    existing = (await session.execute(
        text("SELECT id FROM community_comment_likes WHERE comment_id = :cid AND resident_id = :rid"),
        {"cid": comment_id, "rid": current.resident_id},
    )).fetchone()

    if existing:
        await session.execute(text("DELETE FROM community_comment_likes WHERE id = :id"), {"id": existing[0]})
        liked = False
    else:
        await session.execute(
            text("INSERT INTO community_comment_likes (comment_id, resident_id) VALUES (:cid, :rid)"),
            {"cid": comment_id, "rid": current.resident_id},
        )
        liked = True

    count = (await session.execute(
        text("SELECT COUNT(*) FROM community_comment_likes WHERE comment_id = :cid"), {"cid": comment_id},
    )).scalar_one()
    await session.commit()
    return {"liked": liked, "like_count": count}


class NovoComentarioRequest(BaseModel):
    body: str


@router.post("/feed/{post_id}/comments", summary="Comentar num post")
@limiter.limit("20/minute")
async def criar_comentario(
    request: Request,
    post_id: UUID,
    body: NovoComentarioRequest,
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if not body.body.strip():
        raise HTTPException(422, "O comentário não pode ser vazio.")

    post = (await session.execute(
        text("SELECT author_resident_id, title FROM community_posts WHERE id = :pid AND association_id = :aid AND status = 'approved'"),
        {"pid": post_id, "aid": current.association_id},
    )).fetchone()
    if not post:
        raise HTTPException(404, "Post não encontrado.")

    row = (await session.execute(
        text("SELECT full_name FROM residents WHERE id = :rid"),
        {"rid": current.resident_id},
    )).fetchone()
    author_name = row[0] if row else current.full_name

    result = (await session.execute(
        text("""
            INSERT INTO community_comments (post_id, association_id, author_type, author_resident_id, author_name, body)
            VALUES (:pid, :aid, 'resident', :rid, :author_name, :body)
            RETURNING id, created_at
        """),
        {"pid": post_id, "aid": current.association_id, "rid": current.resident_id, "author_name": author_name, "body": body.body},
    )).fetchone()

    post_author_id = post[0]
    if post_author_id and post_author_id != current.resident_id:
        await notify_resident(
            session, current.association_id, post_author_id, "comment",
            f"{author_name} comentou na sua publicação", body.body, post_id,
        )

    await session.commit()
    return {"id": str(result[0]), "author_name": author_name, "body": body.body, "created_at": result[1].isoformat()}


@router.delete("/feed/comments/{comment_id}", summary="Excluir o próprio comentário")
async def excluir_comentario_proprio(
    comment_id: UUID,
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        text("DELETE FROM community_comments WHERE id = :cid AND association_id = :aid AND author_resident_id = :rid"),
        {"cid": comment_id, "aid": current.association_id, "rid": current.resident_id},
    )
    if result.rowcount == 0:
        raise HTTPException(404, "Comentário não encontrado.")
    await session.commit()
    return {"ok": True}


@router.get("/notifications", summary="Notificações do morador")
async def listar_notificacoes(
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(
        text("""
            SELECT id, type, title, body, post_id, read_at, created_at
            FROM resident_notifications
            WHERE resident_id = :rid
            ORDER BY created_at DESC
            LIMIT 50
        """),
        {"rid": current.resident_id},
    )).fetchall()
    return [
        {
            "id": str(r[0]), "type": r[1], "title": r[2], "body": r[3],
            "post_id": str(r[4]) if r[4] else None,
            "read": r[5] is not None, "created_at": r[6].isoformat(),
        }
        for r in rows
    ]


@router.get("/notifications/unread-count", summary="Contagem de notificações não lidas")
async def contar_notificacoes_nao_lidas(
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    count = (await session.execute(
        text("SELECT COUNT(*) FROM resident_notifications WHERE resident_id = :rid AND read_at IS NULL"),
        {"rid": current.resident_id},
    )).scalar_one()
    return {"count": count}


@router.post("/notifications/{notification_id}/read", summary="Marcar notificação como lida")
async def marcar_notificacao_lida(
    notification_id: UUID,
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(
        text("UPDATE resident_notifications SET read_at = now() WHERE id = :id AND resident_id = :rid AND read_at IS NULL"),
        {"id": notification_id, "rid": current.resident_id},
    )
    await session.commit()
    return {"ok": True}


@router.post("/notifications/read-all", summary="Marcar todas as notificações como lidas")
async def marcar_todas_notificacoes_lidas(
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(
        text("UPDATE resident_notifications SET read_at = now() WHERE resident_id = :rid AND read_at IS NULL"),
        {"rid": current.resident_id},
    )
    await session.commit()
    return {"ok": True}


def _place_row_to_dict(r) -> dict:
    return {
        "id": str(r[0]), "category": r[1], "name": r[2], "description": r[3],
        "phone": r[4], "whatsapp": r[5], "address": r[6], "image_urls": r[7] or [],
        "avg_rating": round(float(r[8]), 1) if r[8] is not None else None,
        "rating_count": r[9], "my_rating": r[10],
    }


@router.get("/directory/places", summary="Diretório da comunidade")
async def listar_lugares(
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(
        text("""
            SELECT p.id, p.category, p.name, p.description, p.phone, p.whatsapp, p.address, p.image_urls,
                   AVG(r.stars), COUNT(r.id),
                   (SELECT stars FROM community_place_ratings mr WHERE mr.place_id = p.id AND mr.resident_id = :rid)
            FROM community_places p
            LEFT JOIN community_place_ratings r ON r.place_id = p.id
            WHERE p.association_id = :aid AND p.is_active = TRUE AND p.status = 'approved'
            GROUP BY p.id
            ORDER BY p.category, p.name
        """),
        {"aid": current.association_id, "rid": current.resident_id},
    )).fetchall()
    return [_place_row_to_dict(r) for r in rows]


def _my_place_row_to_dict(r) -> dict:
    return {
        "id": str(r[0]), "category": r[1], "name": r[2], "description": r[3],
        "phone": r[4], "whatsapp": r[5], "address": r[6], "image_urls": r[7] or [],
        "status": r[8], "moderation_reason": r[9], "is_active": r[10],
    }


@router.get("/directory/mine", summary="Meus cadastros no diretório")
async def listar_meus_lugares(
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(
        text("""
            SELECT id, category, name, description, phone, whatsapp, address, image_urls,
                   status, moderation_reason, is_active
            FROM community_places
            WHERE association_id = :aid AND owner_resident_id = :rid
            ORDER BY created_at DESC
        """),
        {"aid": current.association_id, "rid": current.resident_id},
    )).fetchall()
    return [_my_place_row_to_dict(r) for r in rows]


class NovoLugarMoradorRequest(BaseModel):
    category: str
    name: str
    description: str | None = None
    phone: str | None = None
    whatsapp: str | None = None
    address: str | None = None
    image_urls: list[str] = []


_PLACE_CATEGORIES = {"lanchonete", "restaurante", "mercado", "servico", "saude", "beleza", "educacao", "outro"}


@router.post("/directory/mine", summary="Cadastrar meu negócio/serviço no diretório")
@limiter.limit("5/minute")
async def criar_meu_lugar(
    request: Request,
    body: NovoLugarMoradorRequest,
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.category not in _PLACE_CATEGORIES:
        raise HTTPException(422, "Categoria inválida.")
    if not body.name.strip():
        raise HTTPException(422, "O nome é obrigatório.")
    if len(body.image_urls) > 4:
        raise HTTPException(422, "No máximo 4 imagens.")

    result = (await session.execute(
        text("""
            INSERT INTO community_places
                (association_id, owner_resident_id, category, name, description, phone, whatsapp, address, image_urls, status)
            VALUES (:aid, :rid, :category, :name, :description, :phone, :whatsapp, :address, CAST(:image_urls AS jsonb), 'pending')
            RETURNING id, created_at
        """),
        {
            "aid": current.association_id, "rid": current.resident_id, "category": body.category,
            "name": body.name.strip(), "description": body.description, "phone": body.phone,
            "whatsapp": body.whatsapp, "address": body.address, "image_urls": json.dumps(body.image_urls),
        },
    )).fetchone()
    await session.commit()
    return {"id": str(result[0]), "status": "pending", "created_at": result[1].isoformat()}


@router.patch("/directory/mine/{place_id}", summary="Editar meu cadastro no diretório")
async def editar_meu_lugar(
    place_id: UUID,
    body: NovoLugarMoradorRequest,
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.category not in _PLACE_CATEGORIES:
        raise HTTPException(422, "Categoria inválida.")
    if not body.name.strip():
        raise HTTPException(422, "O nome é obrigatório.")

    place = (await session.execute(
        text("SELECT 1 FROM community_places WHERE id = :pid AND association_id = :aid AND owner_resident_id = :rid"),
        {"pid": place_id, "aid": current.association_id, "rid": current.resident_id},
    )).fetchone()
    if not place:
        raise HTTPException(404, "Cadastro não encontrado.")

    await session.execute(
        text("""
            UPDATE community_places
            SET category = :category, name = :name, description = :description, phone = :phone,
                whatsapp = :whatsapp, address = :address, image_urls = CAST(:image_urls AS jsonb),
                status = 'pending', moderation_reason = NULL, updated_at = now()
            WHERE id = :pid
        """),
        {
            "pid": place_id, "category": body.category, "name": body.name.strip(), "description": body.description,
            "phone": body.phone, "whatsapp": body.whatsapp, "address": body.address,
            "image_urls": json.dumps(body.image_urls),
        },
    )
    await session.commit()
    return {"ok": True, "status": "pending"}


@router.delete("/directory/mine/{place_id}", summary="Excluir meu cadastro no diretório")
async def excluir_meu_lugar(
    place_id: UUID,
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        text("DELETE FROM community_places WHERE id = :pid AND association_id = :aid AND owner_resident_id = :rid"),
        {"pid": place_id, "aid": current.association_id, "rid": current.resident_id},
    )
    if result.rowcount == 0:
        raise HTTPException(404, "Cadastro não encontrado.")
    await session.commit()
    return {"ok": True}


@router.post("/directory/upload", summary="Upload de imagem do diretório")
@limiter.limit("20/minute")
async def upload_imagem_diretorio(
    request: Request,
    file: UploadFile = File(...),
    current: CurrentResident = Depends(get_current_resident),
) -> dict:
    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(400, "Tipo de arquivo não permitido. Use JPG, PNG ou WEBP.")
    file_bytes = await file.read()
    if len(file_bytes) > _MAX_IMAGE_SIZE:
        raise HTTPException(400, "Imagem muito grande (máx. 8 MB).")

    svc = StorageService(str(current.association_id))
    url = await svc.upload(file_bytes, file.filename or "directory.jpg", "directory")
    return {"url": url}


class AvaliarLugarRequest(BaseModel):
    stars: int


@router.post("/directory/places/{place_id}/rate", summary="Avaliar um lugar com estrelas")
async def avaliar_lugar(
    place_id: UUID,
    body: AvaliarLugarRequest,
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.stars < 1 or body.stars > 5:
        raise HTTPException(422, "A avaliação deve ser de 1 a 5 estrelas.")

    place = (await session.execute(
        text("SELECT 1 FROM community_places WHERE id = :pid AND association_id = :aid AND is_active = TRUE AND status = 'approved'"),
        {"pid": place_id, "aid": current.association_id},
    )).fetchone()
    if not place:
        raise HTTPException(404, "Lugar não encontrado.")

    await session.execute(
        text("""
            INSERT INTO community_place_ratings (place_id, resident_id, stars)
            VALUES (:pid, :rid, :stars)
            ON CONFLICT (place_id, resident_id) DO UPDATE SET stars = :stars, updated_at = now()
        """),
        {"pid": place_id, "rid": current.resident_id, "stars": body.stars},
    )
    await session.commit()

    agg = (await session.execute(
        text("SELECT AVG(stars), COUNT(*) FROM community_place_ratings WHERE place_id = :pid"),
        {"pid": place_id},
    )).fetchone()
    return {"avg_rating": round(float(agg[0]), 1) if agg[0] is not None else None, "rating_count": agg[1]}


class SugerirAtualizacaoRequest(BaseModel):
    changes: dict
    notes: str | None = None


@router.post("/directory/places/{place_id}/update-request", summary="Sugerir atualização de um lugar")
@limiter.limit("10/minute")
async def sugerir_atualizacao(
    request: Request,
    place_id: UUID,
    body: SugerirAtualizacaoRequest,
    current: CurrentResident = Depends(get_current_resident),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if not body.changes:
        raise HTTPException(422, "Informe ao menos um campo pra sugerir alteração.")

    place = (await session.execute(
        text("SELECT 1 FROM community_places WHERE id = :pid AND association_id = :aid AND status = 'approved'"),
        {"pid": place_id, "aid": current.association_id},
    )).fetchone()
    if not place:
        raise HTTPException(404, "Lugar não encontrado.")

    result = (await session.execute(
        text("""
            INSERT INTO community_place_update_requests (place_id, association_id, resident_id, changes, notes)
            VALUES (:pid, :aid, :rid, CAST(:changes AS jsonb), :notes)
            RETURNING id, created_at
        """),
        {
            "pid": place_id, "aid": current.association_id, "rid": current.resident_id,
            "changes": json.dumps(body.changes), "notes": body.notes,
        },
    )).fetchone()
    await session.commit()
    return {"id": str(result[0]), "created_at": result[1].isoformat()}
