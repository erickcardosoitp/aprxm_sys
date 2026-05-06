from __future__ import annotations

from datetime import date, date as date_type, datetime
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session

router = APIRouter(prefix="/daily-tasks", tags=["Tarefas Diárias"])


async def _group_assoc_ids(association_id: str, session: AsyncSession) -> list[str]:
    row = (await session.execute(
        text("SELECT chat_group FROM associations WHERE id = :aid"),
        {"aid": association_id},
    )).fetchone()
    group = row[0] if row else None
    if group:
        rows = (await session.execute(
            text("SELECT id FROM associations WHERE chat_group = :g"),
            {"g": group},
        )).fetchall()
    else:
        rows = (await session.execute(
            text("SELECT id FROM associations WHERE id = :aid"),
            {"aid": association_id},
        )).fetchall()
    return [str(r[0]) for r in rows]


class CreateDailyTaskRequest(BaseModel):
    title: str
    description: str | None = None
    assigned_to: UUID | None = None
    assigned_to_name: str | None = None
    due_date: str | None = None
    reminder_at: str | None = None
    checklist: list[dict] = []
    attachment_urls: list[str] = []
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
    attachment_urls: list[str] | None = None
    status: str | None = None
    service_order_id: UUID | None = None
    service_order_title: str | None = None


