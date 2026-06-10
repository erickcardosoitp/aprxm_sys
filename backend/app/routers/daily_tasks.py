from __future__ import annotations

from datetime import date, date as date_type, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.tenant import CurrentUser, get_current_user
from app.database import AsyncSessionLocal, get_session
from app.routers.chat import post_system_message

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
    status: str | None = None


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


class EditCommentRequest(BaseModel):
    comment: str


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
    view: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from datetime import date as _date
    aids = await _group_assoc_ids(str(current.association_id), session)
    filters = ["t.association_id = ANY(:aids)", "t.deleted_at IS NULL"]
    params: dict = {"aids": aids}
    if assigned_to:
        filters.append("t.assigned_to = :at")
        params["at"] = str(assigned_to)
    if status:
        filters.append("t.status = :status")
        params["status"] = status
    if view == "default":
        filters.append("(t.status != 'done' OR (t.updated_at AT TIME ZONE 'America/Sao_Paulo')::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date)")
    else:
        if date_from:
            try:
                params["df"] = date.fromisoformat(date_from)
                filters.append("t.due_date >= :df")
            except ValueError:
                pass
        if date_to:
            try:
                params["dt"] = date.fromisoformat(date_to)
                filters.append("t.due_date <= :dt")
            except ValueError:
                pass
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
            CASE WHEN t.due_date < CURRENT_DATE AND t.status != 'done' THEN 0
                 WHEN t.due_date IS NULL AND t.status != 'done' THEN 1
                 ELSE 2 END,
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
    initial_status = body.status if body.status in ("pending", "in_progress") else "pending"
    row = (await session.execute(text("""
        INSERT INTO daily_tasks
          (association_id, title, description, assigned_to, assigned_to_name,
           due_date, reminder_at, checklist, attachment_urls, service_order_id, service_order_title, created_by, status)
        VALUES
          (:aid, :title, :desc, :at, :at_name,
           :due, :reminder,
           CAST(:checklist AS jsonb), CAST(:attachments AS jsonb),
           :so_id, :so_title, (SELECT id FROM users WHERE id = :created_by LIMIT 1), :status)
        RETURNING id, title, description, assigned_to, assigned_to_name,
                  due_date, reminder_at, status, checklist,
                  service_order_id, service_order_title,
                  created_by, NULL, created_at, updated_at, attachment_urls
    """), {
        "aid": str(current.association_id),
        "title": body.title.strip(),
        "desc": body.description.strip() or None if body.description else None,
        "at": str(body.assigned_to) if body.assigned_to else None,
        "at_name": body.assigned_to_name,
        "due": date_type.fromisoformat(body.due_date) if body.due_date else None,
        "reminder": datetime.fromisoformat(body.reminder_at) if body.reminder_at else None,
        "checklist": json.dumps(body.checklist),
        "attachments": json.dumps(body.attachment_urls),
        "so_id": str(body.service_order_id) if body.service_order_id else None,
        "so_title": body.service_order_title,
        "created_by": str(current.user_id),
        "status": initial_status,
    })).fetchone()
    # Chat: postar mensagem automática ao criar tarefa
    try:
        so_ref = f' (OS: {body.service_order_title})' if body.service_order_title else ''
        responsible = body.assigned_to_name or 'equipe'
        badge = f"[{current.association_name}] " if current.association_name else ""
        msg = f'{badge}📋 Tarefa criada: "{body.title}"{so_ref} → {responsible}'
        await post_system_message(str(current.association_id), msg, session)
    except Exception:
        pass

    await session.commit()

    if body.assigned_to and str(body.assigned_to) != str(current.user_id):
        try:
            from app.routers.notifications import create_notification
            so_ctx = f' (OS: {body.service_order_title})' if body.service_order_title else ''
            await create_notification(
                str(current.association_id), str(body.assigned_to),
                "📋 Nova tarefa atribuída",
                f'Você foi atribuído(a) à tarefa "{body.title}"{so_ctx}',
                "task",
            )
        except Exception:
            pass
    return _row_to_dict(row)


