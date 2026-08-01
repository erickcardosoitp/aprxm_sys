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