@router.get("/users/group", summary="Usuários do grupo de associações")
async def list_group_users(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    row = (await session.execute(
        text("SELECT chat_group FROM associations WHERE id = :aid"),
        {"aid": str(current.association_id)},
    )).fetchone()
    group = row[0] if row else None
    if group:
        rows = (await session.execute(text("""
            SELECT u.id, u.full_name, u.role, a.name AS assoc_name
            FROM users u
            JOIN associations a ON a.id = u.association_id
            WHERE a.chat_group = :g AND u.is_active = true
            ORDER BY u.full_name
        """), {"g": group})).fetchall()
    else:
        rows = (await session.execute(text("""
            SELECT u.id, u.full_name, u.role, a.name AS assoc_name
            FROM users u
            JOIN associations a ON a.id = u.association_id
            WHERE u.association_id = :aid AND u.is_active = true
            ORDER BY u.full_name
        """), {"aid": str(current.association_id)})).fetchall()
    return [{"id": str(r[0]), "full_name": r[1], "role": r[2], "assoc_name": r[3]} for r in rows]


@router.get("", summary="Listar Tarefas Diárias")
async def list_tasks(
    assigned_to: UUID | None = None,
    status: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    aids = await _group_assoc_ids(str(current.association_id), session)
    filters = ["t.association_id = ANY(:aids)"]
    params: dict = {"aids": aids}
    if assigned_to:
        filters.append("t.assigned_to = :at")
        params["at"] = str(assigned_to)
    if status:
        filters.append("t.status = :status")
        params["status"] = status
    where = " AND ".join(filters)
    rows = (await session.execute(text(f"""
        SELECT t.id, t.title, t.description, t.assigned_to, t.assigned_to_name,
               t.due_date, t.reminder_at, t.status, t.checklist,
               t.service_order_id, t.service_order_title,
               t.created_by, u.full_name AS creator_name, t.created_at, t.updated_at,
               t.attachment_urls
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
           due_date, reminder_at, checklist, attachment_urls, service_order_id, service_order_title, created_by)
        VALUES
          (:aid, :title, :desc, :at, :at_name,
           :due, :reminder,
           CAST(:checklist AS jsonb), CAST(:attachments AS jsonb),
           :so_id, :so_title, :created_by)
        RETURNING id, title, description, assigned_to, assigned_to_name,
                  due_date, reminder_at, status, checklist,
                  service_order_id, service_order_title,
                  created_by, NULL, created_at, updated_at, attachment_urls
    """), {
        "aid": str(current.association_id),
        "title": body.title,
        "desc": body.description,
        "at": str(body.assigned_to) if body.assigned_to else None,
        "at_name": body.assigned_to_name,
        "due": date_type.fromisoformat(body.due_date) if body.due_date else None,
        "reminder": datetime.fromisoformat(body.reminder_at) if body.reminder_at else None,
        "checklist": json.dumps(body.checklist),
        "attachments": json.dumps(body.attachment_urls),
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
    if body.due_date is not None: sets.append("due_date = :due"); params["due"] = date_type.fromisoformat(body.due_date)
    if body.reminder_at is not None: sets.append("reminder_at = :reminder"); params["reminder"] = datetime.fromisoformat(body.reminder_at)
    if body.checklist is not None: sets.append("checklist = CAST(:checklist AS jsonb)"); params["checklist"] = json.dumps(body.checklist)
    if body.attachment_urls is not None: sets.append("attachment_urls = CAST(:attachments AS jsonb)"); params["attachments"] = json.dumps(body.attachment_urls)
    if body.status is not None: sets.append("status = :status"); params["status"] = body.status
    if body.service_order_id is not None: sets.append("service_order_id = :so_id"); params["so_id"] = str(body.service_order_id)
    if body.service_order_title is not None: sets.append("service_order_title = :so_title"); params["so_title"] = body.service_order_title
    if not sets:
        return {"ok": True}
    sets.append("updated_at = NOW()")
    await session.execute(text(f"UPDATE daily_tasks SET {', '.join(sets)} WHERE id = :id AND association_id = :aid"), params)
    await session.commit()
    return {"ok": True}


class AddCommentRequest(BaseModel):
    comment: str
    attachment_urls: list[str] = []


@router.post("/{task_id}/comments", summary="Adicionar acompanhamento")
async def add_comment(
    task_id: UUID,
    body: AddCommentRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    import json
    row = (await session.execute(text("""
        INSERT INTO daily_task_comments (task_id, association_id, created_by, comment, attachment_urls)
        VALUES (:tid, :aid, :uid, :comment, CAST(:attachments AS jsonb))
        RETURNING id, created_at
    """), {
        "tid": str(task_id),
        "aid": str(current.association_id),
        "uid": str(current.user_id),
        "comment": body.comment,
        "attachments": json.dumps(body.attachment_urls),
    })).fetchone()
    await session.commit()
    author = (await session.execute(
        text("SELECT full_name FROM users WHERE id = :id"), {"id": str(current.user_id)}
    )).scalar() or "Usuário"
    return {
        "id": str(row[0]), "created_at": str(row[1]),
        "author_name": author, "comment": body.comment,
        "attachment_urls": body.attachment_urls,
    }


@router.get("/{task_id}/comments", summary="Listar acompanhamentos")
async def list_comments(
    task_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    aids = await _group_assoc_ids(str(current.association_id), session)
    rows = (await session.execute(text("""
        SELECT c.id, c.comment, c.attachment_urls, c.created_at, u.full_name
        FROM daily_task_comments c
        JOIN users u ON u.id = c.created_by
        WHERE c.task_id = :tid AND c.association_id = ANY(:aids)
        ORDER BY c.created_at ASC
    """), {"tid": str(task_id), "aids": aids})).fetchall()
    return [
        {"id": str(r[0]), "comment": r[1], "attachment_urls": r[2] or [],
         "created_at": str(r[3]), "author_name": r[4]}
        for r in rows
    ]


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


@router.get("/report/by-user", summary="Relatório de atividade por colaborador")
async def report_by_user(
    date_from: str | None = None,
    date_to: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    aids = await _group_assoc_ids(str(current.association_id), session)
    params: dict = {"aids": aids}
    date_filter_task = ""
    date_filter_comment = ""
    if date_from:
        date_filter_task += " AND t.created_at >= CAST(:df AS timestamptz)"
        date_filter_comment += " AND c.created_at >= CAST(:df AS timestamptz)"
        params["df"] = date.fromisoformat(date_from)
    if date_to:
        date_filter_task += " AND t.created_at < CAST(:dt AS timestamptz) + interval '1 day'"
        date_filter_comment += " AND c.created_at < CAST(:dt AS timestamptz) + interval '1 day'"
        params["dt"] = date.fromisoformat(date_to)

    # Tasks assigned to or created by user
    task_rows = (await session.execute(text(f"""
        SELECT
            u.id AS user_id,
            u.full_name AS user_name,
            t.id, t.title, t.status, t.due_date, t.service_order_title,
            t.checklist, t.created_at, t.updated_at,
            CASE WHEN t.assigned_to = u.id THEN 'assigned' ELSE 'created' END AS relation
        FROM users u
        JOIN daily_tasks t ON (t.assigned_to = u.id OR t.created_by = u.id)
        WHERE t.association_id = ANY(:aids)
          AND u.association_id = ANY(:aids)
          {date_filter_task}
        ORDER BY u.full_name, t.created_at DESC
    """), params)).fetchall()

    # Comments / acompanhamentos by user
    comment_rows = (await session.execute(text(f"""
        SELECT
            c.created_by AS user_id,
            u.full_name AS user_name,
            c.id, c.comment, c.created_at,
            t.id AS task_id, t.title AS task_title
        FROM daily_task_comments c
        JOIN users u ON u.id = c.created_by
        JOIN daily_tasks t ON t.id = c.task_id
        WHERE c.association_id = ANY(:aids)
          {date_filter_comment}
        ORDER BY c.created_at DESC
    """), params)).fetchall()

    # Group by user
    import json as _json
    from collections import defaultdict
    users_map: dict = {}

    for r in task_rows:
        uid = str(r[0])
        if uid not in users_map:
            users_map[uid] = {"user_id": uid, "user_name": r[1], "tasks": [], "comments": []}
        # avoid duplicate tasks (assigned+created)
        if not any(t["id"] == str(r[2]) for t in users_map[uid]["tasks"]):
            checklist = r[7]
            if isinstance(checklist, str):
                try: checklist = _json.loads(checklist)
                except: checklist = []
            users_map[uid]["tasks"].append({
                "id": str(r[2]), "title": r[3], "status": r[4],
                "due_date": str(r[5]) if r[5] else None,
                "so_title": r[6], "checklist": checklist or [],
                "created_at": str(r[8])[:16], "relation": r[10],
            })

    for r in comment_rows:
        uid = str(r[0])
        if uid not in users_map:
            users_map[uid] = {"user_id": uid, "user_name": r[1], "tasks": [], "comments": []}
        users_map[uid]["comments"].append({
            "id": str(r[2]), "comment": r[3],
            "created_at": str(r[4])[:16],
            "task_id": str(r[5]), "task_title": r[6],
        })

    result = []
    for entry in users_map.values():
        tasks = entry["tasks"]
        concluidas = sum(1 for t in tasks if t["status"] == "done")
        atrasadas = sum(1 for t in tasks if t["status"] != "done" and t["due_date"] and t["due_date"] < str(date.today()))
        result.append({
            "user_id": entry["user_id"],
            "user_name": entry["user_name"],
            "total": len(tasks),
            "concluidas": concluidas,
            "atrasadas": atrasadas,
            "tasks": tasks,
            "comments": entry["comments"],
            "total_comments": len(entry["comments"]),
        })

    result.sort(key=lambda x: (-x["total_comments"] - x["total"], x["user_name"]))
    return result


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
        "attachment_urls": r[15] or [],
    }
