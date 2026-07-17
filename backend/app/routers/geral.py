"""
Router /geral — painel consolidado read-only para associações agregadoras.
Requer: current.is_aggregator == True (linked_association_ids no JWT).
Permite filtro opcional por assoc_slug (ex: 'vaz-lobo', 'congonha', ou omitir para tudo).
"""
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session

router = APIRouter(prefix="/geral", tags=["Geral"])


def _require_aggregator(current: CurrentUser) -> CurrentUser:
    if not current.is_aggregator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso exclusivo para contas do painel Geral.",
        )
    return current


def _require_inventory_role(current: CurrentUser) -> CurrentUser:
    if not current.is_conferente:
        raise HTTPException(status_code=403, detail="Permissão insuficiente para inventário.")
    return current


def _resolve_ids(current: CurrentUser, assoc_ids: list[str] | None) -> list[UUID]:
    authorized = set(current.linked_association_ids)
    if not assoc_ids:
        return list(authorized)
    requested = {UUID(i) for i in assoc_ids}
    valid = authorized & requested
    if not valid:
        raise HTTPException(status_code=403, detail="Associação não autorizada.")
    return list(valid)


# ─── READ-ONLY endpoints ────────────────────────────────────────────────────


@router.get("/associations", summary="Associações vinculadas ao Geral")
async def list_linked_associations(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    _require_aggregator(current)
    seen = dict.fromkeys(
        [str(current.association_id)] + [str(i) for i in current.linked_association_ids]
    )
    ids = list(seen.keys())
    result = await session.execute(
        text("SELECT id, name, slug FROM associations WHERE id = ANY(:ids)"),
        {"ids": ids},
    )
    return [{"id": str(r.id), "name": r.name, "slug": r.slug} for r in result.fetchall()]


@router.get("/dashboard", summary="Dashboard consolidado")
async def geral_dashboard(
    assoc_ids: list[str] | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _require_aggregator(current)
    ids = _resolve_ids(current, assoc_ids)
    ids_str = [str(i) for i in ids]

    result = await session.execute(
        text("""
            SELECT
                (SELECT COUNT(*) FROM residents WHERE association_id = ANY(:ids) AND status = 'active') AS total_moradores,
                (SELECT COUNT(*) FROM residents WHERE association_id = ANY(:ids) AND type = 'member' AND status = 'active') AS total_membros,
                (SELECT COALESCE(SUM(amount), 0) FROM mensalidades WHERE association_id = ANY(:ids) AND status = 'paid') AS total_arrecadado,
                (SELECT COALESCE(SUM(amount), 0) FROM mensalidades WHERE association_id = ANY(:ids) AND status != 'paid') AS total_pendente,
                (SELECT COUNT(*) FROM mensalidades WHERE association_id = ANY(:ids) AND status != 'paid' AND due_date < CURRENT_DATE) AS inadimplentes,
                (SELECT COUNT(*) FROM packages WHERE association_id = ANY(:ids) AND status = 'received') AS encomendas_aguardando
        """),
        {"ids": ids_str},
    )
    row = result.fetchone()

    return {
        "total_moradores": row.total_moradores,
        "total_membros": row.total_membros,
        "total_arrecadado": str(row.total_arrecadado),
        "total_pendente": str(row.total_pendente),
        "inadimplentes": row.inadimplentes,
        "encomendas_aguardando": row.encomendas_aguardando,
    }


@router.get("/cobrancas", summary="Cobranças consolidadas")
async def geral_cobrancas(
    assoc_ids: list[str] | None = Query(default=None),
    status_filter: str = Query(default="all"),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    _require_aggregator(current)
    ids = _resolve_ids(current, assoc_ids)
    ids_str = [str(i) for i in ids]

    where_status = ""
    if status_filter == "paid":
        where_status = "AND m.status = 'paid'"
    elif status_filter == "pending":
        where_status = "AND m.status = 'pending' AND m.due_date >= CURRENT_DATE"
    elif status_filter == "overdue":
        where_status = "AND m.status != 'paid' AND m.due_date < CURRENT_DATE"

    result = await session.execute(
        text(f"""
            SELECT
                m.id, m.association_id,
                a.name AS association_name,
                a.slug AS association_slug,
                r.full_name AS resident_name,
                m.reference_month, m.due_date, m.amount, m.status, m.paid_at
            FROM mensalidades m
            JOIN residents r ON r.id = m.resident_id
            JOIN associations a ON a.id = m.association_id
            WHERE m.association_id = ANY(:ids)
            {where_status}
            ORDER BY m.due_date DESC
            LIMIT 500
        """),
        {"ids": ids_str},
    )
    return [
        {
            "id": str(r.id),
            "association_id": str(r.association_id),
            "association_name": r.association_name,
            "association_slug": r.association_slug,
            "resident_name": r.resident_name,
            "reference_month": r.reference_month,
            "due_date": str(r.due_date),
            "amount": str(r.amount),
            "status": r.status,
            "paid_at": str(r.paid_at) if r.paid_at else None,
        }
        for r in result.fetchall()
    ]


@router.get("/moradores", summary="Moradores consolidados")
async def geral_moradores(
    assoc_ids: list[str] | None = Query(default=None),
    q: str | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    _require_aggregator(current)
    ids = _resolve_ids(current, assoc_ids)
    ids_str = [str(i) for i in ids]

    where_search = ""
    params: dict = {"ids": ids_str}
    if q:
        where_search = "AND (unaccent(lower(r.full_name)) LIKE unaccent(lower(:q)) OR r.cpf ILIKE :q)"
        params["q"] = f"%{q}%"

    result = await session.execute(
        text(f"""
            SELECT
                r.id, r.full_name, r.cpf, r.type, r.status,
                a.name AS association_name, a.slug AS association_slug,
                (SELECT COUNT(*) FROM mensalidades m WHERE m.resident_id = r.id AND m.status != 'paid') AS pendencias
            FROM residents r
            JOIN associations a ON a.id = r.association_id
            WHERE r.association_id = ANY(:ids)
            {where_search}
            ORDER BY r.full_name
            LIMIT 200
        """),
        params,
    )
    return [
        {
            "id": str(r.id),
            "full_name": r.full_name,
            "cpf": r.cpf,
            "type": r.type,
            "status": r.status,
            "association_name": r.association_name,
            "association_slug": r.association_slug,
            "pendencias": r.pendencias,
        }
        for r in result.fetchall()
    ]


@router.get("/inventario", summary="Inventário financeiro mensal consolidado")
async def inventario_mensal(
    month: str = Query(description="Mês no formato YYYY-MM"),
    assoc_ids: list[str] | None = Query(default=None),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    _require_aggregator(current)
    ids = _resolve_ids(current, assoc_ids)
    ids_str = [str(i) for i in ids]

    rows = (await session.execute(text("""
        SELECT
            a.id,
            a.name AS association_name,
            COALESCE((
                SELECT SUM(m.amount) FROM mensalidades m
                 WHERE m.association_id = a.id AND m.status = 'paid'
                   AND TO_CHAR(m.paid_at, 'YYYY-MM') = :month
            ), 0) AS mensalidades_pagas,
            COALESCE((
                SELECT COUNT(*) FROM mensalidades m
                 WHERE m.association_id = a.id AND m.status = 'paid'
                   AND TO_CHAR(m.paid_at, 'YYYY-MM') = :month
            ), 0) AS qtd_mensalidades,
            COALESCE((
                SELECT SUM(t.amount) FROM transactions t
                 WHERE t.association_id = a.id AND t.type = 'income'
                   AND t.reversed_at IS NULL AND t.is_reversal = false
                   AND TO_CHAR(t.created_at, 'YYYY-MM') = :month
            ), 0) AS total_receitas,
            COALESCE((
                SELECT SUM(t.amount) FROM transactions t
                 WHERE t.association_id = a.id AND t.type = 'expense'
                   AND t.reversed_at IS NULL AND t.is_reversal = false
                   AND TO_CHAR(t.created_at, 'YYYY-MM') = :month
            ), 0) AS total_despesas,
            COALESCE((
                SELECT SUM(cb.balance) FROM cash_boxes cb
                 WHERE cb.association_id = a.id AND cb.is_active = true
            ), 0) AS saldo_caixinhas,
            COALESCE((
                SELECT SUM(cb.balance) FROM cash_boxes cb
                 WHERE cb.association_id = a.id AND cb.is_cofre = true AND cb.is_active = true
            ), 0) AS saldo_cofres
          FROM associations a
         WHERE a.id = ANY(:ids)
         ORDER BY a.name
    """), {"ids": ids_str, "month": month})).fetchall()

    return [{
        "association_id": str(r[0]),
        "association_name": r[1],
        "mensalidades_pagas": str(round(float(r[2]), 2)),
        "qtd_mensalidades": int(r[3]),
        "total_receitas": str(round(float(r[4]), 2)),
        "total_despesas": str(round(float(r[5]), 2)),
        "saldo_caixinhas": str(round(float(r[6]), 2)),
        "saldo_cofres": str(round(float(r[7]), 2)),
        "liquido_mes": str(round(float(r[4]) - float(r[5]), 2)),
    } for r in rows]


# ─── SYNC PANEL ─────────────────────────────────────────────────────────────


@router.get("/sync", summary="Painel de sincronização do Escritório")
async def sync_panel(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    _require_aggregator(current)
    ids_str = [str(i) for i in current.linked_association_ids]

    rows = (await session.execute(text("""
        SELECT
            a.id,
            a.name,
            a.slug,
            (SELECT COUNT(*) FROM residents r WHERE r.association_id = a.id AND r.status = 'active') AS moradores_ativos,
            (SELECT COUNT(*) FROM residents r WHERE r.association_id = a.id AND r.type = 'member' AND r.status = 'active') AS membros_ativos,
            (SELECT COUNT(*) FROM packages p WHERE p.association_id = a.id AND p.status = 'received') AS encomendas_pendentes,
            (SELECT COUNT(*) FROM packages p WHERE p.association_id = a.id AND DATE_TRUNC('month', p.delivered_at) = DATE_TRUNC('month', NOW())) AS encomendas_entregues_mes,
            COALESCE((
                SELECT SUM(cb.balance) FROM cash_boxes cb
                WHERE cb.association_id = a.id AND cb.is_cofre = true AND cb.is_active = true
            ), 0) AS saldo_cofre,
            (SELECT MAX(t.created_at) FROM transactions t WHERE t.association_id = a.id) AS ultima_transacao,
            (SELECT cs.opened_at FROM cash_sessions cs WHERE cs.association_id = a.id AND cs.status = 'open' ORDER BY cs.opened_at DESC LIMIT 1) AS sessao_aberta_em,
            (SELECT MAX(cs.closed_at) FROM cash_sessions cs WHERE cs.association_id = a.id AND cs.status = 'closed') AS ultima_sessao_fechada,
            (SELECT COUNT(*) FROM residents r WHERE r.association_id = a.id
                AND EXISTS (SELECT 1 FROM mensalidades m WHERE m.resident_id = r.id AND m.status != 'paid' AND m.due_date < CURRENT_DATE)) AS inadimplentes
        FROM associations a
        WHERE a.id = ANY(:ids)
        ORDER BY a.name
    """), {"ids": ids_str})).fetchall()

    result = []
    now = datetime.now(timezone.utc)
    for r in rows:
        sessao_aberta_em = r[9]
        ultima_transacao = r[8]

        # Determina status de sincronização
        sync_status = "ok"
        warnings = []

        if sessao_aberta_em:
            horas_abertas = (now - sessao_aberta_em.replace(tzinfo=timezone.utc)).total_seconds() / 3600
            if horas_abertas > 24:
                sync_status = "warning"
                warnings.append(f"Sessão de caixa aberta há {int(horas_abertas)}h")

        if ultima_transacao is None:
            sync_status = "warning"
            warnings.append("Nenhuma transação registrada")
        else:
            dias_sem_transacao = (now - ultima_transacao.replace(tzinfo=timezone.utc)).days
            if dias_sem_transacao > 30:
                sync_status = "warning"
                warnings.append(f"Sem transações há {dias_sem_transacao} dias")

        result.append({
            "id": str(r[0]),
            "name": r[1],
            "slug": r[2],
            "moradores_ativos": r[3],
            "membros_ativos": r[4],
            "encomendas_pendentes": r[5],
            "encomendas_entregues_mes": r[6],
            "saldo_cofre": str(round(float(r[7]), 2)),
            "ultima_transacao": r[8].isoformat() if r[8] else None,
            "sessao_aberta_em": r[9].isoformat() if r[9] else None,
            "ultima_sessao_fechada": r[10].isoformat() if r[10] else None,
            "inadimplentes": r[11],
            "sync_status": sync_status,
            "warnings": warnings,
        })

    return result


# ─── INVENTÁRIO FINANCEIRO (apenas Escritório) ──────────────────────────────


class InventoryUpdateRequest(BaseModel):
    pix_counted: float | None = None
    cash_counted: float | None = None
    justification: str | None = None


class InventoryConcludeRequest(BaseModel):
    pix_counted: float
    cash_counted: float
    justification: str
    attributed_association_id: UUID | None = None


def _first_of_month(d: date | None = None) -> date:
    ref = d or date.today()
    return ref.replace(day=1)


async def _expected_total(session: AsyncSession, ids_str: list[str]) -> float:
    row = (await session.execute(text("""
        SELECT COALESCE(SUM(cb.balance), 0)
        FROM cash_boxes cb
        WHERE cb.association_id = ANY(:ids) AND cb.is_cofre = true AND cb.is_active = true
    """), {"ids": ids_str})).fetchone()
    return float(row[0]) if row else 0.0


async def _open_sessions(session: AsyncSession, ids_str: list[str]) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT a.name, cs.opened_at
        FROM cash_sessions cs
        JOIN associations a ON a.id = cs.association_id
        WHERE cs.association_id = ANY(:ids) AND cs.status = 'open'
        ORDER BY a.name
    """), {"ids": ids_str})).fetchall()
    return [{"association": r[0], "opened_at": r[1].isoformat()} for r in rows]


@router.get("/inventory", summary="Lista inventários do Escritório")
async def list_inventories(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    _require_aggregator(current)
    rows = (await session.execute(text("""
        SELECT ir.id, ir.pix_counted, ir.cash_counted, ir.total_counted,
               ir.expected_total, ir.difference, ir.justification,
               ir.status, ir.reference_month, ir.signed_at,
               ir.cancelled_at, ir.created_at,
               u_sign.full_name AS signed_by_name,
               u_cancel.full_name AS cancelled_by_name,
               ir.attributed_association_id,
               a_attr.name AS attributed_association_name
        FROM inventory_records ir
        LEFT JOIN users u_sign ON u_sign.id = ir.signed_by
        LEFT JOIN users u_cancel ON u_cancel.id = ir.cancelled_by
        LEFT JOIN associations a_attr ON a_attr.id = ir.attributed_association_id
        WHERE ir.association_id = :assoc_id
        ORDER BY ir.reference_month DESC
        LIMIT 24
    """), {"assoc_id": str(current.association_id)})).fetchall()

    return [{
        "id": str(r[0]),
        "pix_counted": str(r[1]),
        "cash_counted": str(r[2]),
        "total_counted": str(r[3]),
        "expected_total": str(r[4]) if r[4] is not None else None,
        "difference": str(r[5]) if r[5] is not None else None,
        "justification": r[6],
        "status": r[7],
        "reference_month": r[8].isoformat() if r[8] else None,
        "signed_at": r[9].isoformat() if r[9] else None,
        "cancelled_at": r[10].isoformat() if r[10] else None,
        "created_at": r[11].isoformat() if r[11] else None,
        "signed_by_name": r[12],
        "cancelled_by_name": r[13],
        "attributed_association_id": str(r[14]) if r[14] else None,
        "attributed_association_name": r[15],
    } for r in rows]


@router.post("/inventory/draft", summary="Cria draft de inventário para o mês corrente")
async def create_inventory_draft(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _require_aggregator(current)
    _require_inventory_role(current)

    ref_month = _first_of_month()

    existing = (await session.execute(text("""
        SELECT id, status FROM inventory_records
        WHERE association_id = :assoc_id AND reference_month = :ref_month AND status != 'cancelled'
    """), {"assoc_id": str(current.association_id), "ref_month": ref_month})).fetchone()

    if existing:
        return {"id": str(existing[0]), "status": existing[1], "created": False}

    # Bloqueia se houver sessões abertas em qualquer associação vinculada
    ids_str = [str(i) for i in current.linked_association_ids]
    open_sessions = await _open_sessions(session, ids_str)
    if open_sessions:
        detail = "Existem sessões de caixa abertas: " + ", ".join(
            f"{s['association']} (desde {s['opened_at'][:10]})" for s in open_sessions
        )
        raise HTTPException(status_code=400, detail=detail)

    result = (await session.execute(text("""
        INSERT INTO inventory_records (association_id, reference_month, status)
        VALUES (:assoc_id, :ref_month, 'draft')
        RETURNING id
    """), {"assoc_id": str(current.association_id), "ref_month": ref_month})).fetchone()
    await session.commit()

    return {"id": str(result[0]), "status": "draft", "created": True}


@router.patch("/inventory/{inventory_id}", summary="Atualiza valores do draft")
async def update_inventory_draft(
    inventory_id: UUID,
    body: InventoryUpdateRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _require_aggregator(current)
    _require_inventory_role(current)

    row = (await session.execute(text("""
        SELECT id, pix_counted, cash_counted, justification, status
        FROM inventory_records
        WHERE id = :id AND association_id = :assoc_id
    """), {"id": str(inventory_id), "assoc_id": str(current.association_id)})).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Inventário não encontrado.")
    if row[4] != "draft":
        raise HTTPException(status_code=400, detail="Apenas drafts podem ser editados.")

    pix = float(body.pix_counted) if body.pix_counted is not None else float(row[1])
    cash = float(body.cash_counted) if body.cash_counted is not None else float(row[2])
    justification = body.justification if body.justification is not None else row[3]
    total = pix + cash

    ids_str = [str(i) for i in current.linked_association_ids]
    expected = await _expected_total(session, ids_str)
    difference = total - expected

    await session.execute(text("""
        UPDATE inventory_records
        SET pix_counted = :pix, cash_counted = :cash, total_counted = :total,
            expected_total = :expected, difference = :diff, justification = :justification
        WHERE id = :id
    """), {
        "pix": pix, "cash": cash, "total": total,
        "expected": expected, "diff": difference,
        "justification": justification, "id": str(inventory_id),
    })
    await session.commit()

    return {
        "id": str(inventory_id),
        "pix_counted": str(pix),
        "cash_counted": str(cash),
        "total_counted": str(total),
        "expected_total": str(expected),
        "difference": str(difference),
        "justification": justification,
    }


@router.post("/inventory/{inventory_id}/conclude", summary="Conclui e assina o inventário")
async def conclude_inventory(
    inventory_id: UUID,
    body: InventoryConcludeRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _require_aggregator(current)
    _require_inventory_role(current)

    if not body.justification.strip():
        raise HTTPException(status_code=400, detail="Justificativa obrigatória.")

    row = (await session.execute(text("""
        SELECT id, status FROM inventory_records
        WHERE id = :id AND association_id = :assoc_id
    """), {"id": str(inventory_id), "assoc_id": str(current.association_id)})).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Inventário não encontrado.")
    if row[1] != "draft":
        raise HTTPException(status_code=400, detail="Apenas drafts podem ser concluídos.")

    pix = float(body.pix_counted)
    cash = float(body.cash_counted)
    total = pix + cash
    ids_str = [str(i) for i in current.linked_association_ids]
    expected = await _expected_total(session, ids_str)
    difference = total - expected
    now = datetime.now(timezone.utc)

    # Valida que attributed_association_id pertence às associações vinculadas
    if body.attributed_association_id:
        if body.attributed_association_id not in current.linked_association_ids:
            raise HTTPException(status_code=400, detail="Associação atribuída não vinculada ao Escritório.")

    await session.execute(text("""
        UPDATE inventory_records
        SET pix_counted = :pix, cash_counted = :cash, total_counted = :total,
            expected_total = :expected, difference = :diff,
            justification = :justification,
            signed_by = :signed_by, signed_at = :signed_at,
            status = 'concluded',
            attributed_association_id = :attr_assoc
        WHERE id = :id
    """), {
        "pix": pix, "cash": cash, "total": total,
        "expected": expected, "diff": difference,
        "justification": body.justification,
        "signed_by": str(current.user_id), "signed_at": now,
        "attr_assoc": str(body.attributed_association_id) if body.attributed_association_id else None,
        "id": str(inventory_id),
    })
    await session.commit()

    return {"id": str(inventory_id), "status": "concluded", "difference": str(difference)}


@router.post("/inventory/{inventory_id}/cancel", summary="Cancela um inventário")
async def cancel_inventory(
    inventory_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    _require_aggregator(current)
    _require_inventory_role(current)

    row = (await session.execute(text("""
        SELECT id, status FROM inventory_records
        WHERE id = :id AND association_id = :assoc_id
    """), {"id": str(inventory_id), "assoc_id": str(current.association_id)})).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Inventário não encontrado.")
    if row[1] == "cancelled":
        raise HTTPException(status_code=400, detail="Inventário já cancelado.")

    now = datetime.now(timezone.utc)
    await session.execute(text("""
        UPDATE inventory_records
        SET status = 'cancelled', cancelled_by = :user_id, cancelled_at = :now
        WHERE id = :id
    """), {"user_id": str(current.user_id), "now": now, "id": str(inventory_id)})
    await session.commit()

    return {"id": str(inventory_id), "status": "cancelled"}
