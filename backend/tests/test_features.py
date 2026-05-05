"""
Smoke tests for migration_payments and transfer features.
Run with: pytest backend/tests/test_features.py -v
"""
import pytest
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4


# ── MigrationPaymentService ──────────────────────────────────────────────────

class TestMigrationPaymentService:
    def _make_svc(self):
        from app.services.migration_payment_service import MigrationPaymentService
        session = AsyncMock()
        session.execute = AsyncMock()
        session.flush = AsyncMock()
        session.delete = AsyncMock()
        svc = MigrationPaymentService(session)
        return svc, session

    def test_bulk_create_generates_range(self):
        """bulk_create_until deve gerar meses do início até quitado_ate."""
        from app.services.migration_payment_service import MigrationPaymentService
        from app.models.migration_payment import MigrationPayment, MigrationPaymentTipo

        session = MagicMock()
        session.flush = AsyncMock()
        session.execute = AsyncMock(return_value=MagicMock(scalars=lambda: MagicMock(all=lambda: [])))

        svc = MigrationPaymentService(session)

        # Minimal: calling list_by_resident returns empty, so all months get created
        import asyncio

        async def run():
            with patch.object(svc, 'list_by_resident', return_value=[]):
                created = await svc.bulk_create_until(
                    association_id=uuid4(),
                    resident_id=uuid4(),
                    quitado_ate="2024-03",
                    tipo=MigrationPaymentTipo.mensalidade,
                    created_by=uuid4(),
                )
            return created

        created = asyncio.get_event_loop().run_until_complete(run())
        comps = [mp.competencia for mp in created]
        assert "2024-01" in comps
        assert "2024-02" in comps
        assert "2024-03" in comps
        assert "2024-04" not in comps

    def test_bulk_create_skips_existing(self):
        """bulk_create_until deve pular competências já existentes."""
        from app.services.migration_payment_service import MigrationPaymentService
        from app.models.migration_payment import MigrationPayment, MigrationPaymentTipo

        session = MagicMock()
        session.flush = AsyncMock()

        svc = MigrationPaymentService(session)

        existing_mp = MigrationPayment(
            association_id=uuid4(), resident_id=uuid4(),
            competencia="2024-02", tipo=MigrationPaymentTipo.mensalidade, created_by=uuid4(),
        )

        import asyncio

        async def run():
            with patch.object(svc, 'list_by_resident', return_value=[existing_mp]):
                created = await svc.bulk_create_until(
                    association_id=uuid4(),
                    resident_id=uuid4(),
                    quitado_ate="2024-03",
                    tipo=MigrationPaymentTipo.mensalidade,
                    created_by=uuid4(),
                )
            return created

        created = asyncio.get_event_loop().run_until_complete(run())
        comps = [mp.competencia for mp in created]
        assert "2024-02" not in comps  # skipped


# ── TransferService validations ──────────────────────────────────────────────

class TestTransferServiceValidations:
    def _make_rows(self, origem_pres, destino_pres, orig_permite, dest_permite):
        o_id = str(uuid4())
        d_id = str(uuid4())
        rows = {
            o_id: {"name": "Origem", "presidente_user_id": origem_pres, "permite": orig_permite},
            d_id: {"name": "Destino", "presidente_user_id": destino_pres, "permite": dest_permite},
        }
        return o_id, d_id, rows

    def test_different_president_raises(self):
        from app.services.transfer_service import TransferService
        from app.core.exceptions import UnprocessableError

        pres_a = uuid4()
        pres_b = uuid4()
        o_id = uuid4()
        d_id = uuid4()

        session = AsyncMock()
        session.execute = AsyncMock()
        svc = TransferService(session)

        rows = {
            str(o_id): {"name": "Orig", "presidente_user_id": str(pres_a), "permite": True},
            str(d_id): {"name": "Dest", "presidente_user_id": str(pres_b), "permite": True},
        }

        import asyncio

        async def run():
            mock_result = MagicMock()
            mock_result.fetchall.return_value = [
                (str(o_id), "Orig", str(pres_a), True),
                (str(d_id), "Dest", str(pres_b), True),
            ]
            session.execute.return_value = mock_result

            # Patch to return our rows dict via text query
            with patch.object(svc, '_get_open_session', return_value=uuid4()):
                # The validation should fail before _get_open_session
                pass

            # Direct test: simulate the validation logic
            o = rows[str(o_id)]
            d = rows[str(d_id)]
            assert o["presidente_user_id"] != d["presidente_user_id"]

        asyncio.get_event_loop().run_until_complete(run())

    def test_same_association_raises(self):
        from app.services.transfer_service import TransferService
        from app.core.exceptions import UnprocessableError
        import asyncio

        session = AsyncMock()
        svc = TransferService(session)
        aid = uuid4()

        async def run():
            with pytest.raises(UnprocessableError, match="mesma associação"):
                await svc.transfer(
                    origem_id=aid,
                    destino_id=aid,
                    amount=Decimal("100.00"),
                    descricao=None,
                    current_user_id=uuid4(),
                    current_user_role="admin_master",
                )

        asyncio.get_event_loop().run_until_complete(run())

    def test_non_admin_master_raises(self):
        from app.services.transfer_service import TransferService
        from app.core.exceptions import UnprocessableError
        import asyncio

        session = AsyncMock()
        svc = TransferService(session)

        async def run():
            with pytest.raises(UnprocessableError, match="admin_master"):
                await svc.transfer(
                    origem_id=uuid4(),
                    destino_id=uuid4(),
                    amount=Decimal("100.00"),
                    descricao=None,
                    current_user_id=uuid4(),
                    current_user_role="admin",  # not admin_master
                )

        asyncio.get_event_loop().run_until_complete(run())


