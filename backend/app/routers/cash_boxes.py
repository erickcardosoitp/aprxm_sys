"""
Router /cash-boxes — Caixinhas / Tesouraria
"""
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session

router = APIRouter(prefix="/cash-boxes", tags=["Caixinhas"])


class BoxRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None
    is_malote: bool = False


class MovementRequest(BaseModel):
    amount: Decimal = Field(gt=0)
    movement_type: str = Field(pattern="^(credit|debit)$")
    description: str = Field(min_length=1)


@router.get("/summary", summary="Resumo: caixa aberto + caixinhas + sangrias")
async def summary(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    open_row = (await session.execute(text("""
        SELECT COALESCE(SUM(cs.opening_balance), 0) +
               COALESCE(SUM(CASE WHEN t.type='income' AND t.reversed_at IS NULL AND t.is_reversal=false THEN t.amount
                                 WHEN t.type IN ('expense','sangria') AND t.reversed_at IS NULL AND t.is_reversal=false THEN -t.amount
                                 ELSE 0 END), 0) AS bal
          FROM cash_sessions cs
          LEFT JOIN transactions t ON t.cash_session_id = cs.id
                                   AND t.association_id  = cs.association_id
         WHERE cs.association_id = :aid AND cs.status = 'open'
    """), {"aid": str(current.association_id)})).fetchone()

    boxes_rows = (await session.execute(text("""
        SELECT id, name, description, balance FROM cash_boxes
         WHERE association_id = :aid AND is_active = true ORDER BY name
    """), {"aid": str(current.association_id)})).fetchall()

    sangria_rows = (await session.execute(text("""
        SELECT t.sangria_destination, SUM(t.amount) AS total
          FROM transactions t
         WHERE t.association_id = :aid AND t.type = 'sangria'
           AND t.created_at > NOW() - INTERVAL '30 days'
         GROUP BY t.sangria_destination ORDER BY total DESC
    """), {"aid": str(current.association_id)})).fetchall()

    boxes = [{"id": str(r[0]), "name": r[1], "description": r[2], "balance": str(r[3])} for r in boxes_rows]
    return {
        "open_session_balance": str(round(float(open_row[0]), 2)) if open_row else None,
        "cash_boxes": boxes,
        "total_in_boxes": str(round(sum(float(b["balance"]) for b in boxes), 2)),
        "sangria_by_destination": [{"destination": r[0] or "—", "total": str(round(float(r[1]), 2))} for r in sangria_rows],
    }


@router.get("/saldo-consolidado", summary="Saldo líquido consolidado: caixas + porta a porta")
async def saldo_consolidado(
    from_date: str | None = None,
    to_date: str | None = None,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    aid = str(current.association_id)
    date_filter = ""
    params: dict = {"aid": aid}
    if from_date:
        date_filter += " AND DATE(cs.opened_at) >= :from_date"
        params["from_date"] = from_date
    if to_date:
        date_filter += " AND DATE(cs.opened_at) <= :to_date"
        params["to_date"] = to_date

    sessoes_row = (await session.execute(text(f"""
        SELECT
            COUNT(*) AS total_sessoes,
            COALESCE(SUM(
                CASE WHEN cs.origin = 'Manual' THEN cs.manual_total_bruto
                     ELSE (SELECT COALESCE(SUM(t.amount),0) FROM transactions t
                           WHERE t.cash_session_id = cs.id AND t.type = 'income'
                             AND t.reversed_at IS NULL AND t.is_reversal = false)
                END
            ), 0) AS bruto,
            COALESCE(SUM(
                CASE WHEN cs.origin = 'Manual' THEN cs.manual_total_baixas
                     ELSE (SELECT COALESCE(SUM(t.amount),0) FROM transactions t
                           WHERE t.cash_session_id = cs.id AND t.type = 'sangria'
                             AND t.reversed_at IS NULL AND t.is_reversal = false)
                END
            ), 0) AS baixas,
            COALESCE(SUM(
                CASE WHEN cs.origin = 'Manual' THEN cs.manual_pix
                     ELSE (SELECT COALESCE(SUM(t.amount),0) FROM transactions t
                           JOIN payment_methods pm ON pm.id = t.payment_method_id
                           WHERE t.cash_session_id = cs.id AND t.type = 'income'
                             AND pm.name ILIKE '%pix%'
                             AND t.reversed_at IS NULL AND t.is_reversal = false)
                END
            ), 0) AS pix,
            COALESCE(SUM(
                CASE WHEN cs.origin = 'Manual' THEN cs.manual_dinheiro
                     ELSE (SELECT COALESCE(SUM(t.amount),0) FROM transactions t
                           WHERE t.cash_session_id = cs.id AND t.type = 'income'
                             AND (t.payment_method_id IS NULL OR t.payment_method_id NOT IN (
                                 SELECT id FROM payment_methods WHERE name ILIKE '%pix%'))
                             AND t.reversed_at IS NULL AND t.is_reversal = false)
                END
            ), 0) AS dinheiro
          FROM cash_sessions cs
         WHERE cs.association_id = :aid AND cs.status != 'open' {date_filter}
    """), params)).fetchone()

    pap_params: dict = {"aid": aid}
    pap_date_filter = ""
    if from_date:
        pap_date_filter += " AND DATE(l.updated_at) >= :from_date"
        pap_params["from_date"] = from_date
    if to_date:
        pap_date_filter += " AND DATE(l.updated_at) <= :to_date"
        pap_params["to_date"] = to_date

    pap_row = (await session.execute(text(f"""
        SELECT
            COUNT(*) AS total_pagos,
            COALESCE(SUM(p.amount), 0) AS recebido
          FROM porta_a_porta_payments p
          JOIN porta_a_porta_leads l ON l.id = p.lead_id
         WHERE l.association_id = :aid AND p.status = 'paid' {pap_date_filter}
    """), pap_params)).fetchone()

    bruto = float(sessoes_row[1])
    baixas = float(sessoes_row[2])
    liquido_caixas = round(bruto - baixas, 2)
    pap_recebido = float(pap_row[1])
    total_consolidado = round(liquido_caixas + pap_recebido, 2)

    return {
        "total_consolidado": str(total_consolidado),
        "caixas": {
            "sessoes": int(sessoes_row[0]),
            "bruto": str(round(bruto, 2)),
            "baixas": str(round(baixas, 2)),
            "liquido": str(liquido_caixas),
            "pix": str(round(float(sessoes_row[3]), 2)),
            "dinheiro": str(round(float(sessoes_row[4]), 2)),
        },
        "porta_a_porta": {
            "total_pagos": int(pap_row[0]),
            "recebido": str(round(pap_recebido, 2)),
        },
    }


@router.get("", summary="Listar caixinhas")
async def list_boxes(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT id, name, description, balance, is_active, created_at, is_malote
          FROM cash_boxes WHERE association_id = :aid ORDER BY name
    """), {"aid": str(current.association_id)})).fetchall()
    return [{"id": str(r[0]), "name": r[1], "description": r[2],
             "balance": str(r[3]), "is_active": r[4], "created_at": str(r[5]),
             "is_malote": bool(r[6])} for r in rows]


@router.post("", summary="Criar caixinha")
async def create_box(
    body: BoxRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    r = (await session.execute(text("""
        INSERT INTO cash_boxes (id, association_id, name, description, is_malote)
        VALUES (gen_random_uuid(), :aid, :name, :desc, :malote)
        RETURNING id, name, balance, is_malote
    """), {"aid": str(current.association_id), "name": body.name, "desc": body.description, "malote": body.is_malote})).fetchone()
    await session.commit()
    return {"id": str(r[0]), "name": r[1], "balance": str(r[2]), "is_malote": bool(r[3])}


@router.put("/{box_id}", summary="Editar caixinha")
async def update_box(
    box_id: str,
    body: BoxRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(text("""
        UPDATE cash_boxes SET name=:name, description=:desc, is_malote=:malote, updated_at=NOW()
         WHERE id=:id::uuid AND association_id=:aid::uuid
    """), {"id": box_id, "aid": str(current.association_id), "name": body.name, "desc": body.description, "malote": body.is_malote})
    await session.commit()
    return {"ok": True}


@router.delete("/{box_id}", summary="Desativar caixinha")
async def deactivate_box(
    box_id: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(text("""
        UPDATE cash_boxes SET is_active=false, updated_at=NOW()
         WHERE id=:id::uuid AND association_id=:aid::uuid
    """), {"id": box_id, "aid": str(current.association_id)})
    await session.commit()
    return {"ok": True}


@router.post("/{box_id}/movements", summary="Movimentar caixinha")
async def add_movement(
    box_id: str,
    body: MovementRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = (await session.execute(text("""
        SELECT id, balance FROM cash_boxes
         WHERE id=:id AND association_id=:aid AND is_active=true
    """), {"id": box_id, "aid": str(current.association_id)})).fetchone()
    if not row:
        raise HTTPException(404, "Caixinha não encontrada.")
    sign = 1 if body.movement_type == "credit" else -1
    new_bal = float(row[1]) + sign * float(body.amount)
    if new_bal < 0:
        raise HTTPException(400, "Saldo insuficiente.")
    await session.execute(text("UPDATE cash_boxes SET balance=:b, updated_at=NOW() WHERE id=:id"),
                          {"b": new_bal, "id": box_id})
    await session.execute(text("""
        INSERT INTO cash_box_movements (id, association_id, cash_box_id, amount, movement_type, description, created_by)
        VALUES (gen_random_uuid(), :aid, :bid, :amt, :mtype, :desc, :usr)
    """), {"aid": str(current.association_id), "bid": box_id, "amt": float(body.amount),
           "mtype": body.movement_type, "desc": body.description, "usr": str(current.user_id)})
    await session.commit()
    return {"ok": True, "new_balance": str(round(new_bal, 2))}


@router.get("/{box_id}/movements", summary="Movimentações de uma caixinha")
async def list_movements(
    box_id: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT m.id, m.amount, m.movement_type, m.description, m.created_at, u.full_name
          FROM cash_box_movements m
          LEFT JOIN users u ON u.id = m.created_by
         WHERE m.cash_box_id=:bid AND m.association_id=:aid
         ORDER BY m.created_at DESC LIMIT 200
    """), {"bid": box_id, "aid": str(current.association_id)})).fetchall()
    return [{"id": str(r[0]), "amount": str(r[1]), "movement_type": r[2],
             "description": r[3], "created_at": str(r[4]), "created_by_name": r[5]} for r in rows]
