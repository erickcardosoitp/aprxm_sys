from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.database import get_session
from app.models.association import Association
from app.models.resident import Resident, ResidentStatus, ResidentType
from app.services.storage_service import StorageService

router = APIRouter(prefix="/public", tags=["Público"])


class PublicRegisterRequest(BaseModel):
    full_name: str
    cpf: str | None = None
    phone_primary: str
    phone_secondary: str | None = None
    email: str | None = None
    date_of_birth: date | None = None
    address_cep: str
    address_street: str | None = None
    address_number: str | None = None
    address_complement: str | None = None
    address_city: str | None = None
    address_state: str | None = None
    notes: str | None = None
    registered_by: str | None = None
    proof_of_payment_url: str | None = None


@router.get("/associations/{slug}", summary="Info pública da associação")
async def get_association_public(
    slug: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(select(Association).where(Association.slug == slug, Association.is_active == True))
    assoc = result.scalar_one_or_none()
    if not assoc:
        raise HTTPException(404, "Associação não encontrada.")
    return {
        "id": str(assoc.id),
        "name": assoc.name,
        "slug": assoc.slug,
        "address_city": assoc.address_city,
        "logo_url": assoc.logo_url,
        "phone": assoc.phone,
        "email": assoc.email,
    }


@router.post("/associations/{slug}/residents", summary="Cadastro público de morador")
async def public_register_resident(
    slug: str,
    body: PublicRegisterRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    assoc_result = await session.execute(
        select(Association).where(Association.slug == slug, Association.is_active == True)
    )
    assoc = assoc_result.scalar_one_or_none()
    if not assoc:
        raise HTTPException(404, "Associação não encontrada.")

    cpf_clean = body.cpf.replace(".", "").replace("-", "").strip() if body.cpf else None

    if cpf_clean:
        dup = (await session.execute(
            select(Resident).where(Resident.association_id == assoc.id, Resident.cpf == cpf_clean)
        )).scalar_one_or_none()
        if dup:
            raise HTTPException(409, f"CPF já cadastrado.")

    # Use first admin user as created_by placeholder
    from sqlalchemy import text
    uid_row = await session.execute(
        text("SELECT id FROM users WHERE association_id = :aid LIMIT 1"),
        {"aid": str(assoc.id)},
    )
    uid = uid_row.scalar()
    if not uid:
        raise HTTPException(422, "Associação sem usuários configurados.")

    resident = Resident(
        association_id=assoc.id,
        created_by=uid,
        type=ResidentType.member,
        status=ResidentStatus.inactive,
        full_name=body.full_name,
        cpf=cpf_clean,
        phone_primary=body.phone_primary,
        phone_secondary=body.phone_secondary,
        email=body.email,
        date_of_birth=body.date_of_birth,
        address_cep=body.address_cep,
        address_street=body.address_street,
        address_number=body.address_number,
        address_complement=body.address_complement,
        address_city=body.address_city,
        address_state=body.address_state,
        notes=f"Lançado por: {body.registered_by}\n{body.notes or ''}".strip() if body.registered_by else body.notes,
        wants_to_join=True,
        proof_of_payment_url=body.proof_of_payment_url,
    )
    session.add(resident)
    await session.flush()
    await session.commit()
    return {"id": str(resident.id), "message": "Cadastro recebido com sucesso."}


ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
MAX_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/associations/{slug}/upload", summary="Upload público de comprovante")
async def public_upload(
    slug: str,
    file: UploadFile = File(...),
    folder: str = Form(default="public/proofs"),
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    assoc_result = await session.execute(
        select(Association).where(Association.slug == slug, Association.is_active == True)
    )
    assoc = assoc_result.scalar_one_or_none()
    if not assoc:
        raise HTTPException(404, "Associação não encontrada.")

    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, "Tipo de arquivo não permitido. Use JPG, PNG ou PDF.")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_SIZE:
        raise HTTPException(400, "Arquivo muito grande (máx. 10 MB).")

    svc = StorageService(str(assoc.id))
    url = await svc.upload(file_bytes, file.filename or "comprovante.jpg", folder)
    return JSONResponse({"url": url})


class UpdateRequestBody(BaseModel):
    changes: dict
    notes: str | None = None


@router.get("/associations/{slug}/residents/search", summary="Buscar morador para atualização pública")
async def public_search_resident(
    slug: str,
    q: str,
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text as sa_text
    assoc_result = await session.execute(
        select(Association).where(Association.slug == slug, Association.is_active == True)
    )
    assoc = assoc_result.scalar_one_or_none()
    if not assoc:
        raise HTTPException(404, "Associação não encontrada.")
    rows = (await session.execute(sa_text("""
        SELECT id, full_name, cpf, phone_primary
          FROM residents
         WHERE association_id = :aid
           AND (unaccent(lower(full_name)) LIKE unaccent(lower(:q)) OR cpf ILIKE :q OR phone_primary ILIKE :q)
         ORDER BY full_name LIMIT 10
    """), {"aid": str(assoc.id), "q": f"%{q}%"})).fetchall()
    return [{"id": str(r[0]), "full_name": r[1], "cpf": r[2], "phone_primary": r[3]} for r in rows]


@router.post("/associations/{slug}/residents/{resident_id}/update-request",
             summary="Submeter solicitação de atualização de cadastro")
async def public_submit_update_request(
    slug: str,
    resident_id: str,
    body: UpdateRequestBody,
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as sa_text
    assoc_result = await session.execute(
        select(Association).where(Association.slug == slug, Association.is_active == True)
    )
    assoc = assoc_result.scalar_one_or_none()
    if not assoc:
        raise HTTPException(404, "Associação não encontrada.")
    resident = (await session.execute(sa_text(
        "SELECT id, full_name FROM residents WHERE id=:rid AND association_id=:aid"
    ), {"rid": resident_id, "aid": str(assoc.id)})).fetchone()
    if not resident:
        raise HTTPException(404, "Morador não encontrado.")
    await session.execute(sa_text("""
        INSERT INTO resident_update_requests (association_id, resident_id, changes, notes)
        VALUES (:aid, :rid, CAST(:changes AS jsonb), :notes)
    """), {"aid": str(assoc.id), "rid": resident_id,
           "changes": __import__('json').dumps(body.changes, ensure_ascii=False),
           "notes": body.notes})
    await session.commit()
    return {"ok": True, "resident_name": resident[1]}
