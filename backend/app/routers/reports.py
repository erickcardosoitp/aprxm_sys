from datetime import date
from io import BytesIO

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session

router = APIRouter(prefix="/reports", tags=["Relatórios"])

_HEADER_COLOR = "1A3F6F"


def _mk_wb(sheet_name: str) -> tuple[Workbook, any]:
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_name
    return wb, ws


def _style_headers(ws, headers: list[str]) -> None:
    for col, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=h)
        cell.font = Font(bold=True, color="FFFFFF", size=10)
        cell.fill = PatternFill("solid", fgColor=_HEADER_COLOR)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 22


def _auto_width(ws) -> None:
    for col in ws.columns:
        max_len = max((len(str(c.value or "")) for c in col), default=8)
        ws.column_dimensions[col[0].column_letter].width = min(max_len + 3, 45)


def _respond(wb: Workbook, filename: str) -> Response:
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _v(val) -> str:
    return str(val) if val is not None else "—"


@router.get("/finance")
async def export_finance(
    date_from: str,
    date_to: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    df, dt = date.fromisoformat(date_from), date.fromisoformat(date_to)
    rows = (await session.execute(text("""
        SELECT t.created_at::date, t.type, t.amount, t.description,
               pm.name, u.full_name, cs.id
        FROM transactions t
        LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
        LEFT JOIN cash_sessions cs ON cs.id = t.cash_session_id
        LEFT JOIN users u ON u.id = t.created_by
        WHERE t.association_id = :aid AND t.created_at::date BETWEEN :df AND :dt
          AND t.reversed_at IS NULL
        ORDER BY t.created_at DESC
    """), {"aid": str(current.association_id), "df": df, "dt": dt})).fetchall()

    wb, ws = _mk_wb("Financeiro")
    _style_headers(ws, ["Data", "Tipo", "Valor (R$)", "Descrição", "Forma de Pagamento", "Criado por"])
    for r in rows:
        ws.append([_v(r[0]), "Entrada" if r[1] == "income" else "Saída", float(r[2] or 0), _v(r[3]), _v(r[4]), _v(r[5])])
    _auto_width(ws)
    return _respond(wb, f"financeiro_{date_from}_{date_to}.xlsx")


@router.get("/residents")
async def export_residents(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    rows = (await session.execute(text("""
        SELECT full_name, cpf, phone_primary, email, address_street, address_number,
               address_complement, address_neighborhood, address_city, address_cep,
               type, status, unit, block, created_at::date
        FROM residents WHERE association_id = :aid ORDER BY full_name
    """), {"aid": str(current.association_id)})).fetchall()

    wb, ws = _mk_wb("Moradores")
    _style_headers(ws, ["Nome", "CPF", "Telefone", "E-mail", "Rua", "Número",
                         "Complemento", "Bairro", "Cidade", "CEP", "Tipo", "Status",
                         "Unidade", "Bloco", "Cadastrado em"])
    for r in rows:
        ws.append([_v(v) for v in r])
    _auto_width(ws)
    return _respond(wb, "moradores.xlsx")


@router.get("/packages")
async def export_packages(
    date_from: str,
    date_to: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    df, dt = date.fromisoformat(date_from), date.fromisoformat(date_to)
    rows = (await session.execute(text("""
        SELECT p.tracking_code, p.recipient_name, p.recipient_unit, p.recipient_block,
               p.status, p.carrier, p.received_at::date, p.delivered_at::date,
               p.delivery_fee, u.full_name
        FROM packages p
        LEFT JOIN users u ON u.id = p.received_by
        WHERE p.association_id = :aid AND p.received_at::date BETWEEN :df AND :dt
        ORDER BY p.received_at DESC
    """), {"aid": str(current.association_id), "df": df, "dt": dt})).fetchall()

    wb, ws = _mk_wb("Encomendas")
    _style_headers(ws, ["Código Rastreio", "Destinatário", "Unidade", "Bloco", "Status",
                         "Transportadora", "Recebido em", "Entregue em", "Taxa (R$)", "Recebido por"])
    for r in rows:
        ws.append([_v(v) for v in r])
    _auto_width(ws)
    return _respond(wb, f"encomendas_{date_from}_{date_to}.xlsx")


@router.get("/service-orders")
async def export_service_orders(
    date_from: str,
    date_to: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    df, dt = date.fromisoformat(date_from), date.fromisoformat(date_to)
    rows = (await session.execute(text("""
        SELECT number, title, status, priority, area, category_name,
               service_impacted, org_responsible, requester_name, requester_phone,
               assigned_to_name, request_date::date, created_at::date,
               resolved_at::date, resolution_notes, cancellation_reason
        FROM service_orders
        WHERE association_id = :aid AND created_at::date BETWEEN :df AND :dt
        ORDER BY number
    """), {"aid": str(current.association_id), "df": df, "dt": dt})).fetchall()

    wb, ws = _mk_wb("Ordens de Serviço")
    _style_headers(ws, ["Nº", "Título", "Status", "Prioridade", "Área", "Categoria",
                         "Serviço Afetado", "Org. Responsável", "Solicitante", "Telefone",
                         "Atribuído a", "Data Solicitação", "Criado em", "Resolvido em",
                         "Notas Resolução", "Motivo Cancelamento"])
    for r in rows:
        ws.append([_v(v) for v in r])
    _auto_width(ws)
    return _respond(wb, f"ordens_{date_from}_{date_to}.xlsx")


@router.get("/mensalidades")
async def export_mensalidades(
    date_from: str,
    date_to: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    df, dt = date.fromisoformat(date_from), date.fromisoformat(date_to)
    rows = (await session.execute(text("""
        SELECT r.full_name, r.unit, m.reference_month, m.due_date,
               m.amount, m.status, m.paid_at::date, m.payment_method
        FROM mensalidades m
        JOIN residents r ON r.id = m.resident_id
        WHERE m.association_id = :aid AND m.due_date BETWEEN :df AND :dt
        ORDER BY m.reference_month, r.full_name
    """), {"aid": str(current.association_id), "df": df, "dt": dt})).fetchall()

    wb, ws = _mk_wb("Mensalidades")
    _style_headers(ws, ["Morador", "Unidade", "Mês Referência", "Vencimento",
                         "Valor (R$)", "Status", "Pago em", "Forma Pagamento"])
    for r in rows:
        ws.append([_v(v) for v in r])
    _auto_width(ws)
    return _respond(wb, f"mensalidades_{date_from}_{date_to}.xlsx")


@router.get("/daily-records")
async def export_daily_records(
    date_from: str,
    date_to: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    df, dt = date.fromisoformat(date_from), date.fromisoformat(date_to)
    rows = (await session.execute(text("""
        SELECT so.number, so.title, t.title, t.priority, t.status,
               t.due_date, t.notes, t.assigned_to_name, t.created_at::date,
               (SELECT COUNT(*) FROM jsonb_array_elements(t.checklist) item
                WHERE (item->>'done')::boolean = true) AS done_items,
               jsonb_array_length(t.checklist) AS total_items
        FROM service_order_tasks t
        JOIN service_orders so ON so.id = t.service_order_id
        WHERE t.association_id = :aid AND t.due_date BETWEEN :df AND :dt
        ORDER BY t.due_date, so.number
    """), {"aid": str(current.association_id), "df": df, "dt": dt})).fetchall()

    wb, ws = _mk_wb("Registros Diários")
    _style_headers(ws, ["OS Nº", "Título da OS", "Registro", "Prioridade", "Status",
                         "Data Entrega", "Notas", "Responsável", "Criado em", "Checklist"])
    for r in rows:
        ws.append([
            _v(r[0]), _v(r[1]), _v(r[2]), _v(r[3]), _v(r[4]),
            _v(r[5]), _v(r[6]), _v(r[7]), _v(r[8]),
            f"{r[9]}/{r[10]}" if r[10] else "—",
        ])
    _auto_width(ws)
    return _respond(wb, f"registros_{date_from}_{date_to}.xlsx")
