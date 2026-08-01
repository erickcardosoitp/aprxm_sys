"""
Smoke tests do painel da presidencia — gate de acesso e helper de frescor.
Run with: pytest backend/tests/test_presidencia.py -v
"""
import asyncio
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException


# ── require_presidencia_access ───────────────────────────────────────────────

class TestRequirePresidenciaAccess:
    def _user(self, role: str):
        from app.core.tenant import CurrentUser
        return CurrentUser(user_id=uuid4(), association_id=uuid4(), role=role)

    @pytest.mark.parametrize("role", ["admin", "conselho", "admin_master", "superadmin"])
    def test_allows_admin_conselho_and_platform_roles(self, role):
        from app.core.tenant import require_presidencia_access
        user = self._user(role)

        async def run():
            result = await require_presidencia_access(current=user)
            assert result is user
        asyncio.get_event_loop().run_until_complete(run())

    @pytest.mark.parametrize("role", ["operator", "conferente", "diretoria", "diretoria_adjunta", "viewer"])
    def test_blocks_everyone_else(self, role):
        from app.core.tenant import require_presidencia_access
        user = self._user(role)

        async def run():
            with pytest.raises(HTTPException) as exc:
                await require_presidencia_access(current=user)
            assert exc.value.status_code == 403
        asyncio.get_event_loop().run_until_complete(run())


# ── PresidenciaService.freshness ─────────────────────────────────────────────

class TestFreshness:
    def _make_svc(self, row):
        from app.services.presidencia_service import PresidenciaService
        session = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchone.return_value = row
        session.execute = AsyncMock(return_value=mock_result)
        analytics = AsyncMock()
        return PresidenciaService(session, analytics)

    def test_success_run_is_not_stale(self):
        import datetime
        completed = datetime.datetime(2026, 8, 1, 9, 0, tzinfo=datetime.timezone.utc)
        svc = self._make_svc(("success", completed))

        async def run():
            result = await svc.freshness()
            assert result["stale"] is False
            assert result["generated_at"] == completed.isoformat()
        asyncio.get_event_loop().run_until_complete(run())

    def test_failed_run_is_stale(self):
        svc = self._make_svc(("failed", None))

        async def run():
            result = await svc.freshness()
            assert result["stale"] is True
        asyncio.get_event_loop().run_until_complete(run())

    def test_no_run_ever_is_stale(self):
        svc = self._make_svc(None)

        async def run():
            result = await svc.freshness()
            assert result["stale"] is True
            assert result["generated_at"] is None
        asyncio.get_event_loop().run_until_complete(run())


# ── get_inicio / get_resumo (shape, sem depender de dado real) ──────────────

class TestGetInicio:
    def test_inicio_returns_expected_shape(self):
        from app.services.presidencia_service import PresidenciaService

        session = AsyncMock()
        session_result = MagicMock(); session_result.scalar.return_value = 2  # caixas abertos
        session.execute = AsyncMock(return_value=session_result)

        analytics = AsyncMock()

        def make(v):
            r = MagicMock()
            r.scalar.return_value = v
            r.fetchone.return_value = v
            return r

        analytics.execute = AsyncMock(side_effect=[
            make(7312.51),          # receita_mes
            make((132, 261)),        # mensalidades pagas/vencidas
            make(5220.0),            # inadimplente
            make((1426, 408, 69, 949)),  # moradores
            make((1556, 48.0, 312)),     # pacotes
            make((2, 0)),                 # os
        ])
        svc = PresidenciaService(session, analytics)

        async def run():
            data = await svc.get_inicio()
            assert data["financeiro"]["receita_mes_atual"] == 7312.51
            assert data["moradores"]["total"] == 1426
            assert data["pacotes_os"]["pacotes_recebidos"] == 1556
            assert "alertas" in data
            assert any("caixas abertos" in a for a in data["alertas"])
        asyncio.get_event_loop().run_until_complete(run())


class TestGetResumo:
    def test_resumo_returns_wow_shape(self):
        from app.services.presidencia_service import PresidenciaService

        session = AsyncMock()
        analytics = AsyncMock()

        def make(v):
            r = MagicMock()
            r.scalar.return_value = v
            return r

        # 4 KPIs x (atual, anterior) = 8 chamadas
        analytics.execute = AsyncMock(side_effect=[
            make(1000.0), make(1400.0),   # receita
            make(365), make(386),          # encomendas
            make(9), make(18),             # crescimento
            make(1.1), make(2.1),          # tempo entrega
        ])
        svc = PresidenciaService(session, analytics)

        async def run():
            data = await svc.get_resumo()
            assert data["receita_liquida"]["atual"] == 1000.0
            assert data["receita_liquida"]["wow_pct"] == round(100 * (1000 - 1400) / 1400, 1)
            assert data["encomendas"]["anterior"] == 386
        asyncio.get_event_loop().run_until_complete(run())
