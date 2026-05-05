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
        desc_base = f"Mensalidade {m.reference_month} — {resident_name}"

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
        today = date.today()
        grace_cutoff = today - timedelta(days=await self._grace_days(association_id))
        stmt = select(Mensalidade).where(
            Mensalidade.association_id == association_id,
            Mensalidade.resident_id == resident_id,
            Mensalidade.status != MensalidadeStatus.paid,
            Mensalidade.status != MensalidadeStatus.agreement,
            Mensalidade.due_date < grace_cutoff,
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def list_delinquent(self, association_id: UUID) -> list[dict]:
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
                Mensalidade.status != MensalidadeStatus.paid,
                Mensalidade.status != MensalidadeStatus.agreement,
                Mensalidade.due_date < grace_cutoff,
                Resident.type == ResidentType.member,
            )
            .order_by(Mensalidade.due_date.asc())
        )
        result = await self._session.execute(stmt)
        rows = result.all()

        delinquent = []
        for m, full_name, phone, street, number, unit in rows:
            months_overdue = (
                (today.year - m.due_date.year) * 12 + (today.month - m.due_date.month)
            )
            delinquent.append({
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
        result = await self._session.execute(text("""
            SELECT r.id, r.monthly_payment_day FROM residents r
            WHERE r.association_id = :aid
              AND r.type = 'member'
              AND r.status = 'active'
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
        from sqlalchemy import text
        result = await self._session.execute(
            text("""
                SELECT COALESCE(SUM(amount), 0)
                FROM mensalidades
                WHERE association_id = :aid AND status != 'paid'
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
        """Mensalidades pagas com nome do morador. Filtro opcional por mês (YYYY-MM)."""
        from app.models.resident import Resident
        from sqlalchemy import select as sa_select

        stmt = (
            sa_select(Mensalidade, Resident.full_name)
            .join(Resident, Resident.id == Mensalidade.resident_id)
            .where(
                Mensalidade.association_id == association_id,
                Mensalidade.status == MensalidadeStatus.paid,
            )
            .order_by(Mensalidade.paid_at.desc())
        )
        if month:
            from sqlalchemy import func
            year, mo = month.split("-")
            stmt = stmt.where(
                func.extract("year", Mensalidade.paid_at) == int(year),
                func.extract("month", Mensalidade.paid_at) == int(mo),
            )

        result = await self._session.execute(stmt)
        return [
            {
                "id": str(m.id),
                "resident_id": str(m.resident_id),
                "resident_name": name,
                "reference_month": m.reference_month,
                "due_date": str(m.due_date),
                "amount": str(m.amount),
                "paid_at": str(m.paid_at) if m.paid_at else None,
                "transaction_id": str(m.transaction_id) if m.transaction_id else None,
            }
            for m, name in result.all()
        ]

    async def payment_report(
        self, association_id: UUID, from_month: str, to_month: str
    ) -> dict:
        """Relatório de mensalidades por período (qualquer status)."""
        from app.models.resident import Resident
        from sqlalchemy import select as sa_select

        stmt = (
            sa_select(Mensalidade, Resident.full_name)
            .join(Resident, Resident.id == Mensalidade.resident_id)
            .where(
                Mensalidade.association_id == association_id,
                Mensalidade.reference_month >= from_month,
                Mensalidade.reference_month <= to_month,
            )
            .order_by(Mensalidade.reference_month.desc(), Resident.full_name.asc())
        )
        result = await self._session.execute(stmt)
        rows = result.all()

        items = [
            {
                "id": str(m.id),
                "resident_id": str(m.resident_id),
                "resident_name": name,
                "reference_month": m.reference_month,
                "due_date": str(m.due_date),
                "amount": str(m.amount),
                "status": m.status,
                "paid_at": str(m.paid_at) if m.paid_at else None,
            }
            for m, name in rows
        ]

        paid = [i for i in items if i["status"] == MensalidadeStatus.paid]
        pending = [i for i in items if i["status"] != MensalidadeStatus.paid]
        total_paid = sum(Decimal(i["amount"]) for i in paid)
        total_pending = sum(Decimal(i["amount"]) for i in pending)

        return {
            "from_month": from_month,
            "to_month": to_month,
            "total": len(items),
            "paid_count": len(paid),
            "pending_count": len(pending),
            "total_paid": str(total_paid),
            "total_pending": str(total_pending),
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
