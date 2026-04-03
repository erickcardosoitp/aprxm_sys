from datetime import datetime
from io import BytesIO
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import func, select

from app.core.exceptions import NotFoundError, UnprocessableError
from app.models.service_order import (
    ServiceOrder,
    ServiceOrderHistory,
    ServiceOrderPriority,
    ServiceOrderStatus,
)


class ServiceOrderService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        association_id: UUID,
        created_by: UUID,
        title: str,
        description: str,
        priority: ServiceOrderPriority = ServiceOrderPriority.medium,
        area: str | None = None,
        unit: str | None = None,
        block: str | None = None,
        location_detail: str | None = None,
        requester_resident_id: UUID | None = None,
        requester_name: str | None = None,
        requester_phone: str | None = None,
        requester_email: str | None = None,
        service_impacted: str | None = None,
        category_name: str | None = None,
        org_responsible: str | None = None,
        reference_point: str | None = None,
        request_date: datetime | None = None,
        address_cep: str | None = None,
        use_requester_address: bool = False,
    ) -> ServiceOrder:
        number = await self._next_number(association_id)

        so = ServiceOrder(
            association_id=association_id,
            number=number,
            title=title,
            description=description,
            priority=priority,
            status=ServiceOrderStatus.pending,
            area=area,
            unit=unit,
            block=block,
            location_detail=location_detail,
            requester_resident_id=requester_resident_id,
            requester_user_id=created_by,
            requester_name=requester_name,
            requester_phone=requester_phone,
            requester_email=requester_email,
            service_impacted=service_impacted,
            category_name=category_name,
            org_responsible=org_responsible,
            reference_point=reference_point,
            request_date=request_date or datetime.utcnow(),
            address_cep=address_cep,
            use_requester_address=use_requester_address,
            created_by=created_by,
        )
        self._session.add(so)
        await self._session.flush()
        return so

    async def update(self, so_id: UUID, association_id: UUID, data: dict) -> ServiceOrder:
        so = await self._get(so_id, association_id)
        for k, v in data.items():
            if hasattr(so, k):
                setattr(so, k, v)
        so.updated_at = datetime.utcnow()
        self._session.add(so)
        await self._session.flush()
        return so

    async def update_status(
        self,
        so_id: UUID,
        association_id: UUID,
        new_status: ServiceOrderStatus,
        changed_by: UUID,
        notes: str | None = None,
        resolution_notes: str | None = None,
        cancellation_reason: str | None = None,
    ) -> ServiceOrder:
        so = await self._get(so_id, association_id)
        old_status = so.status

        if new_status == ServiceOrderStatus.resolved:
            if not resolution_notes:
                raise UnprocessableError("Notas de resolução são obrigatórias.")
            so.resolution_notes = resolution_notes
            so.resolved_at = datetime.utcnow()
        elif new_status == ServiceOrderStatus.cancelled:
            if not cancellation_reason:
                raise UnprocessableError("Motivo de cancelamento é obrigatório.")
            so.cancellation_reason = cancellation_reason
            so.cancelled_at = datetime.utcnow()
        elif new_status == ServiceOrderStatus.in_progress and so.assigned_to is None:
            so.assigned_to = changed_by
            so.assigned_at = datetime.utcnow()

        so.status = new_status
        so.updated_at = datetime.utcnow()
        self._session.add(so)

        history = ServiceOrderHistory(
            service_order_id=so.id,
            association_id=association_id,
            from_status=old_status,
            to_status=new_status,
            changed_by=changed_by,
            notes=notes,
        )
        self._session.add(history)
        await self._session.flush()
        return so

    async def generate_pdf(self, so_id: UUID, association_id: UUID) -> bytes:
        """Generate a PDF oficium for the service order using fpdf2."""
        from fpdf import FPDF  # type: ignore

        so = await self._get(so_id, association_id)

        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 16)
        pdf.cell(0, 10, f"OFÍCIO DE SERVIÇO Nº {so.number:04d}", ln=True, align="C")
        pdf.set_font("Helvetica", size=11)
        pdf.ln(4)
        pdf.multi_cell(0, 8, f"Título: {so.title}")
        pdf.multi_cell(0, 8, f"Área: {so.area or '—'}")
        pdf.multi_cell(0, 8, f"Prioridade: {so.priority.value.upper()}")
        pdf.multi_cell(0, 8, f"Unidade/Bloco: {so.unit or '—'} / {so.block or '—'}")
        pdf.ln(2)
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 8, "Descrição:", ln=True)
        pdf.set_font("Helvetica", size=11)
        pdf.multi_cell(0, 8, so.description)
        pdf.ln(4)
        pdf.set_font("Helvetica", size=9)
        pdf.cell(0, 6, f"Gerado em: {datetime.utcnow().strftime('%d/%m/%Y %H:%M')} UTC", ln=True)

        return bytes(pdf.output())

    async def list(
        self,
        association_id: UUID,
        status: ServiceOrderStatus | None = None,
    ) -> list[ServiceOrder]:
        stmt = select(ServiceOrder).where(ServiceOrder.association_id == association_id)
        if status:
            stmt = stmt.where(ServiceOrder.status == status)
        stmt = stmt.order_by(ServiceOrder.created_at.desc())
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def _get(self, so_id: UUID, association_id: UUID) -> ServiceOrder:
        stmt = select(ServiceOrder).where(
            ServiceOrder.id == so_id,
            ServiceOrder.association_id == association_id,
        )
        result = await self._session.execute(stmt)
        so = result.scalar_one_or_none()
        if not so:
            raise NotFoundError("Ordem de Serviço")
        return so

    async def _next_number(self, association_id: UUID) -> int:
        stmt = select(func.coalesce(func.max(ServiceOrder.number), 0)).where(
            ServiceOrder.association_id == association_id
        )
        result = await self._session.execute(stmt)
        return (result.scalar() or 0) + 1
