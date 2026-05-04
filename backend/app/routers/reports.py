from datetime import date
from io import BytesIO
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session

router = APIRouter(prefix="/reports", tags=["Relatórios"])

_HDR = "1A3F6F"


def _mk(sheet: str):
    wb = Workbook()
    ws = wb.active
    ws.title = sheet
    return wb, ws


def _headers(ws, cols: list[str]):
    for i, h in enumerate(cols, 1):
        c = ws.cell(row=1, column=i, value=h)
        c.font = Font(bold=True, color="FFFFFF", size=10)
        c.fill = PatternFill("solid", fgColor=_HDR)
        c.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 22


def _widths(ws):
    for col in ws.columns:
        w = max((len(str(c.value or "")) for c in col), default=8)
        ws.column_dimensions[col[0].column_letter].width = min(w + 3, 48)


def _xlsx(wb: Workbook, name: str) -> Response:
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


import re as _re
_ILLEGAL = _re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f]')

def _s(v: Any) -> str:
    s = str(v) if v is not None else "—"
    return _ILLEGAL.sub('', s)


# ─── Financeiro ───────────────────────────────────────────────────────────────

async def _query_finance(session, aid: str, date_from=None, date_to=None, tx_type=None, payment_method=None):
    conds = ["t.association_id = :aid", "t.reversed_at IS NULL"]
    p: dict = {"aid": aid}
    if date_from: conds.append("t.created_at::date >= :df"); p["df"] = date.fromisoformat(date_from)
    if date_to: conds.append("t.created_at::date <= :dt"); p["dt"] = date.fromisoformat(date_to)
    if tx_type in ("income", "expense"): conds.append("t.type = :tp"); p["tp"] = tx_type
    if payment_method: conds.append("pm.name ILIKE :pm"); p["pm"] = f"%{payment_method}%"
    w = " AND ".join(conds)
    rows = (await session.execute(text(f"""
        SELECT t.created_at::date, t.type, t.amount, t.description,
               pm.name AS pagamento, u.full_name AS criado_por
        FROM transactions t
        LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
        LEFT JOIN users u ON u.id = t.created_by
        WHERE {w} ORDER BY t.created_at DESC
    """), p)).fetchall()
    return [{"Data": _s(r[0]), "Tipo": "Entrada" if r[1] == "income" else "Saída",
             "Valor (R$)": float(r[2] or 0), "Descrição": _s(r[3]),
             "Pagamento": _s(r[4]), "Criado por": _s(r[5])} for r in rows]


