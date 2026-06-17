from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, text
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.tenant import CurrentUser, get_current_user, require_admin
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


def _serialize_list(r: Resident) -> dict:
    """Serialização leve para listagem — omite campos de censo e arrays pesados."""
    return {
        "id": str(r.id),
        "type": r.type,
        "status": r.status,
        "full_name": r.full_name,
        "cpf": r.cpf,
        "phone_primary": r.phone_primary,
        "phone_secondary": r.phone_secondary,
        "address_cep": r.address_cep,
        "address_street": r.address_street,
        "address_number": r.address_number,
        "address_neighborhood": getattr(r, "address_neighborhood", None),
        "responsible_id": str(r.responsible_id) if r.responsible_id else None,
        "is_member_confirmed": r.is_member_confirmed,
        "monthly_payment_day": r.monthly_payment_day,
        "photo_url": r.photo_url if hasattr(r, "photo_url") else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        # Arrays/censo omitidos na lista — disponíveis em GET /residents/{id}
        "neighborhood_problems": [],
        "household_profiles": [],
        "address_access": [],
    }


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
    # Normalize name — title case
    if body.full_name:
        body = body.model_copy(update={"full_name": body.full_name.strip().title()})

    # Validate CPF uniqueness
    if body.cpf:
        cpf_clean = body.cpf.replace(".", "").replace("-", "").strip()
        existing_cpf = (await session.execute(
            select(Resident).where(
                Resident.association_id == current.association_id,
                Resident.cpf == cpf_clean,
                Resident.status != ResidentStatus.inactive,
            )
        )).scalar_one_or_none()
        if existing_cpf:
            status_pt = {ResidentStatus.active: "ativo", ResidentStatus.suspended: "suspenso"}
            st = status_pt.get(existing_cpf.status, existing_cpf.status.value)
            raise HTTPException(status_code=409, detail=f"CPF já cadastrado para {existing_cpf.full_name} ({st}).")
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
    type: str | None = None,
    street: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text as sa_text
    q_clean = q.strip()
    if not q_clean:
        return []
    q_digits = ''.join(c for c in q_clean if c.isdigit())
    type_clause = "AND r.type = :rtype" if type else ""
    street_clause = "AND r.address_street ILIKE :street_pat" if street else ""
    result = await session.execute(
        sa_text(f"""
            SELECT r.id, r.full_name, r.cpf, r.phone_primary, r.phone_secondary,
                   r.address_street, r.address_number, r.address_city, r.type, r.status,
                   r.address_cep, r.responsible_id, resp.full_name AS responsible_name
            FROM residents r
            LEFT JOIN residents resp ON resp.id = r.responsible_id
            WHERE r.association_id = :aid
              {type_clause}
              {street_clause}
              AND (
                unaccent(lower(r.full_name)) LIKE unaccent(lower(:q))
                OR r.cpf ILIKE :qraw
                OR r.phone_primary ILIKE :q
                OR r.phone_secondary ILIKE :q
              )
            ORDER BY r.full_name
            LIMIT 20
        """),
        {
            "aid": str(current.association_id),
            "q": f"%{q_clean}%",
            "qraw": f"%{q_clean.replace('.','').replace('-','')}%",
            **( {"rtype": type} if type else {} ),
            **( {"street_pat": f"%{street.strip()}%"} if street else {} ),
        },
    )
    rows = result.fetchall()
    return [
        {
            "id": str(r[0]), "full_name": r[1], "cpf": r[2],
            "phone_primary": r[3], "phone_secondary": r[4],
            "address_street": r[5], "address_number": r[6], "address_city": r[7],
            "type": r[8], "status": r[9],
            "address_cep": r[10],
            "responsible_id": str(r[11]) if r[11] else None,
            "responsible_name": r[12],
        }
        for r in rows
    ]


