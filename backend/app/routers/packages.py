from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session
from app.models.package import Package, PackageStatus
from app.models.resident import Resident
from app.services.package_service import PackageService

router = APIRouter(prefix="/packages", tags=["Encomendas"])


class ReceivePackageRequest(BaseModel):
    unit: str
    block: str | None = None
    resident_id: UUID | None = None
    sender_name: str | None = None
    carrier_name: str | None = None
    tracking_code: str | None = None
    object_type: str | None = None
    # [{url, label, taken_at}]
    photo_urls: list[dict] = []
    notes: str | None = None


class DeliverPackageRequest(BaseModel):
    delivered_to_name: str
    signature_url: str
    delivered_to_cpf: str | None = None
    delivered_to_resident_id: UUID | None = None


@router.post("", summary="Registrar recebimento de encomenda")
async def receive_package(
    body: ReceivePackageRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = PackageService(session)
    pkg = await svc.receive_package(
        association_id=current.association_id,
        received_by=current.user_id,
        unit=body.unit,
        block=body.block,
        photo_urls=body.photo_urls,
        resident_id=body.resident_id,
        sender_name=body.sender_name,
        carrier_name=body.carrier_name,
        tracking_code=body.tracking_code,
        object_type=body.object_type,
        notes=body.notes,
    )
    return {"id": str(pkg.id), "status": pkg.status, "received_at": str(pkg.received_at)}


@router.post("/{package_id}/deliver", summary="Registrar entrega de encomenda")
async def deliver_package(
    package_id: UUID,
    body: DeliverPackageRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = PackageService(session)
    pkg = await svc.deliver_package(
        package_id=package_id,
        association_id=current.association_id,
        delivered_by=current.user_id,
        delivered_to_name=body.delivered_to_name,
        signature_url=body.signature_url,
        delivered_to_cpf=body.delivered_to_cpf,
        delivered_to_resident_id=body.delivered_to_resident_id,
    )
    return {
        "id": str(pkg.id),
        "status": pkg.status,
        "has_delivery_fee": pkg.has_delivery_fee,
        "delivery_fee_amount": str(pkg.delivery_fee_amount) if pkg.delivery_fee_amount else None,
        "delivered_at": str(pkg.delivered_at),
    }


@router.get("", summary="Listar encomendas")
async def list_packages(
    status: PackageStatus | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    # Join packages with residents to get resident info
    stmt = (
        select(Package, Resident)
        .outerjoin(Resident, Package.resident_id == Resident.id)
        .where(Package.association_id == current.association_id)
    )
    if status:
        stmt = stmt.where(Package.status == status)
    stmt = stmt.order_by(Package.received_at.desc())
    result = await session.execute(stmt)
    rows = result.all()
    return [
        {
            "id": str(p.id),
            "status": p.status,
            "unit": p.unit,
            "block": p.block,
            "carrier_name": p.carrier_name,
            "tracking_code": p.tracking_code,
            "has_delivery_fee": p.has_delivery_fee,
            "delivery_fee_amount": str(p.delivery_fee_amount) if p.delivery_fee_amount else None,
            "received_at": str(p.received_at),
            "resident_id": str(p.resident_id) if p.resident_id else None,
            "resident_name": r.full_name if r else None,
            "resident_cep": r.address_cep if r else None,
            "resident_phone": r.phone_primary if r else None,
        }
        for p, r in rows
    ]
