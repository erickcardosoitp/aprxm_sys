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
        dw = AsyncMock()
        return PresidenciaService(session, dw)

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

        dw = AsyncMock()

        def make(v):
            r = MagicMock()
            r.scalar.return_value = v
            r.fetchone.return_value = v
            return r

        # ordem em get_inicio: _metricas_periodo(atual) = receita/cob/pacotes/os,
        # _metricas_periodo(anterior) = idem, depois inadimplente, moradores, parados.
        dw.execute = AsyncMock(side_effect=[
            make(7312.51),               # atual: receita_mes
            make((132, 393)),            # atual: cob pagas, total
            make((1556, 2.0)),           # atual: pacotes recebidos, media_dias_permanencia
            make((2, 0)),                # atual: os abertas, fechadas
            make(6800.0),                # anterior: receita_mes
            make((120, 380)),            # anterior: cob pagas, total
            make((1400, 2.5)),           # anterior: pacotes recebidos, media_dias_permanencia
            make((3, 1)),                # anterior: os abertas, fechadas
            make(5220.0),                # inadimplente
            make((1426, 408, 69, 949)),  # moradores: total, associados, dependentes, visitantes
            make(312),                   # parados
        ])
        svc = PresidenciaService(session, dw)

        async def run():
            data = await svc.get_inicio()
            assert data["financeiro"]["receita_mes_atual"] == 7312.51
            assert data["moradores"]["total"] == 1426
            assert data["pacotes_os"]["pacotes_recebidos"] == 1556
            assert "alertas" in data
            assert any("caixas abertos" in a for a in data["alertas"])
            assert any("pacotes parados" in a for a in data["alertas"])
        asyncio.get_event_loop().run_until_complete(run())


class TestGetResumo:
    def test_resumo_returns_wow_shape(self):
        from app.services.presidencia_service import PresidenciaService

        session = AsyncMock()
        dw = AsyncMock()

        def make_weeks(cur, prev):
            r = MagicMock()
            r.fetchall.return_value = [("2026-07-27", cur), ("2026-07-20", prev)]
            return r

        # 1 chamada por KPI (_wow_semanal busca as 2 semanas mais recentes de uma vez)
        dw.execute = AsyncMock(side_effect=[
            make_weeks(1000.0, 1400.0),  # receita_liquida
            make_weeks(365, 386),         # encomendas
            make_weeks(9, 18),            # crescimento
            make_weeks(1.1, 2.1),         # tempo_entrega
        ])
        svc = PresidenciaService(session, dw)

        async def run():
            data = await svc.get_resumo()
            assert data["receita_liquida"]["atual"] == 1000.0
            assert data["receita_liquida"]["wow_pct"] == round(100 * (1000 - 1400) / 1400, 1)
            assert data["encomendas"]["anterior"] == 386
        asyncio.get_event_loop().run_until_complete(run())