@router.get("", summary="Listar moradores")
async def list_residents(
    status: ResidentStatus | None = None,
    type: ResidentType | None = None,
    q: str | None = None,
    responsible_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text as sa_text
    conditions = ["r.association_id = :aid"]
    params: dict = {"aid": str(current.association_id), "lim": limit, "off": offset}
    if status:
        conditions.append("r.status = :status")
        params["status"] = status.value
    if type:
        conditions.append("r.type = :rtype")
        params["rtype"] = type.value
    if responsible_id:
        conditions.append("r.responsible_id = :rid")
        params["rid"] = str(responsible_id)
    if q:
        q_digits = ''.join(c for c in q if c.isdigit())
        parts = ["unaccent(lower(r.full_name)) LIKE unaccent(lower(:q))", "r.phone_primary ILIKE :qp"]
        params["q"] = f"%{q}%"; params["qp"] = f"%{q}%"
        if q_digits:
            parts.append("r.phone_secondary ILIKE :qs")
            params["qs"] = f"%{q_digits}%"
        conditions.append(f"({' OR '.join(parts)})")
    where = " AND ".join(conditions)
    rows = (await session.execute(sa_text(f"""
        SELECT r.id, r.type, r.status, r.full_name, r.cpf,
               r.phone_primary, r.phone_secondary,
               r.address_cep, r.address_street, r.address_number, r.address_neighborhood,
               r.responsible_id, r.is_member_confirmed, r.monthly_payment_day,
               r.photo_url, r.created_at, resp.full_name AS responsible_name
        FROM residents r
        LEFT JOIN residents resp ON resp.id = r.responsible_id
        WHERE {where}
        ORDER BY r.full_name
        LIMIT :lim OFFSET :off
    """), params)).fetchall()
    return [
        {
            "id": str(r[0]), "type": r[1], "status": r[2], "full_name": r[3],
            "cpf": r[4], "phone_primary": r[5], "phone_secondary": r[6],
            "address_cep": r[7], "address_street": r[8], "address_number": r[9],
            "address_neighborhood": r[10],
            "responsible_id": str(r[11]) if r[11] else None,
            "is_member_confirmed": r[12], "monthly_payment_day": r[13],
            "photo_url": r[14],
            "created_at": r[15].isoformat() if r[15] else None,
            "responsible_name": r[16],
            "neighborhood_problems": [], "household_profiles": [], "address_access": [],
        }
        for r in rows
    ]


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
            COUNT(*) FILTER (WHERE phone_primary IS NOT NULL AND phone_primary <> '') AS with_phone
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


@router.get("/map-data", summary="Dados de moradores por CEP para mapa")
async def map_data(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text as sa_text
    rows = (await session.execute(sa_text("""
        SELECT
            address_cep,
            MAX(address_street) AS street,
            SUM(CASE WHEN type = 'member' THEN 1 ELSE 0 END)::int AS members,
            SUM(CASE WHEN type = 'guest'  THEN 1 ELSE 0 END)::int AS guests
        FROM residents
        WHERE association_id = :aid
          AND address_cep IS NOT NULL
          AND address_cep <> ''
          AND status = 'active'
        GROUP BY address_cep
        ORDER BY (SUM(CASE WHEN type = 'member' THEN 1 ELSE 0 END) + SUM(CASE WHEN type = 'guest' THEN 1 ELSE 0 END)) DESC
        LIMIT 120
    """), {"aid": str(current.association_id)})).fetchall()
    return [
        {"cep": r[0], "street": r[1] or "", "members": r[2], "guests": r[3]}
        for r in rows
    ]


@router.get("/kpis", summary="KPIs do módulo de moradores")
async def residents_kpis(
    resident_type: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as sa_text
    from datetime import date, timedelta
    from app.services.mensalidade_service import MensalidadeService

    # default: member
    rtype = resident_type if resident_type in ("member", "guest", "dependent") else "member"

    row = (await session.execute(sa_text("""
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE (address_cep IS NULL OR TRIM(address_cep) = '')) AS sem_cep,
            COUNT(*) FILTER (WHERE (phone_primary IS NULL OR TRIM(phone_primary) = '')) AS sem_telefone,
            COUNT(*) FILTER (WHERE (cpf IS NULL OR TRIM(cpf) = '')) AS sem_cpf
        FROM residents
        WHERE association_id = :aid AND type = :rtype AND status = 'active'
    """), {"aid": str(current.association_id), "rtype": rtype})).fetchone()

    # inadimplência só faz sentido para members
    inadimplentes = 0
    if rtype == "member":
        svc = MensalidadeService(session)
        grace_days = await svc._grace_days(current.association_id)
        grace_cutoff = date.today() - timedelta(days=grace_days)
        inadimplentes = int((await session.execute(sa_text("""
            SELECT COUNT(DISTINCT m.resident_id)
            FROM mensalidades m
            JOIN residents r ON r.id = m.resident_id
            WHERE m.association_id = :aid
              AND m.status NOT IN ('paid', 'agreement')
              AND m.due_date < :cutoff
              AND r.type = 'member' AND r.status = 'active'
              AND NOT EXISTS (
                SELECT 1 FROM migration_payments mp
                WHERE mp.resident_id = m.resident_id
                  AND mp.association_id = m.association_id
                  AND mp.competencia = m.reference_month
              )
        """), {"aid": str(current.association_id), "cutoff": grace_cutoff})).scalar() or 0)

    return {
        "total": int(row[0]),
        "sem_cep": int(row[1]),
        "sem_telefone": int(row[2]),
        "sem_cpf": int(row[3]),
        "inadimplentes": inadimplentes,
    }


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
    if "full_name" in data and data["full_name"]:
        data["full_name"] = data["full_name"].strip().title()

    if "cpf" in data:
        cpf_val = data["cpf"]
        if cpf_val:
            cpf_clean = cpf_val.replace(".", "").replace("-", "").strip()
            existing_cpf = (await session.execute(
                select(Resident).where(
                    Resident.association_id == current.association_id,
                    Resident.cpf == cpf_clean,
                    Resident.id != resident_id,
                    Resident.status != ResidentStatus.inactive,
                )
            )).scalar_one_or_none()
            if existing_cpf:
                status_pt = {ResidentStatus.active: "ativo", ResidentStatus.suspended: "suspenso"}
                st = status_pt.get(existing_cpf.status, existing_cpf.status.value)
                raise HTTPException(status_code=409, detail=f"CPF já cadastrado para {existing_cpf.full_name} ({st}).")
            data["cpf"] = cpf_clean
        else:
            data["cpf"] = None

    old_type = resident.type
    for key, value in data.items():
        setattr(resident, key, value)
    from datetime import datetime
    resident.updated_at = datetime.utcnow()
    session.add(resident)
    await session.commit()
    await session.refresh(resident)
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


@router.delete("/{resident_id}", summary="Excluir morador (sem movimentações)")
async def delete_resident(
    resident_id: UUID,
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    resident = (await session.execute(
        select(Resident).where(
            Resident.id == resident_id,
            Resident.association_id == current.association_id,
        )
    )).scalar_one_or_none()
    if not resident:
        raise HTTPException(status_code=404, detail="Morador não encontrado.")

    checks = await session.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM mensalidades WHERE resident_id = :rid) +
            (SELECT COUNT(*) FROM packages WHERE resident_id = :rid) +
            (SELECT COUNT(*) FROM transactions WHERE resident_id = :rid) AS total
    """), {"rid": str(resident_id)})
    row = checks.fetchone()
    if row and row[0] > 0:
        raise HTTPException(
            status_code=409,
            detail="Não é possível excluir: morador possui movimentações no sistema."
        )

    await session.delete(resident)
    await session.commit()
    return {"id": str(resident_id), "deleted": True}


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
        "SELECT id, full_name, cpf, phone_primary, phone_secondary, email, "
        "address_street, address_number, address_cep, date_of_birth, type, status "
        "FROM residents WHERE id = ANY(:ids) AND association_id = :aid"
    ), {"ids": all_ids, "aid": aid})).fetchall()

    if len(rows) != len(all_ids):
        raise HTTPException(404, "Um ou mais cadastros não encontrados.")

    primary = next(r for r in rows if str(r[0]) == str(body.primary_id))
    secondaries = [r for r in rows if str(r[0]) != str(body.primary_id)]

    # Build update dict: fill NULL fields on primary from secondaries
    fields = ["cpf", "phone_primary", "phone_secondary", "email",
              "address_street", "address_number", "address_cep", "date_of_birth"]
    col_idx = {f: i + 1 for i, f in enumerate(["full_name", "cpf", "phone_primary", "phone_secondary",
                                                 "email", "address_street",
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

    # Antes de reassignar mensalidades: deletar as dos secundários que já existem no primary
    # para evitar UniqueViolationError em uq_mensalidade_period (association_id, resident_id, reference_month)
    await session.execute(sa_text("""
        DELETE FROM mensalidades
        WHERE resident_id = ANY(:sids)
          AND association_id = :aid
          AND reference_month IN (
              SELECT reference_month FROM mensalidades
              WHERE resident_id = :pid AND association_id = :aid
          )
    """), {"sids": sec_id_list, "pid": str(body.primary_id), "aid": aid})

    # Reassign foreign keys
    for table, col in [
        ("transactions", "resident_id"),
        ("mensalidades", "resident_id"),
        ("migration_payments", "resident_id"),
        ("packages", "resident_id"),
        ("packages", "delivered_to_resident_id"),
        ("service_orders", "requester_resident_id"),
        ("residents", "responsible_id"),
        ("porta_a_porta_leads", "resident_id"),
        ("pix_learning_map", "resident_id"),
        ("resident_update_requests", "resident_id"),
    ]:
        await session.execute(sa_text(
            f"UPDATE {table} SET {col} = :pid WHERE {col} = ANY(:sids) AND association_id = :aid"
        ), {"pid": str(body.primary_id), "sids": sec_id_list, "aid": aid})

    # If primary is a member, fix packages that came from guest secondaries
    primary_type = primary[10]  # type column index
    if str(primary_type) == "member":
        await session.execute(sa_text("""
            UPDATE packages SET has_delivery_fee = FALSE
            WHERE resident_id = :pid AND association_id = :aid
              AND has_delivery_fee = TRUE
              AND status NOT IN ('delivered', 'returned')
        """), {"pid": str(body.primary_id), "aid": aid})

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


@router.get("/update-requests", summary="Listar solicitações de atualização pendentes")
async def list_update_requests(
    status: str = "pending",
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text as sa_text
    rows = (await session.execute(sa_text("""
        SELECT r.id, r.full_name, r.cpf,
               req.id AS req_id, req.changes, req.notes, req.submitted_at, req.status
          FROM resident_update_requests req
          JOIN residents r ON r.id = req.resident_id
         WHERE req.association_id = :aid AND req.status = :status
         ORDER BY req.submitted_at DESC
    """), {"aid": str(current.association_id), "status": status})).fetchall()
    import json as _json
    return [{
        "id": str(r[3]), "resident_id": str(r[0]), "resident_name": r[1],
        "cpf": r[2],
        "changes": r[4] if isinstance(r[4], dict) else _json.loads(r[4]),
        "notes": r[5], "submitted_at": str(r[6]), "status": r[7],
    } for r in rows]


@router.post("/update-requests/{req_id}/approve", summary="Aprovar atualização de cadastro")
async def approve_update_request(
    req_id: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as sa_text
    import json as _json
    row = (await session.execute(sa_text(
        "SELECT resident_id, changes FROM resident_update_requests WHERE id=:id AND association_id=:aid AND status='pending'"
    ), {"id": req_id, "aid": str(current.association_id)})).fetchone()
    if not row:
        raise HTTPException(404, "Solicitação não encontrada.")
    changes = row[1] if isinstance(row[1], dict) else _json.loads(row[1])
    allowed = {"full_name", "phone_primary", "phone_secondary", "email", "date_of_birth",
                "address_cep", "address_street", "address_number",
                "address_complement", "address_district", "address_city", "address_state", "cpf"}
    safe = {k: v for k, v in changes.items() if k in allowed and v is not None and v != ""}
    if safe:
        set_clause = ", ".join(f"{k} = :{k}" for k in safe)
        safe["rid"] = str(row[0]); safe["aid"] = str(current.association_id)
        await session.execute(sa_text(
            f"UPDATE residents SET {set_clause}, updated_at=NOW() WHERE id=:rid AND association_id=:aid"
        ), safe)
    await session.execute(sa_text(
        "UPDATE resident_update_requests SET status='approved', reviewed_at=NOW(), reviewed_by=:uid WHERE id=:id"
    ), {"uid": str(current.user_id), "id": req_id})
    await session.commit()
    return {"ok": True}


@router.post("/update-requests/{req_id}/reject", summary="Rejeitar atualização de cadastro")
async def reject_update_request(
    req_id: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as sa_text
    row = (await session.execute(sa_text(
        "SELECT id FROM resident_update_requests WHERE id=:id AND association_id=:aid AND status='pending'"
    ), {"id": req_id, "aid": str(current.association_id)})).fetchone()
    if not row:
        raise HTTPException(404, "Solicitação não encontrada.")
    await session.execute(sa_text(
        "UPDATE resident_update_requests SET status='rejected', reviewed_at=NOW(), reviewed_by=:uid WHERE id=:id"
    ), {"uid": str(current.user_id), "id": req_id})
    await session.commit()
    return {"ok": True}


