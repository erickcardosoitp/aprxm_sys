from uuid import UUID

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

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


class UpdateStatusRequest(BaseModel):
    status: ServiceOrderStatus
    notes: str | None = None
    resolution_notes: str | None = None
    cancellation_reason: str | None = None


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
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    svc = ServiceOrderService(session)
    sos = await svc.list(current.association_id, status)
    return [
        {
            "id": str(s.id),
            "number": s.number,
            "title": s.title,
            "status": s.status,
            "priority": s.priority,
            "area": s.area,
            "created_at": str(s.created_at),
        }
        for s in sos
    ]
