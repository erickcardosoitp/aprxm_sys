import json
from datetime import datetime, timedelta
from decimal import Decimal
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
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
            await session.execute(text("""
                INSERT INTO reconciliations (id, association_id, statement_id, transaction_id, score, status)
                VALUES (gen_random_uuid(), :aid, :sid, :tid, 100, 'manual')
                ON CONFLICT DO NOTHING
            """), {"aid": aid, "sid": str(new_stmt_id), "tid": str(body.transaction_id)})
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
    await session.execute(text("""
        UPDATE bank_statements SET batched_at=NOW(), conciliado=true
         WHERE id = ANY(:ids) AND association_id = :aid
    """), {"ids": stmt_ids_to_batch, "aid": aid})
    await session.execute(text("UPDATE cash_boxes SET balance=:b, updated_at=NOW() WHERE id=:id"),
                          {"b": new_bal, "id": str(body.cash_box_id)})
    await session.execute(text("""
        INSERT INTO cash_box_movements (id, association_id, cash_box_id, amount, movement_type, description, created_by)
        VALUES (gen_random_uuid(), :aid, :bid, :amt, 'credit', :desc, :usr)
    """), {"aid": aid, "bid": str(body.cash_box_id), "amt": total,
           "desc": f"PIX — lote {len(stmt_ids_to_batch)} lançamentos", "usr": str(current.user_id)})
    await session.commit()
    return {"ok": True, "total": str(round(total, 2)), "count": len(stmt_ids_to_batch), "new_balance": str(round(new_bal, 2))}
