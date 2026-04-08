from datetime import datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session
from app.services.reconciliation_service import ReconciliationService

router = APIRouter(prefix="/financeiro", tags=["Financeiro"])


@router.get("/summary")
async def get_summary(
    period: str = "month",
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
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
            WHERE association_id = :aid
              AND transaction_at >= :date_from
        """),
        {"aid": str(current.association_id), "date_from": date_from},
    )
    row = result.fetchone()
    income = float(row[0])
    expense = float(row[1]) + float(row[2])  # expense + sangria

    # Income breakdown by subtype
    breakdown_result = await session.execute(
        text("""
            SELECT income_subtype, COALESCE(SUM(amount), 0)
            FROM transactions
            WHERE association_id = :aid
              AND type = 'income'
              AND transaction_at >= :date_from
            GROUP BY income_subtype
        """),
        {"aid": str(current.association_id), "date_from": date_from},
    )
    income_by_type: dict = {}
    for r in breakdown_result.fetchall():
        income_by_type[r[0] or "other"] = float(r[1])

    # Contas a receber: mensalidades pendentes
    cr_result = await session.execute(
        text("""
            SELECT COALESCE(SUM(amount), 0), COUNT(*)
            FROM mensalidades
            WHERE association_id = :aid AND status = 'pending'
        """),
        {"aid": str(current.association_id)},
    )
    cr_row = cr_result.fetchone()

    return {
        "total_income": income,
        "total_expense": expense,
        "total_balance": income - expense,
        "transactions_count": int(row[3]),
        "income_by_type": income_by_type,
        "contas_a_receber": float(cr_row[0] or 0),
        "contas_a_receber_count": int(cr_row[1] or 0),
        "period_label": label,
    }


@router.get("/dashboard", summary="Dashboard financeiro")
async def get_dashboard(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    # Faturamento do dia por tipo
    day_result = await session.execute(
        text("""
            SELECT
                income_subtype,
                COALESCE(SUM(amount), 0) AS total
            FROM transactions
            WHERE association_id = :aid
              AND type = 'income'
              AND transaction_at >= :today
            GROUP BY income_subtype
        """),
        {"aid": str(current.association_id), "today": today_start},
    )
    faturamento_dia: dict = {}
    for row in day_result.fetchall():
        faturamento_dia[row[0] or "other"] = float(row[1])

    # Total em caixa (sessão aberta)
    cash_result = await session.execute(
        text("""
            SELECT
                s.opening_balance,
                COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN t.type != 'income' THEN t.amount ELSE 0 END), 0) AS out
            FROM cash_sessions s
            LEFT JOIN transactions t ON t.cash_session_id = s.id
            WHERE s.association_id = :aid
              AND s.status = 'open'
            GROUP BY s.id, s.opening_balance
            LIMIT 1
        """),
        {"aid": str(current.association_id)},
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
            WHERE bs.association_id = :aid
              AND bs.conciliado = TRUE
              AND bs.date >= DATE_TRUNC('month', CURRENT_DATE)
        """),
        {"aid": str(current.association_id)},
    )
    total_banco = float(pix_result.scalar() or 0)

    # Inadimplência (mensalidades pendentes vencidas)
    inadimplencia_result = await session.execute(
        text("""
            SELECT COALESCE(SUM(amount), 0), COUNT(*)
            FROM mensalidades
            WHERE association_id = :aid
              AND status != 'paid'
              AND due_date < CURRENT_DATE
        """),
        {"aid": str(current.association_id)},
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


@router.post("/bank-statements/import")
async def import_bank_statement(
    bank: str = Form(...),
    file: UploadFile = File(...),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    content = await file.read()
    svc = ReconciliationService(session)
    statements = await svc.import_csv(current.association_id, bank, content)
    await session.commit()
    return {"imported": len(statements)}


@router.get("/extrato", summary="Extrato financeiro por período")
async def get_extrato(
    date_from: str,
    date_to: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
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
            WHERE t.association_id = :aid
              AND t.transaction_at::date BETWEEN :df AND :dt
            ORDER BY t.transaction_at ASC
        """),
        {"aid": str(current.association_id), "df": date_from, "dt": date_to},
    )
    return [
        {"id": str(r[0]), "tipo": r[1], "subtipo": r[2], "valor": str(r[3]),
         "descricao": r[4], "data": str(r[5]), "aprovacao": r[6],
         "operador": r[7], "categoria": r[8], "metodo": r[9]}
        for r in result.fetchall()
    ]


@router.get("/evolucao", summary="Evolução financeira mensal (últimos 6 meses)")
async def get_evolucao(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    result = await session.execute(
        text("""
            SELECT
              TO_CHAR(DATE_TRUNC('month', transaction_at), 'YYYY-MM') AS mes,
              COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) AS entradas,
              COALESCE(SUM(CASE WHEN type!='income' THEN amount ELSE 0 END), 0) AS saidas
            FROM transactions
            WHERE association_id = :aid
              AND transaction_at >= NOW() - INTERVAL '6 months'
            GROUP BY mes ORDER BY mes ASC
        """),
        {"aid": str(current.association_id)},
    )
    return [{"mes": r[0], "entradas": float(r[1]), "saidas": float(r[2])} for r in result.fetchall()]


@router.get("/fluxo-projetado", summary="Fluxo de caixa projetado (próximos 30 dias)")
async def get_fluxo_projetado(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        text("""
            SELECT COALESCE(SUM(amount), 0), COUNT(*)
            FROM mensalidades
            WHERE association_id = :aid
              AND status = 'pending'
              AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
        """),
        {"aid": str(current.association_id)},
    )
    r = result.fetchone()
    return {
        "a_receber_30d": float(r[0]),
        "mensalidades_count": int(r[1]),
    }


@router.post("/reconcile")
async def run_reconciliation(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = ReconciliationService(session)
    result = await svc.run_reconciliation(current.association_id)
    await session.commit()
    return result
