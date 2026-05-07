from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session
from app.models.service_order import ServiceOrderPriority, ServiceOrderStatus
from app.models.user import User
from app.services.service_order_service import ServiceOrderService

router = APIRouter(prefix="/service-orders", tags=["Ordens de Serviço"])


async def _get_group_assoc_ids(association_id: str, session: AsyncSession) -> tuple[list[UUID], dict[str, str]]:
    """Returns (list_of_uuids_in_same_group, {id: name} map). Falls back to just the current assoc."""
    row = (await session.execute(
        text("SELECT chat_group FROM associations WHERE id = :aid"),
        {"aid": association_id},
    )).fetchone()
    group = row[0] if row else None
    if group:
        rows = (await session.execute(
            text("SELECT id, name FROM associations WHERE chat_group = :g"),
            {"g": group},
        )).fetchall()
    else:
        rows = (await session.execute(
            text("SELECT id, name FROM associations WHERE id = :aid"),
            {"aid": association_id},
        )).fetchall()
    ids = [UUID(str(r[0])) for r in rows]
    names = {str(r[0]): r[1] for r in rows}
    return ids, names


class CreateSORequest(BaseModel):
    title: str
    description: str
    priority: ServiceOrderPriority = ServiceOrderPriority.medium
    status: ServiceOrderStatus = ServiceOrderStatus.pending
    area: str | None = None
    unit: str | None = None
    block: str | None = None
    location_detail: str | None = None
    requester_resident_id: UUID | None = None
    requester_name: str | None = None
    requester_phone: str | None = None
    requester_email: str | None = None
    service_impacted: str | None = None
    category_name: str | None = None
    org_responsible: str | None = None
    reference_point: str | None = None
    request_date: datetime | None = None
    address_cep: str | None = None
    address_street: str | None = None
    address_number: str | None = None
    address_complement: str | None = None
    use_requester_address: bool = False
    community_wide: bool = False
    assigned_to: UUID | None = None
    assigned_to_name: str | None = None
    energia_eletrica_data: dict | None = None
    impacted_residents: list[dict] = []


