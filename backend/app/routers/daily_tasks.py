from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session

router = APIRouter(prefix="/daily-tasks", tags=["Tarefas Diárias"])


class CreateDailyTaskRequest(BaseModel):
    title: str
    description: str | None = None
    assigned_to: UUID | None = None
    assigned_to_name: str | None = None
    due_date: str | None = None
    reminder_at: str | None = None
    checklist: list[dict] = []
    service_order_id: UUID | None = None
    service_order_title: str | None = None


class UpdateDailyTaskRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    assigned_to: UUID | None = None
    assigned_to_name: str | None = None
    due_date: str | None = None
    reminder_at: str | None = None
    checklist: list[dict] | None = None
    status: str | None = None
    service_order_id: UUID | None = None
    service_order_title: str | None = None


@router.get("", summary="Listar Tarefas Diárias")
async def list_tasks(
    assigned_to: UUID | None = None,
    status: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    filters = ["association_id = :aid"]
    params: dict = {"aid": str(current.association_id)}
    if assigned_to:
        filters.append("assigned_to = :at")
        params["at"] = str(assigned_to)
    if status:
        filters.append("status = :status")
        params["status"] = status
    where = " AND ".join(filters)
    rows = (await session.execute(text(f"""
        SELECT t.id, t.title, t.description, t.assigned_to, t.assigned_to_name,
               t.due_date, t.reminder_at, t.status, t.checklist,
               t.service_order_id, t.service_order_title,
               t.created_by, u.full_name AS creator_name, t.created_at, t.updated_at
        FROM daily_tasks t
        LEFT JOIN users u ON u.id = t.created_by
        WHERE {where}
        ORDER BY
            CASE WHEN t.status = 'done' THEN 1 ELSE 0 END,
            t.due_date ASC NULLS LAST,
            t.created_at DESC
    """), params)).fetchall()
    return [_row_to_dict(r) for r in rows]


@router.post("", summary="Criar Tarefa Diária")
async def create_task(
    body: CreateDailyTaskRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    import json
    row = (await session.execute(text("""
        INSERT INTO daily_tasks
          (association_id, title, description, assigned_to, assigned_to_name,
           due_date, reminder_at, checklist, service_order_id, service_order_title, created_by)
        VALUES
          (:aid, :title, :desc, :at, :at_name,
           :due, :reminder, CAST(:checklist AS jsonb), :so_id, :so_title, :created_by)
        RETURNING id, title, description, assigned_to, assigned_to_name,
                  due_date, reminder_at, status, checklist,
                  service_order_id, service_order_title,
                  created_by, NULL, created_at, updated_at
    """), {
        "aid": str(current.association_id),
        "title": body.title,
        "desc": body.description,
        "at": str(body.assigned_to) if body.assigned_to else None,
        "at_name": body.assigned_to_name,
        "due": body.due_date or None,
        "reminder": body.reminder_at or None,
        "checklist": json.dumps(body.checklist),
        "so_id": str(body.service_order_id) if body.service_order_id else None,
        "so_title": body.service_order_title,
        "created_by": str(current.user_id),
    })).fetchone()
    await session.commit()
    return _row_to_dict(row)


@router.patch("/{task_id}", summary="Atualizar Tarefa Diária")
async def update_task(
    task_id: UUID,
    body: UpdateDailyTaskRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    import json
    sets, params = [], {"id": str(task_id), "aid": str(current.association_id)}
    if body.title is not None: sets.append("title = :title"); params["title"] = body.title
    if body.description is not None: sets.append("description = :desc"); params["desc"] = body.description
    if body.assigned_to is not None: sets.append("assigned_to = :at"); params["at"] = str(body.assigned_to)
    if body.assigned_to_name is not None: sets.append("assigned_to_name = :at_name"); params["at_name"] = body.assigned_to_name
    if body.due_date is not None: sets.append("due_date = :due"); params["due"] = body.due_date
    if body.reminder_at is not None: sets.append("reminder_at = :reminder"); params["reminder"] = body.reminder_at
    if body.checklist is not None: sets.append("checklist = CAST(:checklist AS jsonb)"); params["checklist"] = json.dumps(body.checklist)
    if body.status is not None: sets.append("status = :status"); params["status"] = body.status
    if body.service_order_id is not None: sets.append("service_order_id = :so_id"); params["so_id"] = str(body.service_order_id)
    if body.service_order_title is not None: sets.append("service_order_title = :so_title"); params["so_title"] = body.service_order_title
    if not sets:
        return {"ok": True}
    sets.append("updated_at = NOW()")
    await session.execute(text(f"UPDATE daily_tasks SET {', '.join(sets)} WHERE id = :id AND association_id = :aid"), params)
    await session.commit()
    return {"ok": True}


@router.delete("/{task_id}", summary="Excluir Tarefa Diária")
async def delete_task(
    task_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(text(
        "DELETE FROM daily_tasks WHERE id = :id AND association_id = :aid"
    ), {"id": str(task_id), "aid": str(current.association_id)})
    await session.commit()
    return {"ok": True}


@router.get("/report/by-user", summary="Relatório de entregas por colaborador")
async def report_by_user(
    date_from: str | None = None,
    date_to: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    filters = ["t.association_id = :aid"]
    params: dict = {"aid": str(current.association_id)}
    if date_from:
        filters.append("t.due_date >= :df")
        params["df"] = date_from
    if date_to:
        filters.append("t.due_date <= :dt")
        params["dt"] = date_to
    where = " AND ".join(filters)
    rows = (await session.execute(text(f"""
        SELECT
            t.assigned_to,
            t.assigned_to_name,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE t.status = 'done') AS concluidas,
            COUNT(*) FILTER (WHERE t.status != 'done' AND t.due_date < CURRENT_DATE) AS atrasadas,
            ARRAY_AGG(JSON_BUILD_OBJECT(
                'id', t.id,
                'title', t.title,
                'status', t.status,
                'due_date', t.due_date,
                'so_title', t.service_order_title,
                'checklist', t.checklist
            ) ORDER BY t.due_date ASC NULLS LAST) AS tasks
        FROM daily_tasks t
        WHERE {where} AND t.assigned_to IS NOT NULL
        GROUP BY t.assigned_to, t.assigned_to_name
        ORDER BY concluidas DESC
    """), params)).fetchall()
    return [
        {
            "user_id": str(r[0]),
            "user_name": r[1],
            "total": r[2],
            "concluidas": r[3],
            "atrasadas": r[4],
            "tasks": r[5] or [],
        }
        for r in rows
    ]


def _row_to_dict(r) -> dict:
    return {
        "id": str(r[0]),
        "title": r[1],
        "description": r[2],
        "assigned_to": str(r[3]) if r[3] else None,
        "assigned_to_name": r[4],
        "due_date": str(r[5]) if r[5] else None,
        "reminder_at": str(r[6]) if r[6] else None,
        "status": r[7],
        "checklist": r[8] or [],
        "service_order_id": str(r[9]) if r[9] else None,
        "service_order_title": r[10],
        "created_by": str(r[11]) if r[11] else None,
        "creator_name": r[12],
        "created_at": str(r[13]),
        "updated_at": str(r[14]),
    }
