from fastapi import APIRouter
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.core.metrics import registry

# Sem prefixo /api/v1 de proposito (montado direto em main.py) -- convencao
# padrao de scrape do Prometheus, mesmo usado pelo erp_itp_backend
# (GET /api/metrics). Publico (sem auth) tambem seguindo o mesmo padrao ja
# aceito la: sao so contagens agregadas, e o Prometheus so acessa via rede
# interna do docker-compose (aprxm_backend:8000), nunca pelo dominio publico.
router = APIRouter(tags=["Métricas"])


@router.get("/metrics", summary="Métricas Prometheus (negócio)")
async def metrics() -> Response:
    return Response(generate_latest(registry), media_type=CONTENT_TYPE_LATEST)
