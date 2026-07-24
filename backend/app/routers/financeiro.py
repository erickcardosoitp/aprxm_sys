import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user, financeiro_scope
from app.database import get_session
from app.services.reconciliation_service import ReconciliationService

router = APIRouter(prefix="/financeiro", tags=["Financeiro"])


@router.get("/summary")
async def get_summary(
    period: str = "month",
    unidade: UUID | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    ids = [str(i) for i in await financeiro_scope(current, session, unidade)]
    now = datetime.utcnow()
    if period == "week":
        date_from = now - timedelta(days=7)
        label = "últimos 7 dias"
    elif period == "year":
        date_from = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        label = str(now.year)
    else:  # month
        date_from = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        label = now.strftime("%B/%Y")

    result = await session.execute(
        text("""
            SELECT
                COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS total_income,
                COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expense,
                COALESCE(SUM(CASE WHEN type = 'sangria' THEN amount ELSE 0 END), 0) AS total_sangria,
                COUNT(*) AS total_count
            FROM transactions
            WHERE association_id = ANY(:ids)
              AND transaction_at >= :date_from
              AND reversed_at IS NULL
              AND is_reversal = false
        """),
        {"ids": ids, "date_from": date_from},
    )
    row = result.fetchone()
    income = float(row[0])
    expense = float(row[1])  # sangria = transferência interna, não é despesa
    sangria = float(row[2])

    # Income breakdown by subtype
    breakdown_result = await session.execute(
        text("""
            SELECT income_subtype, COALESCE(SUM(amount), 0)
            FROM transactions
            WHERE association_id = ANY(:ids)
              AND type = 'income'
              AND transaction_at >= :date_from
              AND reversed_at IS NULL
              AND is_reversal = false
            GROUP BY income_subtype
        """),
        {"ids": ids, "date_from": date_from},
    )
    income_by_type: dict = {}
    for r in breakdown_result.fetchall():
        income_by_type[r[0] or "other"] = float(r[1])

    # Contas a receber: mensalidades pendentes de associados ativos
    cr_result = await session.execute(
        text("""
            SELECT COALESCE(SUM(m.amount), 0), COUNT(*)
            FROM mensalidades m
            JOIN residents r ON r.id = m.resident_id
            WHERE m.association_id = ANY(:ids) AND m.status = 'pending'
              AND r.type = 'member' AND r.status = 'active'
        """),
        {"ids": ids},
    )
    cr_row = cr_result.fetchone()

    return {
        "total_income": income,
        "total_expense": expense,
        "total_sangria": sangria,
        "total_balance": income - expense,
        "transactions_count": int(row[3]),
        "income_by_type": income_by_type,
        "contas_a_receber": float(cr_row[0] or 0),
        "contas_a_receber_count": int(cr_row[1] or 0),
        "period_label": label,
    }


@router.get("/dashboard", summary="Dashboard financeiro")
async def get_dashboard(
    unidade: UUID | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    ids = [str(i) for i in await financeiro_scope(current, session, unidade)]
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    # Faturamento do dia por tipo
    day_result = await session.execute(
        text("""
            SELECT
                income_subtype,
                COALESCE(SUM(amount), 0) AS total
            FROM transactions
            WHERE association_id = ANY(:ids)
              AND type = 'income'
              AND transaction_at >= :today
            GROUP BY income_subtype
        """),
        {"ids": ids, "today": today_start},
    )
    faturamento_dia: dict = {}
    for row in day_result.fetchall():
        faturamento_dia[row[0] or "other"] = float(row[1])

    # Total em caixa (sessões abertas de todas as unidades no escopo)
    cash_result = await session.execute(
        text("""
            SELECT
                COALESCE(SUM(s.opening_balance), 0),
                COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN t.type != 'income' THEN t.amount ELSE 0 END), 0) AS out
            FROM cash_sessions s
            LEFT JOIN transactions t ON t.cash_session_id = s.id
            WHERE s.association_id = ANY(:ids)
              AND s.status = 'open'
        """),
        {"ids": ids},
    )
    cash_row = cash_result.fetchone()
    total_caixa = (
        float(cash_row[0]) + float(cash_row[1]) - float(cash_row[2])
        if cash_row else 0.0
    )

    # Total em banco (PIX conciliados no mês)
    pix_result = await session.execute(
        text("""
            SELECT COALESCE(SUM(bs.amount), 0)
            FROM bank_statements bs
            WHERE bs.association_id = ANY(:ids)
              AND bs.conciliado = TRUE
              AND bs.date >= DATE_TRUNC('month', CURRENT_DATE)
        """),
        {"ids": ids},
    )
    total_banco = float(pix_result.scalar() or 0)

    # Inadimplência (mensalidades pendentes vencidas)
    inadimplencia_result = await session.execute(
        text("""
            SELECT COALESCE(SUM(amount), 0), COUNT(*)
            FROM mensalidades
            WHERE association_id = ANY(:ids)
              AND status != 'paid'
              AND due_date < CURRENT_DATE
        """),
        {"ids": ids},
    )
    inadimplencia_row = inadimplencia_result.fetchone()
    total_inadimplencia = float(inadimplencia_row[0] or 0)
    inadimplentes_count = int(inadimplencia_row[1] or 0)

    return {
        "faturamento_dia": faturamento_dia,
        "total_caixa": total_caixa,
        "total_banco_mes": total_banco,
        "inadimplencia_total": total_inadimplencia,
        "inadimplentes_count": inadimplentes_count,
    }


@router.get("/caixas-abertos", summary="Sessões de caixa abertas no escopo (pra zerar caixa)")
async def list_caixas_abertos(
    unidade: UUID | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    ids = [str(i) for i in await financeiro_scope(current, session, unidade)]
    rows = (await session.execute(text("""
        SELECT s.id, a.name AS unidade, s.opened_at, u.full_name AS aberto_por,
               s.opening_balance
               + COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0)
               - COALESCE(SUM(CASE WHEN t.type != 'income' THEN t.amount ELSE 0 END), 0) AS saldo_disponivel
        FROM cash_sessions s
        JOIN associations a ON a.id = s.association_id
        LEFT JOIN users u ON u.id = s.opened_by
        LEFT JOIN transactions t ON t.cash_session_id = s.id
        WHERE s.association_id = ANY(:ids) AND s.status = 'open'
          AND a.plan_name IS DISTINCT FROM 'Homologação' AND a.name NOT LIKE '%DELETADO%'
        GROUP BY s.id, a.name, s.opened_at, u.full_name, s.opening_balance
        ORDER BY a.name
    """), {"ids": ids})).fetchall()
    return [
        {"session_id": str(r[0]), "unidade": r[1], "opened_at": str(r[2]),
         "aberto_por": r[3], "saldo_disponivel": float(r[4])}
        for r in rows
    ]


@router.get("/saldo-caixa-realizado", summary="Saldo físico de caixa por unidade (todas as entradas - todas as saídas)")
async def list_saldo_caixa_realizado(
    unidade: UUID | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    # Dinheiro fisico no cofre da unidade = todas as entradas menos todas as saidas
    # ja CONFIRMADAS: transacoes de sessoes ja CONFERIDAS (contagem fisica validada)
    # + lancamentos sem caixa (manuais/devolucoes). Sessao aberta ou so fechada
    # (ainda nao conferida) fica de fora — o valor dela pode mudar ate a conferencia.
    ids = [str(i) for i in await financeiro_scope(current, session, unidade)]
    rows = (await session.execute(text("""
        SELECT a.id, a.name AS unidade,
               COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0)
               - COALESCE(SUM(CASE WHEN t.type != 'income' THEN t.amount ELSE 0 END), 0) AS saldo
        FROM associations a
        LEFT JOIN transactions t ON t.association_id = a.id
        LEFT JOIN cash_sessions cs ON cs.id = t.cash_session_id
        WHERE a.id = ANY(:ids)
          AND a.plan_name IS DISTINCT FROM 'Homologação' AND a.name NOT LIKE '%DELETADO%'
          AND (t.id IS NULL OR t.cash_session_id IS NULL OR cs.status = 'conferido')
        GROUP BY a.id, a.name
        ORDER BY a.name
    """), {"ids": ids})).fetchall()
    return [{"association_id": str(r[0]), "unidade": r[1], "saldo": float(r[2])} for r in rows]


class ZerarCaixaTotalRequest(BaseModel):
    association_id: UUID
    reason: str = Field(min_length=5, max_length=255)


@router.post("/zerar-caixa-total", summary="Zeramento do saldo realizado total de uma unidade — sangria sem caixa")
async def zerar_caixa_total(
    body: ZerarCaixaTotalRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if not current.is_admin:
        raise HTTPException(status_code=403, detail="Apenas administradores podem zerar o caixa.")
    ids = [str(i) for i in await financeiro_scope(current, session)]
    if str(body.association_id) not in ids:
        raise HTTPException(status_code=403, detail="Unidade fora do escopo do Financeiro desta empresa.")

    row = (await session.execute(text("""
        SELECT COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0)
               - COALESCE(SUM(CASE WHEN t.type != 'income' THEN t.amount ELSE 0 END), 0) AS saldo
        FROM transactions t
        LEFT JOIN cash_sessions cs ON cs.id = t.cash_session_id
        WHERE t.association_id = :aid
          AND (t.cash_session_id IS NULL OR cs.status = 'conferido')
    """), {"aid": str(body.association_id)})).fetchone()
    saldo = row[0] if row else 0
    if saldo <= 0:
        raise HTTPException(status_code=400, detail="Saldo realizado já é zero.")

    # cash_session_id NULL = mesmo mecanismo da devolucao "sem caixa": nao mexe em
    # nenhuma sessao especifica, so registra a saida e reduz o saldo realizado.
    await session.execute(text("""
        INSERT INTO transactions
            (id, association_id, cash_session_id, type, amount, description,
             is_sangria, sangria_reason, sangria_destination, created_by)
        VALUES
            (gen_random_uuid(), :aid, NULL, 'sangria', :amount,
             'Zeramento administrativo total (ESC)', TRUE, :reason, 'Zeramento administrativo total (ESC)', :uid)
    """), {"aid": str(body.association_id), "amount": saldo, "reason": body.reason, "uid": str(current.user_id)})
    await session.commit()
    return {"ok": True, "amount": float(saldo)}


class ZerarCaixaRequest(BaseModel):
    session_id: UUID
    reason: str = Field(min_length=5, max_length=255)


@router.post("/zerar-caixa", summary="Zeramento administrativo remoto (ESC) — sangria sem foto")
async def zerar_caixa(
    body: ZerarCaixaRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if not current.is_admin:
        raise HTTPException(status_code=403, detail="Apenas administradores podem zerar o caixa.")
    ids = [str(i) for i in await financeiro_scope(current, session)]

    row = (await session.execute(text("""
        SELECT s.association_id,
               s.opening_balance
               + COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0)
               - COALESCE(SUM(CASE WHEN t.type != 'income' THEN t.amount ELSE 0 END), 0) AS saldo_disponivel
        FROM cash_sessions s
        LEFT JOIN transactions t ON t.cash_session_id = s.id
        WHERE s.id = :sid AND s.status = 'open'
        GROUP BY s.id, s.association_id, s.opening_balance
    """), {"sid": str(body.session_id)})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Sessão aberta não encontrada.")
    assoc_id, saldo = row
    if str(assoc_id) not in ids:
        raise HTTPException(status_code=403, detail="Sessão fora do escopo do Financeiro desta empresa.")
    if saldo <= 0:
        raise HTTPException(status_code=400, detail="Saldo disponível já é zero.")

    await session.execute(text("""
        INSERT INTO transactions
            (id, association_id, cash_session_id, type, amount, description,
             is_sangria, sangria_reason, sangria_destination, created_by)
        VALUES
            (gen_random_uuid(), :aid, :sid, 'sangria', :amount,
             'Zeramento administrativo (ESC)', TRUE, :reason, 'Zeramento administrativo (ESC)', :uid)
    """), {"aid": str(assoc_id), "sid": str(body.session_id), "amount": saldo,
           "reason": body.reason, "uid": str(current.user_id)})
    await session.commit()
    return {"ok": True, "amount": float(saldo)}


@router.post("/bank-statements/import")
async def import_bank_statement(
    bank: str = Form(...),
    file: UploadFile = File(...),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    content = await file.read()
    svc = ReconciliationService(session)
    result = await svc.import_csv(current.association_id, bank, content)
    await session.commit()
    return result


@router.get("/extrato", summary="Extrato financeiro por período")
async def get_extrato(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    unidade: UUID | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    ids = [str(i) for i in await financeiro_scope(current, session, unidade)]
    today = datetime.utcnow().date()
    df = date.fromisoformat(date_from) if date_from else today.replace(day=1)
    dt = date.fromisoformat(date_to) if date_to else today
    result = await session.execute(
        text("""
            SELECT t.id, t.type, t.income_subtype, t.amount, t.description,
                   t.transaction_at, t.approval_status,
                   u.full_name AS creator, c.name AS category,
                   pm.name AS payment_method
            FROM transactions t
            JOIN users u ON u.id = t.created_by
            LEFT JOIN transaction_categories c ON c.id = t.category_id
            LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
            WHERE t.association_id = ANY(:ids)
              AND t.transaction_at::date BETWEEN :df AND :dt
            ORDER BY t.transaction_at ASC
        """),
        {"ids": ids, "df": df, "dt": dt},
    )
    return [
        {"id": str(r[0]), "tipo": r[1], "subtipo": r[2], "valor": str(r[3]),
         "descricao": r[4], "data": str(r[5]), "aprovacao": r[6],
         "operador": r[7], "categoria": r[8], "metodo": r[9]}
        for r in result.fetchall()
    ]


@router.get("/evolucao", summary="Evolução financeira mensal (últimos 6 meses)")
async def get_evolucao(
    unidade: UUID | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    ids = [str(i) for i in await financeiro_scope(current, session, unidade)]
    result = await session.execute(
        text("""
            SELECT
              TO_CHAR(DATE_TRUNC('month', transaction_at), 'YYYY-MM') AS mes,
              COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) AS entradas,
              COALESCE(SUM(CASE WHEN type!='income' THEN amount ELSE 0 END), 0) AS saidas
            FROM transactions
            WHERE association_id = ANY(:ids)
              AND transaction_at >= NOW() - INTERVAL '6 months'
            GROUP BY mes ORDER BY mes ASC
        """),
        {"ids": ids},
    )
    return [{"mes": r[0], "entradas": float(r[1]), "saidas": float(r[2])} for r in result.fetchall()]


@router.get("/fluxo-projetado", summary="Fluxo de caixa projetado (próximos 30 dias)")
async def get_fluxo_projetado(
    unidade: UUID | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    ids = [str(i) for i in await financeiro_scope(current, session, unidade)]
    result = await session.execute(
        text("""
            SELECT r.full_name, m.reference_month, m.due_date, m.amount
            FROM mensalidades m
            JOIN residents r ON r.id = m.resident_id
            WHERE m.association_id = ANY(:ids)
              AND m.status = 'pending'
              AND m.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
            ORDER BY m.due_date ASC
        """),
        {"ids": ids},
    )
    return [
        {"resident_name": r[0], "reference_month": r[1], "due_date": str(r[2]), "amount": str(r[3])}
        for r in result.fetchall()
    ]


async def _query_movimentacoes(
    session: AsyncSession,
    ids: list[str],
    date_from: str | None = None,
    date_to: str | None = None,
    tipo: list[str] | None = None,
    produto: list[str] | None = None,
    morador: str | None = None,
    rua: str | None = None,
    inadimplente: bool | None = None,
    usuario_id: UUID | None = None,
    cargo: str | None = None,
) -> list[dict]:
    conds = ["t.association_id = ANY(:ids)"]
    p: dict = {"ids": ids}

    if date_from:
        conds.append("t.transaction_at::date >= :df")
        p["df"] = date.fromisoformat(date_from)
    if date_to:
        conds.append("t.transaction_at::date <= :dt")
        p["dt"] = date.fromisoformat(date_to)

    if tipo:
        tipo_conds = []
        if "entrada" in tipo:
            tipo_conds.append("(t.type = 'income' AND NOT t.is_reversal)")
        if "saida" in tipo:
            tipo_conds.append("(t.type = 'expense' AND NOT t.is_reversal)")
        if "sangria" in tipo:
            tipo_conds.append("(t.type = 'sangria' AND NOT t.is_reversal)")
        if "estorno" in tipo:
            tipo_conds.append("(t.is_reversal AND t.cash_session_id IS NOT NULL)")
        if "devolucao" in tipo:
            tipo_conds.append("(t.is_reversal AND t.cash_session_id IS NULL)")
        if tipo_conds:
            conds.append(f"({' OR '.join(tipo_conds)})")

    if produto:
        conds.append("t.income_subtype = ANY(:produtos)")
        p["produtos"] = produto
    if morador:
        conds.append("COALESCE(res.full_name, res2.full_name) ILIKE :morador")
        p["morador"] = f"%{morador}%"
    if rua:
        conds.append("COALESCE(res.address_street, res2.address_street) ILIKE :rua")
        p["rua"] = f"%{rua}%"
    if usuario_id:
        conds.append("t.created_by = :uid")
        p["uid"] = str(usuario_id)
    if cargo:
        conds.append("u.role = :cargo")
        p["cargo"] = cargo
    if inadimplente is not None:
        sub = """
            EXISTS (
                SELECT 1 FROM mensalidades dm
                WHERE dm.resident_id = COALESCE(res.id, res2.id)
                  AND dm.status != 'paid'
                  AND dm.due_date < CURRENT_DATE
            )
        """
        conds.append(sub if inadimplente else f"NOT {sub}")

    where = " AND ".join(conds)
    rows = (await session.execute(text(f"""
        SELECT t.transaction_at, t.type, t.is_reversal, t.cash_session_id,
               a.name AS unidade, COALESCE(res.full_name, res2.full_name) AS morador,
               t.amount, t.income_subtype,
               COALESCE(res.status, res2.status)::text AS status_morador,
               u.full_name AS usuario
        FROM transactions t
        JOIN associations a ON a.id = t.association_id
        LEFT JOIN users u ON u.id = t.created_by
        LEFT JOIN mensalidades men ON men.transaction_id = t.id
        LEFT JOIN residents res ON res.id = men.resident_id
        LEFT JOIN residents res2 ON res2.id = t.resident_id
        WHERE {where}
        ORDER BY t.transaction_at DESC
    """), p)).fetchall()

    TIPO_LABEL = {"income": "Entrada", "expense": "Saída", "sangria": "Sangria"}
    PRODUTO_LABEL = {
        "mensalidade": "Mensalidade", "delivery_fee": "Taxa de Entrega",
        "proof_of_residence": "Comprovante de Residência", "other": "Outras",
    }
    out = []
    for r in rows:
        if r[2] and r[3] is None:
            tipo_label = "Devolução"
        elif r[2]:
            tipo_label = "Estorno"
        else:
            tipo_label = TIPO_LABEL.get(r[1], r[1])
        out.append({
            "Data/hora": str(r[0]), "Tipo Movimentação": tipo_label, "Associação": r[4],
            "Morador": r[5] or "—", "Valor": float(r[6]),
            "Produto": PRODUTO_LABEL.get(r[7], r[7] or "—"),
            "Status Morador": r[8] or "—", "Usuário": r[9] or "—",
        })
    return out


@router.get("/movimentacoes", summary="Movimentações — todas as unidades no escopo, com filtros")
async def list_movimentacoes(
    unidade: UUID | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    tipo: list[str] | None = Query(default=None),
    produto: list[str] | None = Query(default=None),
    morador: str | None = Query(default=None),
    rua: str | None = Query(default=None),
    inadimplente: bool | None = Query(default=None),
    usuario_id: UUID | None = Query(default=None),
    cargo: str | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    ids = [str(i) for i in await financeiro_scope(current, session, unidade)]
    return await _query_movimentacoes(
        session, ids, date_from, date_to, tipo, produto,
        morador, rua, inadimplente, usuario_id, cargo,
    )


@router.get("/movimentacoes/export", summary="Movimentações — export xlsx com os filtros aplicados")
async def export_movimentacoes(
    unidade: UUID | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    tipo: list[str] | None = Query(default=None),
    produto: list[str] | None = Query(default=None),
    morador: str | None = Query(default=None),
    rua: str | None = Query(default=None),
    inadimplente: bool | None = Query(default=None),
    usuario_id: UUID | None = Query(default=None),
    cargo: str | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    from app.routers.reports import _mk, _headers, _widths, _xlsx

    ids = [str(i) for i in await financeiro_scope(current, session, unidade)]
    rows = await _query_movimentacoes(
        session, ids, date_from, date_to, tipo, produto,
        morador, rua, inadimplente, usuario_id, cargo,
    )
    wb, ws = _mk("Movimentações")
    cols = list(rows[0].keys()) if rows else ["Data/hora", "Tipo Movimentação", "Associação", "Morador", "Valor", "Produto", "Status Morador", "Usuário"]
    _headers(ws, cols)
    for r in rows:
        ws.append(list(r.values()))
    _widths(ws)
    return _xlsx(wb, "movimentacoes.xlsx")


@router.get("/dre", summary="Demonstrativo de Resultado da Associação")
async def get_dre(
    year: int = Query(...),
    month: int | None = Query(default=None),
    nivel: int = Query(default=2, ge=1, le=3),
    agrupar_por: str = Query(default="tipo"),
    sub_agrupar_por: str | None = Query(default=None),
    unidade: UUID | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    ids = [str(i) for i in await financeiro_scope(current, session, unidade)]
    if month:
        date_filter = "EXTRACT(YEAR FROM t.transaction_at)=:yr AND EXTRACT(MONTH FROM t.transaction_at)=:mo"
        params: dict = {"ids": ids, "yr": year, "mo": month}
        period_label = f"{str(month).zfill(2)}/{year}"
    else:
        date_filter = "EXTRACT(YEAR FROM t.transaction_at)=:yr"
        params = {"ids": ids, "yr": year}
        period_label = str(year)

    SUBTYPE_MAP = {
        "mensalidade":        "Mensalidades",
        "delivery_fee":       "Taxas de Entrega",
        "proof_of_residence": "Comprovantes de Residência",
        "other":              "Outras Receitas",
        None:                 "Outras Receitas",
    }

    BASE = f"""
        FROM transactions t
        LEFT JOIN transaction_categories c ON c.id = t.category_id
        LEFT JOIN cash_sessions cs ON cs.id = t.cash_session_id
        LEFT JOIN users u ON u.id = cs.opened_by
        WHERE t.association_id = ANY(:ids)
          AND {date_filter}
          AND t.is_reversal = FALSE
          AND t.reversed_at IS NULL
          AND t.type IN ('income','expense')
    """

    # ── Nível 1: só totais ─────────────────────────────────────────────────
    if nivel == 1:
        r = (await session.execute(text(f"""
            SELECT
                COALESCE(SUM(amount) FILTER (WHERE type='income'),  0) AS rec,
                COALESCE(SUM(amount) FILTER (WHERE type='expense'), 0) AS desp
            {BASE}
        """), params)).fetchone()
        tr, td = float(r[0]), float(r[1])
        return {
            "period_label": period_label, "nivel": 1, "agrupar_por": agrupar_por,
            "receitas": [{"label": "Receitas", "valor": round(tr, 2), "linhas": None}],
            "despesas": [{"label": "Despesas", "valor": round(td, 2), "linhas": None}],
            "total_receitas": round(tr, 2), "total_despesas": round(td, 2),
            "resultado": round(tr - td, 2),
        }

    # ── Nível 2 e 3: agrupado ─────────────────────────────────────────────
    def _group_label_rec(agrupar_por: str, subtipo, categoria, op_name) -> str:
        if agrupar_por == "tipo":
            return SUBTYPE_MAP.get(subtipo, "Outras Receitas")
        if agrupar_por == "origem":
            return "Receitas via Caixa" if op_name else "Receitas Manuais"
        if agrupar_por == "operador":
            return op_name or "Manual / Sem caixa"
        if agrupar_por == "categoria":
            return categoria or SUBTYPE_MAP.get(subtipo or "", "Sem categoria")
        return "Outras Receitas"

    def _group_label_desp(agrupar_por: str, categoria, op_name) -> str:
        if agrupar_por == "origem":
            return "Saídas via Caixa" if op_name else "Saídas Manuais"
        return categoria or "Despesas Gerais"

    rows_all = (await session.execute(text(f"""
        SELECT t.type, t.income_subtype, c.name AS cat, u.full_name AS op,
               t.amount, t.description, t.transaction_at::date AS dt,
               CASE WHEN t.cash_session_id IS NOT NULL THEN TRUE ELSE FALSE END AS tem_sessao
        {BASE}
        ORDER BY t.type, t.transaction_at
    """), params)).fetchall()

    receitas: dict[str, list] = {}
    despesas: dict[str, list] = {}

    for r in rows_all:
        tipo, subtipo, cat, op, amt, desc, dt, tem_sessao = r
        amt = float(amt)
        linha = {"descricao": desc or cat or subtipo or "—", "valor": round(amt, 2), "data": str(dt)}
        if tipo == "income":
            label = _group_label_rec(agrupar_por, subtipo, cat, op)
            receitas.setdefault(label, []).append(linha)
        else:
            label = _group_label_desp(agrupar_por, cat, op)
            despesas.setdefault(label, []).append(linha)

    def _build(groups: dict, include_linhas: bool):
        result = []
        for label, linhas in sorted(groups.items()):
            total = sum(l["valor"] for l in linhas)
            result.append({
                "label": label,
                "valor": round(total, 2),
                "linhas": linhas if include_linhas else None,
            })
        return result

    include_linhas = nivel == 3
    rec_list  = _build(receitas, include_linhas)
    desp_list = _build(despesas, include_linhas)

    # ── Sub-agrupamento opcional ───────────────────────────────────────────
    if sub_agrupar_por and sub_agrupar_por != agrupar_por and nivel >= 2:
        # Busca todas as transações com DUAS dimensões agrupadas
        sub_rec: dict[str, dict[str, float]] = {}
        sub_desp: dict[str, dict[str, float]] = {}

        for r in rows_all:
            tipo, subtipo, cat, op, amt, desc, dt, tem_sessao = r
            amt_f = float(amt)
            # label primário (já calculado)
            if tipo == "income":
                pri = _group_label_rec(agrupar_por, subtipo, cat, op)
                sub = _group_label_rec(sub_agrupar_por, subtipo, cat, op)
                sub_rec.setdefault(pri, {}).setdefault(sub, 0)
                sub_rec[pri][sub] += amt_f
            else:
                pri = _group_label_desp(agrupar_por, cat, op)
                sub = _group_label_desp(sub_agrupar_por, cat, op)
                sub_desp.setdefault(pri, {}).setdefault(sub, 0)
                sub_desp[pri][sub] += amt_f

        # Injeta sub_grupos em cada item da lista
        for item in rec_list:
            subs = sub_rec.get(item["label"], {})
            item["sub_grupos"] = [
                {"label": k, "valor": round(v, 2)}
                for k, v in sorted(subs.items(), key=lambda x: -x[1])
            ]
        for item in desp_list:
            subs = sub_desp.get(item["label"], {})
            item["sub_grupos"] = [
                {"label": k, "valor": round(v, 2)}
                for k, v in sorted(subs.items(), key=lambda x: -x[1])
            ]

    tr = sum(x["valor"] for x in rec_list)
    td = sum(x["valor"] for x in desp_list)

    return {
        "period_label": period_label, "nivel": nivel,
        "agrupar_por": agrupar_por, "sub_agrupar_por": sub_agrupar_por,
        "receitas": rec_list,
        "despesas": desp_list,
        "total_receitas": round(tr, 2),
        "total_despesas": round(td, 2),
        "resultado": round(tr - td, 2),
    }


@router.get("/bank-statements", summary="Listar lançamentos do extrato bancário")
async def list_bank_statements(
    conciliado: bool | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    filters = ["association_id = :aid"]
    params: dict = {"aid": str(current.association_id)}
    if conciliado is not None:
        filters.append("conciliado = :conc")
        params["conc"] = conciliado
    if date_from:
        filters.append("date >= :df")
        params["df"] = date_from
    if date_to:
        filters.append("date <= :dt")
        params["dt"] = date_to
    where = " AND ".join(filters)
    rows = (await session.execute(text(f"""
        SELECT id, bank, date, amount, name, description, tipo, conciliado, transaction_id, batched_at
          FROM bank_statements
         WHERE {where}
         ORDER BY date DESC, id DESC
         LIMIT 500
    """), params)).fetchall()
    return [{
        "id": str(r[0]), "bank": r[1], "date": str(r[2]), "amount": str(r[3]),
        "name": r[4], "description": r[5], "tipo": r[6], "conciliado": r[7],
        "transaction_id": str(r[8]) if r[8] else None, "batched_at": str(r[9]) if r[9] else None,
    } for r in rows]


class ManualReconcileRequest(BaseModel):
    statement_id: UUID | None = None
    transaction_id: UUID | None = None
    # For manual entry without a CSV (creates a bank_statement record)
    amount: Decimal | None = None
    date: str | None = None
    payer_name: str | None = None
    description: str | None = None


@router.post("/bank-statements/manual-reconcile", summary="Conciliação PIX manual")
async def manual_reconcile(
    body: ManualReconcileRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from app.core.tenant import require_conferente as _rc
    aid = str(current.association_id)

    if body.statement_id:
        # Mark existing statement as conciliado and optionally link transaction
        updates = ["conciliado = true"]
        params: dict = {"id": str(body.statement_id), "aid": aid}
        if body.transaction_id:
            updates.append("transaction_id = :tid")
            params["tid"] = str(body.transaction_id)
        await session.execute(text(
            f"UPDATE bank_statements SET {', '.join(updates)} WHERE id = :id AND association_id = :aid"
        ), params)
        if body.transaction_id:
            sid = str(body.statement_id)
            tid = str(body.transaction_id)
            existing = (await session.execute(text("""
                SELECT id FROM reconciliations
                 WHERE transaction_id = :tid AND association_id = :aid
                 LIMIT 1
            """), {"tid": tid, "aid": aid})).fetchone()
            if existing:
                await session.execute(text("""
                    UPDATE reconciliations SET status = 'manual', statement_id = :sid
                     WHERE id = :rid
                """), {"sid": sid, "rid": str(existing[0])})
            else:
                await session.execute(text("""
                    INSERT INTO reconciliations (id, association_id, statement_id, transaction_id, score, status)
                    VALUES (gen_random_uuid(), :aid, :sid, :tid, 100, 'manual')
                """), {"aid": aid, "sid": sid, "tid": tid})
    elif body.amount and body.date:
        from datetime import date as _date
        stmt_row = (await session.execute(text("""
            INSERT INTO bank_statements (id, association_id, bank, date, amount, name, description, tipo, conciliado)
            VALUES (gen_random_uuid(), :aid, 'PIX', :date, :amt, :name, :desc, 'entrada', true)
            RETURNING id
        """), {
            "aid": aid,
            "date": _date.fromisoformat(body.date),
            "amt": float(body.amount),
            "name": body.payer_name or "Manual",
            "desc": body.description or "Conciliação manual",
        })).fetchone()
        new_stmt_id = stmt_row[0]
        if body.transaction_id:
            tid2 = str(body.transaction_id)
            existing2 = (await session.execute(text("""
                SELECT id FROM reconciliations
                 WHERE transaction_id = :tid AND association_id = :aid
                 LIMIT 1
            """), {"tid": tid2, "aid": aid})).fetchone()
            if existing2:
                await session.execute(text("""
                    UPDATE reconciliations SET status = 'manual', statement_id = :sid
                     WHERE id = :rid
                """), {"sid": str(new_stmt_id), "rid": str(existing2[0])})
            else:
                await session.execute(text("""
                    INSERT INTO reconciliations (id, association_id, statement_id, transaction_id, score, status)
                    VALUES (gen_random_uuid(), :aid, :sid, :tid, 100, 'manual')
                """), {"aid": aid, "sid": str(new_stmt_id), "tid": tid2})
    else:
        raise HTTPException(400, "Informe statement_id ou amount+date para conciliação manual.")

    await session.commit()
    return {"ok": True}


class PixLearningConfirmBody(BaseModel):
    bank_statement_id: UUID
    transaction_id: UUID
    resident_id: UUID


@router.post("/pix-learning/confirm")
async def confirm_pix_learning(
    body: PixLearningConfirmBody,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    aid = str(current.association_id)

    # Fetch bank statement name
    stmt_row = (await session.execute(
        text("SELECT name FROM bank_statements WHERE id=:id AND association_id=:aid"),
        {"id": str(body.bank_statement_id), "aid": aid},
    )).fetchone()
    if not stmt_row:
        raise HTTPException(404, "Bank statement não encontrado.")
    bank_name: str = stmt_row[0] or ""

    # Fetch resident name
    res_row = (await session.execute(
        text("SELECT full_name FROM residents WHERE id=:id AND association_id=:aid"),
        {"id": str(body.resident_id), "aid": aid},
    )).fetchone()
    if not res_row:
        raise HTTPException(404, "Residente não encontrado.")
    resident_name: str = res_row[0] or ""

    svc = ReconciliationService(session)
    await svc.record_learning(
        association_id=current.association_id,
        bank_name=bank_name,
        resident_id=body.resident_id,
        resident_name=resident_name,
        confirmed_by=current.user_id,
    )

    # Upsert reconciliation as manual
    existing = (await session.execute(
        text("SELECT id FROM reconciliations WHERE transaction_id=:tid AND association_id=:aid LIMIT 1"),
        {"tid": str(body.transaction_id), "aid": aid},
    )).fetchone()
    if existing:
        await session.execute(
            text("UPDATE reconciliations SET status='manual', statement_id=:sid WHERE id=:rid"),
            {"sid": str(body.bank_statement_id), "rid": str(existing[0])},
        )
    else:
        await session.execute(
            text("""
                INSERT INTO reconciliations (id, association_id, statement_id, transaction_id, score, status)
                VALUES (gen_random_uuid(), :aid, :sid, :tid, 100, 'manual')
            """),
            {"aid": aid, "sid": str(body.bank_statement_id), "tid": str(body.transaction_id)},
        )

    # Mark statement as conciliated
    await session.execute(
        text("UPDATE bank_statements SET conciliado=TRUE WHERE id=:id AND association_id=:aid"),
        {"id": str(body.bank_statement_id), "aid": aid},
    )

    await session.commit()
    return {"ok": True}


class RegisterOrphanAsIncomeBody(BaseModel):
    resident_id: UUID
    income_subtype: str = "other"
    payment_method_id: UUID | None = None


@router.post("/bank-statements/{statement_id}/register-as-income")
async def register_orphan_as_income(
    statement_id: UUID,
    body: RegisterOrphanAsIncomeBody,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Cria uma transaction a partir de um bank_statement órfão e concilia automaticamente."""
    aid = str(current.association_id)

    stmt_row = (await session.execute(
        text("SELECT id, amount, name, date, bank FROM bank_statements WHERE id=:id AND association_id=:aid AND conciliado=FALSE"),
        {"id": str(statement_id), "aid": aid},
    )).fetchone()
    if not stmt_row:
        raise HTTPException(404, "Statement não encontrado ou já conciliado.")

    stmt_id, stmt_amount, stmt_name, stmt_date, stmt_bank = stmt_row

    res_row = (await session.execute(
        text("SELECT full_name FROM residents WHERE id=:id AND association_id=:aid"),
        {"id": str(body.resident_id), "aid": aid},
    )).fetchone()
    if not res_row:
        raise HTTPException(404, "Residente não encontrado.")
    resident_name = res_row[0]

    # Busca payment_method PIX se não informado
    pm_id = body.payment_method_id
    if not pm_id:
        pm_row = (await session.execute(
            text("SELECT id FROM payment_methods WHERE association_id=:aid AND name ILIKE '%pix%' LIMIT 1"),
            {"aid": aid},
        )).fetchone()
        if pm_row:
            pm_id = pm_row[0]

    # Cria a transaction
    tx_row = (await session.execute(
        text("""
            INSERT INTO transactions
                (association_id, type, amount, description, income_subtype,
                 resident_id, payment_method_id, payer_name, created_by, transaction_at)
            VALUES (:aid, 'income', :amount, :desc, CAST(:subtype AS income_subtype),
                    :rid, :pmid, :pname, :cby, :txat)
            RETURNING id
        """),
        {
            "aid": aid,
            "amount": float(stmt_amount),
            "desc": f"PIX — {resident_name}",
            "subtype": body.income_subtype,
            "rid": str(body.resident_id),
            "pmid": str(pm_id) if pm_id else None,
            "pname": stmt_name,
            "cby": str(current.id),
            "txat": stmt_date,
        },
    )).fetchone()
    tx_id = tx_row[0]

    # Cria reconciliation
    await session.execute(
        text("""
            INSERT INTO reconciliations (id, association_id, statement_id, transaction_id, score, status)
            VALUES (gen_random_uuid(), :aid, :sid, :tid, 100, 'manual')
        """),
        {"aid": aid, "sid": str(statement_id), "tid": str(tx_id)},
    )

    # Marca statement conciliado
    await session.execute(
        text("UPDATE bank_statements SET conciliado=TRUE WHERE id=:id"),
        {"id": str(statement_id)},
    )

    # Alimenta pix_learning_map
    svc = ReconciliationService(session)
    await svc.record_learning(
        association_id=current.association_id,
        bank_name=stmt_name or "",
        resident_id=body.resident_id,
        resident_name=resident_name,
        confirmed_by=current.user_id,
    )

    await session.commit()
    return {"ok": True, "transaction_id": str(tx_id)}


@router.post("/reconcile")
async def run_reconciliation(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = ReconciliationService(session)
    result = await svc.run_reconciliation(current.association_id)
    await session.commit()
    return result


@router.get("/reconcile/stream")
async def stream_reconciliation(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    aid = current.association_id

    async def generate():
        def sse(data: dict) -> str:
            return f"data: {json.dumps(data)}\n\n"

        try:
            svc = ReconciliationService(session)

            # Load only PIX income transactions (unreconciled)
            tx_rows = (await session.execute(text("""
                SELECT t.id, t.amount, t.description, t.transaction_at,
                       r.full_name, r.cpf, t.resident_id
                FROM transactions t
                JOIN payment_methods pm ON pm.id = t.payment_method_id
                LEFT JOIN residents r ON r.id = t.resident_id
                WHERE t.association_id = :aid
                  AND t.type = 'income'
                  AND pm.name ILIKE '%pix%'
                  AND t.reversed_at IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM reconciliations rec WHERE rec.transaction_id = t.id
                  )
                ORDER BY t.transaction_at DESC
            """), {"aid": str(aid)})).fetchall()

            stmt_rows = (await session.execute(text("""
                SELECT id, amount, name, cpf, date, bank, description
                FROM bank_statements
                WHERE association_id = :aid AND conciliado = false
            """), {"aid": str(aid)})).fetchall()

            total = len(tx_rows)
            yield sse({"type": "start", "total": total, "statements": len(stmt_rows)})

            if total == 0:
                yield sse({"type": "done", "matched": 0, "unmatched": 0, "total": 0})
                return

            from app.services.reconciliation_service import normalize_name, clean_cpf
            from difflib import SequenceMatcher as _SM
            from decimal import Decimal as D
            from datetime import date

            def _words_match(a: str, b: str) -> bool:
                if a == b: return True
                if len(a) >= 5 and len(b) >= 5 and a[:5] == b[:5]: return True
                if len(a) >= 4 and len(b) >= 4 and _SM(None, a, b).ratio() >= 0.8: return True
                return False

            def _name_score(a: str, b: str) -> int:
                if not a or not b: return 0
                stop = {"DE","DA","DO","DOS","DAS","E"}
                tw = set(normalize_name(a).split()) - stop
                sw = set(normalize_name(b).split()) - stop
                if not tw or not sw: return 0
                overlap = sum(1 for w in tw if any(_words_match(w, s) for s in sw))
                ratio = overlap / max(len(tw), len(sw))
                return int(60 * ratio) if ratio >= 0.4 else 0

            def _desc_name(d: str) -> str:
                if not d: return ""
                if " — " in d: return d.split(" — ", 1)[1].strip()
                if " - " in d: return d.split(" - ", 1)[1].strip()
                return ""

            # Load dependents (residents with responsible_id) for all residents in the tx set
            from uuid import UUID as _UUID
            res_ids = [_UUID(str(tx[6])) for tx in tx_rows if tx[6]]
            res_ids = list({r for r in res_ids})
            dep_map: dict[str, list[str]] = {}
            if res_ids:
                dep_rows = (await session.execute(text("""
                    SELECT responsible_id, full_name FROM residents
                     WHERE responsible_id = ANY(:ids)
                       AND association_id = :aid
                """), {"ids": res_ids, "aid": str(aid)})).fetchall()
                for dr in dep_rows:
                    dep_map.setdefault(str(dr[0]), []).append(normalize_name(dr[1] or ""))

            claimed: set[str] = set()
            matched = 0
            unmatched = 0

            for idx, tx in enumerate(tx_rows):
                tx_id, tx_amount, tx_desc, tx_at, res_name, res_cpf, tx_res_id = tx
                tx_date = tx_at.date() if hasattr(tx_at, "date") else date.fromisoformat(str(tx_at)[:10])
                tx_amount_dec = D(str(tx_amount))
                tx_primary = normalize_name(res_name or "") or normalize_name(_desc_name(tx_desc or ""))
                tx_dep_names = dep_map.get(str(tx_res_id), []) if tx_res_id else []
                label = res_name or _desc_name(tx_desc or "") or str(tx_desc or "")[:40]

                yield sse({
                    "type": "processing",
                    "current": idx + 1,
                    "total": total,
                    "pct": round((idx / total) * 100),
                    "desc": label,
                    "amount": float(tx_amount),
                    "date": str(tx_date),
                })

                best_score = 0
                best_stmt = None

                for stmt in stmt_rows:
                    sid, s_amount, s_name, s_cpf, s_date, s_bank, s_desc = stmt
                    if str(sid) in claimed: continue
                    s_date = s_date.date() if hasattr(s_date, "date") else s_date
                    score = 0; ns = 0

                    if res_cpf and s_cpf and clean_cpf(res_cpf) == s_cpf:
                        score += 100; ns = 100

                    n = _name_score(tx_primary, s_name or "")
                    # also try matching against dependent names
                    for dep_name in tx_dep_names:
                        dn = _name_score(dep_name, s_name or "")
                        if dn > n:
                            n = dn
                    score += n; ns = max(ns, n)

                    if D(str(s_amount)) == tx_amount_dec: score += 50
                    if abs((tx_date - s_date).days) <= 1: score += 20

                    if score > 0 and ns > 0 and score > best_score:
                        best_score = score
                        best_stmt = stmt

                if best_stmt and best_score >= 100:
                    sid = best_stmt[0]
                    from app.models.bank_statement import Reconciliation
                    recon = Reconciliation(
                        association_id=aid,
                        statement_id=sid,
                        transaction_id=tx_id,
                        score=best_score,
                        status="automatico",
                    )
                    session.add(recon)
                    await session.execute(text(
                        "UPDATE bank_statements SET conciliado=true WHERE id=:id"
                    ), {"id": str(sid)})
                    claimed.add(str(sid))
                    matched += 1
                    yield sse({
                        "type": "matched",
                        "current": idx + 1,
                        "total": total,
                        "pct": round(((idx + 1) / total) * 100),
                        "desc": label,
                        "amount": float(tx_amount),
                        "date": str(tx_date),
                        "score": best_score,
                        "payer": best_stmt[2],
                    })
                else:
                    unmatched += 1
                    yield sse({
                        "type": "unmatched",
                        "current": idx + 1,
                        "total": total,
                        "pct": round(((idx + 1) / total) * 100),
                        "desc": label,
                        "amount": float(tx_amount),
                        "date": str(tx_date),
                    })

            await session.commit()
            yield sse({"type": "done", "matched": matched, "unmatched": unmatched, "total": total, "pct": 100})

        except Exception as e:
            yield sse({"type": "error", "message": str(e)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.patch("/bank-statements/{statement_id}/payer", summary="Atualizar nome do pagador PIX")
async def update_payer_name(
    statement_id: UUID,
    body: dict,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Nome obrigatório.")
    await session.execute(text("""
        UPDATE bank_statements SET name = :name
         WHERE id = :id AND association_id = :aid
    """), {"name": name, "id": str(statement_id), "aid": str(current.association_id)})
    await session.commit()
    return {"ok": True}


class BatchToCashboxRequest(BaseModel):
    cash_box_id: UUID
    transaction_ids: List[UUID]


@router.post("/bank-statements/batch-to-cashbox", summary="Enviar PIX para caixinha (cria bank_statement se necessário)")
async def batch_pix_to_cashbox(
    body: BatchToCashboxRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from datetime import date as _date
    aid = str(current.association_id)

    box = (await session.execute(text(
        "SELECT id, balance FROM cash_boxes WHERE id=:id AND association_id=:aid AND is_active=true"
    ), {"id": str(body.cash_box_id), "aid": aid})).fetchone()
    if not box:
        raise HTTPException(404, "Caixinha não encontrada.")

    from uuid import UUID as _UUID
    tx_ids = [_UUID(str(t)) for t in body.transaction_ids]

    # Load transactions with their existing bank_statement (prefer unbatched)
    tx_rows = (await session.execute(text("""
        SELECT DISTINCT ON (t.id)
               t.id, t.amount, t.transaction_at, t.description,
               r.full_name,
               bs.id AS stmt_id, bs.batched_at
          FROM transactions t
          LEFT JOIN residents r ON r.id = t.resident_id
          LEFT JOIN reconciliations rec ON rec.transaction_id = t.id
          LEFT JOIN bank_statements bs ON bs.id = rec.statement_id
         WHERE t.id = ANY(:ids) AND t.association_id = :aid
         ORDER BY t.id, bs.batched_at NULLS FIRST
    """), {"ids": tx_ids, "aid": aid})).fetchall()

    if not tx_rows:
        raise HTTPException(400, "Nenhuma transação encontrada.")

    # Deduplicate by tx id (could have multiple reconciliation rows)
    seen_tx: set[str] = set()
    stmt_ids_to_batch: list[str] = []
    total = 0.0

    for row in tx_rows:
        tx_id, tx_amount, tx_at, tx_desc, res_name, stmt_id, batched_at = row
        tx_str = str(tx_id)
        if tx_str in seen_tx:
            continue
        seen_tx.add(tx_str)

        if batched_at:
            continue  # already batched, skip

        if stmt_id:
            stmt_ids_to_batch.append(str(stmt_id))
        else:
            # Create bank_statement + reconciliation on the fly
            tx_date = tx_at.date() if hasattr(tx_at, "date") else _date.fromisoformat(str(tx_at)[:10])
            new_stmt = (await session.execute(text("""
                INSERT INTO bank_statements (id, association_id, bank, date, amount, name, description, tipo, conciliado)
                VALUES (gen_random_uuid(), :aid, 'PIX', :date, :amt, :name, :desc, 'entrada', true)
                RETURNING id
            """), {
                "aid": aid, "date": tx_date, "amt": float(tx_amount),
                "name": res_name or "Manual", "desc": tx_desc or "PIX manual",
            })).fetchone()
            new_sid = str(new_stmt[0])
            await session.execute(text("""
                INSERT INTO reconciliations (id, association_id, statement_id, transaction_id, score, status)
                VALUES (gen_random_uuid(), :aid, :sid, :tid, 100, 'manual')
                ON CONFLICT DO NOTHING
            """), {"aid": aid, "sid": new_sid, "tid": tx_str})
            stmt_ids_to_batch.append(new_sid)

        total += float(tx_amount)

    if not stmt_ids_to_batch:
        raise HTTPException(400, "Todos os itens já foram enviados para caixinha.")

    new_bal = float(box[1]) + total
    from uuid import UUID as _UUID
    stmt_uuid_ids = [_UUID(s) for s in stmt_ids_to_batch]
    await session.execute(text("""
        UPDATE bank_statements SET batched_at=NOW(), conciliado=true
         WHERE id = ANY(:ids) AND association_id = :aid
    """), {"ids": stmt_uuid_ids, "aid": aid})
    await session.execute(text("UPDATE cash_boxes SET balance=:b, updated_at=NOW() WHERE id=:id"),
                          {"b": new_bal, "id": str(body.cash_box_id)})
    await session.execute(text("""
        INSERT INTO cash_box_movements (id, association_id, cash_box_id, amount, movement_type, description, created_by)
        VALUES (gen_random_uuid(), :aid, :bid, :amt, 'credit', :desc, :usr)
    """), {"aid": aid, "bid": str(body.cash_box_id), "amt": total,
           "desc": f"PIX — lote {len(stmt_ids_to_batch)} lançamentos", "usr": str(current.user_id)})
    await session.commit()
    return {"ok": True, "total": str(round(total, 2)), "count": len(stmt_ids_to_batch), "new_balance": str(round(new_bal, 2))}
