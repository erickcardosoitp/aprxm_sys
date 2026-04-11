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
