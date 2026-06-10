"""
Resilience primitives: DB retry + Circuit Breaker para serviços externos.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Awaitable, Callable, TypeVar

from sqlalchemy.exc import DBAPIError

log = logging.getLogger(__name__)

T = TypeVar("T")

# ─── DB Retry ────────────────────────────────────────────────────────────────

_TRANSIENT_MARKERS = (
    "deadlock",
    "too many connections",
    "connection does not exist",
    "connection was closed",
    "ssl connection has been closed unexpectedly",
    "server closed the connection unexpectedly",
    "could not connect to server",
)


def _is_transient(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(m in msg for m in _TRANSIENT_MARKERS)


async def with_db_retry(
    fn: Callable[[], Awaitable[T]],
    max_attempts: int = 3,
    base_delay: float = 0.1,
) -> T:
    """
    Retry an async DB operation on transient errors (deadlock, pool exhaustion,
    dropped connection) with exponential backoff.

    Usage:
        result = await with_db_retry(lambda: session.execute(...))
    """
    last_exc: Exception | None = None
    for attempt in range(max_attempts):
        try:
            return await fn()
        except DBAPIError as exc:
            last_exc = exc
            if _is_transient(exc) and attempt < max_attempts - 1:
                delay = base_delay * (2 ** attempt)
                log.warning("transient DB error (attempt %d/%d), retry in %.2fs: %s",
                            attempt + 1, max_attempts, delay, exc)
                await asyncio.sleep(delay)
                continue
            raise
    raise last_exc  # type: ignore[misc]


# ─── Circuit Breaker ─────────────────────────────────────────────────────────

class CircuitBreaker:
    """
    In-memory circuit breaker (per-process, resets on cold start).

    States:
        CLOSED    — normal, calls pass through
        OPEN      — failing fast, no calls attempted
        HALF_OPEN — recovery probe: one call allowed; success → CLOSED, fail → OPEN
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 3,
        recovery_timeout: float = 30.0,
    ) -> None:
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self._failures = 0
        self._opened_at: float = 0.0
        self._state = "CLOSED"

    # ── state machine ────────────────────────────────────────────────────────

    @property
    def state(self) -> str:
        if self._state == "OPEN":
            if time.monotonic() - self._opened_at >= self.recovery_timeout:
                self._state = "HALF_OPEN"
                log.info("CircuitBreaker[%s] → HALF_OPEN (probing)", self.name)
        return self._state

    def _success(self) -> None:
        if self._state != "CLOSED":
            log.info("CircuitBreaker[%s] → CLOSED (recovered)", self.name)
        self._failures = 0
        self._state = "CLOSED"

    def _failure(self) -> None:
        self._failures += 1
        self._opened_at = time.monotonic()
        if self._failures >= self.failure_threshold:
            if self._state != "OPEN":
                log.warning("CircuitBreaker[%s] → OPEN (%d failures)", self.name, self._failures)
            self._state = "OPEN"

    # ── public API ───────────────────────────────────────────────────────────

    async def call_async(self, fn: Callable[[], Awaitable[T]]) -> T:
        if self.state == "OPEN":
            raise ServiceUnavailableError(
                f"Serviço '{self.name}' temporariamente indisponível (circuit open)."
            )
        try:
            result = await fn()
            self._success()
            return result
        except ServiceUnavailableError:
            raise
        except Exception as exc:
            self._failure()
            raise

    def call_sync(self, fn: Callable[[], T]) -> T:
        if self.state == "OPEN":
            raise ServiceUnavailableError(
                f"Serviço '{self.name}' temporariamente indisponível (circuit open)."
            )
        try:
            result = fn()
            self._success()
            return result
        except ServiceUnavailableError:
            raise
        except Exception as exc:
            self._failure()
            raise

    def status(self) -> dict:
        return {
            "name": self.name,
            "state": self.state,
            "failures": self._failures,
            "threshold": self.failure_threshold,
            "recovery_timeout_s": self.recovery_timeout,
        }


class ServiceUnavailableError(RuntimeError):
    """Raised when a circuit breaker is OPEN."""
    pass


# ─── Singletons ──────────────────────────────────────────────────────────────

supabase_cb = CircuitBreaker("supabase-storage", failure_threshold=3, recovery_timeout=30.0)
r2_cb       = CircuitBreaker("r2-storage",       failure_threshold=3, recovery_timeout=60.0)
http_cb     = CircuitBreaker("http-external",    failure_threshold=5, recovery_timeout=20.0)


def all_circuit_breakers() -> list[dict]:
    return [cb.status() for cb in (supabase_cb, r2_cb, http_cb)]
