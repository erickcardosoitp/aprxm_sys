import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user, require_conferente
from app.database import get_session
from app.services.resident_notification_service import notify_resident

router = APIRouter(prefix="/directory", tags=["Diretório da Comunidade"])

_VALID_CATEGORIES = {"lanchonete", "restaurante", "mercado", "servico", "saude", "beleza", "educacao", "outro"}
_ALLOWED_CHANGE_FIELDS = {"name", "description", "phone", "whatsapp", "address"}


async def _scoped_association_ids(current: CurrentUser, session: AsyncSession) -> list[UUID]:
    if current.is_empresa_wide and current.empresa_id is not None:
        rows = (await session.execute(
            text("SELECT id FROM associations WHERE empresa_id = :eid"),
            {"eid": str(current.empresa_id)},
        )).fetchall()
        return [r[0] for r in rows]
    return current.scoped_ids()


def _place_row_to_dict(r) -> dict:
    return {
        "id": str(r[0]), "association_id": str(r[1]), "category": r[2], "name": r[3],
        "description": r[4], "phone": r[5], "whatsapp": r[6], "address": r[7],
        "image_urls": r[8] or [], "is_active": r[9],
        "avg_rating": round(float(r[10]), 1) if r[10] is not None else None,
        "rating_count": r[11], "status": r[12], "moderation_reason": r[13],
        "owner_resident_name": r[14],
    }


