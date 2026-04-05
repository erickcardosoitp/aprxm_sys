from calendar import monthrange
from datetime import date, datetime
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
    ) -> dict:
        """
        Pay a mensalidade:
        1. Validates open cash session exists
        2. Creates income Transaction linked to the mensalidade
        3. Marks mensalidade as paid
        4. Optionally creates next month's mensalidade (pending)
        Returns {"mensalidade": Mensalidade, "transaction": Transaction, "next": Mensalidade | None}
        """
        from app.services.finance_service import FinanceService
        from app.models.finance import TransactionType, IncomeSubtype
        from app.models.resident import Resident

        m = await self._get(mensalidade_id, association_id)
        if m.status == MensalidadeStatus.paid:
            raise UnprocessableError("Mensalidade já está paga.")

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

        # Create income transaction
        tx = await finance_svc.register_transaction(
            association_id=association_id,
            cash_session_id=cash_session.id,
            tx_type=TransactionType.income,
            amount=m.amount,
            description=f"Mensalidade {m.reference_month} — {resident_name}",
            created_by=paid_by,
            income_subtype=IncomeSubtype.mensalidade,
            payment_method_id=payment_method_id,
            resident_id=m.resident_id,
        )

        # Mark mensalidade as paid
        m.status = MensalidadeStatus.paid
        m.paid_at = datetime.utcnow()
        m.transaction_id = tx.id
        m.updated_at = datetime.utcnow()
        self._session.add(m)

        await self._session.flush()

        # Auto-create next month's mensalidade
        next_m: Mensalidade | None = None
        if auto_next:
            next_m = await self._create_next_month(m, paid_by)

        return {"mensalidade": m, "transaction": tx, "next": next_m}

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

        # Check if already exists
        stmt = select(Mensalidade).where(
            Mensalidade.association_id == current.association_id,
            Mensalidade.resident_id == current.resident_id,
            Mensalidade.reference_month == next_ref,
        )
        result = await self._session.execute(stmt)
        if result.scalar_one_or_none():
            return None  # already exists, skip silently

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

    async def list_delinquent(self, association_id: UUID) -> list[dict]:
        today = date.today()
        stmt = (
            select(Mensalidade)
            .where(
                Mensalidade.association_id == association_id,
                Mensalidade.status != MensalidadeStatus.paid,
                Mensalidade.due_date < today,
            )
            .order_by(Mensalidade.due_date.asc())
        )
        result = await self._session.execute(stmt)
        rows = result.scalars().all()

        delinquent = []
        for m in rows:
            months_overdue = (
                (today.year - m.due_date.year) * 12 + (today.month - m.due_date.month)
            )
            delinquent.append({
                "id": str(m.id),
                "resident_id": str(m.resident_id),
                "reference_month": m.reference_month,
                "due_date": str(m.due_date),
                "amount": str(m.amount),
                "months_overdue": months_overdue,
            })
        return delinquent

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
