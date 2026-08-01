import asyncio
import time
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.core.limiter import limiter

from app.config import get_settings
from app.database import init_db
from app.db.migrations import run_migrations, seed_local_dev
from app.routers import admin, agent, auth, carriers, cash_boxes, chat, crm, daily_tasks, datalake, demands, esc, finance, financeiro, geral, governanca, mensalidades, notifications, packages, painel_auth, public, reports, residents, senso, service_order_phases, service_orders, superadmin, ti, uploads, transfers, webauthn
from app.routers import settings as settings_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Migrations ANTES do create_all: num banco vazio, o create_all do SQLModel
    # cria as tabelas sem os defaults SQL que as migrations definem (ex: empresas.id
    # sem DEFAULT gen_random_uuid(), timestamptz virando timestamp), e os INSERTs
    # das migrations de dados quebram. As migrations sao a fonte de verdade do
    # schema; o create_all so cobre tabela nova de model que ainda nao tem migration.
    await run_migrations()
    await init_db()
    await seed_local_dev()
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Sistema de Gestão Comunitária — APRXM",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Association-ID", "X-Device-Token"],
)

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Permitted-Cross-Domain-Policies": "none",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
    # API so retorna JSON/binario, nunca HTML/JS renderizado por ela mesma — CSP
    # restritiva aqui e' defesa em profundidade (ex: se algum endpoint um dia
    # devolver uma pagina de erro em HTML por engano).
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}

@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    for key, value in _SECURITY_HEADERS.items():
        response.headers[key] = value
    return response

_SKIP_LOG = {
    "/health", "/api/v1/health",
    "/api/v1/notifications/unread-count", "/api/v1/chat/unread-count",
    "/", "/favicon.ico", "/favicon.png", "/robots.txt",
}

def _extract_user_id_from_request(request: Request) -> str | None:
    try:
        auth_header = request.headers.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            return None
        from app.core.security import decode_access_token
        payload = decode_access_token(auth_header[7:])
        return payload.get("sub")
    except Exception:
        return None


async def _log_request(path: str, method: str, status_code: int, duration_ms: int, user_id: str | None) -> None:
    try:
        from app.database import AsyncSessionLocal
        from sqlalchemy import text as _t
        async with AsyncSessionLocal() as s:
            await s.execute(_t(
                "INSERT INTO api_request_logs (path, method, status_code, duration_ms, user_id)"
                " VALUES (:p, :m, :s, :d, :u)"
            ), {"p": path, "m": method, "s": status_code, "d": duration_ms, "u": user_id})
            await s.commit()
    except Exception:
        pass


@app.middleware("http")
async def request_timing_middleware(request: Request, call_next):
    start = time.monotonic()
    response = await call_next(request)
    duration_ms = int((time.monotonic() - start) * 1000)
    path = request.url.path
    if path not in _SKIP_LOG and not path.startswith("/api/v1/ti/"):
        user_id = _extract_user_id_from_request(request)
        # Fire-and-forget: não bloquear a resposta esperando o INSERT do log.
        asyncio.create_task(_log_request(path, request.method, response.status_code, duration_ms, user_id))
    return response


@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    # Stack trace so' vai pro cliente fora de producao. Em producao ele expunha
    # estrutura interna de codigo/banco pra qualquer chamador (inclusive nao autenticado);
    # o trace continua indo pro log do servidor de qualquer forma.
    trace = traceback.format_exc()
    print(f"[UNHANDLED] {type(exc).__name__}: {exc}\n{trace}")
    if settings.app_env == "production":
        return JSONResponse(status_code=500, content={"detail": "Erro interno do servidor."})
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "type": type(exc).__name__, "trace": trace[-1000:]},
    )


PREFIX = "/api/v1"
app.include_router(auth.router, prefix=PREFIX)
app.include_router(admin.router, prefix=PREFIX)
app.include_router(finance.router, prefix=PREFIX)
app.include_router(packages.router, prefix=PREFIX)
app.include_router(residents.router, prefix=PREFIX)
app.include_router(service_orders.router, prefix=PREFIX)
app.include_router(service_order_phases.router, prefix=PREFIX)
app.include_router(daily_tasks.router, prefix=PREFIX)
app.include_router(settings_router.router, prefix=PREFIX)
app.include_router(financeiro.router, prefix=PREFIX)
app.include_router(mensalidades.router, prefix=PREFIX)
app.include_router(geral.router, prefix=PREFIX)
app.include_router(superadmin.router, prefix=PREFIX)
app.include_router(uploads.router, prefix=PREFIX)
app.include_router(transfers.router, prefix=PREFIX)
app.include_router(reports.router, prefix=PREFIX)
app.include_router(public.router, prefix=PREFIX)
app.include_router(senso.router, prefix=PREFIX)
app.include_router(agent.router, prefix=PREFIX)
app.include_router(cash_boxes.router, prefix=PREFIX)
app.include_router(carriers.router, prefix=PREFIX)
app.include_router(demands.router, prefix=PREFIX)
app.include_router(chat.router, prefix=PREFIX)
app.include_router(notifications.router, prefix=PREFIX)
app.include_router(webauthn.router, prefix=PREFIX)
app.include_router(datalake.router, prefix=PREFIX)
app.include_router(ti.router, prefix=PREFIX)
app.include_router(crm.router, prefix=PREFIX)
app.include_router(governanca.router, prefix=PREFIX)
app.include_router(esc.router, prefix=PREFIX)
app.include_router(painel_auth.router, prefix=PREFIX)


@app.get("/health", tags=["Sistema"])
@app.get("/api/v1/health", tags=["Sistema"])
async def health() -> dict:
    return {"status": "ok", "version": settings.app_version}

@app.get("/", include_in_schema=False)
async def root():
    return {"status": "ok"}

@app.get("/favicon.ico", include_in_schema=False)
@app.get("/favicon.png", include_in_schema=False)
@app.get("/robots.txt", include_in_schema=False)
async def static_stubs():
    from fastapi.responses import Response
    return Response(status_code=204)
