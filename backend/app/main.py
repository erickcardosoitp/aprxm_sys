import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.database import init_db
from app.routers import admin, auth, finance, packages, residents, service_orders
from app.routers import settings as settings_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Sistema de Gestão Comunitária — APRXM",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "type": type(exc).__name__, "trace": traceback.format_exc()[-1000:]},
    )


PREFIX = "/api/v1"
app.include_router(auth.router, prefix=PREFIX)
app.include_router(admin.router, prefix=PREFIX)
app.include_router(finance.router, prefix=PREFIX)
app.include_router(packages.router, prefix=PREFIX)
app.include_router(residents.router, prefix=PREFIX)
app.include_router(service_orders.router, prefix=PREFIX)
app.include_router(settings_router.router, prefix=PREFIX)


@app.get("/health", tags=["Sistema"])
async def health() -> dict:
    return {"status": "ok", "version": settings.app_version}
