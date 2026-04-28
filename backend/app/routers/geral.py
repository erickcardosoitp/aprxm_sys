"""
Router /geral — painel consolidado read-only para associações agregadoras.
Requer: current.is_aggregator == True (linked_association_ids no JWT).
Permite filtro opcional por assoc_slug (ex: 'vaz-lobo', 'congonha', ou omitir para tudo).
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
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


def _resolve_ids(current: CurrentUser, assoc_ids: list[str] | None) -> list[UUID]:
    """Se assoc_ids passado, usa só os que estão na lista autorizada do usuário."""
    authorized = set(current.linked_association_ids)
    if not assoc_ids:
        return list(authorized)
    requested = {UUID(i) for i in assoc_ids}
    valid = authorized & requested
    if not valid:
        raise HTTPException(status_code=403, detail="Associação não autorizada.")
    return list(valid)


@router.get("/associations", summary="Associações vinculadas ao Geral")
async def list_linked_associations(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    _require_aggregator(current)
    ids = [str(i) for i in current.linked_association_ids]
    if not ids:
        return []
    result = await session.execute(
        text("SELECT id, name, slug FROM associations WHERE id = ANY(:ids)"),
        {"ids": ids},
    )
    return [{"id": str(r.id), "name": r.name, "slug": r.slug} for r in result.fetchall()]


@router.get("/dashboard", summary="Dashboard consolidado")
async def geral_dashboard(
    assoc_ids: list[str] | None = Query(default=None, description="UUIDs das associações para filtrar"),
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

    cofre_rows = (await session.execute(text("""
        SELECT a.name, cb.balance
          FROM cash_boxes cb
          JOIN associations a ON a.id = cb.association_id
         WHERE cb.association_id = ANY(:ids) AND cb.is_cofre = true AND cb.is_active = true
         ORDER BY a.name, cb.name
    """), {"ids": ids_str})).fetchall()

    cofres = [{"association": r[0], "balance": str(round(float(r[1]), 2))} for r in cofre_rows]
    total_cofres = str(round(sum(float(r[1]) for r in cofre_rows), 2))

    return {
        "total_moradores": row.total_moradores,
        "total_membros": row.total_membros,
        "total_arrecadado": str(row.total_arrecadado),
        "total_pendente": str(row.total_pendente),
        "inadimplentes": row.inadimplentes,
        "encomendas_aguardando": row.encomendas_aguardando,
        "cofres": cofres,
        "total_cofres": total_cofres,
    }


@router.get("/cobrancas", summary="Cobranças consolidadas")
async def geral_cobrancas(
    assoc_ids: list[str] | None = Query(default=None),
    status_filter: str = Query(default="all", description="all | paid | pending | overdue"),
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
    q: str | None = Query(default=None, description="Busca por nome ou CPF"),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    _require_aggregator(current)
    ids = _resolve_ids(current, assoc_ids)
    ids_str = [str(i) for i in ids]

    where_search = ""
    params: dict = {"ids": ids_str}
    if q:
        where_search = "AND (r.full_name ILIKE :q OR r.cpf ILIKE :q)"
        params["q"] = f"%{q}%"

    result = await session.execute(
        text(f"""
            SELECT
                r.id, r.full_name, r.cpf, r.unit, r.block, r.type, r.status,
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
            "unit": r.unit,
            "block": r.block,
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