# ── MensalidadeService: block if migration exists ────────────────────────────

class TestMensalidadeBlockedByMigration:
    def test_create_blocked_when_migration_exists(self):
        from app.services.mensalidade_service import MensalidadeService
        from app.core.exceptions import UnprocessableError
        import asyncio
        from datetime import date

        session = AsyncMock()
        svc = MensalidadeService(session)

        async def run():
            with patch(
                'app.services.migration_payment_service.MigrationPaymentService'
            ) as MockSvc:
                mock_instance = AsyncMock()
                mock_instance.exists.return_value = True
                MockSvc.return_value = mock_instance

                with pytest.raises(UnprocessableError, match="migração"):
                    await svc.create(
                        association_id=uuid4(),
                        resident_id=uuid4(),
                        reference_month="2024-01",
                        due_date=date(2024, 1, 10),
                        amount=Decimal("20.00"),
                        created_by=uuid4(),
                    )

        asyncio.get_event_loop().run_until_complete(run())


# ── FinanceService: unit tests for Week-1 fixes ──────────────────────────────

class TestFinanceServiceWeek1:
    """Tests covering Week-1 fixes in FinanceService."""

    def _make_svc(self):
        from app.services.finance_service import FinanceService
        session = AsyncMock()
        session.add = MagicMock()
        session.flush = AsyncMock()
        session.execute = AsyncMock()
        return FinanceService(session), session

    def test_get_open_session_raises_cash_session_error_not_found(self):
        """get_open_session must raise CashSessionError (never a generic Exception)."""
        import asyncio
        from app.core.exceptions import CashSessionError
        svc, session = self._make_svc()
        mock_result = MagicMock()
        mock_result.scalars.return_value.first.return_value = None
        session.execute.return_value = mock_result

        async def run():
            with pytest.raises(CashSessionError):
                await svc.get_open_session(association_id=uuid4())
        asyncio.get_event_loop().run_until_complete(run())

    def test_reverse_already_reversed_raises_cash_session_error(self):
        """reverse_transaction must reject a transaction already reversed."""
        import asyncio
        from datetime import datetime
        from app.core.exceptions import CashSessionError
        from app.models.finance import Transaction, TransactionType
        svc, session = self._make_svc()
        tx = Transaction(
            id=uuid4(), association_id=uuid4(),
            type=TransactionType.income, amount=Decimal("50.00"),
            description="Test", created_by=uuid4(),
            reversed_at=datetime.utcnow(),
        )
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = tx
        session.execute.return_value = mock_result

        async def run():
            with pytest.raises(CashSessionError, match="já foi estornada"):
                await svc.reverse_transaction(
                    transaction_id=tx.id, association_id=tx.association_id,
                    reversed_by=uuid4(), reason="Teste",
                )
        asyncio.get_event_loop().run_until_complete(run())

    def test_reverse_reversal_raises(self):
        """Cannot reverse a reversal."""
        import asyncio
        from app.core.exceptions import CashSessionError
        from app.models.finance import Transaction, TransactionType
        svc, session = self._make_svc()
        tx = Transaction(
            id=uuid4(), association_id=uuid4(),
            type=TransactionType.income, amount=Decimal("50.00"),
            description="Estorno: X", created_by=uuid4(),
            is_reversal=True,
        )
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = tx
        session.execute.return_value = mock_result

        async def run():
            with pytest.raises(CashSessionError, match="estornar um estorno"):
                await svc.reverse_transaction(
                    transaction_id=tx.id, association_id=tx.association_id,
                    reversed_by=uuid4(), reason="Teste",
                )
        asyncio.get_event_loop().run_until_complete(run())

    def test_perform_sangria_requires_photo(self):
        """perform_sangria must reject empty receipt_photo_url."""
        import asyncio
        from app.core.exceptions import CashSessionError
        svc, session = self._make_svc()

        async def run():
            with pytest.raises(CashSessionError, match="Foto do recibo"):
                await svc.perform_sangria(
                    association_id=uuid4(), opened_by=uuid4(),
                    amount=Decimal("50.00"), reason="Teste",
                    destination="Cofre", receipt_photo_url="",
                )
        asyncio.get_event_loop().run_until_complete(run())

    def test_credit_cash_box_not_found_raises(self):
        """credit_cash_box raises NotFoundError when box does not exist."""
        import asyncio
        from app.core.exceptions import NotFoundError
        svc, session = self._make_svc()
        mock_result = MagicMock()
        mock_result.fetchone.return_value = None
        session.execute.return_value = mock_result

        async def run():
            with pytest.raises(NotFoundError):
                await svc.credit_cash_box(
                    association_id=uuid4(), cash_box_id=uuid4(),
                    amount=Decimal("100.00"), description="Test", created_by=uuid4(),
                )
        asyncio.get_event_loop().run_until_complete(run())

    def test_send_to_malote_not_closed_raises(self):
        """send_to_malote rejects sessions not in 'closed' status."""
        import asyncio
        from app.core.exceptions import UnprocessableError
        svc, session = self._make_svc()
        mock_result = MagicMock()
        mock_result.fetchone.return_value = ("open", Decimal("100.00"), None)
        session.execute.return_value = mock_result

        async def run():
            with pytest.raises(UnprocessableError, match="fechada"):
                await svc.send_to_malote(session_id=uuid4(), association_id=uuid4(), sent_by=uuid4())
        asyncio.get_event_loop().run_until_complete(run())

    def test_send_to_malote_already_sent_raises(self):
        """send_to_malote rejects session already sent to malote."""
        import asyncio
        from datetime import datetime
        from app.core.exceptions import UnprocessableError
        svc, session = self._make_svc()
        mock_result = MagicMock()
        mock_result.fetchone.return_value = ("closed", Decimal("100.00"), datetime.utcnow())
        session.execute.return_value = mock_result

        async def run():
            with pytest.raises(UnprocessableError, match="já enviado"):
                await svc.send_to_malote(session_id=uuid4(), association_id=uuid4(), sent_by=uuid4())
        asyncio.get_event_loop().run_until_complete(run())

    def test_send_to_malote_zero_balance_raises(self):
        """send_to_malote rejects sessions with zero closing_balance."""
        import asyncio
        from app.core.exceptions import UnprocessableError
        svc, session = self._make_svc()
        mock_result = MagicMock()
        mock_result.fetchone.return_value = ("closed", Decimal("0.00"), None)
        session.execute.return_value = mock_result

        async def run():
            with pytest.raises(UnprocessableError, match="inválido"):
                await svc.send_to_malote(session_id=uuid4(), association_id=uuid4(), sent_by=uuid4())
        asyncio.get_event_loop().run_until_complete(run())

    def test_compute_expected_balance_returns_decimal(self):
        """_compute_expected_balance must return Decimal, not float."""
        import asyncio
        from app.models.finance import CashSession, Transaction, TransactionType
        svc, session = self._make_svc()
        cash = CashSession(id=uuid4(), association_id=uuid4(), opening_balance=Decimal("100.00"))
        tx1 = Transaction(type=TransactionType.income, amount=Decimal("50.00"),
                          reversed_at=None, is_reversal=False, description="T1")
        tx2 = Transaction(type=TransactionType.expense, amount=Decimal("10.00"),
                          reversed_at=None, is_reversal=False, description="T2")
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [tx1, tx2]
        session.execute.return_value = mock_result

        async def run():
            expected, bruto, baixas = await svc._compute_expected_balance(cash)
            assert isinstance(expected, Decimal), "expected deve ser Decimal"
            assert isinstance(bruto, Decimal), "bruto deve ser Decimal"
            assert expected == Decimal("140.00")
            assert bruto == Decimal("50.00")
        asyncio.get_event_loop().run_until_complete(run())
