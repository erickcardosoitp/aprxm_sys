from uuid import UUID

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session
from app.models.package import Package, PackageStatus
from app.models.resident import Resident
from app.services.package_service import PackageService

router = APIRouter(prefix="/packages", tags=["Encomendas"])


class ReceivePackageRequest(BaseModel):
    resident_id: UUID | None = None
    unit: str | None = None
    block: str | None = None
    carrier_name: str | None = None
    tracking_code: str | None = None
    object_type: str | None = None
    photo_urls: list[dict] = []
    notes: str | None = None
    deliverer_name: str | None = None
    deliverer_signature_url: str | None = None


class AddPackageEventRequest(BaseModel):
    event_type: str = "comment"
    comment: str | None = None
    attachment_url: str | None = None
    attachment_name: str | None = None


class DeliverPackageRequest(BaseModel):
    delivered_to_name: str
    signature_url: str
    delivered_to_cpf: str | None = None
    delivered_to_resident_id: UUID | None = None
    # anti-fraud
    proof_of_residence_url: str
    recipient_id_photo_url: str | None = None
    delivery_person_name: str | None = None


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
        carrier_name=body.carrier_name,
        tracking_code=body.tracking_code,
        object_type=body.object_type,
        notes=body.notes,
        deliverer_name=body.deliverer_name,
        deliverer_signature_url=body.deliverer_signature_url,
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
        proof_of_residence_url=body.proof_of_residence_url,
        recipient_id_photo_url=body.recipient_id_photo_url,
        delivery_person_name=body.delivery_person_name,
    )
    return {
        "id": str(pkg.id),
        "status": pkg.status,
        "has_delivery_fee": pkg.has_delivery_fee,
        "delivery_fee_amount": str(pkg.delivery_fee_amount) if pkg.delivery_fee_amount else None,
        "delivered_at": str(pkg.delivered_at),
    }


@router.post("/{package_id}/events", summary="Adicionar evento / comentário na encomenda")
async def add_package_event(
    package_id: UUID,
    body: AddPackageEventRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        text("""
            INSERT INTO package_events
              (association_id, package_id, created_by, event_type, comment, attachment_url, attachment_name)
            VALUES (:assoc_id, :pkg_id, :user_id, :etype, :comment, :att_url, :att_name)
            RETURNING id, created_at
        """),
        {
            "assoc_id": str(current.association_id),
            "pkg_id": str(package_id),
            "user_id": str(current.user_id),
            "etype": body.event_type,
            "comment": body.comment,
            "att_url": body.attachment_url,
            "att_name": body.attachment_name,
        },
    )
    row = result.fetchone()
    await session.commit()
    return {"id": str(row[0]), "created_at": str(row[1])}


@router.get("/{package_id}/events", summary="Listar eventos da encomenda")
async def list_package_events(
    package_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    result = await session.execute(
        text("""
            SELECT e.id, e.event_type, e.comment, e.attachment_url, e.attachment_name,
                   e.created_at, u.full_name
            FROM package_events e
            JOIN users u ON u.id = e.created_by
            WHERE e.package_id = :pkg_id AND e.association_id = :assoc_id
            ORDER BY e.created_at ASC
        """),
        {"pkg_id": str(package_id), "assoc_id": str(current.association_id)},
    )
    rows = result.fetchall()
    return [
        {
            "id": str(r[0]), "event_type": r[1], "comment": r[2],
            "attachment_url": r[3], "attachment_name": r[4],
            "created_at": str(r[5]), "author_name": r[6],
        }
        for r in rows
    ]


@router.get("", summary="Listar encomendas")
async def list_packages(
    status: PackageStatus | None = None,
    q: str | None = None,
    cpf: str | None = None,
    cep: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    stmt = (
        select(Package, Resident)
        .outerjoin(Resident, Package.resident_id == Resident.id)
        .where(Package.association_id == current.association_id)
    )
    if status:
        stmt = stmt.where(Package.status == status)
    if date_from:
        from datetime import datetime as dt
        stmt = stmt.where(Package.received_at >= dt.fromisoformat(date_from))
    if date_to:
        from datetime import datetime as dt
        stmt = stmt.where(Package.received_at <= dt.fromisoformat(date_to))
    stmt = stmt.order_by(Package.received_at.desc())
    result = await session.execute(stmt)
    rows = result.all()
    out = []
    for p, r in rows:
        rname = r.full_name if r else None
        rcpf = r.cpf if r else None
        rcep = r.address_cep if r else None
        if q and not (q.lower() in (rname or "").lower() or q.lower() in (p.tracking_code or "").lower()):
            continue
        if cpf and (rcpf or "").replace(".", "").replace("-", "") != cpf.replace(".", "").replace("-", ""):
            continue
        if cep and (rcep or "").replace("-", "") != cep.replace("-", ""):
            continue
        out.append({
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
            "resident_name": rname,
            "resident_cpf": rcpf,
            "resident_type": r.type if r else None,
            "resident_cep": rcep,
            "resident_phone": r.phone_primary if r else None,
            "photo_urls": p.photo_urls or [],
            "notes": p.notes,
            "object_type": p.object_type,
            "sender_name": p.sender_name,
            "delivered_to_name": p.delivered_to_name,
            "delivered_to_cpf": p.delivered_to_cpf,
            "deliverer_name": p.deliverer_name,
            "signature_url": p.signature_url,
            "proof_of_residence_url": getattr(p, 'proof_of_residence_url', None),
            "deliverer_signature_url": p.deliverer_signature_url,
            "delivered_at": str(p.delivered_at) if p.delivered_at else None,
        })
    return out


@router.get("/cep/{cep}", summary="Consultar endereço por CEP (proxy ViaCEP)")
async def lookup_cep(cep: str) -> dict:
    clean = cep.replace("-", "").strip()
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(f"https://viacep.com.br/ws/{clean}/json/")
    data = resp.json()
    if data.get("erro"):
        return {}
    return {
        "street": data.get("logradouro", ""),
        "district": data.get("bairro", ""),
        "city": data.get("localidade", ""),
        "state": data.get("uf", ""),
    }
