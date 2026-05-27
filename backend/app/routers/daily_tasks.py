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
    filters = ["t.association_id = ANY(:aids)"]
    params: dict = {"aids": aids}
    if assigned_to:
        filters.append("t.assigned_to = :at")
        params["at"] = str(assigned_to)
    if status:
        filters.append("t.status = :status")
        params["status"] = status
    if view == "default":
        filters.append("(t.status != 'done' OR t.updated_at::date = CURRENT_DATE)")
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
           :so_id, :so_title, :created_by, :status)
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
    row = (await session.execute(
        text(f"UPDATE daily_tasks SET {', '.join(sets)} WHERE id = :id AND association_id = :aid RETURNING title, assigned_to, service_order_title"),
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
        date_filter_task += " AND t.created_at >= CAST(:df AS timestamptz)"
        date_filter_os_hist += " AND h.changed_at >= CAST(:df AS timestamptz)"
        date_filter_os_comment += " AND c.created_at >= CAST(:df AS timestamptz)"
        params["df"] = date.fromisoformat(date_from)
    if date_to:
        date_filter_task += " AND t.created_at < CAST(:dt AS timestamptz) + interval '1 day'"
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
            SELECT c.task_id, u.full_name, c.id, c.comment, c.created_at, c.checklist_index
            FROM daily_task_comments c
            JOIN users u ON u.id = c.created_by
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
        JOIN users u ON u.id = c.created_by
        JOIN service_orders so ON so.id = c.service_order_id
        WHERE c.association_id = ANY(:aids)
          {date_filter_os_comment}{uid_filter_user}
        ORDER BY c.created_at DESC
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
            SELECT c.task_id, c.comment, c.attachment_urls, c.created_at, u.full_name, c.checklist_index
            FROM daily_task_comments c
            JOIN users u ON u.id = c.created_by
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

    users_map: OrderedDict = OrderedDict()
    for r in rows:
        key = r[0].strip().lower()  # agrupar por nome (unifica associações)
        if key not in users_map:
            users_map[key] = {"user_name": r[0], "tasks": []}
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

    def fmt_date(d: str) -> str:
        p = d.split("-")
        return f"{p[2]}/{p[1]}" if len(p) == 3 else d

    period_label = ""
    if date_from or date_to:
        period_label = f"Período: {fmt_date(date_from) if date_from else '—'} – {fmt_date(date_to) if date_to else '—'}"

    IS_IMAGE = lambda u: bool(u and u.lower().split("?")[0].endswith((".jpg", ".jpeg", ".png", ".gif", ".webp")))
    STATUS_LABEL = {"pending": "PENDENTE", "in_progress": "ANDANDO", "done": "FEITA"}

    def safe(s: str) -> str:
        """Remove characters outside Latin-1 to avoid fpdf2 Helvetica corruption."""
        return s.encode("latin-1", errors="replace").decode("latin-1")

    def embed_attachments(pdf: FPDF, urls: list):
        if not urls: return
        pdf.set_font("Helvetica", size=8)
        pdf.set_text_color(150, 150, 150)
        pdf.cell(0, 4, "Anexos:", ln=True)
        pdf.set_text_color(0, 0, 0)
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
                        buf = _BIO(resp.read())
                    col = i % 4
                    if i > 0 and col == 0:
                        y += 13
                    pdf.image(buf, x=x0 + col * 13, y=y, w=11, h=11)
                except Exception:
                    pdf.set_font("Helvetica", size=7)
                    pdf.set_text_color(180, 50, 50)
                    pdf.cell(0, 4, "[imagem indisponível]", ln=True)
                    pdf.set_text_color(0, 0, 0)
            rows_used = (len(images) - 1) // 4 + 1
            pdf.set_y(y + rows_used * 13)
        for fu in files:
            name = fu.split("/")[-1].split("?")[0][:40]
            pdf.set_font("Helvetica", size=8)
            pdf.set_text_color(40, 80, 200)
            pdf.cell(0, 5, f"  {name}", link=fu, ln=True)
            pdf.set_text_color(0, 0, 0)

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=10)

    for uid, entry in users_map.items():
        pdf.add_page()

        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(130, 6, safe(assoc_name), ln=False)
        if period_label:
            pdf.set_font("Helvetica", size=8)
            pdf.set_text_color(120, 120, 120)
            pdf.cell(0, 6, safe(period_label), ln=True, align="R")
            pdf.set_text_color(0, 0, 0)
        else:
            pdf.ln()
        pdf.set_font("Helvetica", size=9)
        pdf.set_text_color(80, 80, 80)
        pdf.cell(0, 4, "Tarefas Diarias - Relatorio de Entregas", ln=True)
        pdf.set_text_color(0, 0, 0)
        pdf.ln(1.5)

        pdf.set_fill_color(235, 242, 255)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 6, safe(f"  COLABORADOR: {entry['user_name'].upper()}"), fill=True, ln=True)

        tasks = entry["tasks"]
        total_items = sum(len(t["checklist"]) for t in tasks)
        done_items = sum(sum(1 for i in t["checklist"] if i.get("done")) for t in tasks)
        pdf.set_font("Helvetica", size=8)
        pdf.set_text_color(80, 80, 80)
        pdf.cell(0, 5, f"  {len(tasks)} tarefa(s)  |  {done_items} entrega(s) OK  |  {total_items - done_items} pendente(s)", ln=True)
        pdf.set_text_color(0, 0, 0)
        pdf.ln(1.5)

        for task in tasks:
            badge = STATUS_LABEL.get(task["status"], task["status"].upper())
            due_str = f"  Prazo: {fmt_date(task['due_date'])}" if task["due_date"] else ""

            pdf.set_fill_color(245, 248, 255)
            pdf.set_font("Helvetica", "B", 9)
            pdf.cell(0, 5.5, safe(f"  > {task['title']}{due_str}  [{badge}]"), fill=True, ln=True)

            if task.get("so_title"):
                pdf.set_font("Helvetica", "I", 7)
                pdf.set_text_color(80, 80, 200)
                pdf.cell(0, 3.5, safe(f"    OS: {task['so_title']}"), ln=True)
                pdf.set_text_color(0, 0, 0)

            task_comments = comments_map.get(task["id"], [])
            pdf.set_font("Helvetica", size=8)
            if task["checklist"]:
                for ci, item in enumerate(task["checklist"]):
                    mark = "[OK]" if item.get("done") else "[  ]"
                    col = (0, 120, 0) if item.get("done") else (160, 160, 160)
                    pdf.set_text_color(*col)
                    pdf.set_font("Helvetica", "B", 8)
                    pdf.cell(0, 4, safe(f"    {mark}  {item['text']}"), ln=True)
                    # Acompanhamentos deste item
                    item_comments = [c for c in task_comments if c.get("checklist_index") == ci]
                    for c in item_comments:
                        pdf.set_font("Helvetica", "I", 7)
                        pdf.set_text_color(120, 120, 120)
                        prefix = f"      ↳ [{c['created_at']}] {c['author_name']}: "
                        txt = prefix + (c["comment"] or "")
                        pdf.multi_cell(0, 3.5, safe(txt))
                    pdf.set_text_color(0, 0, 0)
                pdf.set_text_color(0, 0, 0)
            else:
                pdf.set_text_color(140, 140, 140)
                pdf.cell(0, 4, "    (sem itens de entrega)", ln=True)
                pdf.set_text_color(0, 0, 0)

            # Comentários gerais (sem checklist_index)
            general_comments = [c for c in task_comments if c.get("checklist_index") is None]
            if general_comments:
                pdf.set_font("Helvetica", "I", 7)
                pdf.set_text_color(100, 100, 100)
                for c in general_comments:
                    txt = f"      ↳ [{c['created_at']}] {c['author_name']}: {c['comment'] or ''}"
                    pdf.multi_cell(0, 3.5, safe(txt))
                pdf.set_text_color(0, 0, 0)

            embed_attachments(pdf, task["attachment_urls"])

            pdf.ln(1)

        pdf.set_y(-9)
        pdf.set_font("Helvetica", size=6.5)
        pdf.set_text_color(170, 170, 170)
        now_str = _dt.utcnow().strftime("%d/%m/%Y %H:%M")
        pdf.cell(0, 4, f"Gerado em {now_str} - APRXM", align="C", ln=True)

    buf = _BytesIO()
    buf.write(bytes(pdf.output()))
    buf.seek(0)
    fname = f"tarefas_{date_from or 'all'}_{date_to or 'all'}.pdf"
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
        VALUES (:tid, :aid, :uid, :comment, CAST(:attachments AS jsonb), :cidx)
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
        SELECT c.id, c.comment, c.attachment_urls, c.created_at, u.full_name, c.checklist_index
        FROM daily_task_comments c
        JOIN users u ON u.id = c.created_by
        WHERE c.task_id = :tid AND c.association_id = ANY(:aids)
        ORDER BY c.created_at ASC
    """), {"tid": str(task_id), "aids": aids})).fetchall()
    return [
        {"id": str(r[0]), "comment": r[1], "attachment_urls": r[2] or [],
         "created_at": str(r[3]), "author_name": r[4], "checklist_index": r[5]}
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
