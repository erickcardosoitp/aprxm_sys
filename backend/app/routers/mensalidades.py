from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session
from app.models.mensalidade import Mensalidade
from app.models.migration_payment import MigrationPaymentTipo
from app.services.mensalidade_service import MensalidadeService
from app.services.migration_payment_service import MigrationPaymentService

router = APIRouter(prefix="/mensalidades", tags=["Mensalidades"])


class CreateMensalidadeRequest(BaseModel):
    resident_id: UUID
    reference_month: str = Field(pattern=r"^\d{4}-\d{2}$", description="YYYY-MM")
    due_date: date
    amount: Decimal = Field(gt=0)
    notes: str | None = None


class PayMensalidadeRequest(BaseModel):
    payment_method_id: UUID | None = None
    auto_next: bool = True
    payment_method_id_2: UUID | None = None
    amount_2: Decimal | None = Field(default=None, gt=0)
    pix_payer_name: str | None = None
    payer_entity_id: UUID | None = None


class GenerateMonthRequest(BaseModel):
    reference_month: str = Field(pattern=r"^\d{4}-\d{2}$")
    due_day: int = Field(ge=1, le=31, default=10)
    amount: Decimal = Field(gt=0)


class UpdateDueDateRequest(BaseModel):
    due_date: date
    update_resident_day: bool = False


class AdvancePaymentRequest(BaseModel):
    resident_id: UUID
    reference_month: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")
    amount: Decimal | None = Field(default=None, gt=0)


