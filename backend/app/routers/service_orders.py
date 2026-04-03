from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session
from app.models.service_order import ServiceOrderPriority, ServiceOrderStatus
from app.services.service_order_service import ServiceOrderService

router = APIRouter(prefix="/service-orders", tags=["Ordens de Serviço"])


class CreateSORequest(BaseModel):
    title: str
    description: str
    priority: ServiceOrderPriority = ServiceOrderPriority.medium
    area: str | None = None
    unit: str | None = None
    block: str | None = None
    location_detail: str | None = None
    requester_resident_id: UUID | None = None
    requester_name: str | None = None
    requester_phone: str | None = None
    requester_email: str | None = None
    service_impacted: str | None = None
    category_name: str | None = None
    org_responsible: str | None = None
    reference_point: str | None = None
    request_date: datetime | None = None
    address_cep: str | None = None
    use_requester_address: bool = False


class UpdateSORequest(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: ServiceOrderPriority | None = None
    area: str | None = None
    location_detail: str | None = None
    service_impacted: str | None = None
    category_name: str | None = None
    org_responsible: str | None = None
    reference_point: str | None = None
    address_cep: str | None = None
    assigned_to: UUID | None = None
    requester_name: str | None = None
    requester_phone: str | None = None
    requester_email: str | None = None


class UpdateStatusRequest(BaseModel):
    status: ServiceOrderStatus
    notes: str | None = None
    resolution_notes: str | None = None
    cancellation_reason: str | None = None


class AddCommentRequest(BaseModel):
    comment: str
    attachment_urls: list[str] = []


@router.post("", summary="Criar Ordem de Serviço")
async def create_so(
    body: CreateSORequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = ServiceOrderService(session)
    so = await svc.create(
        association_id=current.association_id,
        created_by=current.user_id,
        **body.model_dump(),
    )
    return {"id": str(so.id), "number": so.number, "status": so.status}


@router.put("/{so_id}", summary="Atualizar dados da OS")
async def update_so(
    so_id: UUID,
    body: UpdateSORequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = ServiceOrderService(session)
    so = await svc.update(so_id, current.association_id, body.model_dump(exclude_none=True))
    return {"id": str(so.id), "number": so.number, "status": so.status}


@router.patch("/{so_id}/status", summary="Atualizar status da OS")
async def update_status(
    so_id: UUID,
    body: UpdateStatusRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = ServiceOrderService(session)
    so = await svc.update_status(
        so_id=so_id,
        association_id=current.association_id,
        new_status=body.status,
        changed_by=current.user_id,
        notes=body.notes,
        resolution_notes=body.resolution_notes,
        cancellation_reason=body.cancellation_reason,
    )
    return {"id": str(so.id), "number": so.number, "status": so.status}


@router.post("/{so_id}/comments", summary="Adicionar comentário / atualização na OS")
async def add_comment(
    so_id: UUID,
    body: AddCommentRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    import json
    result = await session.execute(
        text("""
            INSERT INTO service_order_comments
              (service_order_id, association_id, created_by, comment, attachment_urls)
            VALUES (:so_id, :assoc_id, :user_id, :comment, CAST(:attachments AS jsonb))
            RETURNING id, created_at
        """),
        {
            "so_id": str(so_id),
            "assoc_id": str(current.association_id),
            "user_id": str(current.user_id),
            "comment": body.comment,
            "attachments": json.dumps(body.attachment_urls),
        },
    )
    row = result.fetchone()
    await session.commit()
    return {"id": str(row[0]), "created_at": str(row[1])}


@router.get("/{so_id}/comments", summary="Listar comentários da OS")
async def list_comments(
    so_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    result = await session.execute(
        text("""
            SELECT c.id, c.comment, c.attachment_urls, c.created_at,
                   u.full_name as author_name
            FROM service_order_comments c
            JOIN users u ON u.id = c.created_by
            WHERE c.service_order_id = :so_id
              AND c.association_id = :assoc_id
            ORDER BY c.created_at ASC
        """),
        {"so_id": str(so_id), "assoc_id": str(current.association_id)},
    )
    rows = result.fetchall()
    return [
        {
            "id": str(r[0]),
            "comment": r[1],
            "attachment_urls": r[2] or [],
            "created_at": str(r[3]),
            "author_name": r[4],
        }
        for r in rows
    ]


@router.get("/{so_id}", summary="Detalhar OS")
async def get_so(
    so_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from app.models.service_order import ServiceOrder
    from sqlmodel import select
    result = await session.execute(
        select(ServiceOrder).where(
            ServiceOrder.id == so_id,
            ServiceOrder.association_id == current.association_id,
        )
    )
    so = result.scalar_one_or_none()
    if not so:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="OS não encontrada.")
    return {
        "id": str(so.id), "number": so.number, "title": so.title,
        "description": so.description, "status": so.status, "priority": so.priority,
        "area": so.area, "unit": so.unit, "block": so.block,
        "location_detail": so.location_detail,
        "service_impacted": so.service_impacted,
        "category_name": so.category_name,
        "org_responsible": so.org_responsible,
        "requester_name": so.requester_name, "requester_phone": so.requester_phone,
        "requester_email": so.requester_email,
        "reference_point": so.reference_point,
        "address_cep": so.address_cep,
        "use_requester_address": so.use_requester_address,
        "resolution_notes": so.resolution_notes, "resolved_at": str(so.resolved_at) if so.resolved_at else None,
        "cancellation_reason": so.cancellation_reason,
        "attachments": so.attachments or [],
        "created_at": str(so.created_at), "updated_at": str(so.updated_at),
        "assigned_to": str(so.assigned_to) if so.assigned_to else None,
        "requester_resident_id": str(so.requester_resident_id) if so.requester_resident_id else None,
        "request_date": str(so.request_date) if so.request_date else None,
    }


@router.get("/{so_id}/pdf", summary="Gerar PDF do Ofício")
async def generate_pdf(
    so_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    svc = ServiceOrderService(session)
    pdf_bytes = await svc.generate_pdf(so_id, current.association_id)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="OS-{so_id}.pdf"'},
    )


@router.get("", summary="Listar Ordens de Serviço")
async def list_sos(
    status: ServiceOrderStatus | None = None,
    priority: ServiceOrderPriority | None = None,
    q: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    svc = ServiceOrderService(session)
    sos = await svc.list(current.association_id, status)
    result = []
    for s in sos:
        if priority and s.priority != priority:
            continue
        if q:
            ql = q.lower()
            if ql not in (s.title or "").lower() and ql not in (s.requester_name or "").lower():
                continue
        result.append({
            "id": str(s.id),
            "number": s.number,
            "title": s.title,
            "description": s.description,
            "status": s.status,
            "priority": s.priority,
            "area": s.area,
            "service_impacted": s.service_impacted,
            "category_name": s.category_name,
            "requester_name": s.requester_name,
            "requester_phone": s.requester_phone,
            "unit": s.unit,
            "block": s.block,
            "created_at": str(s.created_at),
            "assigned_to": str(s.assigned_to) if s.assigned_to else None,
        })
    return result
