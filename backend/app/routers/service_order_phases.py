from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session
from app.models.service_order_phase import ServiceOrderPhase

router = APIRouter(prefix="/service-order-phases", tags=["Fases de OS"])


class CreatePhaseRequest(BaseModel):
    name: str
    color: str = "#9333ea"
    sort_order: int = 0


class UpdatePhaseRequest(BaseModel):
    name: str | None = None
    color: str | None = None
    sort_order: int | None = None
    active: bool | None = None


@router.get("", summary="Listar fases")
async def list_phases(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(
        text("SELECT id, name, color, sort_order, active FROM service_order_phases WHERE association_id = :aid AND active = true ORDER BY sort_order, name"),
        {"aid": str(current.association_id)},
    )).fetchall()
    return [{"id": str(r[0]), "name": r[1], "color": r[2], "sort_order": r[3], "active": r[4]} for r in rows]


@router.get("/all", summary="Listar fases incluindo inativas (admin)")
async def list_phases_all(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(
        text("SELECT id, name, color, sort_order, active FROM service_order_phases WHERE association_id = :aid ORDER BY sort_order, name"),
        {"aid": str(current.association_id)},
    )).fetchall()
    return [{"id": str(r[0]), "name": r[1], "color": r[2], "sort_order": r[3], "active": r[4]} for r in rows]


@router.post("", summary="Criar fase")
async def create_phase(
    body: CreatePhaseRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    phase = ServiceOrderPhase(
        association_id=current.association_id,
        name=body.name,
        color=body.color,
        sort_order=body.sort_order,
    )
    session.add(phase)
    await session.flush()
    await session.commit()
    return {"id": str(phase.id), "name": phase.name, "color": phase.color, "sort_order": phase.sort_order, "active": phase.active}


@router.patch("/{phase_id}", summary="Atualizar fase")
async def update_phase(
    phase_id: UUID,
    body: UpdatePhaseRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = (await session.execute(
        text("SELECT id FROM service_order_phases WHERE id = :id AND association_id = :aid"),
        {"id": str(phase_id), "aid": str(current.association_id)},
    )).fetchone()
    if not row:
        raise HTTPException(404, "Fase não encontrada.")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        set_clause = ", ".join(f"{k} = :{k}" for k in updates)
        updates["id"] = str(phase_id)
        await session.execute(text(f"UPDATE service_order_phases SET {set_clause} WHERE id = :id"), updates)
        await session.commit()
    row2 = (await session.execute(
        text("SELECT id, name, color, sort_order, active FROM service_order_phases WHERE id = :id"),
        {"id": str(phase_id)},
    )).fetchone()
    return {"id": str(row2[0]), "name": row2[1], "color": row2[2], "sort_order": row2[3], "active": row2[4]}


@router.delete("/{phase_id}", summary="Remover fase")
async def delete_phase(
    phase_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = (await session.execute(
        text("SELECT id FROM service_order_phases WHERE id = :id AND association_id = :aid"),
        {"id": str(phase_id), "aid": str(current.association_id)},
    )).fetchone()
    if not row:
        raise HTTPException(404, "Fase não encontrada.")
    count = (await session.execute(
        text("SELECT COUNT(*) FROM service_orders WHERE phase_id = :id"),
        {"id": str(phase_id)},
    )).scalar()
    if count and count > 0:
        await session.execute(
            text("UPDATE service_order_phases SET active = false WHERE id = :id"),
            {"id": str(phase_id)},
        )
    else:
        await session.execute(
            text("DELETE FROM service_order_phases WHERE id = :id"),
            {"id": str(phase_id)},
        )
    await session.commit()
    return {"ok": True, "soft": bool(count and count > 0)}
