from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session

router = APIRouter(prefix="/carriers", tags=["Transportadoras"])


class CarrierIn(BaseModel):
    name: str


class DelivererIn(BaseModel):
    name: str
    carrier_id: UUID | None = None
    signature_url: str | None = None


# ── Carriers ──────────────────────────────────────────────────────────────────

@router.get("", summary="Listar transportadoras")
async def list_carriers(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT id, name, created_at FROM carriers
        WHERE association_id = :aid AND active = TRUE
        ORDER BY name
    """), {"aid": str(current.association_id)})).fetchall()
    return [{"id": str(r[0]), "name": r[1], "created_at": r[2].isoformat()} for r in rows]


@router.post("", summary="Criar transportadora")
async def create_carrier(
    body: CarrierIn,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = (await session.execute(text("""
        INSERT INTO carriers (association_id, name)
        VALUES (:aid, :name)
        RETURNING id, name, created_at
    """), {"aid": str(current.association_id), "name": body.name.strip()})).fetchone()
    await session.commit()
    return {"id": str(row[0]), "name": row[1], "created_at": row[2].isoformat()}


@router.delete("/{carrier_id}", summary="Excluir transportadora")
async def delete_carrier(
    carrier_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(text(
        "UPDATE carriers SET active = FALSE WHERE id = :id AND association_id = :aid"
    ), {"id": str(carrier_id), "aid": str(current.association_id)})
    await session.commit()
    return {"deleted": True}


# ── Deliverers ────────────────────────────────────────────────────────────────

@router.get("/deliverers", summary="Listar entregadores")
async def list_deliverers(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT d.id, d.name, d.carrier_id, c.name AS carrier_name, d.signature_url, d.created_at
        FROM deliverers d
        LEFT JOIN carriers c ON c.id = d.carrier_id
        WHERE d.association_id = :aid AND d.active = TRUE
        ORDER BY d.name
    """), {"aid": str(current.association_id)})).fetchall()
    return [
        {
            "id": str(r[0]),
            "name": r[1],
            "carrier_id": str(r[2]) if r[2] else None,
            "carrier_name": r[3],
            "signature_url": r[4],
            "created_at": r[5].isoformat(),
        }
        for r in rows
    ]


@router.post("/deliverers", summary="Criar entregador")
async def create_deliverer(
    body: DelivererIn,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = (await session.execute(text("""
        INSERT INTO deliverers (association_id, name, carrier_id, signature_url)
        VALUES (:aid, :name, :cid, :sig)
        RETURNING id, name, carrier_id, signature_url, created_at
    """), {
        "aid": str(current.association_id),
        "name": body.name.strip(),
        "cid": str(body.carrier_id) if body.carrier_id else None,
        "sig": body.signature_url,
    })).fetchone()
    await session.commit()
    return {
        "id": str(row[0]),
        "name": row[1],
        "carrier_id": str(row[2]) if row[2] else None,
        "signature_url": row[3],
        "created_at": row[4].isoformat(),
    }


@router.patch("/deliverers/{deliverer_id}", summary="Atualizar entregador")
async def update_deliverer(
    deliverer_id: UUID,
    body: DelivererIn,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(text("""
        UPDATE deliverers
        SET name = :name, carrier_id = :cid, signature_url = :sig
        WHERE id = :id AND association_id = :aid
    """), {
        "id": str(deliverer_id),
        "aid": str(current.association_id),
        "name": body.name.strip(),
        "cid": str(body.carrier_id) if body.carrier_id else None,
        "sig": body.signature_url,
    })
    await session.commit()
    return {"updated": True}


@router.delete("/deliverers/{deliverer_id}", summary="Excluir entregador")
async def delete_deliverer(
    deliverer_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(text(
        "UPDATE deliverers SET active = FALSE WHERE id = :id AND association_id = :aid"
    ), {"id": str(deliverer_id), "aid": str(current.association_id)})
    await session.commit()
    return {"deleted": True}
