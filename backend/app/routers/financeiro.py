from datetime import datetime, timedelta
from decimal import Decimal
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
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
              AND reversed_at IS NULL
              AND is_reversal = false
        """),
        {"aid": str(current.association_id), "date_from": date_from},
    )
    row = result.fetchone()
    income = float(row[0])
    expense = float(row[1])  # sangria = transferência interna, não é despesa

    # Income breakdown by subtype
    breakdown_result = await session.execute(
        text("""
            SELECT income_subtype, COALESCE(SUM(amount), 0)
            FROM transactions
            WHERE association_id = :aid
              AND type = 'income'
              AND transaction_at >= :date_from
              AND reversed_at IS NULL
              AND is_reversal = false
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
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    today = datetime.utcnow().date()
    df = date_from or today.replace(day=1).isoformat()
    dt = date_to or today.isoformat()
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
        {"aid": str(current.association_id), "df": df, "dt": dt},
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
) -> list[dict]:
    result = await session.execute(
        text("""
            SELECT r.full_name, r.unit, r.block, m.reference_month, m.due_date, m.amount
            FROM mensalidades m
            JOIN residents r ON r.id = m.resident_id
            WHERE m.association_id = :aid
              AND m.status = 'pending'
              AND m.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
            ORDER BY m.due_date ASC
        """),
        {"aid": str(current.association_id)},
    )
    return [
        {"resident_name": r[0], "unit": r[1], "block": r[2],
         "reference_month": r[3], "due_date": str(r[4]), "amount": str(r[5])}
        for r in result.fetchall()
    ]


@router.get("/dre", summary="Demonstrativo de Resultado da Associação")
async def get_dre(
    year: int = Query(...),
    month: int | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if month:
        date_filter = "EXTRACT(YEAR FROM t.transaction_at) = :yr AND EXTRACT(MONTH FROM t.transaction_at) = :mo"
        params: dict = {"aid": str(current.association_id), "yr": year, "mo": month}
        period_label = f"{str(month).zfill(2)}/{year}"
    else:
        date_filter = "EXTRACT(YEAR FROM t.transaction_at) = :yr"
        params = {"aid": str(current.association_id), "yr": year}
        period_label = str(year)

    result = await session.execute(text(f"""
        SELECT
            t.type,
            t.income_subtype,
            c.name AS category,
            COALESCE(SUM(t.amount), 0) AS total
        FROM transactions t
        LEFT JOIN transaction_categories c ON c.id = t.category_id
        WHERE t.association_id = :aid
          AND {date_filter}
          AND t.is_reversal = false
          AND t.reversed_at IS NULL
        GROUP BY t.type, t.income_subtype, c.name
        ORDER BY t.type, t.income_subtype, c.name
    """), params)
    rows = result.fetchall()

    receitas: dict[str, float] = {}
    despesas: dict[str, float] = {}

    SUBTYPE_MAP = {
        "mensalidade": "Mensalidades",
        "delivery_fee": "Taxas de Entrega",
        "proof_of_residence": "Comprovantes de Residência",
        "other": "Outras Receitas",
    }

    for r in rows:
        tipo, subtipo, categoria, total = r[0], r[1], r[2], float(r[3])
        if tipo == "income":
            label = SUBTYPE_MAP.get(subtipo or "", "Outras Receitas")
            receitas[label] = receitas.get(label, 0.0) + total
        elif tipo == "expense":
            label = categoria or "Despesas Gerais"
            despesas[label] = despesas.get(label, 0.0) + total
        # sangria = transferência interna (caixa → malote → cofre), não entra no DRE

    total_receitas = sum(receitas.values())
    total_despesas = sum(despesas.values())
    resultado = total_receitas - total_despesas

    return {
        "period_label": period_label,
        "year": year,
        "month": month,
        "receitas": [{"descricao": k, "valor": round(v, 2)} for k, v in sorted(receitas.items())],
        "total_receitas": round(total_receitas, 2),
        "despesas": [{"descricao": k, "valor": round(v, 2)} for k, v in sorted(despesas.items())],
        "total_despesas": round(total_despesas, 2),
        "resultado": round(resultado, 2),
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
    elif body.amount and body.date:
        # Create new bank_statement entry and mark as conciliado
        await session.execute(text("""
            INSERT INTO bank_statements (association_id, bank, date, amount, name, description, tipo, conciliado, transaction_id)
            VALUES (:aid, 'PIX', :date, :amt, :name, :desc, 'entrada', true, :tid)
        """), {
            "aid": aid,
            "date": body.date,
            "amt": float(body.amount),
            "name": body.payer_name or "Manual",
            "desc": body.description or "Conciliação manual",
            "tid": str(body.transaction_id) if body.transaction_id else None,
        })
    else:
        raise HTTPException(400, "Informe statement_id ou amount+date para conciliação manual.")

    await session.commit()
    return {"ok": True}


@router.post("/reconcile")
async def run_reconciliation(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = ReconciliationService(session)
    result = await svc.run_reconciliation(current.association_id)
    await session.commit()
    return result


class BatchToCashboxRequest(BaseModel):
    cash_box_id: UUID
    statement_ids: List[UUID]


@router.post("/bank-statements/batch-to-cashbox", summary="Enviar PIX conciliados para caixinha")
async def batch_pix_to_cashbox(
    body: BatchToCashboxRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    aid = str(current.association_id)

    box = (await session.execute(text(
        "SELECT id, balance FROM cash_boxes WHERE id=:id AND association_id=:aid AND is_active=true"
    ), {"id": str(body.cash_box_id), "aid": aid})).fetchone()
    if not box:
        raise HTTPException(404, "Caixinha não encontrada.")

    id_list = [str(s) for s in body.statement_ids]
    rows = (await session.execute(text("""
        SELECT id, amount FROM bank_statements
         WHERE id = ANY(:ids) AND association_id = :aid AND batched_at IS NULL
    """), {"ids": id_list, "aid": aid})).fetchall()

    if not rows:
        raise HTTPException(400, "Nenhum lançamento válido para enviar.")

    total = sum(float(r[1]) for r in rows)
    new_bal = float(box[1]) + total

    await session.execute(text("""
        UPDATE bank_statements SET batched_at=NOW(), conciliado=true
         WHERE id = ANY(:ids) AND association_id = :aid
    """), {"ids": id_list, "aid": aid})
    await session.execute(text("UPDATE cash_boxes SET balance=:b, updated_at=NOW() WHERE id=:id"),
                          {"b": new_bal, "id": str(body.cash_box_id)})
    await session.execute(text("""
        INSERT INTO cash_box_movements (id, association_id, cash_box_id, amount, movement_type, description, created_by)
        VALUES (gen_random_uuid(), :aid, :bid, :amt, 'credit', :desc, :usr)
    """), {"aid": aid, "bid": str(body.cash_box_id), "amt": total,
           "desc": f"PIX conciliados — lote {len(rows)} lançamentos", "usr": str(current.user_id)})
    await session.commit()
    return {"ok": True, "total": str(round(total, 2)), "count": len(rows), "new_balance": str(round(new_bal, 2))}