@router.patch("/{task_id}", summary="Atualizar Tarefa Diária")
async def update_task(
    task_id: UUID,
    body: UpdateDailyTaskRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    import json
    aids = await _group_assoc_ids(str(current.association_id), session)
    sets, params = [], {"id": str(task_id), "aids": aids}
    if body.title is not None: sets.append("title = :title"); params["title"] = body.title.strip()
    if body.description is not None: sets.append("description = :desc"); params["desc"] = body.description.strip() or None
    if body.assigned_to is not None: sets.append("assigned_to = :at"); params["at"] = str(body.assigned_to)
    if body.assigned_to_name is not None: sets.append("assigned_to_name = :at_name"); params["at_name"] = body.assigned_to_name
    if body.due_date is not None: sets.append("due_date = :due"); params["due"] = date_type.fromisoformat(body.due_date)
    if body.reminder_at is not None: sets.append("reminder_at = :reminder"); params["reminder"] = datetime.fromisoformat(body.reminder_at)
    BLOCKING = {"pending", "in_progress", "waiting_third", "waiting_public"}
    TERMINAL = {"done", "cancelled", "postergado"}

    if body.checklist is not None:
        checklist = body.checklist
    elif body.status == "done":
        # valida e carrega checklist atual
        row_cl = (await session.execute(
            text("SELECT checklist FROM daily_tasks WHERE id = :id AND association_id = ANY(:aids)"),
            {"id": str(task_id), "aids": aids},
        )).fetchone()
        cl: list = (row_cl[0] if isinstance(row_cl[0], list) else []) if (row_cl and row_cl[0]) else []

        if cl:
            def _st(item: dict) -> str:
                return item.get("status") or ("done" if item.get("done") else "pending")

            # Regra 1: nenhum item pode estar em status bloqueante
            open_items = [item["text"] for item in cl if _st(item) in BLOCKING]
            if open_items:
                raise HTTPException(
                    status_code=422,
                    detail=f"Existem itens ainda em aberto: {'; '.join(t[:50] for t in open_items[:5])}. "
                           "Conclua, cancele ou postergue todos os itens antes de finalizar a tarefa.",
                )

            # Regra 2: todos os itens devem ter ao menos um acompanhamento
            comment_rows = (await session.execute(
                text("SELECT DISTINCT checklist_index FROM daily_task_comments WHERE task_id = :tid AND checklist_index IS NOT NULL"),
                {"tid": str(task_id)},
            )).fetchall()
            commented = {r[0] for r in comment_rows}
            missing = [item["text"] for idx, item in enumerate(cl) if idx not in commented]
            if missing:
                raise HTTPException(
                    status_code=422,
                    detail=f"Itens sem acompanhamento: {'; '.join(t[:50] for t in missing[:5])}. "
                           "Registre um acompanhamento em cada item antes de concluir.",
                )

        checklist = [
            {**item, "done": True, "status": "done"}
            if _st(item) not in TERMINAL
            else item
            for item in cl
        ] if cl else None
    else:
        checklist = None
    if checklist is not None:
        sets.append("checklist = CAST(:checklist AS jsonb)")
        params["checklist"] = json.dumps(checklist)
    if body.attachment_urls is not None: sets.append("attachment_urls = CAST(:attachments AS jsonb)"); params["attachments"] = json.dumps(body.attachment_urls)
    if body.status is not None: sets.append("status = :status"); params["status"] = body.status
    if body.service_order_id is not None: sets.append("service_order_id = :so_id"); params["so_id"] = str(body.service_order_id)
    if body.service_order_title is not None: sets.append("service_order_title = :so_title"); params["so_title"] = body.service_order_title
    if not sets:
        return {"ok": True}
    sets.append("updated_at = NOW()")
    row = (await session.execute(
        text(f"UPDATE daily_tasks SET {', '.join(sets)} WHERE id = :id AND association_id = ANY(:aids) RETURNING title, assigned_to, service_order_title"),
        params,
    )).fetchone()
    await session.commit()
    if body.assigned_to and row and str(body.assigned_to) != str(current.user_id):
        try:
            from app.routers.notifications import create_notification
            so_ctx = f' (OS: {row[2]})' if row[2] else ''
            await create_notification(
                str(current.association_id), str(body.assigned_to),
                "📋 Tarefa atribuída a você",
                f'Você foi atribuído(a) à tarefa "{row[0]}"{so_ctx}',
                "task",
            )
        except Exception:
            pass
    return {"ok": True}


class AddCommentRequest(BaseModel):
    comment: str = ""
    attachment_urls: list[str] = []
    checklist_index: int | None = None


# ── Rotas sem parâmetro de path (devem vir ANTES de /{task_id}) ────────────────

@router.get("/report/by-user", summary="Relatório de atividade por colaborador")
async def report_by_user(
    date_from: str | None = None,
    date_to: str | None = None,
    user_id: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    aids = await _group_assoc_ids(str(current.association_id), session)
    params: dict = {"aids": aids}
    date_filter_task = ""
    date_filter_os_hist = ""
    date_filter_os_comment = ""
    uid_filter_task = ""
    uid_filter_user = ""
    if date_from:
        date_filter_task += " AND (t.created_at >= CAST(:df AS timestamptz) OR (t.status = 'done' AND t.updated_at >= CAST(:df AS timestamptz)))"
        date_filter_os_hist += " AND h.changed_at >= CAST(:df AS timestamptz)"
        date_filter_os_comment += " AND c.created_at >= CAST(:df AS timestamptz)"
        params["df"] = date.fromisoformat(date_from)
    if date_to:
        date_filter_task += " AND (t.created_at < CAST(:dt AS timestamptz) + interval '1 day' OR t.status = 'done')"
        date_filter_os_hist += " AND h.changed_at < CAST(:dt AS timestamptz) + interval '1 day'"
        date_filter_os_comment += " AND c.created_at < CAST(:dt AS timestamptz) + interval '1 day'"
        params["dt"] = date.fromisoformat(date_to)
    if user_id:
        uid_filter_task = " AND (t.assigned_to = :uid OR t.created_by = :uid)"
        uid_filter_user = " AND u.id = :uid"
        params["uid"] = user_id

    # Tasks — FROM daily_tasks para incluir tarefas ITP mesmo com assigned_to deletado
    task_rows = (await session.execute(text(f"""
        SELECT
            COALESCE(ua.full_name, t.assigned_to_name, uc.full_name, 'Desconhecido') AS user_name,
            t.id, t.title, t.status, t.due_date, t.service_order_title,
            t.checklist, t.created_at,
            CASE WHEN t.assigned_to IS NOT NULL THEN 'assigned' ELSE 'created' END AS relation
        FROM daily_tasks t
        LEFT JOIN users ua ON ua.id = t.assigned_to
        LEFT JOIN users uc ON uc.id = t.created_by
        WHERE t.association_id = ANY(:aids)
          {date_filter_task}{uid_filter_task}
        ORDER BY user_name, t.created_at DESC
    """), params)).fetchall()

    # Comentários — buscar por task_id (para embedar em cada tarefa)
    task_ids = list({str(r[1]) for r in task_rows})
    comments_by_task: dict = {}
    if task_ids:
        c_rows = (await session.execute(text("""
            SELECT c.task_id, COALESCE(u.full_name, 'Usuário') AS full_name,
                   c.id, c.comment, c.created_at, c.checklist_index
            FROM daily_task_comments c
            LEFT JOIN users u ON u.id = c.created_by
            WHERE c.task_id = ANY(:tids)
            ORDER BY c.created_at ASC
        """), {"tids": task_ids})).fetchall()
        for cr in c_rows:
            comments_by_task.setdefault(str(cr[0]), []).append({
                "commenter": cr[1], "id": str(cr[2]),
                "comment": cr[3], "created_at": str(cr[4])[:16],
                "checklist_index": cr[5],
            })

    # OS: mudanças de status (service_order_history)
    os_hist_rows = (await session.execute(text(f"""
        SELECT
            h.changed_by AS user_id,
            u.full_name AS user_name,
            h.to_status, h.changed_at,
            so.id AS so_id, so.title AS so_title, so.number AS so_number
        FROM service_order_history h
        JOIN users u ON u.id = h.changed_by
        JOIN service_orders so ON so.id = h.service_order_id
        WHERE h.association_id = ANY(:aids)
          AND u.association_id = ANY(:aids)
          AND h.to_status IN ('resolved', 'in_progress', 'cancelled')
          {date_filter_os_hist}{uid_filter_user}
        ORDER BY h.changed_at DESC
    """), params)).fetchall()

    # OS: comentários (service_order_comments)
    os_comment_rows = (await session.execute(text(f"""
        SELECT
            c.created_by AS user_id,
            u.full_name AS user_name,
            c.id, c.comment, c.created_at,
            so.id AS so_id, so.title AS so_title, so.number AS so_number
        FROM service_order_comments c
        LEFT JOIN users u ON u.id = c.created_by
        JOIN service_orders so ON so.id = c.service_order_id
        WHERE c.association_id = ANY(:aids)
          {date_filter_os_comment}{uid_filter_user}
        ORDER BY c.created_at DESC
    """), params)).fetchall()

    # OS: registros abertos/em andamento atribuídos ou criados pelo usuário
    uid_filter_os_direct = ""
    if user_id:
        uid_filter_os_direct = " AND (so.assigned_to = :uid OR so.requester_user_id = :uid)"
    os_open_rows = (await session.execute(text(f"""
        SELECT
            COALESCE(ua.full_name, uc.full_name, 'Desconhecido') AS user_name,
            so.id, so.title, so.number, so.status, so.created_at
        FROM service_orders so
        LEFT JOIN users ua ON ua.id = so.assigned_to
        LEFT JOIN users uc ON uc.id = so.requester_user_id
        WHERE so.association_id = ANY(:aids)
          AND so.status NOT IN ('resolved', 'cancelled')
          {uid_filter_os_direct}
        ORDER BY so.created_at DESC
    """), params)).fetchall()

    import json as _json

    # Agrupar por nome (unifica mesma pessoa em associações diferentes)
    users_map: dict = {}  # key = user_name.lower()

    def _ensure(name: str) -> dict:
        key = name.strip().lower()
        if key not in users_map:
            users_map[key] = {
                "user_name": name, "tasks": [],
                "os_entregas": [], "os_andamento": [],
            }
        return users_map[key]

    for r in task_rows:
        entry = _ensure(r[0])  # r[0] = user_name
        tid = str(r[1])
        if not any(t["id"] == tid for t in entry["tasks"]):
            cl = r[6]
            if isinstance(cl, str):
                try: cl = _json.loads(cl)
                except: cl = []
            entry["tasks"].append({
                "id": tid, "title": r[2], "status": r[3],
                "due_date": str(r[4]) if r[4] else None,
                "so_title": r[5], "checklist": cl or [],
                "created_at": str(r[7])[:16], "relation": r[8],
                "comments": comments_by_task.get(tid, []),
            })

    for r in os_hist_rows:
        entry = _ensure(r[1])
        ev = {"so_id": str(r[4]), "so_title": r[5], "so_number": r[6],
              "changed_at": str(r[3])[:16], "action": r[2]}
        if r[2] == "resolved":
            entry["os_entregas"].append(ev)
        else:
            entry["os_andamento"].append(ev)

    for r in os_comment_rows:
        entry = _ensure(r[1])
        entry["os_andamento"].append({
            "so_id": str(r[5]), "so_title": r[6], "so_number": r[7],
            "changed_at": str(r[4])[:16], "action": "commented", "comment": r[3],
        })

    # OS abertas/em andamento — aparece em os_andamento se ainda não listada
    seen_os: set = set()
    for ev_list in [e["os_entregas"] + e["os_andamento"] for e in users_map.values()]:
        for ev in ev_list:
            seen_os.add(ev["so_id"])
    for r in os_open_rows:
        user_name = r[0]
        so_id = str(r[1])
        entry = _ensure(user_name)
        # só adiciona se não apareceu via history/comment
        already = any(ev["so_id"] == so_id for ev in entry["os_andamento"] + entry["os_entregas"])
        if not already:
            entry["os_andamento"].append({
                "so_id": so_id, "so_title": r[2], "so_number": r[3],
                "changed_at": str(r[5])[:16], "action": r[4],
            })

    result = []
    today_str = str(date.today())
    for entry in users_map.values():
        tasks = entry["tasks"]
        # % por item de checklist (não por tarefa)
        total_items = done_items = 0
        for t in tasks:
            cl = t["checklist"]
            if cl:
                total_items += len(cl)
                done_items += sum(1 for c in cl if c.get("done"))
            else:
                total_items += 1
                if t["status"] == "done":
                    done_items += 1
        concluidas = sum(1 for t in tasks if t["status"] == "done")
        bloqueadas = sum(1 for t in tasks if t["status"] == "blocked")
        atrasadas = sum(1 for t in tasks
                        if t["status"] not in ("done", "blocked")
                        and t["due_date"] and t["due_date"] < today_str)
        os_e = entry["os_entregas"]
        os_a = entry["os_andamento"]
        result.append({
            "user_name": entry["user_name"],
            "total": len(tasks),
            "concluidas": concluidas,
            "bloqueadas": bloqueadas,
            "atrasadas": atrasadas,
            "total_items": total_items,
            "done_items": done_items,
            "tasks": tasks,
            "os_entregas": os_e,
            "os_andamento": os_a,
            "total_os": len(os_e) + len(os_a),
        })

    result.sort(key=lambda x: (-x["total"] - x["total_os"], x["user_name"]))
    return result


@router.get("/report/pdf", summary="PDF por colaborador")
async def report_pdf(
    date_from: str | None = None,
    date_to: str | None = None,
    user_id: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    import json as _json
    from collections import OrderedDict
    from datetime import datetime as _dt
    from io import BytesIO as _BytesIO
    from fastapi.responses import Response
    from fpdf import FPDF

    aids = await _group_assoc_ids(str(current.association_id), session)
    assoc_row = (await session.execute(
        text("SELECT name FROM associations WHERE id = :aid"),
        {"aid": str(current.association_id)},
    )).fetchone()
    assoc_name = assoc_row[0] if assoc_row else "Associação"

    params: dict = {"aids": aids}
    df_filter = dt_filter = uid_filter = ""
    if date_from:
        try:
            params["df"] = date.fromisoformat(date_from)
            df_filter = " AND t.created_at >= CAST(:df AS timestamptz)"
        except ValueError:
            pass
    if date_to:
        try:
            params["dt"] = date.fromisoformat(date_to)
            dt_filter = " AND t.created_at < CAST(:dt AS timestamptz) + interval '1 day'"
        except ValueError:
            pass
    if user_id:
        uid_filter = " AND (t.assigned_to = :uid OR t.created_by = :uid)"
        params["uid"] = user_id

    rows = (await session.execute(text(f"""
        SELECT
            COALESCE(ua.full_name, t.assigned_to_name, uc.full_name, 'Desconhecido') AS user_name,
            t.id, t.title, t.status, t.due_date,
            t.checklist, t.attachment_urls, t.service_order_title
        FROM daily_tasks t
        LEFT JOIN users ua ON ua.id = t.assigned_to
        LEFT JOIN users uc ON uc.id = t.created_by
        WHERE t.association_id = ANY(:aids)
          {df_filter}{dt_filter}{uid_filter}
        ORDER BY user_name ASC, t.due_date ASC NULLS LAST
    """), params)).fetchall()

    task_ids = list({str(r[1]) for r in rows})
    comments_map: dict = {}
    if task_ids:
        c_rows = (await session.execute(text("""
            SELECT c.task_id, c.comment, c.attachment_urls, c.created_at, COALESCE(u.full_name, 'Usuário') AS full_name, c.checklist_index
            FROM daily_task_comments c
            LEFT JOIN users u ON u.id = c.created_by
            WHERE c.task_id = ANY(:tids)
            ORDER BY c.created_at ASC
        """), {"tids": task_ids})).fetchall()
        for cr in c_rows:
            tid = str(cr[0])
            att = cr[2] or []
            if isinstance(att, str):
                try: att = _json.loads(att)
                except: att = []
            comments_map.setdefault(tid, []).append({
                "comment": cr[1] or "", "attachment_urls": att,
                "created_at": str(cr[3])[:16], "author_name": cr[4],
                "checklist_index": cr[5],
            })

    # OS em andamento/abertas para os colaboradores do período
    os_uid_filter = " AND (so.assigned_to = :uid OR so.requester_user_id = :uid)" if user_id else ""
    os_rows = (await session.execute(text(f"""
        SELECT
            COALESCE(ua.full_name, uc.full_name, so.assigned_to_name, 'Desconhecido') AS user_name,
            so.id, so.number, so.title, so.status, so.priority,
            so.description, so.category_name, so.area, so.updated_at
        FROM service_orders so
        LEFT JOIN users ua ON ua.id = so.assigned_to
        LEFT JOIN users uc ON uc.id = so.requester_user_id
        WHERE so.association_id = ANY(:aids)
          AND so.status IN ('open', 'in_progress', 'waiting_third_party')
          {os_uid_filter}
        ORDER BY user_name ASC, so.number ASC
    """), params)).fetchall()

    users_map: OrderedDict = OrderedDict()
    for r in rows:
        key = r[0].strip().lower()
        if key not in users_map:
            users_map[key] = {"user_name": r[0], "tasks": [], "os_list": []}
        tid = str(r[1])
        if not any(t["id"] == tid for t in users_map[key]["tasks"]):
            cl = r[5]
            if isinstance(cl, str):
                try: cl = _json.loads(cl)
                except: cl = []
            att = r[6]
            if isinstance(att, str):
                try: att = _json.loads(att)
                except: att = []
            users_map[key]["tasks"].append({
                "id": tid, "title": r[2], "status": r[3],
                "due_date": str(r[4]) if r[4] else None,
                "checklist": cl or [], "attachment_urls": att or [],
                "so_title": r[7],
            })

    for r in os_rows:
        key = r[0].strip().lower()
        if key not in users_map:
            users_map[key] = {"user_name": r[0], "tasks": [], "os_list": []}
        so_id = str(r[1])
        if not any(o["id"] == so_id for o in users_map[key]["os_list"]):
            users_map[key]["os_list"].append({
                "id": so_id, "number": r[2], "title": r[3],
                "status": r[4], "priority": r[5],
                "description": r[6], "category_name": r[7],
                "area": r[8], "updated_at": str(r[9])[:10] if r[9] else None,
            })

    # Comentários das OS encontradas
    all_os_ids = [o["id"] for entry in users_map.values() for o in entry.get("os_list", [])]
    os_comments_map: dict = {}
    if all_os_ids:
        oc_rows = (await session.execute(text("""
            SELECT c.service_order_id, COALESCE(u.full_name, 'Usuário') AS full_name, c.comment, c.created_at
            FROM service_order_comments c
            LEFT JOIN users u ON u.id = c.created_by
            WHERE c.service_order_id = ANY(:oids)
            ORDER BY c.created_at ASC
        """), {"oids": all_os_ids})).fetchall()
        for cr in oc_rows:
            os_comments_map.setdefault(str(cr[0]), []).append({
                "author": cr[1], "comment": cr[2] or "",
                "created_at": str(cr[3])[:16],
            })

    def fmt_date(d: str) -> str:
        p = d.split("-")
        return f"{p[2]}/{p[1]}" if len(p) == 3 else d

    period_label = ""
    if date_from or date_to:
        period_label = f"Periodo: {fmt_date(date_from) if date_from else '-'} a {fmt_date(date_to) if date_to else '-'}"

    # ── Design System ─────────────────────────────────────────────────────────
    # Paleta: dark navy + accent dourado (não-genérico)
    INK        = (24, 31, 53)        # primary text
    INK_MUTED  = (105, 113, 138)     # secondary text
    INK_FAINT  = (165, 172, 195)     # tertiary
    BRAND      = (29, 53, 122)       # navy
    BRAND_SOFT = (235, 240, 252)     # navy 5%
    ACCENT     = (203, 158, 35)      # gold
    SUCCESS    = (22, 128, 78)
    WARNING    = (200, 110, 8)
    DANGER     = (180, 45, 60)
    INFO       = (28, 100, 180)
    PURPLE     = (130, 60, 180)
    LINE       = (228, 232, 240)
    SURFACE    = (250, 251, 253)

    STATUS_LABEL = {"pending": "Pendente", "in_progress": "Em andamento", "done": "Concluída", "blocked": "Bloqueada"}
    STATUS_COLOR = {
        "pending":     (WARNING, (255, 243, 224)),
        "in_progress": (INFO,    (224, 239, 255)),
        "done":        (SUCCESS, (224, 247, 235)),
        "blocked":     (DANGER,  (253, 230, 233)),
    }
    OS_STATUS_LABEL = {
        "open": "Aberta", "in_progress": "Em andamento",
        "waiting_third_party": "Aguard. terceiro",
        "resolved": "Resolvida", "cancelled": "Cancelada",
    }
    OS_STATUS_COLOR = {
        "open":                (WARNING, (255, 243, 224)),
        "in_progress":         (INFO,    (224, 239, 255)),
        "waiting_third_party": (PURPLE,  (240, 230, 250)),
    }
    OS_PRIORITY_LABEL = {"low": "Baixa", "medium": "Média", "high": "Alta", "critical": "Crítica"}
    OS_PRIORITY_COLOR = {
        "low":      (INK_MUTED, (240, 242, 247)),
        "medium":   (INFO,      (224, 239, 255)),
        "high":     (WARNING,   (255, 243, 224)),
        "critical": (DANGER,    (253, 230, 233)),
    }
    IS_IMAGE = lambda u: bool(u and u.lower().split("?")[0].endswith((".jpg", ".jpeg", ".png", ".gif", ".webp")))

    # ── Custom PDF class com header/footer ───────────────────────────────────
    class ReportPDF(FPDF):
        page_label = ""

        def header(self):
            if self.page_no() > 0 and hasattr(self, "_skip_header"):
                return

        def footer(self):
            self.set_y(-12)
            self.set_font("DejaVu", size=7)
            self.set_text_color(*INK_FAINT)
            now_str = _dt.utcnow().strftime("%d/%m/%Y às %H:%M")
            self.cell(0, 4, f"Gerado em {now_str}  •  APRXM  •  Página {self.page_no()}", align="C")

    pdf = ReportPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(left=14, top=14, right=14)

    # Registrar DejaVu Sans (Unicode nativo)
    import os as _os
    font_dir = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "assets", "fonts")
    pdf.add_font("DejaVu", "", _os.path.join(font_dir, "DejaVuSans.ttf"))
    pdf.add_font("DejaVu", "B", _os.path.join(font_dir, "DejaVuSans-Bold.ttf"))
    pdf.add_font("DejaVu", "I", _os.path.join(font_dir, "DejaVuSans-Oblique.ttf"))

    def hr(pdf: FPDF, y_offset=0):
        y = pdf.get_y() + y_offset
        pdf.set_draw_color(*LINE)
        pdf.set_line_width(0.2)
        pdf.line(pdf.l_margin, y, pdf.w - pdf.r_margin, y)

    def badge(pdf: FPDF, text: str, fg: tuple, bg: tuple, padding_x=2.5, height=4.5):
        """Renderiza um badge tipo pill com background colorido."""
        pdf.set_font("DejaVu", "B", 7)
        w = pdf.get_string_width(text) + padding_x * 2
        x, y = pdf.get_x(), pdf.get_y()
        pdf.set_fill_color(*bg)
        pdf.set_draw_color(*bg)
        pdf.rect(x, y, w, height, style="F", round_corners=True, corner_radius=1.2)
        pdf.set_text_color(*fg)
        pdf.set_xy(x, y + 0.3)
        pdf.cell(w, height - 0.6, text, align="C")
        pdf.set_xy(x + w + 1.5, y)
        pdf.set_text_color(*INK)

    def initials(name: str) -> str:
        parts = [p for p in name.strip().split() if p]
        if not parts: return "?"
        if len(parts) == 1: return parts[0][:2].upper()
        return (parts[0][0] + parts[-1][0]).upper()

    def kpi_card(pdf: FPDF, x: float, y: float, w: float, h: float, label: str, value: str, color: tuple):
        pdf.set_fill_color(*SURFACE)
        pdf.set_draw_color(*LINE)
        pdf.set_line_width(0.2)
        pdf.rect(x, y, w, h, style="DF", round_corners=True, corner_radius=1.5)
        pdf.set_xy(x + 2.5, y + 2)
        pdf.set_font("DejaVu", "", 7)
        pdf.set_text_color(*INK_MUTED)
        pdf.cell(w - 5, 3.5, label.upper())
        pdf.set_xy(x + 2.5, y + 5.8)
        pdf.set_font("DejaVu", "B", 13)
        pdf.set_text_color(*color)
        pdf.cell(w - 5, 6, value)
        pdf.set_text_color(*INK)

    def embed_attachments(pdf: FPDF, urls: list):
        if not urls: return
        pdf.set_font("DejaVu", "", 7)
        pdf.set_text_color(*INK_MUTED)
        pdf.cell(0, 3.5, "Anexos:", ln=True)
        pdf.set_text_color(*INK)
        images = [u for u in urls if IS_IMAGE(u)]
        files = [u for u in urls if not IS_IMAGE(u)]
        if images:
            y = pdf.get_y()
            x0 = pdf.l_margin + 4
            for i, img_url in enumerate(images):
                try:
                    import urllib.request as _ur
                    from io import BytesIO as _BIO
                    req = _ur.Request(img_url, headers={"User-Agent": "APRXM/1.0"})
                    with _ur.urlopen(req, timeout=3) as resp:
                        buf2 = _BIO(resp.read())
                    col = i % 4
                    if i > 0 and col == 0: y += 13
                    pdf.image(buf2, x=x0 + col * 13, y=y, w=11, h=11)
                except Exception:
                    pass
            rows_used = (len(images) - 1) // 4 + 1
            pdf.set_y(y + rows_used * 13)
        for fu in files:
            name = fu.split("/")[-1].split("?")[0][:50]
            pdf.set_font("DejaVu", "", 7)
            pdf.set_text_color(*INFO)
            pdf.cell(0, 4, f"  ↳ {name}", link=fu, ln=True)
            pdf.set_text_color(*INK)

    # ── Renderiza uma página por colaborador ─────────────────────────────────
    for uid, entry in users_map.items():
        pdf.add_page()

        # Header: banda colorida no topo
        pdf.set_fill_color(*BRAND)
        pdf.rect(0, 0, pdf.w, 4, style="F")

        # Title block
        pdf.set_y(8)
        pdf.set_font("DejaVu", "B", 16)
        pdf.set_text_color(*INK)
        pdf.cell(0, 7, assoc_name, ln=True)

        pdf.set_font("DejaVu", "", 8)
        pdf.set_text_color(*INK_MUTED)
        subtitle = "Relatório de Atividades — Tarefas Diárias e Ordens de Serviço"
        if period_label:
            subtitle = f"{subtitle}  •  {period_label}"
        pdf.cell(0, 4, subtitle, ln=True)
        pdf.ln(3)

        # Card do colaborador (avatar circular + nome + KPIs)
        tasks = entry["tasks"]
        os_list = entry.get("os_list", [])
        total_items = sum(len(t["checklist"]) for t in tasks)
        done_items = sum(sum(1 for i in t["checklist"] if i.get("done")) for t in tasks)
        pending_items = total_items - done_items

        card_y = pdf.get_y()
        card_h = 22
        pdf.set_fill_color(*BRAND_SOFT)
        pdf.set_draw_color(*BRAND_SOFT)
        pdf.rect(pdf.l_margin, card_y, pdf.w - pdf.l_margin - pdf.r_margin, card_h, style="F", round_corners=True, corner_radius=2)

        # Avatar circular com iniciais
        avatar_size = 14
        avatar_x = pdf.l_margin + 4
        avatar_y = card_y + (card_h - avatar_size) / 2
        pdf.set_fill_color(*BRAND)
        pdf.ellipse(avatar_x, avatar_y, avatar_size, avatar_size, style="F")
        pdf.set_font("DejaVu", "B", 10)
        pdf.set_text_color(255, 255, 255)
        pdf.set_xy(avatar_x, avatar_y + 4)
        pdf.cell(avatar_size, 6, initials(entry["user_name"]), align="C")

        # Nome + role
        pdf.set_xy(avatar_x + avatar_size + 4, card_y + 4)
        pdf.set_font("DejaVu", "B", 12)
        pdf.set_text_color(*INK)
        pdf.cell(80, 6, entry["user_name"], ln=True)
        pdf.set_xy(avatar_x + avatar_size + 4, card_y + 10)
        pdf.set_font("DejaVu", "", 8)
        pdf.set_text_color(*INK_MUTED)
        pdf.cell(80, 4, "Colaborador")

        # KPIs à direita (4 cards pequenos)
        kpis_x = pdf.l_margin + 90
        kpi_w = (pdf.w - pdf.r_margin - kpis_x - 6) / 4
        kpi_y = card_y + 4
        kpi_h = card_h - 8
        done_tasks = sum(1 for t in tasks if t["status"] == "done")
        blocked_tasks = sum(1 for t in tasks if t["status"] == "blocked")
        kpi_card(pdf, kpis_x + 0 * (kpi_w + 1.5), kpi_y, kpi_w, kpi_h, "Tarefas", str(len(tasks)), BRAND)
        kpi_card(pdf, kpis_x + 1 * (kpi_w + 1.5), kpi_y, kpi_w, kpi_h, "Concluídas", str(done_tasks), SUCCESS)
        kpi_card(pdf, kpis_x + 2 * (kpi_w + 1.5), kpi_y, kpi_w, kpi_h, "Atribuições", f"{done_items}/{total_items}", WARNING)
        kpi_card(pdf, kpis_x + 3 * (kpi_w + 1.5), kpi_y, kpi_w, kpi_h, "O.S Ativas", str(len(os_list)), INFO)

        pdf.set_y(card_y + card_h + 6)

        # ── Seção: TAREFAS ────────────────────────────────────────────────
        if tasks:
            pdf.set_font("DejaVu", "B", 10)
            pdf.set_text_color(*INK)
            pdf.cell(0, 5, "TAREFAS DO PERÍODO", ln=True)
            hr(pdf, 0.5)
            pdf.ln(2.5)

            for task in tasks:
                status = task["status"] or "pending"
                fg, bg = STATUS_COLOR.get(status, (INK_MUTED, SURFACE))
                status_label = STATUS_LABEL.get(status, status.upper())

                task_y_start = pdf.get_y()

                # Borda esquerda colorida (4mm)
                pdf.set_fill_color(*fg)
                pdf.rect(pdf.l_margin, task_y_start, 0.8, 5, style="F")

                # Título da tarefa
                pdf.set_xy(pdf.l_margin + 3, task_y_start)
                pdf.set_font("DejaVu", "B", 10)
                pdf.set_text_color(*INK)
                pdf.cell(120, 5, task["title"], ln=False)

                # Status badge à direita
                pdf.set_xy(pdf.w - pdf.r_margin - 30, task_y_start + 0.3)
                badge(pdf, status_label, fg, bg)

                pdf.set_y(task_y_start + 5.5)

                # Metadata row (prazo + OS link)
                meta = []
                if task["due_date"]:
                    meta.append(f"Prazo: {fmt_date(task['due_date'])}")
                if task.get("so_title"):
                    meta.append(f"OS: {task['so_title']}")
                if meta:
                    pdf.set_x(pdf.l_margin + 3)
                    pdf.set_font("DejaVu", "", 7.5)
                    pdf.set_text_color(*INK_MUTED)
                    pdf.cell(0, 3.5, "  •  ".join(meta), ln=True)

                pdf.ln(1)

                # Checklist
                task_comments = comments_map.get(task["id"], [])
                if task["checklist"]:
                    for ci, item in enumerate(task["checklist"]):
                        done = item.get("done")
                        mark = "✓" if done else "○"
                        mark_color = SUCCESS if done else INK_FAINT
                        pdf.set_x(pdf.l_margin + 4)
                        pdf.set_font("DejaVu", "B", 9)
                        pdf.set_text_color(*mark_color)
                        pdf.cell(4, 4, mark, ln=False)
                        pdf.set_font("DejaVu", "B", 8.5)
                        pdf.set_text_color(*INK)
                        pdf.multi_cell(0, 4, item.get("text", ""), new_x="LMARGIN", new_y="NEXT")

                        # Comentários do item
                        item_comments = [c for c in task_comments if c.get("checklist_index") == ci]
                        for c in item_comments:
                            pdf.set_x(pdf.l_margin + 10)
                            pdf.set_font("DejaVu", "I", 7.5)
                            pdf.set_text_color(*INK_MUTED)
                            pdf.multi_cell(0, 4, f"↳ {c['comment'] or ''}", new_x="LMARGIN", new_y="NEXT")
                else:
                    pdf.set_x(pdf.l_margin + 4)
                    pdf.set_font("DejaVu", "I", 8)
                    pdf.set_text_color(*INK_FAINT)
                    pdf.cell(0, 4, "Sem itens de entrega cadastrados.", ln=True)

                # Comentários gerais (sem checklist_index)
                general_comments = [c for c in task_comments if c.get("checklist_index") is None]
                if general_comments:
                    pdf.ln(0.5)
                    pdf.set_x(pdf.l_margin + 4)
                    pdf.set_font("DejaVu", "B", 7)
                    pdf.set_text_color(*INK_MUTED)
                    pdf.cell(0, 3.5, "OBSERVAÇÕES", ln=True)
                    for c in general_comments:
                        pdf.set_x(pdf.l_margin + 6)
                        pdf.set_font("DejaVu", "I", 7.5)
                        pdf.set_text_color(*INK_MUTED)
                        pdf.multi_cell(0, 4, f"↳ {c['comment'] or ''}", new_x="LMARGIN", new_y="NEXT")

                if task.get("attachment_urls"):
                    pdf.ln(0.5)
                    pdf.set_x(pdf.l_margin + 4)
                    embed_attachments(pdf, task["attachment_urls"])

                pdf.ln(3)

        # ── Seção: O.S EM ANDAMENTO ──────────────────────────────────────
        if os_list:
            pdf.ln(1)
            pdf.set_font("DejaVu", "B", 10)
            pdf.set_text_color(*INK)
            pdf.cell(0, 5, f"ORDENS DE SERVIÇO ATIVAS  ({len(os_list)})", ln=True)
            hr(pdf, 0.5)
            pdf.ln(2.5)

            for os_item in os_list:
                status = os_item["status"]
                fg, bg = OS_STATUS_COLOR.get(status, (INK_MUTED, SURFACE))
                status_label = OS_STATUS_LABEL.get(status, status.upper())
                priority = os_item.get("priority")
                p_fg, p_bg = OS_PRIORITY_COLOR.get(priority or "", (INK_MUTED, SURFACE))
                priority_label = OS_PRIORITY_LABEL.get(priority or "", "")

                os_y_start = pdf.get_y()
                pdf.set_fill_color(*fg)
                pdf.rect(pdf.l_margin, os_y_start, 0.8, 5, style="F")

                # Linha 1: número + título + badges direita
                pdf.set_xy(pdf.l_margin + 3, os_y_start)
                pdf.set_font("DejaVu", "B", 9.5)
                pdf.set_text_color(*BRAND)
                num_str = f"#{os_item['number']}" if os_item["number"] else "—"
                pdf.cell(pdf.get_string_width(num_str) + 2, 5, num_str, ln=False)
                pdf.set_font("DejaVu", "B", 9.5)
                pdf.set_text_color(*INK)

                # Badges no canto direito (status + prioridade)
                badges_x = pdf.w - pdf.r_margin - 56
                pdf.set_xy(badges_x, os_y_start + 0.3)
                badge(pdf, status_label, fg, bg)
                if priority_label:
                    badge(pdf, priority_label, p_fg, p_bg)

                # Título (com espaço para badges)
                title_x = pdf.l_margin + 3 + pdf.get_string_width(num_str) + 3
                title_w = badges_x - title_x - 2
                pdf.set_xy(title_x, os_y_start)
                pdf.set_font("DejaVu", "B", 9.5)
                pdf.set_text_color(*INK)
                # truncar se muito longo
                title = os_item["title"]
                while pdf.get_string_width(title) > title_w and len(title) > 10:
                    title = title[:-1]
                if title != os_item["title"]:
                    title = title.rstrip() + "…"
                pdf.cell(title_w, 5, title, ln=False)

                pdf.set_y(os_y_start + 5.5)

                # Meta (categoria, área, atualização)
                meta_parts = []
                if os_item.get("category_name"): meta_parts.append(os_item["category_name"])
                if os_item.get("area"): meta_parts.append(os_item["area"])
                if os_item.get("updated_at"): meta_parts.append(f"Atualizada {os_item['updated_at']}")
                if meta_parts:
                    pdf.set_x(pdf.l_margin + 3)
                    pdf.set_font("DejaVu", "", 7.5)
                    pdf.set_text_color(*INK_MUTED)
                    pdf.cell(0, 3.5, "  •  ".join(meta_parts), ln=True)

                # Descrição
                desc = (os_item.get("description") or "").strip()
                if desc:
                    pdf.ln(0.5)
                    pdf.set_x(pdf.l_margin + 3)
                    pdf.set_font("DejaVu", "", 8)
                    pdf.set_text_color(*INK)
                    desc_short = desc[:400] + ("…" if len(desc) > 400 else "")
                    pdf.multi_cell(0, 4, desc_short, new_x="LMARGIN", new_y="NEXT")

                # Comentários
                os_comments = os_comments_map.get(os_item["id"], [])
                if os_comments:
                    pdf.ln(0.5)
                    pdf.set_x(pdf.l_margin + 3)
                    pdf.set_font("DejaVu", "B", 7)
                    pdf.set_text_color(*INK_MUTED)
                    pdf.cell(0, 3.5, f"ATUALIZAÇÕES ({len(os_comments)})", ln=True)
                    for oc in os_comments:
                        pdf.set_x(pdf.l_margin + 6)
                        pdf.set_font("DejaVu", "", 7.5)
                        pdf.set_text_color(*INK_MUTED)
                        prefix = f"[{oc['created_at']}] {oc['author']}:"
                        pdf.cell(pdf.get_string_width(prefix) + 1, 4, prefix, ln=False)
                        pdf.set_font("DejaVu", "I", 7.5)
                        pdf.set_text_color(*INK)
                        pdf.multi_cell(0, 4, f" {oc['comment']}", new_x="LMARGIN", new_y="NEXT")

                pdf.ln(3)

        # Vazio
        if not tasks and not os_list:
            pdf.ln(10)
            pdf.set_font("DejaVu", "I", 10)
            pdf.set_text_color(*INK_FAINT)
            pdf.cell(0, 8, "Sem atividades registradas no período.", align="C", ln=True)

    buf = _BytesIO()
    buf.write(bytes(pdf.output()))
    buf.seek(0)

    # Nome amigável: "Tarefas - Nome Colaborador - DD-MM.pdf"
    if len(users_map) == 1:
        collab_name = next(iter(users_map.values()))["user_name"]
    else:
        collab_name = None
    date_str = fmt_date(date_from or date_to or str(date.today())).replace("/", "-")
    if collab_name:
        fname = f"Tarefas - {collab_name} - {date_str}.pdf"
    else:
        fname = f"Tarefas - {date_str}.pdf"
    # Remove chars inválidos em nome de arquivo
    import re as _re
    fname = _re.sub(r'[\\/:*?"<>|]', "_", fname)

    return Response(
        content=buf.read(), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.post("/reminders/trigger", summary="Cron: disparar lembretes de tarefas no Chat")
async def trigger_task_reminders(
    authorization: str | None = Header(None),
) -> dict:
    settings = get_settings()
    if settings.cron_secret:
        if authorization != f"Bearer {settings.cron_secret}":
            raise HTTPException(401, "Não autorizado")

    sent = 0

    async with AsyncSessionLocal() as session:
        rows = (await session.execute(text("""
            SELECT t.id, t.title, t.association_id, t.assigned_to_name,
                   t.reminder_at, u.full_name
            FROM daily_tasks t
            LEFT JOIN users u ON u.id = t.assigned_to AND u.association_id = t.association_id
            WHERE t.reminder_at <= NOW()
              AND t.status != 'concluida'
              AND t.reminded_at IS NULL
        """))).fetchall()

        for r in rows:
            task_id, title, assoc_id, atn, reminder_at, full_name = r
            responsible = atn or full_name or "equipe"
            try:
                from app.routers.chat import post_system_message
                msg = f'⏰ Lembrete: tarefa "{title}" vence agora — responsável: {responsible}'
                await post_system_message(str(assoc_id), msg, session)
            except Exception:
                pass
            await session.execute(
                text("UPDATE daily_tasks SET reminded_at = NOW() WHERE id = :id"),
                {"id": str(task_id)},
            )
            sent += 1

        await session.commit()

    return {"sent": sent}


# ── Rotas com parâmetro de path (devem vir DEPOIS das rotas fixas) ─────────────

@router.post("/{task_id}/comments", summary="Adicionar acompanhamento")
async def add_comment(
    task_id: UUID,
    body: AddCommentRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    import json
    row = (await session.execute(text("""
        INSERT INTO daily_task_comments (task_id, association_id, created_by, comment, attachment_urls, checklist_index)
        VALUES (:tid, :aid, (SELECT id FROM users WHERE id = :uid LIMIT 1), :comment, CAST(:attachments AS jsonb), :cidx)
        RETURNING id, created_at
    """), {
        "tid": str(task_id),
        "aid": str(current.association_id),
        "uid": str(current.user_id),
        "comment": body.comment,
        "attachments": json.dumps(body.attachment_urls),
        "cidx": body.checklist_index,
    })).fetchone()
    await session.commit()
    author = (await session.execute(
        text("SELECT full_name FROM users WHERE id = :id"), {"id": str(current.user_id)}
    )).scalar() or "Usuário"
    return {
        "id": str(row[0]), "created_at": str(row[1]),
        "author_name": author, "comment": body.comment,
        "attachment_urls": body.attachment_urls,
        "checklist_index": body.checklist_index,
    }


@router.get("/{task_id}/comments", summary="Listar acompanhamentos")
async def list_comments(
    task_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    aids = await _group_assoc_ids(str(current.association_id), session)
    rows = (await session.execute(text("""
        SELECT c.id, c.comment, c.attachment_urls, c.created_at,
               COALESCE(u.full_name, 'Usuário') AS author_name, c.checklist_index
        FROM daily_task_comments c
        LEFT JOIN users u ON u.id = c.created_by
        WHERE c.task_id = :tid AND c.association_id = ANY(:aids)
        ORDER BY c.created_at ASC
    """), {"tid": str(task_id), "aids": aids})).fetchall()
    return [
        {"id": str(r[0]), "comment": r[1], "attachment_urls": r[2] or [],
         "created_at": str(r[3]), "author_name": r[4] or "Usuário", "checklist_index": r[5]}
        for r in rows
    ]


@router.patch("/{task_id}/comments/{comment_id}", summary="Editar acompanhamento")
async def edit_comment(
    task_id: UUID,
    comment_id: UUID,
    body: EditCommentRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    new_text = body.comment.strip()
    if not new_text:
        raise HTTPException(status_code=422, detail="Comentário não pode ser vazio.")
    row = (await session.execute(text("""
        UPDATE daily_task_comments
        SET comment = :comment, updated_at = NOW()
        WHERE id = :cid AND task_id = :tid AND created_by = :uid
        RETURNING id, comment, updated_at
    """), {"comment": new_text, "cid": str(comment_id), "tid": str(task_id), "uid": str(current.user_id)})).fetchone()
    await session.commit()
    if not row:
        raise HTTPException(status_code=403, detail="Não autorizado ou comentário não encontrado.")
    return {"id": str(row[0]), "comment": row[1], "updated_at": str(row[2])}


@router.delete("/{task_id}", summary="Excluir Tarefa Diária (soft delete — recuperável em 30 dias)")
async def delete_task(
    task_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    aids = await _group_assoc_ids(str(current.association_id), session)
    await session.execute(text(
        "UPDATE daily_tasks SET deleted_at = NOW() WHERE id = :id AND association_id = ANY(:aids) AND deleted_at IS NULL"
    ), {"id": str(task_id), "aids": aids})
    await session.commit()
    return {"ok": True}


@router.post("/{task_id}/restore", summary="Restaurar tarefa excluída")
async def restore_task(
    task_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    aids = await _group_assoc_ids(str(current.association_id), session)
    row = (await session.execute(text(
        "UPDATE daily_tasks SET deleted_at = NULL WHERE id = :id AND association_id = ANY(:aids) AND deleted_at IS NOT NULL RETURNING id, title"
    ), {"id": str(task_id), "aids": aids})).fetchone()
    await session.commit()
    if not row:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada ou já ativa.")
    return {"ok": True, "title": row[1]}


@router.get("/deleted", summary="Listar tarefas excluídas (últimos 30 dias)")
async def list_deleted_tasks(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    aids = await _group_assoc_ids(str(current.association_id), session)
    rows = (await session.execute(text("""
        SELECT t.id, t.title, t.assigned_to_name, t.due_date, t.deleted_at,
               COALESCE(u.full_name, 'Usuário') AS deleted_context
        FROM daily_tasks t
        LEFT JOIN users u ON u.id = t.created_by
        WHERE t.association_id = ANY(:aids)
          AND t.deleted_at IS NOT NULL
          AND t.deleted_at > NOW() - INTERVAL '30 days'
        ORDER BY t.deleted_at DESC
    """), {"aids": aids})).fetchall()
    return [
        {"id": str(r[0]), "title": r[1], "assigned_to_name": r[2],
         "due_date": str(r[3]) if r[3] else None,
         "deleted_at": str(r[4])[:16], "created_by_name": r[5]}
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
        "attachment_urls": r[15] or [],
    }