@router.get("/finance/preview")
async def preview_finance(
    date_from: str | None = None, date_to: str | None = None,
    tx_type: str | None = None, payment_method: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await _query_finance(session, str(current.association_id), date_from, date_to, tx_type, payment_method)


@router.get("/finance")
async def export_finance(
    date_from: str | None = None, date_to: str | None = None,
    tx_type: str | None = None, payment_method: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    rows = await _query_finance(session, str(current.association_id), date_from, date_to, tx_type, payment_method)
    wb, ws = _mk("Financeiro")
    cols = list(rows[0].keys()) if rows else ["Data","Tipo","Valor (R$)","Descrição","Pagamento","Criado por"]
    _headers(ws, cols)
    for r in rows: ws.append(list(r.values()))
    _widths(ws)
    return _xlsx(wb, f"financeiro.xlsx")


# ─── Moradores ────────────────────────────────────────────────────────────────

async def _query_residents(session, aid: str, res_type=None, res_status=None, q=None):
    conds = ["association_id = :aid"]
    p: dict = {"aid": aid}
    if res_type: conds.append("type = :tp"); p["tp"] = res_type
    if res_status: conds.append("status = :st"); p["st"] = res_status
    if q: conds.append("(full_name ILIKE :q OR cpf ILIKE :q)"); p["q"] = f"%{q}%"
    w = " AND ".join(conds)
    rows = (await session.execute(text(f"""
        SELECT full_name, cpf, phone_primary, email, address_street,
               address_number, address_neighborhood, address_cep,
               type, status, unit, block, created_at::date
        FROM residents WHERE {w} ORDER BY full_name
    """), p)).fetchall()
    cols = ["Nome","CPF","Telefone","E-mail","Rua","Número","Bairro","CEP","Tipo","Status","Unidade","Bloco","Cadastrado em"]
    return [dict(zip(cols, [_s(v) for v in r])) for r in rows]


@router.get("/residents/preview")
async def preview_residents(
    res_type: str | None = None, res_status: str | None = None, q: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await _query_residents(session, str(current.association_id), res_type, res_status, q)


@router.get("/residents")
async def export_residents(
    res_type: str | None = None, res_status: str | None = None, q: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    rows = await _query_residents(session, str(current.association_id), res_type, res_status, q)
    wb, ws = _mk("Moradores")
    cols = list(rows[0].keys()) if rows else []
    _headers(ws, cols)
    for r in rows: ws.append(list(r.values()))
    _widths(ws)
    return _xlsx(wb, "moradores.xlsx")


# ─── Encomendas ───────────────────────────────────────────────────────────────

async def _query_packages(session, aid: str, date_from=None, date_to=None, pkg_status=None, operator_ids=None, street=None, cep=None):
    conds = ["p.association_id = :aid"]
    p: dict = {"aid": aid}
    if pkg_status == 'awaiting':
        conds.append("p.status IN ('received', 'notified')")
        # ignora janela de data — mostra TODOS aguardando independente de quando chegaram
    else:
        if date_from: conds.append("p.received_at::date >= :df"); p["df"] = date.fromisoformat(date_from)
        if date_to: conds.append("p.received_at::date <= :dt"); p["dt"] = date.fromisoformat(date_to)
        if pkg_status: conds.append("p.status = :st"); p["st"] = pkg_status
    if operator_ids:
        placeholders = ", ".join(f":op{i}" for i in range(len(operator_ids)))
        conds.append(f"p.received_by::text IN ({placeholders})")
        for i, oid in enumerate(operator_ids): p[f"op{i}"] = oid
    if street:
        conds.append("r.address_street ILIKE :street")
        p["street"] = f"%{street}%"
    if cep:
        conds.append("regexp_replace(r.address_cep, '[^0-9]', '', 'g') = regexp_replace(:cep, '[^0-9]', '', 'g')")
        p["cep"] = cep
    w = " AND ".join(conds)
    rows = (await session.execute(text(f"""
        SELECT p.tracking_code, r.full_name, r.address_street, r.address_cep,
               p.unit, p.block,
               p.status, p.carrier_name, p.received_at::date, p.delivered_at::date,
               p.delivery_fee_amount, u.full_name
        FROM packages p
        LEFT JOIN residents r ON r.id = p.resident_id
        LEFT JOIN users u ON u.id = p.received_by
        WHERE {w} ORDER BY p.received_at DESC
    """), p)).fetchall()
    cols = ["Código Rastreio","Destinatário","Rua","CEP","Unidade","Bloco","Status","Transportadora",
            "Recebido em","Entregue em","Taxa (R$)","Recebido por"]
    return [dict(zip(cols, [_s(v) for v in r])) for r in rows]


@router.get("/packages/preview")
async def preview_packages(
    date_from: str | None = None, date_to: str | None = None,
    pkg_status: str | None = None,
    operator_ids: list[str] | None = Query(default=None),
    street: str | None = None, cep: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await _query_packages(session, str(current.association_id), date_from, date_to, pkg_status, operator_ids, street, cep)


@router.get("/packages")
async def export_packages(
    date_from: str | None = None, date_to: str | None = None,
    pkg_status: str | None = None,
    operator_ids: list[str] | None = Query(default=None),
    street: str | None = None, cep: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    rows = await _query_packages(session, str(current.association_id), date_from, date_to, pkg_status, operator_ids, street, cep)
    wb, ws = _mk("Encomendas")
    cols = list(rows[0].keys()) if rows else []
    _headers(ws, cols)
    for r in rows: ws.append(list(r.values()))
    _widths(ws)
    return _xlsx(wb, "encomendas.xlsx")


# ─── Ordens de Serviço ────────────────────────────────────────────────────────

async def _query_service_orders(session, aid: str, date_from=None, date_to=None, so_status=None, so_priority=None, category=None):
    conds = ["association_id = :aid"]
    p: dict = {"aid": aid}
    if date_from: conds.append("created_at::date >= :df"); p["df"] = date.fromisoformat(date_from)
    if date_to: conds.append("created_at::date <= :dt"); p["dt"] = date.fromisoformat(date_to)
    if so_status: conds.append("status = :st"); p["st"] = so_status
    if so_priority: conds.append("priority = :pr"); p["pr"] = so_priority
    if category: conds.append("category_name ILIKE :cat"); p["cat"] = f"%{category}%"
    w = " AND ".join(conds)
    rows = (await session.execute(text(f"""
        SELECT number, title, status, priority, area, category_name,
               service_impacted, org_responsible, requester_name, requester_phone,
               assigned_to_name, request_date::date, created_at::date,
               resolved_at::date, resolution_notes, cancellation_reason
        FROM service_orders WHERE {w} ORDER BY number
    """), p)).fetchall()
    cols = ["Nº","Título","Status","Prioridade","Área","Categoria","Serviço Afetado",
            "Org. Responsável","Solicitante","Telefone","Atribuído a","Data Solicitação",
            "Criado em","Resolvido em","Notas Resolução","Motivo Cancelamento"]
    return [dict(zip(cols, [_s(v) for v in r])) for r in rows]


@router.get("/service-orders/preview")
async def preview_service_orders(
    date_from: str | None = None, date_to: str | None = None,
    so_status: str | None = None, so_priority: str | None = None, category: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await _query_service_orders(session, str(current.association_id), date_from, date_to, so_status, so_priority, category)


@router.get("/service-orders")
async def export_service_orders(
    date_from: str | None = None, date_to: str | None = None,
    so_status: str | None = None, so_priority: str | None = None, category: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    rows = await _query_service_orders(session, str(current.association_id), date_from, date_to, so_status, so_priority, category)
    wb, ws = _mk("Ordens de Serviço")
    cols = list(rows[0].keys()) if rows else []
    _headers(ws, cols)
    for r in rows: ws.append(list(r.values()))
    _widths(ws)
    return _xlsx(wb, "ordens.xlsx")


# ─── Mensalidades ─────────────────────────────────────────────────────────────

async def _query_mensalidades(session, aid: str, date_from=None, date_to=None, men_status=None, ref_month=None):
    conds = ["m.association_id = :aid"]
    p: dict = {"aid": aid}
    if date_from: conds.append("m.due_date >= :df"); p["df"] = date.fromisoformat(date_from)
    if date_to: conds.append("m.due_date <= :dt"); p["dt"] = date.fromisoformat(date_to)
    if men_status: conds.append("m.status = :st"); p["st"] = men_status
    if ref_month: conds.append("m.reference_month = :rm"); p["rm"] = ref_month
    w = " AND ".join(conds)
    rows = (await session.execute(text(f"""
        SELECT r.full_name, r.unit, m.reference_month, m.due_date,
               m.amount, m.status, m.paid_at::date,
               pm.name AS payment_method
        FROM mensalidades m
        JOIN residents r ON r.id = m.resident_id
        LEFT JOIN transactions t ON t.id = m.transaction_id
        LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
        WHERE {w} ORDER BY m.reference_month, r.full_name
    """), p)).fetchall()
    cols = ["Morador","Unidade","Mês Referência","Vencimento","Valor (R$)","Status","Pago em","Forma Pagamento"]
    return [dict(zip(cols, [_s(v) for v in r])) for r in rows]


@router.get("/mensalidades/preview")
async def preview_mensalidades(
    date_from: str | None = None, date_to: str | None = None,
    men_status: str | None = None, ref_month: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await _query_mensalidades(session, str(current.association_id), date_from, date_to, men_status, ref_month)


@router.get("/mensalidades")
async def export_mensalidades(
    date_from: str | None = None, date_to: str | None = None,
    men_status: str | None = None, ref_month: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    rows = await _query_mensalidades(session, str(current.association_id), date_from, date_to, men_status, ref_month)
    wb, ws = _mk("Mensalidades")
    cols = list(rows[0].keys()) if rows else []
    _headers(ws, cols)
    for r in rows: ws.append(list(r.values()))
    _widths(ws)
    return _xlsx(wb, "mensalidades.xlsx")


# ─── Registros Diários ────────────────────────────────────────────────────────

async def _query_daily_records(session, aid: str, date_from=None, date_to=None, task_status=None, task_priority=None):
    conds = ["t.association_id = :aid"]
    p: dict = {"aid": aid}
    if date_from: conds.append("t.due_date >= :df"); p["df"] = date.fromisoformat(date_from)
    if date_to: conds.append("t.due_date <= :dt"); p["dt"] = date.fromisoformat(date_to)
    if task_status: conds.append("t.status = :st"); p["st"] = task_status
    if task_priority: conds.append("t.priority = :pr"); p["pr"] = task_priority
    w = " AND ".join(conds)
    rows = (await session.execute(text(f"""
        SELECT so.number, so.title, t.title, t.priority, t.status,
               t.due_date, t.notes, t.assigned_to_name, t.created_at::date,
               (SELECT COUNT(*) FROM jsonb_array_elements(t.checklist) i WHERE (i->>'done')::boolean = true),
               jsonb_array_length(t.checklist)
        FROM service_order_tasks t
        JOIN service_orders so ON so.id = t.service_order_id
        WHERE {w} ORDER BY t.due_date NULLS LAST, so.number
    """), p)).fetchall()
    return [{
        "OS Nº": _s(r[0]), "Título da OS": _s(r[1]), "Registro": _s(r[2]),
        "Prioridade": _s(r[3]), "Status": _s(r[4]), "Data Entrega": _s(r[5]),
        "Notas": _s(r[6]), "Responsável": _s(r[7]), "Criado em": _s(r[8]),
        "Checklist": f"{r[9]}/{r[10]}" if r[10] else "—",
    } for r in rows]


@router.get("/daily-records/preview")
async def preview_daily_records(
    date_from: str | None = None, date_to: str | None = None,
    task_status: str | None = None, task_priority: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await _query_daily_records(session, str(current.association_id), date_from, date_to, task_status, task_priority)


@router.get("/daily-records")
async def export_daily_records(
    date_from: str | None = None, date_to: str | None = None,
    task_status: str | None = None, task_priority: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    rows = await _query_daily_records(session, str(current.association_id), date_from, date_to, task_status, task_priority)
    wb, ws = _mk("Registros Diários")
    cols = list(rows[0].keys()) if rows else []
    _headers(ws, cols)
    for r in rows: ws.append(list(r.values()))
    _widths(ws)
    return _xlsx(wb, "registros_diarios.xlsx")
