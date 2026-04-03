from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session
from app.models.resident import Resident, ResidentStatus, ResidentType

router = APIRouter(prefix="/residents", tags=["Moradores"])


class CreateResidentRequest(BaseModel):
    type: ResidentType = ResidentType.member
    full_name: str
    cpf: str | None = None
    rg: str | None = None
    date_of_birth: date | None = None
    race: str | None = None
    education_level: str | None = None

    email: str | None = None
    phone_primary: str | None = None
    phone_secondary: str | None = None

    unit: str | None = None
    block: str | None = None
    parking_spot: str | None = None

    address_cep: str | None = None
    address_street: str | None = None
    address_number: str | None = None
    address_complement: str | None = None
    address_city: str | None = None
    address_state: str | None = None

    address_rooms: int | None = None
    address_location: str | None = None
    address_access: list[str] = []
    uses_public_transport: bool | None = None
    transport_distance: str | None = None
    household_count: int | None = None
    household_profiles: list[str] = []
    internet_access: str | None = None
    has_sewage: bool | None = None
    neighborhood_problems: list[str] = []
    main_priority_request: str | None = None

    responsible_id: UUID | None = None
    ownership_type: str | None = None
    move_in_date: date | None = None
    move_out_date: date | None = None
    is_member_confirmed: bool = False
    wants_to_join: bool | None = None
    monthly_payment_day: int | None = None

    terms_accepted: bool = False
    lgpd_accepted: bool = False
    notes: str | None = None


class UpdateResidentRequest(BaseModel):
    type: ResidentType | None = None
    status: ResidentStatus | None = None
    full_name: str | None = None
    cpf: str | None = None
    rg: str | None = None
    date_of_birth: date | None = None
    race: str | None = None
    education_level: str | None = None

    email: str | None = None
    phone_primary: str | None = None
    phone_secondary: str | None = None

    unit: str | None = None
    block: str | None = None
    parking_spot: str | None = None

    address_cep: str | None = None
    address_street: str | None = None
    address_number: str | None = None
    address_complement: str | None = None
    address_city: str | None = None
    address_state: str | None = None

    address_rooms: int | None = None
    address_location: str | None = None
    address_access: list[str] | None = None
    uses_public_transport: bool | None = None
    transport_distance: str | None = None
    household_count: int | None = None
    household_profiles: list[str] | None = None
    internet_access: str | None = None
    has_sewage: bool | None = None
    neighborhood_problems: list[str] | None = None
    main_priority_request: str | None = None

    responsible_id: UUID | None = None
    ownership_type: str | None = None
    move_in_date: date | None = None
    move_out_date: date | None = None
    is_member_confirmed: bool | None = None
    wants_to_join: bool | None = None
    monthly_payment_day: int | None = None

    terms_accepted: bool | None = None
    lgpd_accepted: bool | None = None
    notes: str | None = None


def _serialize(r: Resident) -> dict:
    return {
        "id": str(r.id),
        "type": r.type,
        "status": r.status,
        "full_name": r.full_name,
        "cpf": r.cpf,
        "rg": r.rg,
        "date_of_birth": r.date_of_birth.isoformat() if r.date_of_birth else None,
        "race": r.race,
        "education_level": r.education_level,
        "email": r.email,
        "phone_primary": r.phone_primary,
        "phone_secondary": r.phone_secondary,
        "unit": r.unit,
        "block": r.block,
        "parking_spot": r.parking_spot,
        "address_cep": r.address_cep,
        "address_street": r.address_street,
        "address_number": r.address_number,
        "address_complement": r.address_complement,
        "address_city": r.address_city,
        "address_state": r.address_state,
        "address_rooms": r.address_rooms,
        "address_location": r.address_location,
        "address_access": r.address_access or [],
        "uses_public_transport": r.uses_public_transport,
        "transport_distance": r.transport_distance,
        "household_count": r.household_count,
        "household_profiles": r.household_profiles or [],
        "internet_access": r.internet_access,
        "has_sewage": r.has_sewage,
        "neighborhood_problems": r.neighborhood_problems or [],
        "main_priority_request": r.main_priority_request,
        "responsible_id": str(r.responsible_id) if r.responsible_id else None,
        "ownership_type": r.ownership_type,
        "move_in_date": r.move_in_date.isoformat() if r.move_in_date else None,
        "move_out_date": r.move_out_date.isoformat() if r.move_out_date else None,
        "is_member_confirmed": r.is_member_confirmed,
        "wants_to_join": r.wants_to_join,
        "monthly_payment_day": r.monthly_payment_day,
        "terms_accepted": r.terms_accepted,
        "lgpd_accepted": r.lgpd_accepted,
        "notes": r.notes,
        "photo_url": r.photo_url,
        "created_at": r.created_at.isoformat(),
    }


@router.post("", summary="Cadastrar morador")
async def create_resident(
    body: CreateResidentRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    resident = Resident(
        association_id=current.association_id,
        created_by=current.user_id,
        **body.model_dump(),
    )
    session.add(resident)
    await session.flush()
    return _serialize(resident)


@router.get("", summary="Listar moradores")
async def list_residents(
    status: ResidentStatus | None = None,
    type: ResidentType | None = None,
    q: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    stmt = select(Resident).where(Resident.association_id == current.association_id)
    if status:
        stmt = stmt.where(Resident.status == status)
    if type:
        stmt = stmt.where(Resident.type == type)
    if q:
        stmt = stmt.where(Resident.full_name.ilike(f"%{q}%"))
    stmt = stmt.order_by(Resident.full_name)
    result = await session.execute(stmt)
    return [_serialize(r) for r in result.scalars().all()]


@router.get("/cpf/{cpf}", summary="Buscar morador por CPF")
async def get_resident_by_cpf(
    cpf: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    stmt = select(Resident).where(
        Resident.association_id == current.association_id,
        Resident.cpf == cpf,
    )
    result = await session.execute(stmt)
    resident = result.scalar_one_or_none()
    if not resident:
        raise HTTPException(status_code=404, detail="Morador não encontrado.")
    return _serialize(resident)


@router.get("/{resident_id}", summary="Detalhe do morador")
async def get_resident(
    resident_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    stmt = select(Resident).where(
        Resident.id == resident_id,
        Resident.association_id == current.association_id,
    )
    result = await session.execute(stmt)
    resident = result.scalar_one_or_none()
    if not resident:
        raise HTTPException(status_code=404, detail="Morador não encontrado.")
    return _serialize(resident)


@router.put("/{resident_id}", summary="Atualizar morador")
async def update_resident(
    resident_id: UUID,
    body: UpdateResidentRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    stmt = select(Resident).where(
        Resident.id == resident_id,
        Resident.association_id == current.association_id,
    )
    result = await session.execute(stmt)
    resident = result.scalar_one_or_none()
    if not resident:
        raise HTTPException(status_code=404, detail="Morador não encontrado.")
    data = body.model_dump(exclude_none=True)
    for key, value in data.items():
        setattr(resident, key, value)
    from datetime import datetime
    resident.updated_at = datetime.utcnow()
    session.add(resident)
    return _serialize(resident)


@router.patch("/{resident_id}/status", summary="Atualizar status do morador")
async def update_status(
    resident_id: UUID,
    status: ResidentStatus,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    stmt = select(Resident).where(
        Resident.id == resident_id,
        Resident.association_id == current.association_id,
    )
    result = await session.execute(stmt)
    resident = result.scalar_one_or_none()
    if not resident:
        raise HTTPException(status_code=404, detail="Morador não encontrado.")
    resident.status = status
    session.add(resident)
    return {"id": str(resident.id), "status": resident.status}
