from datetime import date
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from fastapi import HTTPException
from app.core.exceptions import CashSessionError
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
    receive_batch_id: UUID | None = None


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
    proof_of_residence_url: str | None = None
    recipient_id_photo_url: str | None = None
    delivery_person_name: str | None = None
    third_party_pickup: bool = False
    owner_id_photo_url: str | None = None
    picker_id_photo_url: str | None = None
    picker_phone: str | None = None
    payment_method_id: UUID | None = None
    cash_session_id: UUID | None = None


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
        receive_batch_id=body.receive_batch_id,
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
    try:
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
            third_party_pickup=body.third_party_pickup,
            owner_id_photo_url=body.owner_id_photo_url,
            picker_id_photo_url=body.picker_id_photo_url,
            picker_phone=body.picker_phone,
            payment_method_id=body.payment_method_id,
            cash_session_id=body.cash_session_id,
        )
    except CashSessionError:
        raise HTTPException(status_code=422, detail="NO_SESSION")
    return {
        "id": str(pkg.id),
        "status": pkg.status,
        "has_delivery_fee": pkg.has_delivery_fee,
        "delivery_fee_amount": str(pkg.delivery_fee_amount) if pkg.delivery_fee_amount else None,
        "delivered_at": str(pkg.delivered_at),
    }


class BulkDeliverRequest(BaseModel):
    package_ids: list[UUID]
    delivered_to_name: str
    signature_url: str
    delivered_to_cpf: str | None = None
    proof_of_residence_url: str | None = None
    delivery_person_name: str | None = None
    third_party_pickup: bool = False
    owner_id_photo_url: str | None = None
    picker_id_photo_url: str | None = None
    picker_phone: str | None = None
    payment_method_id: UUID | None = None
    cash_session_id: UUID | None = None