class UpdateSORequest(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: ServiceOrderPriority | None = None
    area: str | None = None
    location_detail: str | None = None
    service_impacted: str | None = None
    category_name: str | None = None
    org_responsible: str | None = None
    reference_point: str | None = None
    address_cep: str | None = None
    address_street: str | None = None
    address_number: str | None = None
    address_complement: str | None = None
    community_wide: bool | None = None
    assigned_to: UUID | None = None
    assigned_to_name: str | None = None
    requester_name: str | None = None
    requester_phone: str | None = None
    requester_email: str | None = None
    energia_eletrica_data: dict | None = None
    impacted_residents: list[dict] | None = None


class UpdateStatusRequest(BaseModel):
    status: ServiceOrderStatus
    notes: str | None = None
    resolution_notes: str | None = None
    cancellation_reason: str | None = None


class AddCommentRequest(BaseModel):
    comment: str
    attachment_urls: list[str] = []


@router.post("", summary="Criar Ordem de Serviço")
async def create_so(
    body: CreateSORequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    import asyncio as _asyncio
    from app.routers.notifications import create_notification as _notif
    svc = ServiceOrderService(session)
    so = await svc.create(
        association_id=current.association_id,
        created_by=current.user_id,
        **body.model_dump(),
    )
    if body.assigned_to and str(body.assigned_to) != str(current.user_id):
        await _notif(
            str(current.association_id), str(body.assigned_to),
            f"📋 OS #{so.number} atribuída a você",
            body.title,
            "task",
            {"url": f"/service-orders/{so.id}"},
        )
        assigned_email = (await session.execute(
            text("SELECT email FROM users WHERE id = :id"), {"id": str(body.assigned_to)}
        )).scalar()
        if assigned_email:
            import asyncio as _aio
            from app.services.email_service import send_email
            html = f"""
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="color:#1a3f6f">📋 OS #{so.number} atribuída a você</h2>
  <p><strong>{body.title}</strong></p>
  <p style="color:#6b7280;font-size:13px">APRXM — Sistema de Gestão Comunitária</p>
</div>"""
            await _aio.get_running_loop().run_in_executor(None, send_email, assigned_email, f"OS #{so.number} atribuída a você", html)
    return {"id": str(so.id), "number": so.number, "status": so.status}


@router.put("/{so_id}", summary="Atualizar dados da OS")
async def update_so(
    so_id: UUID,
    body: UpdateSORequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = ServiceOrderService(session)
    assoc_ids, _ = await _get_group_assoc_ids(str(current.association_id), session)
    so = await svc.update(so_id, current.association_id, body.model_dump(exclude_none=True), association_ids=assoc_ids)
    return {"id": str(so.id), "number": so.number, "status": so.status}


_STATUS_EMAIL_TRIGGER = {"in_progress", "resolved", "cancelled"}
_STATUS_PT = {"in_progress": "Em andamento", "resolved": "Concluída", "cancelled": "Cancelada"}
_NOTIFY_EMAIL = "celiapx@institutotiapretinha.org"


def _send_status_pdf_email(pdf_bytes: bytes, number: int, title: str, status: str) -> None:
    from app.services.email_service import send_email
    status_pt = _STATUS_PT.get(status, status)
    html = f"""
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="color:#1a3f6f">📋 OS #{number:04d} — {status_pt}</h2>
  <p><strong>{title}</strong></p>
  <p style="color:#6b7280;font-size:13px">O PDF da ordem de serviço está em anexo.</p>
  <p style="color:#6b7280;font-size:13px">APRXM — Sistema de Gestão Comunitária</p>
</div>"""
    send_email(_NOTIFY_EMAIL, f"OS #{number:04d} — {status_pt}", html,
               pdf_attachment=pdf_bytes, pdf_filename=f"OS-{number:04d}.pdf")


@router.patch("/{so_id}/status", summary="Atualizar status da OS")
async def update_status(
    so_id: UUID,
    body: UpdateStatusRequest,
    background_tasks: BackgroundTasks,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    import asyncio as _aio
    svc = ServiceOrderService(session)
    assoc_ids, _ = await _get_group_assoc_ids(str(current.association_id), session)
    so = await svc.update_status(
        so_id=so_id,
        association_id=current.association_id,
        new_status=body.status,
        changed_by=current.user_id,
        notes=body.notes,
        resolution_notes=body.resolution_notes,
        cancellation_reason=body.cancellation_reason,
        association_ids=assoc_ids,
    )
    if body.status.value in _STATUS_EMAIL_TRIGGER:
        try:
            pdf_bytes = await svc.generate_pdf(so_id, current.association_id, assoc_ids)
            background_tasks.add_task(_send_status_pdf_email, pdf_bytes, so.number, so.title, body.status.value)
        except Exception:
            pass
    return {"id": str(so.id), "number": so.number, "status": so.status}


@router.post("/{so_id}/comments", summary="Adicionar comentário / atualização na OS")
async def add_comment(
    so_id: UUID,
    body: AddCommentRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    import json
    import asyncio as _asyncio
    from app.routers.notifications import create_notification as _notif

    assoc_ids_comment, _ = await _get_group_assoc_ids(str(current.association_id), session)
    so_row = (await session.execute(text("""
        SELECT number, title, created_by, assigned_to, association_id FROM service_orders
        WHERE id = :id AND association_id = ANY(:aids)
    """), {"id": str(so_id), "aids": [str(x) for x in assoc_ids_comment]})).fetchone()

    result = await session.execute(
        text("""
            INSERT INTO service_order_comments
              (service_order_id, association_id, created_by, comment, attachment_urls)
            VALUES (:so_id, :assoc_id, :user_id, :comment, CAST(:attachments AS jsonb))
            RETURNING id, created_at
        """),
        {
            "so_id": str(so_id),
            "assoc_id": str(so_row[4]) if so_row else str(current.association_id),
            "user_id": str(current.user_id),
            "comment": body.comment,
            "attachments": json.dumps(body.attachment_urls),
        },
    )
    row = result.fetchone()
    await session.commit()

    commenter_name = (await session.execute(
        text("SELECT full_name FROM users WHERE id = :id"), {"id": str(current.user_id)}
    )).scalar() or "Usuário"

    if so_row:
        import asyncio as _aio
        from app.services.email_service import send_email
        so_num, so_title, creator_id, assigned_id, _so_assoc = so_row
        preview = (body.comment or "")[:120]
        notif_title = f"💬 {commenter_name} comentou na OS #{so_num}"
        notif_data = {"url": f"/service-orders/{so_id}"}
        targets = {str(creator_id), str(assigned_id) if assigned_id else None} - {None, str(current.user_id)}
        for uid in targets:
            await _notif(
                str(current.association_id), uid,
                notif_title, preview, "comment", notif_data,
            )

        target_ids = list(targets)
        if target_ids:
            email_rows = (await session.execute(
                text("SELECT email FROM users WHERE id = ANY(:ids) AND email IS NOT NULL"),
                {"ids": target_ids},
            )).fetchall()
            html = f"""
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="color:#1a3f6f">💬 Novo comentário — OS #{so_num}</h2>
  <p><strong>{so_title}</strong></p>
  <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0">
    <p style="margin:0"><strong>{commenter_name}:</strong> {preview}</p>
  </div>
  <p style="color:#6b7280;font-size:13px">APRXM — Sistema de Gestão Comunitária</p>
</div>"""
            for (email,) in email_rows:
                await _aio.get_running_loop().run_in_executor(None, send_email, email, f"OS #{so_num} — novo comentário", html)

    return {"id": str(row[0]), "created_at": str(row[1])}


@router.get("/{so_id}/comments", summary="Listar comentários da OS")
async def list_comments(
    so_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    assoc_ids, _ = await _get_group_assoc_ids(str(current.association_id), session)
    result = await session.execute(
        text("""
            SELECT c.id, c.comment, c.attachment_urls, c.created_at,
                   u.full_name as author_name
            FROM service_order_comments c
            JOIN users u ON u.id = c.created_by
            WHERE c.service_order_id = :so_id
              AND c.association_id = ANY(:aids)
            ORDER BY c.created_at ASC
        """),
        {"so_id": str(so_id), "aids": [str(x) for x in assoc_ids]},
    )
    rows = result.fetchall()
    return [
        {
            "id": str(r[0]),
            "comment": r[1],
            "attachment_urls": r[2] or [],
            "created_at": str(r[3]),
            "author_name": r[4],
        }
        for r in rows
    ]


@router.get("/by-id/{so_id}", summary="Buscar OS pelo ID")
async def get_so_by_id(
    so_id: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    assoc_ids, assoc_names = await _get_group_assoc_ids(str(current.association_id), session)
    ids_str = ",".join(f"'{i}'" for i in assoc_ids)
    row = (await session.execute(text(f"""
        SELECT id, number, title, status, priority, association_id
        FROM service_orders
        WHERE id = :so_id AND association_id IN ({ids_str})
    """), {"so_id": so_id})).fetchone()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(404, "OS não encontrada")
    return {
        "id": str(row[0]), "number": row[1], "title": row[2],
        "status": row[3], "priority": row[4],
        "association_name": assoc_names.get(str(row[5])),
    }


@router.get("/search", summary="Buscar OS por número ou título")
async def search_so(
    q: str = "",
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    assoc_ids, assoc_names = await _get_group_assoc_ids(str(current.association_id), session)
    ids_str = ",".join(f"'{i}'" for i in assoc_ids)
    rows = await session.execute(
        text(f"""
            SELECT id, number, title, status, priority, association_id
            FROM service_orders
            WHERE association_id IN ({ids_str})
              AND (
                CAST(number AS TEXT) ILIKE :q
                OR title ILIKE :q
              )
            ORDER BY number DESC
            LIMIT 8
        """),
        {"q": f"%{q}%"},
    )
    return [
        {
            "id": str(r[0]), "number": r[1], "title": r[2],
            "status": r[3], "priority": r[4],
            "association_name": assoc_names.get(str(r[5])),
        }
        for r in rows.fetchall()
    ]


@router.get("/report", summary="Relatório de OS por período")
async def service_orders_report(
    date_from: str,
    date_to: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    df = date.fromisoformat(date_from)
    dt = date.fromisoformat(date_to)
    from sqlalchemy import text as sa_text
    result = await session.execute(
        sa_text("""
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status='resolved') AS resolvidas,
              COUNT(*) FILTER (WHERE status='cancelled') AS canceladas,
              COUNT(*) FILTER (WHERE status NOT IN ('resolved','cancelled','archived')) AS abertas,
              COUNT(*) FILTER (WHERE priority='critical') AS criticas
            FROM service_orders
            WHERE association_id = :aid
              AND created_at::date BETWEEN :df AND :dt
        """),
        {"aid": str(current.association_id), "df": df, "dt": dt},
    )
    r = result.fetchone()
    by_area = await session.execute(
        sa_text("""
            SELECT area, COUNT(*) FROM service_orders
            WHERE association_id = :aid AND created_at::date BETWEEN :df AND :dt
              AND area IS NOT NULL
            GROUP BY area ORDER BY 2 DESC LIMIT 10
        """),
        {"aid": str(current.association_id), "df": df, "dt": dt},
    )
    by_day = await session.execute(
        sa_text("""
            SELECT
              created_at::date AS dia,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status = 'resolved') AS resolvidas,
              COUNT(*) FILTER (WHERE status NOT IN ('resolved','cancelled','archived')) AS abertas
            FROM service_orders
            WHERE association_id = :aid AND created_at::date BETWEEN :df AND :dt
            GROUP BY dia ORDER BY dia
        """),
        {"aid": str(current.association_id), "df": df, "dt": dt},
    )
    return {
        "period": {"from": date_from, "to": date_to},
        "total": r[0], "resolvidas": r[1], "canceladas": r[2],
        "abertas": r[3], "criticas": r[4],
        "by_area": [{"area": a[0], "count": a[1]} for a in by_area.fetchall()],
        "by_day": [{"dia": str(d[0]), "total": d[1], "resolvidas": d[2], "abertas": d[3]} for d in by_day.fetchall()],
    }



@router.get("/{so_id}", summary="Detalhar OS")
async def get_so(
    so_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from app.models.service_order import ServiceOrder
    from sqlmodel import select
    assoc_ids, _ = await _get_group_assoc_ids(str(current.association_id), session)
    result = await session.execute(
        select(ServiceOrder).where(
            ServiceOrder.id == so_id,
            ServiceOrder.association_id.in_(assoc_ids),
        )
    )
    so = result.scalar_one_or_none()
    if not so:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="OS não encontrada.")
    return {
        "id": str(so.id), "number": so.number, "title": so.title,
        "description": so.description, "status": so.status, "priority": so.priority,
        "area": so.area, "unit": so.unit, "block": so.block,
        "location_detail": so.location_detail,
        "service_impacted": so.service_impacted,
        "category_name": so.category_name,
        "org_responsible": so.org_responsible,
        "requester_name": so.requester_name, "requester_phone": so.requester_phone,
        "requester_email": so.requester_email,
        "reference_point": so.reference_point,
        "address_cep": so.address_cep,
        "address_street": so.address_street,
        "address_number": so.address_number,
        "address_complement": so.address_complement,
        "community_wide": so.community_wide,
        "use_requester_address": so.use_requester_address,
        "resolution_notes": so.resolution_notes, "resolved_at": str(so.resolved_at) if so.resolved_at else None,
        "cancellation_reason": so.cancellation_reason,
        "attachments": so.attachments or [],
        "impacted_residents": so.impacted_residents or [],
        "created_at": str(so.created_at), "updated_at": str(so.updated_at),
        "assigned_to": str(so.assigned_to) if so.assigned_to else None,
        "requester_resident_id": str(so.requester_resident_id) if so.requester_resident_id else None,
        "request_date": str(so.request_date) if so.request_date else None,
    }


@router.get("/{so_id}/pdf", summary="Gerar PDF do Ofício")
async def generate_pdf(
    so_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    svc = ServiceOrderService(session)
    assoc_ids, _ = await _get_group_assoc_ids(str(current.association_id), session)
    pdf_bytes = await svc.generate_pdf(so_id, current.association_id, association_ids=assoc_ids)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="OS-{so_id}.pdf"'},
    )


# ── Tasks por OS ─────────────────────────────────────────────────────────────

class CreateTaskRequest(BaseModel):
    title: str
    notes: str | None = None
    priority: str = 'medium'
    status: str = 'open'
    due_date: str | None = None
    checklist: list[dict] = []
    assigned_to: UUID | None = None
    assigned_to_name: str | None = None


class UpdateTaskRequest(BaseModel):
    title: str | None = None
    notes: str | None = None
    priority: str | None = None
    status: str | None = None
    due_date: str | None = None
    checklist: list[dict] | None = None
    assigned_to: UUID | None = None
    assigned_to_name: str | None = None


@router.get("/{so_id}/tasks", summary="Listar Registros Diários da OS")
async def list_tasks(
    so_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    result = await session.execute(text("""
        SELECT t.id, t.title, t.notes, t.priority, t.status, t.due_date,
               t.checklist, t.assigned_to, t.assigned_to_name,
               t.created_at, u.full_name AS created_by_name, t.updated_at
        FROM service_order_tasks t
        JOIN users u ON u.id = t.created_by
        WHERE t.service_order_id = :so_id AND t.association_id = ANY(:aids)
        ORDER BY t.due_date ASC NULLS LAST, t.created_at ASC
    """), {"so_id": str(so_id), "aids": [str(x) for x in (await _get_group_assoc_ids(str(current.association_id), session))[0]]})
    return [{
        "id": str(r[0]), "title": r[1], "notes": r[2], "priority": r[3],
        "status": r[4], "due_date": str(r[5]) if r[5] else None,
        "checklist": r[6] or [], "assigned_to": str(r[7]) if r[7] else None,
        "assigned_to_name": r[8], "created_at": str(r[9]),
        "created_by_name": r[10], "updated_at": str(r[11]),
    } for r in result.fetchall()]


@router.post("/{so_id}/tasks", summary="Criar Registro Diário")
async def create_task(
    so_id: UUID,
    body: CreateTaskRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    import json as _json
    from datetime import date as _date
    result = await session.execute(text("""
        INSERT INTO service_order_tasks
          (association_id, service_order_id, created_by, assigned_to, assigned_to_name,
           title, notes, priority, status, due_date, checklist)
        VALUES (:aid, :so_id, :uid, :at, :atn, :title, :notes, :priority, :status, :due, CAST(:checklist AS jsonb))
        RETURNING id, created_at
    """), {
        "aid": str(current.association_id), "so_id": str(so_id), "uid": str(current.user_id),
        "at": str(body.assigned_to) if body.assigned_to else None,
        "atn": body.assigned_to_name, "title": body.title, "notes": body.notes,
        "priority": body.priority, "status": body.status,
        "due": _date.fromisoformat(body.due_date) if body.due_date else None,
        "checklist": _json.dumps(body.checklist),
    })
    row = result.fetchone()
    await session.commit()

    if body.assigned_to_name:
        try:
            from app.routers.chat import post_system_message
            so_num = await session.execute(
                text("SELECT order_number FROM service_orders WHERE id = :id"),
                {"id": str(so_id)},
            )
            num = so_num.scalar()
            title = body.title
            msg = f'📋 {body.assigned_to_name} foi atribuído(a) à tarefa "{title}" da OS #{num}'
            await post_system_message(str(current.association_id), msg, session)
            await session.commit()
        except Exception:
            pass

    if body.assigned_to:
        import asyncio
        from app.routers.notifications import create_notification
        await create_notification(
            str(current.association_id), str(body.assigned_to),
            "📋 Nova tarefa atribuída",
            f'Você foi atribuído(a) à tarefa "{body.title}"',
            "task",
        )

    return {"id": str(row[0]), "created_at": str(row[1])}


@router.patch("/{so_id}/tasks/{task_id}", summary="Atualizar Registro Diário")
async def update_task(
    so_id: UUID,
    task_id: UUID,
    body: UpdateTaskRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    import json as _json
    so_assoc = (await session.execute(text("SELECT association_id FROM service_orders WHERE id = :id AND association_id = ANY(:aids)"), {"id": str(so_id), "aids": [str(x) for x in (await _get_group_assoc_ids(str(current.association_id), session))[0]]})).scalar()
    sets, params = [], {"task_id": str(task_id), "so_id": str(so_id), "aid": str(so_assoc or current.association_id)}
    if body.title is not None: sets.append("title = :title"); params["title"] = body.title
    if body.notes is not None: sets.append("notes = :notes"); params["notes"] = body.notes
    if body.priority is not None: sets.append("priority = :priority"); params["priority"] = body.priority
    if body.status is not None: sets.append("status = :status"); params["status"] = body.status
    if body.due_date is not None: sets.append("due_date = :due"); params["due"] = body.due_date
    if body.checklist is not None: sets.append("checklist = CAST(:checklist AS jsonb)"); params["checklist"] = _json.dumps(body.checklist)
    if body.assigned_to_name is not None: sets.append("assigned_to_name = :atn"); params["atn"] = body.assigned_to_name
    if body.assigned_to is not None: sets.append("assigned_to = :at"); params["at"] = str(body.assigned_to)
    if not sets: return {"ok": True}
    sets.append("updated_at = NOW()")
    await session.execute(text(f"UPDATE service_order_tasks SET {', '.join(sets)} WHERE id = :task_id AND service_order_id = :so_id AND association_id = :aid"), params)
    await session.commit()
    return {"ok": True}


@router.delete("/{so_id}/tasks/{task_id}", summary="Excluir Registro Diário")
async def delete_task(
    so_id: UUID,
    task_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    so_assoc_del = (await session.execute(text("SELECT association_id FROM service_orders WHERE id = :id AND association_id = ANY(:aids)"), {"id": str(so_id), "aids": [str(x) for x in (await _get_group_assoc_ids(str(current.association_id), session))[0]]})).scalar()
    await session.execute(text(
        "DELETE FROM service_order_tasks WHERE id = :task_id AND service_order_id = :so_id AND association_id = :aid"
    ), {"task_id": str(task_id), "so_id": str(so_id), "aid": str(so_assoc_del or current.association_id)})
    await session.commit()
    return {"ok": True}


@router.get("", summary="Listar Ordens de Serviço")
async def list_sos(
    status: ServiceOrderStatus | None = None,
    priority: ServiceOrderPriority | None = None,
    q: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    assoc_ids, assoc_names = await _get_group_assoc_ids(str(current.association_id), session)
    svc = ServiceOrderService(session)
    sos = await svc.list(current.association_id, status, association_ids=assoc_ids)

    creator_ids = list({s.created_by for s in sos})
    creator_names: dict[UUID, str] = {}
    if creator_ids:
        rows = await session.execute(
            select(User.id, User.full_name).where(User.id.in_(creator_ids))
        )
        creator_names = {r.id: r.full_name for r in rows}

    result = []
    for s in sos:
        if priority and s.priority != priority:
            continue
        if q:
            ql = q.lower()
            if ql not in (s.title or "").lower() and ql not in (s.requester_name or "").lower():
                continue
        result.append({
            "id": str(s.id),
            "number": s.number,
            "title": s.title,
            "description": s.description,
            "status": s.status,
            "priority": s.priority,
            "area": s.area,
            "service_impacted": s.service_impacted,
            "category_name": s.category_name,
            "requester_name": s.requester_name,
            "requester_phone": s.requester_phone,
            "unit": s.unit,
            "block": s.block,
            "address_cep": s.address_cep,
            "address_street": s.address_street,
            "address_number": s.address_number,
            "address_complement": s.address_complement,
            "community_wide": s.community_wide,
            "created_at": str(s.created_at),
            "assigned_to": str(s.assigned_to) if s.assigned_to else None,
            "assigned_to_name": s.assigned_to_name,
            "created_by_name": creator_names.get(s.created_by),
            "association_name": assoc_names.get(str(s.association_id)),
        })
    return result


@router.post("/{so_id}/presence", summary="Registrar presença na OS")
async def register_presence(
    so_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    user_row = await session.execute(select(User.full_name).where(User.id == current.user_id))
    full_name = user_row.scalar_one_or_none() or "Usuário"
    await session.execute(
        text("""
            INSERT INTO so_presence (so_id, user_id, association_id, full_name, last_seen_at)
            VALUES (:so_id, :user_id, :assoc_id, :full_name, NOW())
            ON CONFLICT (so_id, user_id) DO UPDATE SET last_seen_at = NOW(), full_name = EXCLUDED.full_name
        """),
        {"so_id": str(so_id), "user_id": str(current.user_id), "assoc_id": str(current.association_id), "full_name": full_name},
    )
    await session.commit()
    return {"ok": True}


@router.get("/{so_id}/presence", summary="Quem está vendo a OS agora")
async def get_presence(
    so_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = await session.execute(
        text("""
            SELECT user_id, full_name, last_seen_at
            FROM so_presence
            WHERE so_id = :so_id
              AND association_id = :assoc_id
              AND last_seen_at >= NOW() - INTERVAL '10 minutes'
            ORDER BY last_seen_at DESC
        """),
        {"so_id": str(so_id), "assoc_id": str(current.association_id)},
    )
    return [
        {"user_id": str(r.user_id), "full_name": r.full_name, "last_seen_at": r.last_seen_at.isoformat()}
        for r in rows
    ]
