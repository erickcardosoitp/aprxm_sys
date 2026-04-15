from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
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
    address_neighborhood: str | None = None
    address_city: str | None = None
    address_state: str | None = None
    address_country: str | None = 'Brasil'

    address_rooms: int | None = None
    address_location: str | None = None
    address_access: list[str] = []
    uses_public_transport: bool | None = None
    transport_distance: str | None = None
    household_count: int | None = None
    household_profiles: list[str] = []
    internet_access: str | None = None
    has_sewage: bool | None = None
    has_pests: bool | None = None
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
    address_neighborhood: str | None = None
    address_city: str | None = None
    address_state: str | None = None
    address_country: str | None = None

    address_rooms: int | None = None
    address_location: str | None = None
    address_access: list[str] | None = None
    uses_public_transport: bool | None = None
    transport_distance: str | None = None
    household_count: int | None = None
    household_profiles: list[str] | None = None
    internet_access: str | None = None
    has_sewage: bool | None = None
    has_pests: bool | None = None
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
    # Validate phone required for members
    if body.type == ResidentType.member and not body.phone_primary:
        raise HTTPException(status_code=422, detail="Telefone é obrigatório para associados.")

    # Validate CPF uniqueness
    if body.cpf:
        cpf_clean = body.cpf.replace(".", "").replace("-", "").strip()
        existing_cpf = (await session.execute(
            select(Resident).where(
                Resident.association_id == current.association_id,
                Resident.cpf == cpf_clean,
                Resident.status != "inactive",
            )
        )).scalar_one_or_none()
        if existing_cpf:
            raise HTTPException(status_code=409, detail=f"CPF já cadastrado para {existing_cpf.full_name}.")
        body = body.model_copy(update={"cpf": cpf_clean})

    resident = Resident(
        association_id=current.association_id,
        created_by=current.user_id,
        **body.model_dump(),
    )
    session.add(resident)
    await session.flush()
    return _serialize(resident)