@router.post("/bulk-deliver", summary="Entrega múltipla — mesma assinatura para N encomendas")
async def bulk_deliver_packages(
    body: BulkDeliverRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if not body.package_ids:
        from fastapi import HTTPException
        raise HTTPException(422, "Informe ao menos uma encomenda.")
    svc = PackageService(session)
    results = []
    errors = []
    fee_charged_residents: set[str] = set()
    for pkg_id in body.package_ids:
        try:
            # Peek resident to decide if fee was already charged this batch
            from app.models.package import Package as Pkg
            pkg_peek = await session.get(Pkg, pkg_id)
            resident_key = str(pkg_peek.resident_id) if pkg_peek and pkg_peek.resident_id else (body.delivered_to_cpf or body.delivered_to_name or str(pkg_id))
            skip_fee = resident_key in fee_charged_residents

            pkg = await svc.deliver_package(
                package_id=pkg_id,
                association_id=current.association_id,
                delivered_by=current.user_id,
                delivered_to_name=body.delivered_to_name,
                signature_url=body.signature_url,
                delivered_to_cpf=body.delivered_to_cpf,
                proof_of_residence_url=body.proof_of_residence_url,
                delivery_person_name=body.delivery_person_name,
                third_party_pickup=body.third_party_pickup,
                owner_id_photo_url=body.owner_id_photo_url,
                picker_id_photo_url=body.picker_id_photo_url,
                picker_phone=body.picker_phone,
                payment_method_id=body.payment_method_id,
                cash_session_id=body.cash_session_id,
                skip_fee=skip_fee,
            )
            if pkg.has_delivery_fee:
                fee_charged_residents.add(resident_key)
            results.append({
                "id": str(pkg.id),
                "has_delivery_fee": pkg.has_delivery_fee,
                "delivery_fee_amount": str(pkg.delivery_fee_amount) if pkg.delivery_fee_amount else None,
            })
        except Exception as e:
            errors.append({"id": str(pkg_id), "error": str(e)})
    await session.commit()
    return {"delivered": len(results), "errors": errors, "items": results}


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
    from sqlalchemy import text as sa_text
    filters = ["p.association_id = :aid"]
    params: dict = {"aid": str(current.association_id)}
    if status:
        filters.append("p.status = :status")
        params["status"] = status.value if hasattr(status, "value") else status
    if date_from:
        filters.append("p.received_at >= :date_from::date")
        params["date_from"] = date_from
    if date_to:
        filters.append("p.received_at < (:date_to::date + interval '1 day')")
        params["date_to"] = date_to
    where_clause = " AND ".join(filters)
    result = await session.execute(
        sa_text(f"""
            SELECT p.id, p.status, p.unit, p.block, p.carrier_name, p.tracking_code,
                   p.has_delivery_fee, p.delivery_fee_amount, p.received_at,
                   p.resident_id, p.photo_urls, p.notes, p.object_type,
                   p.sender_name, p.delivered_to_name, p.delivered_to_cpf,
                   p.deliverer_name, p.signature_url, p.deliverer_signature_url,
                   p.delivered_at, p.proof_of_residence_url,
                   r.full_name AS resident_name, r.cpf AS resident_cpf,
                   r.type AS resident_type, r.address_cep AS resident_cep,
                   r.phone_primary AS resident_phone,
                   r.address_street AS resident_address_street,
                   r.address_number AS resident_address_number,
                   u_rec.full_name AS received_by_name,
                   u_del.full_name AS delivered_by_name
            FROM packages p
            LEFT JOIN residents r ON r.id = p.resident_id
            LEFT JOIN users u_rec ON u_rec.id = p.received_by
            LEFT JOIN users u_del ON u_del.id = p.delivered_by
            WHERE {where_clause}
            ORDER BY p.received_at DESC
        """),
        params,
    )
    rows = result.fetchall()
    out = []
    for row in rows:
        rname = row[21]
        rcpf = row[22]
        rcep = row[24]
        if q and not (q.lower() in (rname or "").lower() or q.lower() in (row[5] or "").lower()):
            continue
        if cpf and (rcpf or "").replace(".", "").replace("-", "") != cpf.replace(".", "").replace("-", ""):
            continue
        if cep and (rcep or "").replace("-", "") != cep.replace("-", ""):
            continue
        out.append({
            "id": str(row[0]),
            "status": row[1],
            "unit": row[2],
            "block": row[3],
            "carrier_name": row[4],
            "tracking_code": row[5],
            "has_delivery_fee": row[6],
            "delivery_fee_amount": str(row[7]) if row[7] else None,
            "received_at": str(row[8]),
            "resident_id": str(row[9]) if row[9] else None,
            "photo_urls": row[10] or [],
            "notes": row[11],
            "object_type": row[12],
            "sender_name": row[13],
            "delivered_to_name": row[14],
            "delivered_to_cpf": row[15],
            "deliverer_name": row[16],
            "signature_url": row[17],
            "deliverer_signature_url": row[18],
            "delivered_at": str(row[19]) if row[19] else None,
            "proof_of_residence_url": row[20],
            "resident_name": rname,
            "resident_cpf": rcpf,
            "resident_type": row[23],
            "resident_cep": rcep,
            "resident_phone": row[25],
            "resident_address_street": row[26],
            "resident_address_number": row[27],
            "received_by_name": row[28],
            "delivered_by_name": row[29],
        })
    return out


class NotifyPackageRequest(BaseModel):
    message: str | None = None


class ReturnPackageRequest(BaseModel):
    reason: str


@router.post("/{package_id}/notify", summary="Marcar encomenda como notificada")
async def notify_package(
    package_id: UUID,
    body: NotifyPackageRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from datetime import datetime
    pkg = await session.get(Package, package_id)
    if not pkg or str(pkg.association_id) != str(current.association_id):
        from fastapi import HTTPException
        raise HTTPException(404, "Encomenda não encontrada.")
    pkg.status = PackageStatus.notified
    pkg.updated_at = datetime.utcnow()
    session.add(pkg)
    # register event
    await session.execute(
        text("""INSERT INTO package_events (association_id, package_id, created_by, event_type, comment)
                VALUES (:a, :p, :u, 'notification', :msg)"""),
        {"a": str(current.association_id), "p": str(package_id), "u": str(current.user_id),
         "msg": body.message or "Morador notificado da chegada da encomenda."},
    )
    await session.commit()
    return {"id": str(pkg.id), "status": pkg.status}


@router.post("/{package_id}/return", summary="Registrar devolução de encomenda")
async def return_package(
    package_id: UUID,
    body: ReturnPackageRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from datetime import datetime
    pkg = await session.get(Package, package_id)
    if not pkg or str(pkg.association_id) != str(current.association_id):
        from fastapi import HTTPException
        raise HTTPException(404, "Encomenda não encontrada.")
    pkg.status = PackageStatus.returned
    pkg.return_reason = body.reason
    pkg.returned_at = datetime.utcnow()
    pkg.updated_at = datetime.utcnow()
    session.add(pkg)
    await session.execute(
        text("""INSERT INTO package_events (association_id, package_id, created_by, event_type, comment)
                VALUES (:a, :p, :u, 'return', :msg)"""),
        {"a": str(current.association_id), "p": str(package_id), "u": str(current.user_id),
         "msg": f"Devolvida: {body.reason}"},
    )
    # Reverse delivery fee if one was charged
    if pkg.delivery_fee_tx_id:
        from app.services.finance_service import FinanceService
        try:
            svc = FinanceService(session)
            await svc.reverse_transaction(
                transaction_id=pkg.delivery_fee_tx_id,
                association_id=current.association_id,
                reversed_by=current.user_id,
                reason=f"Devolução da encomenda: {body.reason}",
            )
        except Exception:
            pass  # If reversal fails (e.g. no open session), skip silently
    await session.commit()
    return {"id": str(pkg.id), "status": pkg.status, "return_reason": pkg.return_reason}


class ReassignPackageRequest(BaseModel):
    resident_id: UUID


@router.patch("/{package_id}/reassign", summary="Alterar morador da encomenda")
async def reassign_package(
    package_id: UUID,
    body: ReassignPackageRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from datetime import datetime
    from fastapi import HTTPException

    pkg = await session.get(Package, package_id)
    if not pkg or str(pkg.association_id) != str(current.association_id):
        raise HTTPException(404, "Encomenda não encontrada.")
    if pkg.status == PackageStatus.delivered:
        raise HTTPException(422, "Encomenda já entregue não pode ser reatribuída.")

    resident = await session.get(Resident, body.resident_id)
    if not resident or str(resident.association_id) != str(current.association_id):
        raise HTTPException(404, "Morador não encontrado.")

    pkg.resident_id = body.resident_id
    pkg.unit = resident.unit or pkg.unit
    pkg.block = resident.block or pkg.block
    pkg.updated_at = datetime.utcnow()
    session.add(pkg)
    await session.execute(
        text("""INSERT INTO package_events (association_id, package_id, created_by, event_type, comment)
                VALUES (:a, :p, :u, 'comment', :msg)"""),
        {"a": str(current.association_id), "p": str(package_id), "u": str(current.user_id),
         "msg": f"Encomenda reatribuída para {resident.full_name}"},
    )
    await session.commit()
    return {"id": str(pkg.id), "resident_id": str(pkg.resident_id), "resident_name": resident.full_name}


class EditPackageInfoRequest(BaseModel):
    sender_name: str | None = None
    carrier_name: str | None = None
    tracking_code: str | None = None
    object_type: str | None = None
    notes: str | None = None


@router.patch("/{package_id}/info", summary="Editar informações da encomenda (admin+)")
async def edit_package_info(
    package_id: UUID,
    body: EditPackageInfoRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from fastapi import HTTPException
    from datetime import datetime
    if not current.is_admin:
        raise HTTPException(403, "Apenas admins podem editar informações da encomenda.")
    pkg = await session.get(Package, package_id)
    if not pkg or str(pkg.association_id) != str(current.association_id):
        raise HTTPException(404, "Encomenda não encontrada.")
    if body.sender_name is not None: pkg.sender_name = body.sender_name or None
    if body.carrier_name is not None: pkg.carrier_name = body.carrier_name or None
    if body.tracking_code is not None: pkg.tracking_code = body.tracking_code or None
    if body.object_type is not None: pkg.object_type = body.object_type or None
    if body.notes is not None: pkg.notes = body.notes or None
    pkg.updated_at = datetime.utcnow()
    session.add(pkg)
    await session.commit()
    return {"ok": True}


class EditDeliveryInfoRequest(BaseModel):
    delivered_to_name: str | None = None
    delivered_to_cpf: str | None = None
    delivery_person_name: str | None = None
    notes: str | None = None
    admin_password: str


@router.patch("/{package_id}/delivery-info", summary="Editar informações de entrega (conferente+)")
async def edit_delivery_info(
    package_id: UUID,
    body: EditDeliveryInfoRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from datetime import datetime
    from fastapi import HTTPException
    from app.core.security import verify_password
    from sqlmodel import select as sq_select
    from app.models.user import User

    pkg = await session.get(Package, package_id)
    if not pkg or str(pkg.association_id) != str(current.association_id):
        raise HTTPException(404, "Encomenda não encontrada.")
    if pkg.status != PackageStatus.delivered:
        raise HTTPException(422, "Só é possível editar encomendas já entregues.")

    # verify admin password
    result = await session.execute(sq_select(User).where(User.id == current.user_id))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.admin_password, user.hashed_password):
        raise HTTPException(403, "Senha incorreta.")

    if body.delivered_to_name is not None:
        pkg.delivered_to_name = body.delivered_to_name
    if body.delivered_to_cpf is not None:
        pkg.delivered_to_cpf = body.delivered_to_cpf or None
    if body.delivery_person_name is not None:
        pkg.delivery_person_name = body.delivery_person_name or None
    if body.notes is not None:
        pkg.notes = body.notes or None
    pkg.updated_at = datetime.utcnow()
    session.add(pkg)
    await session.execute(
        text("""INSERT INTO package_events (association_id, package_id, created_by, event_type, comment)
                VALUES (:a, :p, :u, 'comment', 'Informações de entrega editadas pelo conferente')"""),
        {"a": str(current.association_id), "p": str(package_id), "u": str(current.user_id)},
    )
    await session.commit()
    return {"ok": True}


class ReverseDeliveryRequest(BaseModel):
    reason: str
    admin_password: str


@router.post("/{package_id}/reverse-delivery", summary="Estornar entrega de encomenda")
async def reverse_delivery(
    package_id: UUID,
    body: ReverseDeliveryRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from datetime import datetime
    from fastapi import HTTPException
    from sqlmodel import select as sq_select
    from app.core.security import verify_password
    from app.models.user import User
    from app.services.finance_service import FinanceService

    # Verify admin password
    user_row = await session.execute(sq_select(User).where(User.id == current.user_id))
    user = user_row.scalar_one_or_none()
    if not user or not verify_password(body.admin_password, user.hashed_password):
        raise HTTPException(403, "Senha de administrador incorreta.")

    pkg = await session.get(Package, package_id)
    if not pkg or str(pkg.association_id) != str(current.association_id):
        raise HTTPException(404, "Encomenda não encontrada.")
    if pkg.status != PackageStatus.delivered:
        raise HTTPException(422, "Apenas encomendas entregues podem ser estornadas.")

    # Reverse fee transaction if exists — use original session, no need for open session
    if pkg.delivery_fee_tx_id:
        from sqlmodel import select as sq_select2
        from app.models.finance import Transaction as Tx
        svc = FinanceService(session)
        tx_row = await session.execute(sq_select2(Tx).where(Tx.id == pkg.delivery_fee_tx_id))
        fee_tx = tx_row.scalar_one_or_none()
        if fee_tx and not fee_tx.reversed_at:
            try:
                await svc.reverse_transaction(
                    transaction_id=pkg.delivery_fee_tx_id,
                    association_id=current.association_id,
                    reversed_by=current.user_id,
                    reason=f"Estorno de entrega: {body.reason}",
                    cash_session_id=fee_tx.cash_session_id,
                )
            except Exception:
                pass

    # Revert package to reversed status
    pkg.status = PackageStatus.reversed
    pkg.delivered_to_name = None
    pkg.delivered_to_cpf = None
    pkg.delivered_to_resident_id = None
    pkg.delivered_at = None
    pkg.delivered_by = None
    pkg.signature_url = None
    pkg.has_delivery_fee = False
    pkg.delivery_fee_amount = None
    pkg.delivery_fee_paid = False
    pkg.delivery_fee_tx_id = None
    pkg.updated_at = datetime.utcnow()
    session.add(pkg)

    await session.execute(
        text("""INSERT INTO package_events (association_id, package_id, created_by, event_type, comment)
                VALUES (:a, :p, :u, 'reversal', :msg)"""),
        {"a": str(current.association_id), "p": str(package_id), "u": str(current.user_id),
         "msg": f"Entrega estornada por {user.full_name}: {body.reason}"},
    )
    await session.commit()
    return {"id": str(pkg.id), "status": pkg.status}


@router.get("/counts", summary="Contagem de encomendas por status")
async def count_packages(
    q: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as sa_text
    filters = ["association_id = :aid"]
    params: dict = {"aid": str(current.association_id)}
    if q:
        filters.append("(tracking_code ILIKE :q OR unit ILIKE :q)")
        params["q"] = f"%{q}%"
    if date_from:
        filters.append("received_at >= :df::date")
        params["df"] = date_from
    if date_to:
        filters.append("received_at < (:dt::date + interval '1 day')")
        params["dt"] = date_to
    where = " AND ".join(filters)
    result = await session.execute(sa_text(f"""
        SELECT
          COUNT(*) FILTER (WHERE status = 'received')  AS received,
          COUNT(*) FILTER (WHERE status = 'notified')  AS notified,
          COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
          COUNT(*) FILTER (WHERE status = 'returned')  AS returned,
          COUNT(*) FILTER (WHERE status = 'reversed')  AS reversed,
          COUNT(*)                                      AS total
        FROM packages WHERE {where}
    """), params)
    r = result.fetchone()
    return {"received": r[0], "notified": r[1], "delivered": r[2], "returned": r[3], "reversed": r[4], "total": r[5]}


@router.get("/report", summary="Relatório de encomendas por período")
async def packages_report(
    date_from: str,
    date_to: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        text("""
            SELECT
              COUNT(*) FILTER (WHERE status = 'received')   AS received,
              COUNT(*) FILTER (WHERE status = 'notified')   AS notified,
              COUNT(*) FILTER (WHERE status = 'delivered')  AS delivered,
              COUNT(*) FILTER (WHERE status = 'returned')   AS returned,
              COUNT(*) FILTER (WHERE has_delivery_fee)      AS with_fee,
              COALESCE(SUM(delivery_fee_amount) FILTER (WHERE has_delivery_fee), 0) AS fee_total,
              COUNT(*) AS total
            FROM packages
            WHERE association_id = :aid
              AND received_at::date BETWEEN :df AND :dt
        """),
        {"aid": str(current.association_id), "df": date.fromisoformat(date_from), "dt": date.fromisoformat(date_to)},
    )
    r = result.fetchone()
    # by carrier
    carriers = await session.execute(
        text("""
            SELECT carrier_name, COUNT(*) FROM packages
            WHERE association_id = :aid AND received_at::date BETWEEN :df AND :dt
              AND carrier_name IS NOT NULL
            GROUP BY carrier_name ORDER BY 2 DESC LIMIT 10
        """),
        {"aid": str(current.association_id), "df": date.fromisoformat(date_from), "dt": date.fromisoformat(date_to)},
    )
    return {
        "period": {"from": date_from, "to": date_to},
        "total": r[6], "received": r[0], "notified": r[1],
        "delivered": r[2], "returned": r[3],
        "with_fee": r[4], "fee_total": str(r[5]),
        "by_carrier": [{"carrier": c[0], "count": c[1]} for c in carriers.fetchall()],
    }


@router.get("/resident/{resident_id}", summary="Encomendas de um morador")
async def packages_by_resident(
    resident_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    result = await session.execute(
        text("""
            SELECT id, status, carrier_name, tracking_code, received_at, delivered_at,
                   has_delivery_fee, delivery_fee_amount, return_reason
            FROM packages
            WHERE association_id = :aid AND resident_id = :rid
            ORDER BY received_at DESC LIMIT 50
        """),
        {"aid": str(current.association_id), "rid": str(resident_id)},
    )
    return [{"id": str(r[0]), "status": r[1], "carrier_name": r[2], "tracking_code": r[3],
             "received_at": str(r[4]), "delivered_at": str(r[5]) if r[5] else None,
             "has_delivery_fee": r[6], "fee": str(r[7]) if r[7] else None,
             "return_reason": r[8]} for r in result.fetchall()]


@router.get("/receive-history", summary="Histórico de recebimentos agrupado por lote ou unitário")
async def receive_history(
    limit: int = 50,
    offset: int = 0,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    result = await session.execute(text("""
        WITH batches AS (
            SELECT
                p.receive_batch_id::text              AS id,
                TRUE                                  AS is_bulk,
                MIN(p.received_at)                    AS received_at,
                u.full_name                           AS received_by_name,
                COUNT(*)::int                         AS count,
                (COUNT(*) FILTER (WHERE p.status = 'reversed'))::int AS reversed_count,
                json_agg(json_build_object(
                    'resident_name', COALESCE(r.full_name, CONCAT(p.unit, CASE WHEN p.block IS NOT NULL THEN ' Bl.' || p.block ELSE '' END)),
                    'unit', p.unit,
                    'block', p.block,
                    'tracking_code', p.tracking_code,
                    'carrier_name', p.carrier_name,
                    'status', p.status
                ) ORDER BY p.received_at) AS items
            FROM packages p
            JOIN users u ON u.id = p.received_by
            LEFT JOIN residents r ON r.id = p.resident_id
            WHERE p.association_id = :aid AND p.receive_batch_id IS NOT NULL
            GROUP BY p.receive_batch_id, u.full_name

            UNION ALL

            SELECT
                p.id::text                            AS id,
                FALSE                                 AS is_bulk,
                p.received_at,
                u.full_name                           AS received_by_name,
                1                                     AS count,
                CASE WHEN p.status = 'reversed' THEN 1 ELSE 0 END AS reversed_count,
                json_build_array(json_build_object(
                    'resident_name', COALESCE(r.full_name, CONCAT(p.unit, CASE WHEN p.block IS NOT NULL THEN ' Bl.' || p.block ELSE '' END)),
                    'unit', p.unit,
                    'block', p.block,
                    'tracking_code', p.tracking_code,
                    'carrier_name', p.carrier_name,
                    'status', p.status
                )) AS items
            FROM packages p
            JOIN users u ON u.id = p.received_by
            LEFT JOIN residents r ON r.id = p.resident_id
            WHERE p.association_id = :aid AND p.receive_batch_id IS NULL
        )
        SELECT * FROM batches
        ORDER BY received_at DESC
        LIMIT :lim OFFSET :off
    """), {"aid": str(current.association_id), "lim": limit, "off": offset})
    rows = result.mappings().all()
    return [
        {
            "id": r["id"],
            "is_bulk": r["is_bulk"],
            "received_at": r["received_at"].isoformat() if r["received_at"] else None,
            "received_by_name": r["received_by_name"],
            "count": r["count"],
            "status": "reversed" if r["reversed_count"] == r["count"] else "confirmed",
            "items": r["items"] if isinstance(r["items"], list) else [],
        }
        for r in rows
    ]


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
