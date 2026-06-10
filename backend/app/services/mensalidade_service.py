from calendar import monthrange
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.exceptions import NotFoundError, UnprocessableError
from app.models.mensalidade import Mensalidade, MensalidadeStatus


class MensalidadeService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        association_id: UUID,
        resident_id: UUID,
        reference_month: str,  # "YYYY-MM"
        due_date: date,
        amount: Decimal,
        created_by: UUID,
        notes: str | None = None,
    ) -> Mensalidade:
        from app.services.migration_payment_service import MigrationPaymentService
        mig_svc = MigrationPaymentService(self._session)
        if await mig_svc.exists(association_id, resident_id, reference_month):
            raise UnprocessableError(
                f"Competência {reference_month} já consta no histórico de migração. Mensalidade não gerada."
            )

        m = Mensalidade(
            association_id=association_id,
            resident_id=resident_id,
            reference_month=reference_month,
            due_date=due_date,
            amount=amount,
            created_by=created_by,
            notes=notes,
        )
        self._session.add(m)
        try:
            await self._session.flush()
        except IntegrityError:
            await self._session.rollback()
            raise UnprocessableError(f"Mensalidade para {reference_month} já existe para este morador.")
        return m

    async def pay_with_cash(
        self,
        mensalidade_id: UUID,
        association_id: UUID,
        paid_by: UUID,
        payment_method_id: UUID | None = None,
        auto_next: bool = True,
        payment_method_id_2: UUID | None = None,
        amount_2: Decimal | None = None,
        pix_payer_name: str | None = None,
        payer_entity_id: UUID | None = None,
    ) -> dict:
        """
        Pay a mensalidade:
        1. Validates open cash session exists
        2. Creates 1 or 2 income Transactions (split payment support)
        3. Marks mensalidade as paid
        4. Optionally creates next month's mensalidade (pending)
        Returns {"mensalidade": Mensalidade, "transaction": Transaction, "transaction_2": Transaction | None, "next": Mensalidade | None}
        """
        from app.services.finance_service import FinanceService
        from app.models.finance import TransactionType, IncomeSubtype
        from app.models.resident import Resident

        m = await self._get(mensalidade_id, association_id)
        if m.status == MensalidadeStatus.paid:
            raise UnprocessableError("Mensalidade já está paga.")

        is_split = payment_method_id_2 is not None and amount_2 is not None and amount_2 > Decimal("0")

        if is_split:
            if amount_2 >= m.amount:
                raise UnprocessableError("O valor da 2ª forma de pagamento deve ser menor que o total.")
            amount_1 = m.amount - amount_2
        else:
            amount_1 = m.amount

        # Ensure open cash session
        finance_svc = FinanceService(self._session)
        cash_session = await finance_svc.get_open_session(association_id)

        # Load resident name for description
        from sqlmodel import select as sa_select
        res_result = await self._session.execute(
            sa_select(Resident).where(Resident.id == m.resident_id)
        )
        resident = res_result.scalar_one_or_none()
        resident_name = resident.full_name if resident else str(m.resident_id)
        payer_suffix = f" | Pagador PIX: {pix_payer_name}" if pix_payer_name else ""
        desc_base = f"Mensalidade {m.reference_month} — {resident_name}{payer_suffix}"

        # Create primary transaction
        tx = await finance_svc.register_transaction(
            association_id=association_id,
            cash_session_id=cash_session.id,
            tx_type=TransactionType.income,
            amount=amount_1,
            description=desc_base if not is_split else f"{desc_base} (1/2)",
            created_by=paid_by,
            income_subtype=IncomeSubtype.mensalidade,
            payment_method_id=payment_method_id,
            resident_id=m.resident_id,
            payer_name=pix_payer_name,
            payer_entity_id=payer_entity_id,
        )

        # Create secondary transaction if split
        tx2 = None
        if is_split:
            tx2 = await finance_svc.register_transaction(
                association_id=association_id,
                cash_session_id=cash_session.id,
                tx_type=TransactionType.income,
                amount=amount_2,
                description=f"{desc_base} (2/2)",
                created_by=paid_by,
                income_subtype=IncomeSubtype.mensalidade,
                payment_method_id=payment_method_id_2,
                resident_id=m.resident_id,
            )

        # Mark mensalidade as paid
        m.status = MensalidadeStatus.paid
        m.paid_at = datetime.utcnow()
        m.transaction_id = tx.id
        m.transaction_id_2 = tx2.id if tx2 else None
        m.amount_2 = amount_2 if is_split else None
        m.updated_at = datetime.utcnow()
        if pix_payer_name:
            m.notes = f"Pagador PIX: {pix_payer_name}" + (f" | {m.notes}" if m.notes else "")
        self._session.add(m)

        await self._session.flush()

        # Auto-create next month's mensalidade
        next_m: Mensalidade | None = None
        if auto_next:
            next_m = await self._create_next_month(m, paid_by)

        return {"mensalidade": m, "transaction": tx, "transaction_2": tx2, "next": next_m}

    async def pay(
        self,
        mensalidade_id: UUID,
        association_id: UUID,
        transaction_id: UUID | None = None,
    ) -> Mensalidade:
        """Low-level pay — used by reconciliation service (no cash session needed)."""
        m = await self._get(mensalidade_id, association_id)
        if m.status == MensalidadeStatus.paid:
            raise UnprocessableError("Mensalidade já está paga.")
        m.status = MensalidadeStatus.paid
        m.paid_at = datetime.utcnow()
        m.transaction_id = transaction_id
        m.updated_at = datetime.utcnow()
        self._session.add(m)
        await self._session.flush()
        return m

    async def _create_next_month(self, current: Mensalidade, created_by: UUID) -> Mensalidade | None:
        year, month = map(int, current.reference_month.split("-"))
        if month == 12:
            next_year, next_month = year + 1, 1
        else:
            next_year, next_month = year, month + 1

        next_ref = f"{next_year:04d}-{next_month:02d}"

        # Check if already exists in mensalidades or migration_payments
        stmt = select(Mensalidade).where(
            Mensalidade.association_id == current.association_id,
            Mensalidade.resident_id == current.resident_id,
            Mensalidade.reference_month == next_ref,
        )
        result = await self._session.execute(stmt)
        if result.scalar_one_or_none():
            return None

        from app.services.migration_payment_service import MigrationPaymentService
        mig_svc = MigrationPaymentService(self._session)
        if await mig_svc.exists(current.association_id, current.resident_id, next_ref):
            return None

        # Due date: same day of month as current, next month
        day = current.due_date.day
        last_day = monthrange(next_year, next_month)[1]
        next_due = date(next_year, next_month, min(day, last_day))

        next_m = Mensalidade(
            association_id=current.association_id,
            resident_id=current.resident_id,
            reference_month=next_ref,
            due_date=next_due,
            amount=current.amount,
            status=MensalidadeStatus.pending,
            created_by=created_by,
        )
        self._session.add(next_m)
        await self._session.flush()
        return next_m

    async def list_by_resident(
        self, association_id: UUID, resident_id: UUID
    ) -> list[Mensalidade]:
        stmt = (
            select(Mensalidade)
            .where(
                Mensalidade.association_id == association_id,
                Mensalidade.resident_id == resident_id,
            )
            .order_by(Mensalidade.reference_month.desc())
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def _grace_days(self, association_id: UUID) -> int:
        from sqlalchemy import text
        row = (await self._session.execute(
            text("SELECT delinquency_grace_days FROM association_settings WHERE association_id = :aid"),
            {"aid": str(association_id)},
        )).fetchone()
        return row[0] if row and row[0] is not None else 2

    async def has_delinquent_mensalidade(
        self, association_id: UUID, resident_id: UUID
    ) -> bool:
        """Returns True if resident has any mensalidade overdue beyond the grace period."""
        from sqlalchemy import text as sa_text
        today = date.today()
        grace_cutoff = today - timedelta(days=await self._grace_days(association_id))
        row = await self._session.execute(
            sa_text("""
                SELECT 1 FROM mensalidades m
                WHERE m.association_id = :aid
                  AND m.resident_id = :rid
                  AND m.status NOT IN ('paid', 'agreement')
                  AND m.due_date < :cutoff
                  AND NOT EXISTS (
                    SELECT 1 FROM migration_payments mp
                    WHERE mp.resident_id = m.resident_id
                      AND mp.association_id = m.association_id
                      AND mp.competencia = m.reference_month
                  )
                LIMIT 1
            """),
            {"aid": str(association_id), "rid": str(resident_id), "cutoff": grace_cutoff},
        )
        return row.fetchone() is not None

    async def list_delinquent(self, association_id: UUID) -> list[dict]:
        from sqlalchemy import text as sa_text
        today = date.today()
        grace_cutoff = today - timedelta(days=await self._grace_days(association_id))
        result = await self._session.execute(
            sa_text("""
                SELECT m.id, m.resident_id, m.reference_month, m.due_date, m.amount,
                       r.full_name, r.phone_primary, r.address_street, r.address_number
                FROM mensalidades m
                JOIN residents r ON r.id = m.resident_id
                WHERE m.association_id = :aid
                  AND m.status NOT IN ('paid', 'agreement')
                  AND m.due_date < :cutoff
                  AND r.type = 'member'
                  AND r.status = 'active'
                  AND NOT EXISTS (
                    SELECT 1 FROM migration_payments mp
                    WHERE mp.resident_id = m.resident_id
                      AND mp.association_id = m.association_id
                      AND mp.competencia = m.reference_month
                  )
                ORDER BY m.due_date ASC
            """),
            {"aid": str(association_id), "cutoff": grace_cutoff},
        )
        rows = result.fetchall()
        delinquent = []
        for r in rows:
            due = r[3]
            months_overdue = (today.year - due.year) * 12 + (today.month - due.month)
            delinquent.append({
                "id": str(r[0]),
                "resident_id": str(r[1]),
                "reference_month": r[2],
                "due_date": str(due),
                "amount": str(r[4]),
                "resident_name": r[5],
                "phone_primary": r[6],
                "address_street": r[7],
                "address_number": r[8],
                "months_overdue": months_overdue,
            })
        return delinquent

    async def list_pending(self, association_id: UUID) -> list[dict]:
        """Mensalidades pendentes dentro do período de carência configurado."""
        from app.models.resident import Resident, ResidentType
        from sqlmodel import select as sa_select
        today = date.today()
        grace_cutoff = today - timedelta(days=await self._grace_days(association_id))
        stmt = (
            sa_select(
                Mensalidade,
                Resident.full_name,
                Resident.phone_primary,
                Resident.address_street,
                Resident.address_number,
                Resident.unit,
            )
            .join(Resident, Resident.id == Mensalidade.resident_id)
            .where(
                Mensalidade.association_id == association_id,
                Mensalidade.status == MensalidadeStatus.pending,
                Mensalidade.due_date >= grace_cutoff,
                Resident.type == ResidentType.member,
                Resident.status == "active",
            )
            .order_by(Mensalidade.due_date.asc())
        )
        result = await self._session.execute(stmt)
        rows = result.all()
        return [
            {
                "id": str(m.id),
                "resident_id": str(m.resident_id),
                "resident_name": full_name,
                "phone_primary": phone,
                "address_street": street,
                "address_number": number,
                "unit": unit,
                "reference_month": m.reference_month,
                "due_date": str(m.due_date),
                "amount": str(m.amount),
                "status": m.status,
                "notes": m.notes,
            }
            for m, full_name, phone, street, number, unit in rows
        ]

    async def generate_month(
        self,
        association_id: UUID,
        reference_month: str,  # "YYYY-MM"
        due_day: int,
        amount: Decimal,
        created_by: UUID,
    ) -> dict:
        """Cria mensalidades pendentes para todos os associados ativos que ainda não têm registro no mês.
        Usa monthly_payment_day do morador se disponível, senão usa due_day padrão."""
        from sqlalchemy import text
        year, month = map(int, reference_month.split("-"))
        last_day = monthrange(year, month)[1]

        # active members without a mensalidade for this month, including their payment day
        # only residents who joined on or before the reference month
        result = await self._session.execute(text("""
            SELECT r.id, r.monthly_payment_day FROM residents r
            WHERE r.association_id = :aid
              AND r.type = 'member'
              AND r.status = 'active'
              AND to_char(r.created_at, 'YYYY-MM') <= :ref
              AND NOT EXISTS (
                SELECT 1 FROM mensalidades m
                WHERE m.resident_id = r.id
                  AND m.association_id = :aid
                  AND m.reference_month = :ref
              )
              AND NOT EXISTS (
                SELECT 1 FROM migration_payments mp
                WHERE mp.resident_id = r.id
                  AND mp.association_id = :aid
                  AND mp.competencia = :ref
              )
        """), {"aid": str(association_id), "ref": reference_month})
        residents = result.fetchall()

        created = 0
        skipped = 0
        for rid, r_due_day in residents:
            effective_day = r_due_day if r_due_day else due_day
            effective_due = date(year, month, min(effective_day, last_day))
            try:
                m = Mensalidade(
                    association_id=association_id,
                    resident_id=rid,
                    reference_month=reference_month,
                    due_date=effective_due,
                    amount=amount,
                    status=MensalidadeStatus.pending,
                    created_by=created_by,
                )
                self._session.add(m)
                await self._session.flush()
                created += 1
            except Exception:
                skipped += 1
        return {"created": created, "skipped": skipped, "reference_month": reference_month}

    async def total_pending(self, association_id: UUID) -> Decimal:
        from sqlalchemy import text as sa_text
        result = await self._session.execute(
            sa_text("""
                SELECT COALESCE(SUM(amount), 0)
                FROM mensalidades m
                WHERE association_id = :aid
                  AND status != 'paid'
                  AND NOT EXISTS (
                    SELECT 1 FROM migration_payments mp
                    WHERE mp.resident_id = m.resident_id
                      AND mp.association_id = m.association_id
                      AND mp.competencia = m.reference_month
                  )
            """),
            {"aid": str(association_id)},
        )
        return Decimal(str(result.scalar()))

    async def find_pending_for_resident(
        self, association_id: UUID, resident_id: UUID
    ) -> Mensalidade | None:
        stmt = (
            select(Mensalidade)
            .where(
                Mensalidade.association_id == association_id,
                Mensalidade.resident_id == resident_id,
                Mensalidade.status == MensalidadeStatus.pending,
            )
            .order_by(Mensalidade.due_date.asc())
        )
        result = await self._session.execute(stmt)
        return result.scalars().first()

    async def list_paid(
        self, association_id: UUID, month: str | None = None
    ) -> list[dict]:
        """Mensalidades pagas (sistema + migração). Filtro opcional por mês (YYYY-MM)."""
        from sqlalchemy import text as sa_text
        conditions = ["v.association_id = :aid", "v.status = 'paid'"]
        params: dict = {"aid": str(association_id)}
        if month:
            conditions.append("v.reference_month = :month")
            params["month"] = month
        where = " AND ".join(conditions)
        result = await self._session.execute(
            sa_text(f"""
                SELECT v.id, v.resident_id, v.resident_name, v.reference_month,
                       v.due_date, v.amount, v.paid_at, v.transaction_id, v.origem
                FROM v_mensalidades_completas v
                WHERE {where}
                ORDER BY v.paid_at DESC
            """),
            params,
        )
        return [
            {
                "id": str(r[0]),
                "resident_id": str(r[1]),
                "resident_name": r[2],
                "reference_month": r[3],
                "due_date": str(r[4]) if r[4] else None,
                "amount": str(r[5]),
                "paid_at": str(r[6]) if r[6] else None,
                "transaction_id": str(r[7]) if r[7] else None,
                "origem": r[8],
            }
            for r in result.fetchall()
        ]

    async def payment_report(
        self,
        association_id: UUID,
        from_month: str,
        to_month: str,
        paid_from: date | None = None,
        paid_to: date | None = None,
        cep: str | None = None,
        payment_method_id: UUID | None = None,
        origem: str | None = None,
        status_filter: str | None = None,
    ) -> dict:
        """Relatório de mensalidades por período — inclui migration_payments."""
        from sqlalchemy import text as sa_text

        conditions = [
            "v.association_id = :aid",
            "v.reference_month >= :from_month",
            "v.reference_month <= :to_month",
        ]
        params: dict = {
            "aid": str(association_id),
            "from_month": from_month,
            "to_month": to_month,
        }
        if paid_from:
            conditions.append("v.paid_at::date >= :paid_from")
            params["paid_from"] = str(paid_from)
        if paid_to:
            conditions.append("v.paid_at::date <= :paid_to")
            params["paid_to"] = str(paid_to)
        if cep:
            conditions.append("v.address_cep LIKE :cep")
            params["cep"] = cep + "%"
        if payment_method_id:
            conditions.append("v.payment_method_id = :pmid")
            params["pmid"] = str(payment_method_id)
        if origem and origem != "all":
            conditions.append("v.origem = :origem")
            params["origem"] = origem
        if status_filter and status_filter != "all":
            if status_filter == "paid":
                conditions.append("v.status = 'paid'")
            else:
                conditions.append("v.status != 'paid'")

        where = " AND ".join(conditions)
        sql = sa_text(f"""
            SELECT v.id, v.resident_id, v.reference_month, v.due_date,
                   v.amount, v.status, v.paid_at, v.resident_name,
                   v.address_cep, v.origem, v.payment_method_name
            FROM v_mensalidades_completas v
            WHERE {where}
            ORDER BY v.reference_month DESC, v.resident_name ASC
        """)

        result = await self._session.execute(sql, params)
        rows = result.fetchall()

        items = [
            {
                "id": str(r[0]),
                "resident_id": str(r[1]),
                "reference_month": r[2],
                "due_date": str(r[3]) if r[3] else None,
                "amount": str(r[4]),
                "status": str(r[5]),
                "paid_at": str(r[6]) if r[6] else None,
                "resident_name": r[7],
                "address_cep": r[8],
                "origem": r[9],
                "payment_method_name": r[10],
            }
            for r in rows
        ]

        paid = [i for i in items if i["status"] == "paid"]
        pending = [i for i in items if i["status"] != "paid"]
        paid_sistema = [i for i in paid if i["origem"] == "sistema"]
        paid_migracao = [i for i in paid if i["origem"] == "migracao"]
        total_paid = sum(Decimal(i["amount"]) for i in paid)
        total_pending = sum(Decimal(i["amount"]) for i in pending)
        total_migracao = sum(Decimal(i["amount"]) for i in paid_migracao)

        return {
            "from_month": from_month,
            "to_month": to_month,
            "total": len(items),
            "paid_count": len(paid),
            "pending_count": len(pending),
            "paid_sistema_count": len(paid_sistema),
            "paid_migracao_count": len(paid_migracao),
            "total_paid": str(total_paid),
            "total_pending": str(total_pending),
            "total_migracao": str(total_migracao),
            "items": items,
        }

    async def _get(self, mensalidade_id: UUID, association_id: UUID) -> Mensalidade:
        stmt = select(Mensalidade).where(
            Mensalidade.id == mensalidade_id,
            Mensalidade.association_id == association_id,
        )
        result = await self._session.execute(stmt)
        m = result.scalar_one_or_none()
        if not m:
            raise NotFoundError("Mensalidade")
        return m
