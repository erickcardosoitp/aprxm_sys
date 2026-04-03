from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.exceptions import CashSessionError, NotFoundError
from app.models.finance import CashSession, CashSessionStatus, Transaction, TransactionType


class FinanceService:
    """Handles all business logic for APRXM Finance module."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------
    # Cash Session
    # ------------------------------------------------------------------

    async def open_session(
        self,
        association_id: UUID,
        opened_by: UUID,
        opening_balance: Decimal = Decimal("0.00"),
        notes: str | None = None,
    ) -> CashSession:
        await self._assert_no_open_session(association_id)

        session = CashSession(
            association_id=association_id,
            opened_by=opened_by,
            opening_balance=opening_balance,
            notes=notes,
        )
        self._session.add(session)
        await self._session.flush()
        return session

    async def get_open_session(self, association_id: UUID) -> CashSession:
        stmt = select(CashSession).where(
            CashSession.association_id == association_id,
            CashSession.status == CashSessionStatus.open,
        )
        result = await self._session.execute(stmt)
        session = result.scalar_one_or_none()
        if not session:
            raise CashSessionError("Nenhuma sessão de caixa aberta.")
        return session

    async def close_session(
        self,
        association_id: UUID,
        closed_by: UUID,
        closing_balance: Decimal,
        notes: str | None = None,
    ) -> CashSession:
        session = await self.get_open_session(association_id)

        expected = await self._compute_expected_balance(session)
        session.expected_balance = expected
        session.closing_balance = closing_balance
        session.difference = closing_balance - expected
        session.status = CashSessionStatus.closed
        session.closed_by = closed_by
        session.closed_at = datetime.utcnow()
        session.notes = notes or session.notes
        session.updated_at = datetime.utcnow()

        self._session.add(session)
        return session

    async def _compute_expected_balance(self, cash_session: CashSession) -> Decimal:
        stmt = select(Transaction).where(Transaction.cash_session_id == cash_session.id)
        result = await self._session.execute(stmt)
        transactions = result.scalars().all()

        balance = cash_session.opening_balance
        for tx in transactions:
            if tx.type == TransactionType.income:
                balance += tx.amount
            else:
                balance -= tx.amount
        return balance

    async def _assert_no_open_session(self, association_id: UUID) -> None:
        stmt = select(CashSession).where(
            CashSession.association_id == association_id,
            CashSession.status == CashSessionStatus.open,
        )
        result = await self._session.execute(stmt)
        if result.scalar_one_or_none():
            raise CashSessionError("Já existe uma sessão de caixa aberta.")

    # ------------------------------------------------------------------
    # Transactions
    # ------------------------------------------------------------------

    async def register_transaction(
        self,
        association_id: UUID,
        cash_session_id: UUID,
        tx_type: TransactionType,
        amount: Decimal,
        description: str,
        created_by: UUID,
        category_id: UUID | None = None,
        payment_method_id: UUID | None = None,
        resident_id: UUID | None = None,
        reference_number: str | None = None,
        package_id: UUID | None = None,
    ) -> Transaction:
        tx = Transaction(
            association_id=association_id,
            cash_session_id=cash_session_id,
            category_id=category_id,
            payment_method_id=payment_method_id,
            resident_id=resident_id,
            type=tx_type,
            amount=amount,
            description=description,
            reference_number=reference_number,
            package_id=package_id,
            created_by=created_by,
        )
        self._session.add(tx)
        await self._session.flush()
        return tx

    async def perform_sangria(
        self,
        association_id: UUID,
        opened_by: UUID,
        amount: Decimal,
        reason: str,
        destination: str,
        receipt_photo_url: str,
        category_id: UUID | None = None,
    ) -> Transaction:
        """
        Perform a sangria (cash withdrawal) from the open session.
        Requires: amount, category, reason, destination and a receipt photo URL.
        """
        if not receipt_photo_url:
            raise CashSessionError("Foto do recibo é obrigatória para realizar uma sangria.")

        session = await self.get_open_session(association_id)

        tx = Transaction(
            association_id=association_id,
            cash_session_id=session.id,
            category_id=category_id,
            type=TransactionType.sangria,
            amount=amount,
            description=f"Sangria: {reason}",
            is_sangria=True,
            sangria_reason=reason,
            sangria_destination=destination,
            receipt_photo_url=receipt_photo_url,
            created_by=opened_by,
        )
        self._session.add(tx)
        await self._session.flush()
        return tx

    async def list_transactions(
        self, association_id: UUID, cash_session_id: UUID | None = None
    ) -> list[Transaction]:
        stmt = select(Transaction).where(Transaction.association_id == association_id)
        if cash_session_id:
            stmt = stmt.where(Transaction.cash_session_id == cash_session_id)
        stmt = stmt.order_by(Transaction.transaction_at.desc())
        result = await self._session.execute(stmt)
        return list(result.scalars().all())