@router.delete("/by-month/{reference_month}", summary="Excluir cobranças pendentes de um mês")
async def delete_by_month(
    reference_month: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text
    result = await session.execute(
        text("""
            DELETE FROM mensalidades
            WHERE association_id = :aid AND reference_month = :month AND status = 'pending'
            RETURNING id
        """),
        {"aid": str(current.association_id), "month": reference_month},
    )
    deleted = len(result.fetchall())
    await session.commit()
    return {"deleted": deleted, "reference_month": reference_month}


@router.post("/cron-generate", summary="Geração automática semanal (chamada por cron externo)")
async def cron_generate(
    request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    import os
    from fastapi import Request
    from sqlalchemy import text
    from decimal import Decimal
    from datetime import datetime

    secret = os.environ.get("CRON_SECRET", "")
    if secret:
        auth = request.headers.get("x-cron-secret", "")
        if auth != secret:
            from fastapi import HTTPException
            raise HTTPException(status_code=401, detail="Não autorizado.")

    now = datetime.utcnow()
    ref = now.strftime("%Y-%m")
    rows = (await session.execute(text("""
        SELECT a.id,
               COALESCE(s.default_mensalidade_amount, 0),
               (SELECT u.id FROM users u WHERE u.association_id = a.id
                AND u.role IN ('admin','admin_master','superadmin')
                AND u.is_active = TRUE LIMIT 1)
        FROM associations a
        LEFT JOIN association_settings s ON s.association_id = a.id
        WHERE a.is_active = TRUE
    """))).fetchall()

    total_created = 0
    svc = MensalidadeService(session)
    for assoc_id, configured_amount, admin_id in rows:
        if not admin_id:
            continue

        amount = Decimal(str(configured_amount)) if configured_amount and configured_amount > 0 else None

        # Fallback: use the most recent mensalidade amount for this association
        if not amount or amount <= 0:
            row = (await session.execute(text("""
                SELECT amount FROM mensalidades
                WHERE association_id = :aid
                ORDER BY created_at DESC LIMIT 1
            """), {"aid": str(assoc_id)})).fetchone()
            if row:
                amount = Decimal(str(row[0]))

        if not amount or amount <= 0:
            continue

        try:
            result = await svc.generate_month(
                association_id=assoc_id,
                reference_month=ref,
                due_day=10,
                amount=amount,
                created_by=admin_id,
            )
            total_created += result.get("created", 0)
            await session.commit()
        except Exception:
            await session.rollback()
    return {"reference_month": ref, "total_created": total_created}


@router.post("/cron-check-overdue", summary="Cron diário: verifica inadimplentes por associação")
async def cron_check_overdue(
    request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    import os
    from fastapi import Request
    from sqlalchemy import text
    from datetime import datetime, timedelta

    secret = os.environ.get("CRON_SECRET", "")
    if secret:
        auth = request.headers.get("x-cron-secret", "")
        if auth != secret:
            from fastapi import HTTPException
            raise HTTPException(status_code=401, detail="Não autorizado.")

    rows = (await session.execute(text("""
        SELECT a.id, a.name, COALESCE(s.delinquency_grace_days, 2)
        FROM associations a
        LEFT JOIN association_settings s ON s.association_id = a.id
        WHERE a.is_active = TRUE
    """))).fetchall()

    summary = []
    for assoc_id, assoc_name, grace_days in rows:
        cutoff = (datetime.utcnow().date() - timedelta(days=grace_days)).isoformat()
        result = (await session.execute(text("""
            SELECT COUNT(DISTINCT m.resident_id), COUNT(m.id), COALESCE(SUM(m.amount), 0)
            FROM mensalidades m
            JOIN residents res ON res.id = m.resident_id
            WHERE m.association_id = :aid
              AND m.status = 'pending'
              AND m.due_date < :cutoff
              AND res.type = 'member'
              AND res.status = 'active'
        """), {"aid": str(assoc_id), "cutoff": cutoff})).fetchone()
        summary.append({
            "association": assoc_name,
            "unique_delinquents": result[0],
            "total_records": result[1],
            "total_amount": float(result[2]),
            "cutoff_date": cutoff,
        })

    return {"checked_at": datetime.utcnow().isoformat(), "associations": summary}


@router.post("/generate-month", summary="Gerar mensalidades pendentes para todos os associados ativos do mês")
async def generate_month(
    body: GenerateMonthRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = MensalidadeService(session)
    result = await svc.generate_month(
        association_id=current.association_id,
        reference_month=body.reference_month,
        due_day=body.due_day,
        amount=body.amount,
        created_by=current.user_id,
    )
    await session.commit()
    return result


@router.patch("/{mensalidade_id}/due-date", summary="Alterar data de vencimento")
async def update_due_date(
    mensalidade_id: UUID,
    body: UpdateDueDateRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as sa_text
    row = (await session.execute(
        sa_text("SELECT id, resident_id FROM mensalidades WHERE id = :id AND association_id = :aid"),
        {"id": str(mensalidade_id), "aid": str(current.association_id)},
    )).fetchone()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(404, "Mensalidade não encontrada.")
    await session.execute(
        sa_text("UPDATE mensalidades SET due_date = :dd WHERE id = :id"),
        {"dd": body.due_date, "id": str(mensalidade_id)},
    )
    if body.update_resident_day:
        await session.execute(
            sa_text("UPDATE residents SET monthly_payment_day = :day WHERE id = :rid AND association_id = :aid"),
            {"day": body.due_date.day, "rid": str(row[1]), "aid": str(current.association_id)},
        )
    await session.commit()
    return {"ok": True, "due_date": str(body.due_date)}


@router.post("/advance", summary="Criar mensalidade adiantada para o próximo mês não registrado")
async def advance_payment(
    body: AdvancePaymentRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text as sa_text
    from datetime import date as dt_date
    import calendar

    resident = (await session.execute(
        sa_text("SELECT monthly_payment_day FROM residents WHERE id = :rid AND association_id = :aid AND is_active = TRUE"),
        {"rid": str(body.resident_id), "aid": str(current.association_id)},
    )).fetchone()
    if not resident:
        from fastapi import HTTPException
        raise HTTPException(404, "Morador não encontrado.")

    if body.reference_month:
        ref = body.reference_month
    else:
        # Find next month without a record
        today = dt_date.today()
        yr, mo = today.year, today.month
        for _ in range(12):
            mo += 1
            if mo > 12:
                mo = 1; yr += 1
            candidate = f"{yr:04d}-{mo:02d}"
            exists = (await session.execute(
                sa_text("SELECT 1 FROM mensalidades WHERE association_id = :aid AND resident_id = :rid AND reference_month = :rm"),
                {"aid": str(current.association_id), "rid": str(body.resident_id), "rm": candidate},
            )).fetchone()
            if not exists:
                ref = candidate
                break
        else:
            from fastapi import HTTPException
            raise HTTPException(409, "Não foi possível determinar o próximo mês disponível.")

    yr_ref, mo_ref = int(ref[:4]), int(ref[5:])
    pay_day = resident[0] or 10
    last_day = calendar.monthrange(yr_ref, mo_ref)[1]
    due = dt_date(yr_ref, mo_ref, min(pay_day, last_day))

    if body.amount:
        amount = body.amount
    else:
        last = (await session.execute(
            sa_text("SELECT amount FROM mensalidades WHERE association_id = :aid AND resident_id = :rid ORDER BY reference_month DESC LIMIT 1"),
            {"aid": str(current.association_id), "rid": str(body.resident_id)},
        )).fetchone()
        amount = last[0] if last else 0
        if not amount:
            from fastapi import HTTPException
            raise HTTPException(422, "Informe o valor da mensalidade.")

    svc = MensalidadeService(session)
    m = await svc.create(
        association_id=current.association_id,
        resident_id=body.resident_id,
        reference_month=ref,
        due_date=due,
        amount=amount,
        created_by=current.user_id,
    )
    await session.commit()
    return _fmt(m)


@router.post("", summary="Criar mensalidade")
async def create_mensalidade(
    body: CreateMensalidadeRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = MensalidadeService(session)
    m = await svc.create(
        association_id=current.association_id,
        resident_id=body.resident_id,
        reference_month=body.reference_month,
        due_date=body.due_date,
        amount=body.amount,
        created_by=current.user_id,
        notes=body.notes,
    )
    await session.commit()
    return _fmt(m)


@router.get("/pending", summary="Mensalidades a receber (não vencidas)")
async def list_pending(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    svc = MensalidadeService(session)
    return await svc.list_pending(current.association_id)


@router.get("/delinquent", summary="Listar inadimplentes")
async def list_delinquent(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    svc = MensalidadeService(session)
    return await svc.list_delinquent(current.association_id)


@router.get("/delinquent/by-street", summary="Inadimplentes agrupados por rua")
async def delinquent_by_street(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    svc = MensalidadeService(session)
    items = await svc.list_delinquent(current.association_id)
    groups: dict[str, list] = {}
    for item in items:
        street = item.get("address_street") or "Sem rua"
        groups.setdefault(street, []).append(item)
    return [
        {
            "street": street,
            "count": len(residents),
            "total_amount": str(sum(float(r["amount"]) for r in residents)),
            "residents": sorted(residents, key=lambda x: x["resident_name"] or ""),
        }
        for street, residents in sorted(groups.items())
    ]


@router.get("/residents/{resident_id}", summary="Histórico por morador")
async def list_by_resident(
    resident_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text
    svc = MensalidadeService(session)
    mensalidades = await svc.list_by_resident(current.association_id, resident_id)
    mig_rows = (await session.execute(
        text("""
            SELECT competencia, tipo, valor_pago, data_pagamento
            FROM migration_payments
            WHERE association_id = :aid AND resident_id = :rid
            ORDER BY competencia DESC
        """),
        {"aid": str(current.association_id), "rid": str(resident_id)},
    )).fetchall()

    mig_months = {r[0] for r in mig_rows}
    migration_items = [
        {
            "id": None, "resident_id": str(resident_id),
            "reference_month": r[0], "due_date": None,
            "amount": str(r[2]) if r[2] is not None else "0.00",
            "status": "paid", "paid_at": str(r[3]) if r[3] else None,
            "transaction_id": None, "notes": None,
            "origem": "migracao", "tipo": str(r[1]),
        }
        for r in mig_rows
    ]
    regular = [{**_fmt(m), "origem": "sistema"} for m in mensalidades if m.reference_month not in mig_months]
    return sorted(regular + migration_items, key=lambda x: x["reference_month"], reverse=True)


@router.get("/paid", summary="Mensalidades pagas (com nome do morador)")
async def list_paid(
    month: str | None = Query(default=None, description="Filtrar por mês YYYY-MM"),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    svc = MensalidadeService(session)
    return await svc.list_paid(current.association_id, month)


@router.get("/report", summary="Relatório de mensalidades por período")
async def payment_report(
    from_month: str = Query(..., description="Mês inicial YYYY-MM"),
    to_month: str = Query(..., description="Mês final YYYY-MM"),
    paid_from: date | None = Query(None),
    paid_to: date | None = Query(None),
    cep: str | None = Query(None),
    payment_method_id: UUID | None = Query(None),
    origem: str | None = Query(None, description="sistema|migracao|all"),
    status_filter: str | None = Query(None, alias="status", description="paid|pending|all"),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = MensalidadeService(session)
    return await svc.payment_report(
        current.association_id, from_month, to_month,
        paid_from=paid_from, paid_to=paid_to, cep=cep,
        payment_method_id=payment_method_id, origem=origem,
        status_filter=status_filter,
    )


@router.get("/{mensalidade_id}/comprovante", summary="Dados do comprovante de pagamento")
async def get_comprovante(
    mensalidade_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text
    result = await session.execute(
        text("""
            SELECT m.reference_month, m.due_date, m.amount, m.paid_at,
                   r.full_name, r.cpf,
                   a.name AS assoc_name, a.address_city, a.phone AS assoc_phone,
                   t.description AS tx_desc, pm.name AS payment_method
            FROM mensalidades m
            JOIN residents r ON r.id = m.resident_id
            JOIN associations a ON a.id = m.association_id
            LEFT JOIN transactions t ON t.id = m.transaction_id
            LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
            WHERE m.id = :mid AND m.association_id = :aid AND m.status = 'paid'
        """),
        {"mid": str(mensalidade_id), "aid": str(current.association_id)},
    )
    row = result.fetchone()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(404, "Comprovante não disponível.")
    return {
        "reference_month": row[0], "due_date": str(row[1]),
        "amount": str(row[2]), "paid_at": str(row[3]),
        "resident_name": row[4], "resident_cpf": row[5],
        "association_name": row[6], "city": row[7], "assoc_phone": row[8],
        "tx_desc": row[9], "payment_method": row[10] or "Dinheiro",
    }


@router.get("/residents/{resident_id}/inadimplencia", summary="Histórico de inadimplência do morador")
async def inadimplencia_history(
    resident_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    from sqlalchemy import text
    result = await session.execute(
        text("""
            SELECT reference_month, due_date, amount, status, paid_at
            FROM mensalidades m
            WHERE association_id = :aid AND resident_id = :rid
              AND (status != 'paid' OR paid_at > due_date + INTERVAL '2 days')
              AND NOT EXISTS (
                SELECT 1 FROM migration_payments mp
                WHERE mp.resident_id = m.resident_id
                  AND mp.association_id = m.association_id
                  AND mp.competencia = m.reference_month
              )
            ORDER BY reference_month DESC
        """),
        {"aid": str(current.association_id), "rid": str(resident_id)},
    )
    return [{"reference_month": r[0], "due_date": str(r[1]), "amount": str(r[2]),
             "status": r[3], "paid_at": str(r[4]) if r[4] else None,
             "pago_em_atraso": r[3] == 'paid'} for r in result.fetchall()]


@router.post("/{mensalidade_id}/pay", summary="Pagar mensalidade via caixa aberto")
async def pay_mensalidade(
    mensalidade_id: UUID,
    body: PayMensalidadeRequest = PayMensalidadeRequest(),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = MensalidadeService(session)
    result = await svc.pay_with_cash(
        mensalidade_id=mensalidade_id,
        association_id=current.association_id,
        paid_by=current.user_id,
        payment_method_id=body.payment_method_id,
        auto_next=body.auto_next,
        payment_method_id_2=body.payment_method_id_2,
        amount_2=body.amount_2,
        pix_payer_name=body.pix_payer_name,
        payer_entity_id=body.payer_entity_id,
    )
    await session.commit()
    return {
        "mensalidade": _fmt(result["mensalidade"]),
        "transaction": {
            "id": str(result["transaction"].id),
            "amount": str(result["transaction"].amount),
            "description": result["transaction"].description,
        },
        "next_month": _fmt(result["next"]) if result["next"] else None,
    }


# ── Migration Payment endpoints ─────────────────────────────────────────────

class CreateMigrationPaymentRequest(BaseModel):
    resident_id: UUID
    competencia: str = Field(pattern=r"^\d{4}-\d{2}$")
    tipo: MigrationPaymentTipo = MigrationPaymentTipo.mensalidade
    valor_pago: Decimal | None = None
    data_pagamento: date | None = None


class BulkMigrationRequest(BaseModel):
    resident_id: UUID
    quitado_de: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$", description="Mês inicial YYYY-MM (padrão: 2000-01)")
    quitado_ate: str = Field(pattern=r"^\d{4}-\d{2}$", description="Gera todos os meses até YYYY-MM")
    tipo: MigrationPaymentTipo = MigrationPaymentTipo.mensalidade
    valor_pago: Decimal | None = None
    data_pagamento: date | None = None


@router.post("/migration", summary="Registrar histórico de migração (1 competência)")
async def create_migration_payment(
    body: CreateMigrationPaymentRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = MigrationPaymentService(session)
    mp = await svc.create(
        association_id=current.association_id,
        resident_id=body.resident_id,
        competencia=body.competencia,
        tipo=body.tipo,
        created_by=current.user_id,
        valor_pago=body.valor_pago,
        data_pagamento=body.data_pagamento,
    )
    await session.commit()
    return _fmt_mp(mp)


@router.post("/migration/bulk", summary="Registrar migração em lote via quitado_ate")
async def bulk_migration_payment(
    body: BulkMigrationRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = MigrationPaymentService(session)
    created = await svc.bulk_create_until(
        association_id=current.association_id,
        resident_id=body.resident_id,
        quitado_ate=body.quitado_ate,
        quitado_de=body.quitado_de,
        tipo=body.tipo,
        created_by=current.user_id,
        valor_pago=body.valor_pago,
        data_pagamento=body.data_pagamento,
    )
    await session.commit()
    return {"created": len(created), "quitado_ate": body.quitado_ate}


@router.get("/migration/residents/{resident_id}", summary="Histórico de migração do morador")
async def list_migration_payments(
    resident_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    svc = MigrationPaymentService(session)
    items = await svc.list_by_resident(current.association_id, resident_id)
    return [_fmt_mp(mp) for mp in items]


class UpdateMigrationPaymentRequest(BaseModel):
    tipo: MigrationPaymentTipo | None = None
    valor_pago: Decimal | None = None
    data_pagamento: date | None = None


@router.patch("/migration/residents/{resident_id}/{competencia}", summary="Atualizar registro de migração")
async def update_migration_payment(
    resident_id: UUID,
    competencia: str,
    body: UpdateMigrationPaymentRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    from sqlalchemy import text
    row = (await session.execute(
        text("SELECT id FROM migration_payments WHERE association_id=:aid AND resident_id=:rid AND competencia=:comp"),
        {"aid": str(current.association_id), "rid": str(resident_id), "comp": competencia},
    )).fetchone()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Registro de migração não encontrado.")
    updates: list[str] = []
    params: dict = {"aid": str(current.association_id), "rid": str(resident_id), "comp": competencia}
    if body.tipo is not None:
        updates.append("tipo = :tipo")
        params["tipo"] = body.tipo.value
    if body.valor_pago is not None:
        updates.append("valor_pago = :valor_pago")
        params["valor_pago"] = float(body.valor_pago)
    if body.data_pagamento is not None:
        updates.append("data_pagamento = :data_pagamento")
        params["data_pagamento"] = body.data_pagamento
    if updates:
        await session.execute(
            text(f"UPDATE migration_payments SET {', '.join(updates)} WHERE association_id=:aid AND resident_id=:rid AND competencia=:comp"),
            params,
        )
        await session.commit()
    return {"updated": True, "competencia": competencia}


@router.delete("/migration/residents/{resident_id}/{competencia}", summary="Remover registro de migração")
async def delete_migration_payment(
    resident_id: UUID,
    competencia: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    svc = MigrationPaymentService(session)
    deleted = await svc.delete(current.association_id, resident_id, competencia)
    await session.commit()
    return {"deleted": deleted}


def _fmt_mp(mp) -> dict:
    return {
        "id": str(mp.id),
        "resident_id": str(mp.resident_id),
        "competencia": mp.competencia,
        "tipo": mp.tipo,
        "origem": mp.origem,
        "valor_pago": str(mp.valor_pago) if mp.valor_pago is not None else None,
        "data_pagamento": str(mp.data_pagamento) if mp.data_pagamento else None,
        "created_at": mp.created_at.isoformat(),
    }


# ── Mensalidade fmt ──────────────────────────────────────────────────────────

def _fmt(m: Mensalidade) -> dict:
    return {
        "id": str(m.id),
        "resident_id": str(m.resident_id),
        "reference_month": m.reference_month,
        "due_date": str(m.due_date),
        "amount": str(m.amount),
        "status": m.status,
        "paid_at": str(m.paid_at) if m.paid_at else None,
        "transaction_id": str(m.transaction_id) if m.transaction_id else None,
        "notes": m.notes,
    }