@router.get("/places", summary="Listar lugares cadastrados (staff)")
async def listar_lugares(
    status_filter: str | None = Query(default=None, alias="status"),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    where = ["p.association_id = ANY(:aids)"]
    params: dict = {"aids": await _scoped_association_ids(current, session)}
    if status_filter:
        where.append("p.status = :status")
        params["status"] = status_filter

    rows = (await session.execute(
        text(f"""
            SELECT p.id, p.association_id, p.category, p.name, p.description, p.phone,
                   p.whatsapp, p.address, p.image_urls, p.is_active,
                   AVG(r.stars), COUNT(r.id), p.status, p.moderation_reason, res.full_name
            FROM community_places p
            LEFT JOIN community_place_ratings r ON r.place_id = p.id
            LEFT JOIN residents res ON res.id = p.owner_resident_id
            WHERE {' AND '.join(where)}
            GROUP BY p.id, res.full_name
            ORDER BY (p.status = 'pending') DESC, p.name
        """),
        params,
    )).fetchall()
    return [_place_row_to_dict(r) for r in rows]


class NovoLugarRequest(BaseModel):
    association_id: UUID
    category: str
    name: str
    description: str | None = None
    phone: str | None = None
    whatsapp: str | None = None
    address: str | None = None
    image_urls: list[str] = []


@router.post("/places", summary="Cadastrar novo lugar (staff)")
async def criar_lugar(
    body: NovoLugarRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.category not in _VALID_CATEGORIES:
        raise HTTPException(422, "Categoria inválida.")
    if not body.name.strip():
        raise HTTPException(422, "O nome é obrigatório.")
    if body.association_id not in await _scoped_association_ids(current, session):
        raise HTTPException(403, "Sem acesso a essa associação.")

    result = (await session.execute(
        text("""
            INSERT INTO community_places
                (association_id, category, name, description, phone, whatsapp, address, image_urls, created_by)
            VALUES (:aid, :category, :name, :description, :phone, :whatsapp, :address, CAST(:image_urls AS jsonb), :uid)
            RETURNING id, created_at
        """),
        {
            "aid": body.association_id, "category": body.category, "name": body.name.strip(),
            "description": body.description, "phone": body.phone, "whatsapp": body.whatsapp,
            "address": body.address, "image_urls": json.dumps(body.image_urls), "uid": current.user_id,
        },
    )).fetchone()
    await session.commit()
    return {"id": str(result[0]), "created_at": result[1].isoformat()}


class EditarLugarRequest(BaseModel):
    category: str
    name: str
    description: str | None = None
    phone: str | None = None
    whatsapp: str | None = None
    address: str | None = None
    image_urls: list[str] = []
    is_active: bool = True


@router.patch("/places/{place_id}", summary="Editar lugar (staff)")
async def editar_lugar(
    place_id: UUID,
    body: EditarLugarRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.category not in _VALID_CATEGORIES:
        raise HTTPException(422, "Categoria inválida.")
    if not body.name.strip():
        raise HTTPException(422, "O nome é obrigatório.")

    place = (await session.execute(
        text("SELECT association_id FROM community_places WHERE id = :pid"),
        {"pid": place_id},
    )).fetchone()
    if not place:
        raise HTTPException(404, "Lugar não encontrado.")
    if place[0] not in await _scoped_association_ids(current, session):
        raise HTTPException(403, "Sem acesso a essa associação.")

    await session.execute(
        text("""
            UPDATE community_places
            SET category = :category, name = :name, description = :description, phone = :phone,
                whatsapp = :whatsapp, address = :address, image_urls = CAST(:image_urls AS jsonb),
                is_active = :is_active, updated_at = now()
            WHERE id = :pid
        """),
        {
            "pid": place_id, "category": body.category, "name": body.name.strip(), "description": body.description,
            "phone": body.phone, "whatsapp": body.whatsapp, "address": body.address,
            "image_urls": json.dumps(body.image_urls), "is_active": body.is_active,
        },
    )
    await session.commit()
    return {"ok": True}


class ModerarLugarRequest(BaseModel):
    status: str
    reason: str | None = None


@router.patch("/places/{place_id}/moderate", summary="Aprovar/reprovar cadastro enviado por morador (staff)")
async def moderar_lugar(
    place_id: UUID,
    body: ModerarLugarRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.status not in ("approved", "rejected"):
        raise HTTPException(422, "Status inválido.")

    place = (await session.execute(
        text("SELECT association_id, owner_resident_id, name FROM community_places WHERE id = :pid"),
        {"pid": place_id},
    )).fetchone()
    if not place:
        raise HTTPException(404, "Lugar não encontrado.")
    if place[0] not in await _scoped_association_ids(current, session):
        raise HTTPException(403, "Sem acesso a essa associação.")

    await session.execute(
        text("UPDATE community_places SET status = :status, moderation_reason = :reason, updated_at = now() WHERE id = :pid"),
        {"status": body.status, "reason": body.reason, "pid": place_id},
    )

    if place[1]:
        title = "Seu cadastro foi aprovado!" if body.status == "approved" else "Seu cadastro não foi aprovado"
        msg = f"\"{place[2]}\" já está visível no diretório da comunidade." if body.status == "approved" else (body.reason or "Revise as informações e tente novamente.")
        await notify_resident(session, place[0], place[1], "directory_listing", title, msg)

    await session.commit()
    return {"ok": True}


@router.delete("/places/{place_id}", summary="Excluir lugar (staff)")
async def excluir_lugar(
    place_id: UUID,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    place = (await session.execute(
        text("SELECT association_id FROM community_places WHERE id = :pid"),
        {"pid": place_id},
    )).fetchone()
    if not place:
        raise HTTPException(404, "Lugar não encontrado.")
    if place[0] not in await _scoped_association_ids(current, session):
        raise HTTPException(403, "Sem acesso a essa associação.")

    await session.execute(text("DELETE FROM community_places WHERE id = :pid"), {"pid": place_id})
    await session.commit()
    return {"ok": True}


@router.get("/update-requests", summary="Fila de sugestões de atualização (staff)")
async def listar_solicitacoes(
    status_filter: str | None = Query(default="pending", alias="status"),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    where = ["u.association_id = ANY(:aids)"]
    params: dict = {"aids": await _scoped_association_ids(current, session)}
    if status_filter:
        where.append("u.status = :status")
        params["status"] = status_filter

    rows = (await session.execute(
        text(f"""
            SELECT u.id, u.place_id, p.name, u.changes, u.notes, u.status, u.created_at, res.full_name
            FROM community_place_update_requests u
            JOIN community_places p ON p.id = u.place_id
            JOIN residents res ON res.id = u.resident_id
            WHERE {' AND '.join(where)}
            ORDER BY u.created_at DESC
            LIMIT 100
        """),
        params,
    )).fetchall()
    return [
        {
            "id": str(r[0]), "place_id": str(r[1]), "place_name": r[2], "changes": r[3],
            "notes": r[4], "status": r[5], "created_at": r[6].isoformat(), "resident_name": r[7],
        }
        for r in rows
    ]


class RevisarSolicitacaoRequest(BaseModel):
    status: str


@router.patch("/update-requests/{request_id}", summary="Aprovar/reprovar sugestão de atualização (staff)")
async def revisar_solicitacao(
    request_id: UUID,
    body: RevisarSolicitacaoRequest,
    current: CurrentUser = Depends(require_conferente),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if body.status not in ("approved", "rejected"):
        raise HTTPException(422, "Status inválido.")

    row = (await session.execute(
        text("""
            SELECT u.association_id, u.place_id, u.changes, u.resident_id, u.status
            FROM community_place_update_requests u
            WHERE u.id = :rid
        """),
        {"rid": request_id},
    )).fetchone()
    if not row:
        raise HTTPException(404, "Solicitação não encontrada.")
    if row[4] != "pending":
        raise HTTPException(422, "Essa solicitação já foi revisada.")
    if row[0] not in await _scoped_association_ids(current, session):
        raise HTTPException(403, "Sem acesso a essa associação.")

    assoc_id, place_id, changes, resident_id = row[0], row[1], row[2], row[3]

    if body.status == "approved":
        safe_changes = {k: v for k, v in changes.items() if k in _ALLOWED_CHANGE_FIELDS}
        if safe_changes:
            sets = ", ".join(f"{k} = :{k}" for k in safe_changes)
            await session.execute(
                text(f"UPDATE community_places SET {sets}, updated_at = now() WHERE id = :pid"),
                {**safe_changes, "pid": place_id},
            )

    await session.execute(
        text("""
            UPDATE community_place_update_requests
            SET status = :status, reviewed_by = :uid, reviewed_at = now()
            WHERE id = :rid
        """),
        {"status": body.status, "uid": current.user_id, "rid": request_id},
    )

    place_name = (await session.execute(
        text("SELECT name FROM community_places WHERE id = :pid"), {"pid": place_id},
    )).scalar_one()
    title = "Sugestão aprovada" if body.status == "approved" else "Sugestão não aprovada"
    body_msg = f"Sua sugestão de atualização para \"{place_name}\" foi {'aplicada' if body.status == 'approved' else 'recusada'}."
    await notify_resident(session, assoc_id, resident_id, "directory_update", title, body_msg)

    await session.commit()
    return {"ok": True}
