from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.tenant import CurrentUser, get_current_user
from app.database import AsyncSessionLocal, get_session

router = APIRouter(prefix="/demands", tags=["Demandas"])

VALID_STATUSES  = {"gaveta", "a_iniciar", "em_andamento", "parado", "concluido"}
VALID_PHASES    = {"pendente", "em_andamento", "ag_terceiros", "cancelado", "concluido"}
VALID_PRIORITIES = {"low", "medium", "high"}


class CreateDemandRequest(BaseModel):
    title: str
    description: str | None = None
    status: str = "gaveta"
    phase: str = "pendente"
    priority: str = "medium"
    assigned_to: UUID | None = None
    assigned_to_name: str | None = None
    due_date: str | None = None
    notes: str | None = None
    service_order_id: UUID | None = None


class UpdateDemandRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    phase: str | None = None
    priority: str | None = None
    assigned_to: UUID | None = None
    assigned_to_name: str | None = None
    due_date: str | None = None
    notes: str | None = None
    service_order_id: UUID | None = None


@router.get("")
async def list_demands(
    status: str | None = None,
    service_order_id: str | None = Query(None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    conds = ["d.association_id = :aid"]
    p: dict = {"aid": str(current.association_id)}
    if status and status in VALID_STATUSES:
        conds.append("d.status = :st")
        p["st"] = status
    if service_order_id:
        conds.append("d.service_order_id = :so_id")
        p["so_id"] = service_order_id
    w = " AND ".join(conds)
    rows = (await session.execute(text(f"""
        SELECT d.id, d.title, d.description, d.status, d.phase, d.priority,
               d.assigned_to, d.assigned_to_name, d.due_date, d.notes,
               d.created_at, d.updated_at, d.service_order_id,
               u.full_name AS created_by_name
        FROM demands d
        LEFT JOIN users u ON u.id = d.created_by
        WHERE {w}
        ORDER BY d.created_at DESC
    """), p)).fetchall()
    cols = ["id", "title", "description", "status", "phase", "priority",
            "assigned_to", "assigned_to_name", "due_date", "notes",
            "created_at", "updated_at", "service_order_id", "created_by_name"]
    return [dict(zip(cols, [str(v) if v is not None else None for v in r])) for r in rows]


@router.post("", status_code=201)
async def create_demand(
    body: CreateDemandRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    if body.status not in VALID_STATUSES:
        raise HTTPException(400, f"status inválido: {body.status}")
    if body.phase not in VALID_PHASES:
        raise HTTPException(400, f"phase inválido: {body.phase}")
    if body.priority not in VALID_PRIORITIES:
        raise HTTPException(400, f"priority inválido: {body.priority}")

    row = (await session.execute(text("""
        INSERT INTO demands (association_id, title, description, status, phase, priority,
                             assigned_to, assigned_to_name, due_date, notes, created_by, service_order_id)
        VALUES (:aid, :title, :desc, :status, :phase, :priority,
                :at, :atn, :dd, :notes, :cb, :so_id)
        RETURNING id, title, status, phase, priority, assigned_to_name, due_date, created_at, service_order_id
    """), {
        "aid": str(current.association_id), "title": body.title, "desc": body.description,
        "status": body.status, "phase": body.phase, "priority": body.priority,
        "at": str(body.assigned_to) if body.assigned_to else None,
        "atn": body.assigned_to_name, "dd": body.due_date, "notes": body.notes,
        "cb": str(current.user_id),
        "so_id": str(body.service_order_id) if body.service_order_id else None,
    })).fetchone()
    await session.commit()
    cols = ["id", "title", "status", "phase", "priority", "assigned_to_name", "due_date", "created_at", "service_order_id"]
    return dict(zip(cols, [str(v) if v is not None else None for v in row]))


@router.patch("/{demand_id}")
async def update_demand(
    demand_id: UUID,
    body: UpdateDemandRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    sets: list[str] = ["updated_at = NOW()"]
    p: dict = {"aid": str(current.association_id), "did": str(demand_id)}

    if body.title is not None:            sets.append("title = :title");             p["title"] = body.title
    if body.description is not None:      sets.append("description = :desc");        p["desc"] = body.description
    if body.status is not None:
        if body.status not in VALID_STATUSES: raise HTTPException(400, "status inválido")
        sets.append("status = :status");  p["status"] = body.status
    if body.phase is not None:
        if body.phase not in VALID_PHASES: raise HTTPException(400, "phase inválido")
        sets.append("phase = :phase");    p["phase"] = body.phase
    if body.priority is not None:
        if body.priority not in VALID_PRIORITIES: raise HTTPException(400, "priority inválido")
        sets.append("priority = :priority"); p["priority"] = body.priority
    if body.assigned_to is not None:      sets.append("assigned_to = :at");          p["at"] = str(body.assigned_to)
    if body.assigned_to_name is not None: sets.append("assigned_to_name = :atn");    p["atn"] = body.assigned_to_name
    if body.due_date is not None:         sets.append("due_date = :dd");             p["dd"] = body.due_date
    if body.notes is not None:            sets.append("notes = :notes");             p["notes"] = body.notes
    if body.service_order_id is not None: sets.append("service_order_id = :so_id"); p["so_id"] = str(body.service_order_id)

    row = (await session.execute(text(f"""
        UPDATE demands SET {', '.join(sets)}
        WHERE id = :did AND association_id = :aid
        RETURNING id, title, description, status, phase, priority,
                  assigned_to, assigned_to_name, due_date, notes, updated_at, service_order_id
    """), p)).fetchone()
    if not row:
        raise HTTPException(404, "Demanda não encontrada.")
    await session.commit()
    cols = ["id", "title", "description", "status", "phase", "priority",
            "assigned_to", "assigned_to_name", "due_date", "notes", "updated_at", "service_order_id"]
    return dict(zip(cols, [str(v) if v is not None else None for v in row]))


@router.delete("/{demand_id}", status_code=204)
async def delete_demand(
    demand_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    res = await session.execute(text(
        "DELETE FROM demands WHERE id = :did AND association_id = :aid"
    ), {"did": str(demand_id), "aid": str(current.association_id)})
    if res.rowcount == 0:
        raise HTTPException(404, "Demanda não encontrada.")
    await session.commit()


@router.post("/reminders/trigger", summary="Cron: enviar lembretes de prazo do dia")
async def trigger_reminders(
    authorization: str | None = Header(None),
) -> dict:
    settings = get_settings()
    if settings.cron_secret:
        expected = f"Bearer {settings.cron_secret}"
        if authorization != expected:
            raise HTTPException(401, "Não autorizado")

    today = date.today().isoformat()
    sent = 0

    async with AsyncSessionLocal() as session:
        rows = (await session.execute(text("""
            SELECT d.id, d.title, d.association_id, d.assigned_to_name,
                   d.service_order_id, u.email, u.full_name,
                   so.order_number
            FROM demands d
            LEFT JOIN users u ON u.full_name = d.assigned_to_name
                              AND u.association_id = d.association_id
            LEFT JOIN service_orders so ON so.id = d.service_order_id
            WHERE d.due_date = :today
              AND d.status != 'concluido'
              AND d.reminded_at IS NULL
              AND d.assigned_to_name IS NOT NULL
        """), {"today": today})).fetchall()

        for r in rows:
            demand_id, title, assoc_id, atn, so_id, email, full_name, so_num = r
            due_fmt = date.today().strftime("%d/%m/%Y")

            # Chat message
            try:
                from app.routers.chat import post_system_message
                so_ref = f" (OS #{so_num})" if so_num else ""
                msg = f'⏰ Lembrete: prazo da demanda "{title}"{so_ref} vence hoje — responsável: {atn}'
                await post_system_message(str(assoc_id), msg, session)
            except Exception:
                pass

            # Email
            if email:
                try:
                    from app.services.email_service import reminder_html, send_email
                    send_email(
                        to=email,
                        subject=f"⏰ Prazo hoje: {title}",
                        html=reminder_html(title, due_fmt, str(so_num) if so_num else None),
                    )
                except Exception:
                    pass

            await session.execute(text(
                "UPDATE demands SET reminded_at = NOW() WHERE id = :id"
            ), {"id": str(demand_id)})
            sent += 1

        await session.commit()

    return {"sent": sent, "date": today}