@router.get("/search", summary="Busca global de moradores (nome, telefone, endereço, CPF)")
async def search_residents_global(
    q: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text as sa_text
    q_clean = q.strip()
    if not q_clean:
        return []
    q_digits = ''.join(c for c in q_clean if c.isdigit())
    phone_clause = "AND (REGEXP_REPLACE(phone_primary, '\\D', '', 'g') ILIKE :qdigits OR REGEXP_REPLACE(phone_secondary, '\\D', '', 'g') ILIKE :qdigits)" if q_digits else ""
    result = await session.execute(
        sa_text(f"""
            SELECT r.id, r.full_name, r.cpf, r.phone_primary, r.phone_secondary,
                   r.address_street, r.address_number, r.address_city, r.unit, r.block, r.type, r.status,
                   r.address_cep, r.responsible_id, resp.full_name AS responsible_name
            FROM residents r
            LEFT JOIN residents resp ON resp.id = r.responsible_id
            WHERE r.association_id = :aid
              AND (
                r.full_name ILIKE :q
                OR r.cpf ILIKE :qraw
                OR r.phone_primary ILIKE :q
                OR r.phone_secondary ILIKE :q
                OR r.address_street ILIKE :q
                OR r.address_city ILIKE :q
                OR r.address_cep ILIKE :q
                OR (r.unit || ' ' || COALESCE(r.block,'')) ILIKE :q
                {f"OR (REGEXP_REPLACE(r.phone_primary, '\\D', '', 'g') ILIKE :qdigits OR REGEXP_REPLACE(r.phone_secondary, '\\D', '', 'g') ILIKE :qdigits)" if q_digits else ""}
              )
            ORDER BY r.full_name
            LIMIT 20
        """),
        {
            "aid": str(current.association_id),
            "q": f"%{q_clean}%",
            "qraw": f"%{q_clean.replace('.','').replace('-','')}%",
            **( {"qdigits": f"%{q_digits}%"} if q_digits else {} ),
        },
    )
    rows = result.fetchall()
    return [
        {
            "id": str(r[0]), "full_name": r[1], "cpf": r[2],
            "phone_primary": r[3], "phone_secondary": r[4],
            "address_street": r[5], "address_number": r[6], "address_city": r[7],
            "unit": r[8], "block": r[9], "type": r[10], "status": r[11],
            "address_cep": r[12],
            "responsible_id": str(r[13]) if r[13] else None,
            "responsible_name": r[14],
        }
        for r in rows
    ]


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
        q_digits = ''.join(c for c in q if c.isdigit())
        filters = [Resident.full_name.ilike(f"%{q}%")]
        if q_digits:
            from sqlalchemy import func
            filters.append(func.regexp_replace(Resident.phone_primary, r'\D', '', 'g').ilike(f"%{q_digits}%"))
            filters.append(func.regexp_replace(Resident.phone_secondary, r'\D', '', 'g').ilike(f"%{q_digits}%"))
        else:
            filters.append(Resident.phone_primary.ilike(f"%{q}%"))
            filters.append(Resident.phone_secondary.ilike(f"%{q}%"))
        stmt = stmt.where(or_(*filters))
    stmt = stmt.order_by(Resident.full_name)
    result = await session.execute(stmt)
    return [_serialize(r) for r in result.scalars().all()]


@router.get("/reports/by-street", summary="Relatório de moradores por rua")
async def report_by_street(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as t
    rows = (await session.execute(t("""
        SELECT
            COALESCE(NULLIF(TRIM(address_street), ''), 'Sem endereço') AS street,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE type = 'member') AS members,
            COUNT(*) FILTER (WHERE type = 'guest') AS guests,
            COUNT(*) FILTER (WHERE status = 'active') AS active,
            COUNT(*) FILTER (WHERE status = 'inactive') AS inactive,
            COUNT(*) FILTER (WHERE cpf IS NOT NULL AND cpf <> '') AS with_cpf,
            COUNT(*) FILTER (WHERE phone IS NOT NULL AND phone <> '') AS with_phone
        FROM residents
        WHERE association_id = :aid
        GROUP BY 1
        ORDER BY total DESC
    """), {"aid": str(current.association_id)})).fetchall()

    grand_total = sum(r[1] for r in rows)
    streets = [
        {
            "street": r[0],
            "total": r[1],
            "members": r[2],
            "guests": r[3],
            "active": r[4],
            "inactive": r[5],
            "with_cpf": r[6],
            "with_phone": r[7],
            "pct_of_total": round(r[1] / grand_total * 100, 1) if grand_total else 0,
            "pct_cpf": round(r[6] / r[1] * 100, 1) if r[1] else 0,
        }
        for r in rows
    ]
    return {
        "grand_total": grand_total,
        "streets": streets,
        "summary": {
            "total_members": sum(s["members"] for s in streets),
            "total_guests": sum(s["guests"] for s in streets),
            "total_active": sum(s["active"] for s in streets),
            "total_inactive": sum(s["inactive"] for s in streets),
            "total_with_cpf": sum(s["with_cpf"] for s in streets),
            "pct_cpf_overall": round(sum(s["with_cpf"] for s in streets) / grand_total * 100, 1) if grand_total else 0,
        },
    }


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
    # Use model_fields_set so explicit null (e.g. clearing CPF) is applied
    data = {k: v for k, v in body.model_dump().items() if k in body.model_fields_set}

    if "cpf" in data:
        cpf_val = data["cpf"]
        if cpf_val:
            cpf_clean = cpf_val.replace(".", "").replace("-", "").strip()
            existing_cpf = (await session.execute(
                select(Resident).where(
                    Resident.association_id == current.association_id,
                    Resident.cpf == cpf_clean,
                    Resident.id != resident_id,
                    Resident.status != "inactive",
                )
            )).scalar_one_or_none()
            if existing_cpf:
                raise HTTPException(status_code=409, detail=f"CPF já cadastrado para {existing_cpf.full_name}.")
            data["cpf"] = cpf_clean
        else:
            data["cpf"] = None

    old_type = resident.type
    for key, value in data.items():
        setattr(resident, key, value)
    from datetime import datetime
    resident.updated_at = datetime.utcnow()
    session.add(resident)

    # Reverse delivery fees on existing packages when upgrading guest → member
    if old_type == ResidentType.guest and resident.type == ResidentType.member:
        from app.models.package import Package
        from app.services.finance_service import FinanceService
        pkgs_result = await session.execute(
            select(Package).where(
                Package.association_id == current.association_id,
                Package.resident_id == resident_id,
                Package.has_delivery_fee == True,
            )
        )
        pkgs = pkgs_result.scalars().all()
        if pkgs:
            finance = FinanceService(session)
            for pkg in pkgs:
                if pkg.delivery_fee_tx_id:
                    try:
                        await finance.reverse_transaction(
                            transaction_id=pkg.delivery_fee_tx_id,
                            association_id=current.association_id,
                            reversed_by=current.id,
                            reason="Morador convertido para associado",
                        )
                    except Exception:
                        pass
                pkg.has_delivery_fee = False
                pkg.delivery_fee_tx_id = None
                session.add(pkg)

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


class MergeResidentsRequest(BaseModel):
    primary_id: UUID
    secondary_ids: list[UUID]


@router.post("/merge", summary="Unir cadastros duplicados")
async def merge_residents(
    body: MergeResidentsRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as sa_text

    aid = str(current.association_id)
    if not body.secondary_ids:
        raise HTTPException(400, "Selecione ao menos dois cadastros para unir.")
    all_ids = [str(body.primary_id)] + [str(s) for s in body.secondary_ids]

    rows = (await session.execute(sa_text(
        "SELECT id, full_name, cpf, phone_primary, phone_secondary, email, unit, block, "
        "address_street, address_number, address_cep, date_of_birth, type, status "
        "FROM residents WHERE id = ANY(:ids) AND association_id = :aid"
    ), {"ids": all_ids, "aid": aid})).fetchall()

    if len(rows) != len(all_ids):
        raise HTTPException(404, "Um ou mais cadastros não encontrados.")

    primary = next(r for r in rows if str(r[0]) == str(body.primary_id))
    secondaries = [r for r in rows if str(r[0]) != str(body.primary_id)]

    # Build update dict: fill NULL fields on primary from secondaries
    fields = ["cpf", "phone_primary", "phone_secondary", "email", "unit", "block",
              "address_street", "address_number", "address_cep", "date_of_birth"]
    col_idx = {f: i + 1 for i, f in enumerate(["full_name", "cpf", "phone_primary", "phone_secondary",
                                                 "email", "unit", "block", "address_street",
                                                 "address_number", "address_cep", "date_of_birth"])}
    updates: dict = {}
    for field in fields:
        idx = col_idx.get(field)
        if idx is not None and primary[idx] is None:
            for sec in secondaries:
                if sec[idx] is not None:
                    updates[field] = sec[idx]
                    break

    sec_id_list = [str(s) for s in body.secondary_ids]

    # Reassign foreign keys
    for table, col in [
        ("transactions", "resident_id"),
        ("mensalidades", "resident_id"),
        ("migration_payments", "resident_id"),
        ("packages", "resident_id"),
        ("packages", "delivered_to_resident_id"),
        ("service_orders", "requester_resident_id"),
        ("residents", "responsible_id"),
    ]:
        await session.execute(sa_text(
            f"UPDATE {table} SET {col} = :pid WHERE {col} = ANY(:sids) AND association_id = :aid"
        ), {"pid": str(body.primary_id), "sids": sec_id_list, "aid": aid})

    # Apply data fill-in to primary
    if updates:
        set_clause = ", ".join(f"{k} = :{k}" for k in updates)
        updates["pid"] = str(body.primary_id)
        updates["aid"] = aid
        await session.execute(sa_text(
            f"UPDATE residents SET {set_clause} WHERE id = :pid AND association_id = :aid"
        ), updates)

    # Delete secondaries
    await session.execute(sa_text(
        "DELETE FROM residents WHERE id = ANY(:sids) AND association_id = :aid"
    ), {"sids": sec_id_list, "aid": aid})

    await session.commit()
    return {
        "merged_into": str(body.primary_id),
        "removed": sec_id_list,
        "fields_filled": list(updates.keys()),
    }
