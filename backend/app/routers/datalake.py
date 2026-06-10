import asyncio
import json
import io
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.tenant import require_admin, CurrentUser
from app.database import get_session
from app.services.datalake_service import run_full_etl

router = APIRouter(prefix="/datalake", tags=["Data Lake"])
settings = get_settings()

# Horários do cron em UTC (09h e 17h Brasília = UTC-3)
CRON_HOURS_UTC = [12, 20]


def _r2_client():
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
    )


def _list_prefix(client, prefix: str) -> list[dict]:
    from app.core.resilience import r2_cb
    def _do():
        resp = client.list_objects_v2(Bucket=settings.r2_bucket_name, Prefix=prefix)
        return [
            {
                "arquivo": o["Key"].replace(prefix, ""),
                "size_kb": round(o["Size"] / 1024, 1),
                "atualizado_em": o["LastModified"].isoformat(),
            }
            for o in resp.get("Contents", [])
        ]
    try:
        return r2_cb.call_sync(_do)
    except Exception:
        return []


def _next_runs() -> list[dict]:
    """Calcula as próximas 2 execuções do cron (09h e 17h horário Brasília)."""
    now_utc = datetime.now(timezone.utc)
    scheduled = []
    for day_offset in range(2):
        base = now_utc.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=day_offset)
        for h in CRON_HOURS_UTC:
            run_time = base.replace(hour=h)
            if run_time > now_utc:
                brasilia = run_time - timedelta(hours=3)
                scheduled.append({
                    "utc": run_time.isoformat(),
                    "brasilia": brasilia.strftime("%d/%m %H:%M"),
                    "em": _humanize(run_time - now_utc),
                })
    return scheduled[:2]


def _humanize(delta: timedelta) -> str:
    total = int(delta.total_seconds())
    if total < 60:
        return f"{total}s"
    if total < 3600:
        return f"{total//60}min"
    return f"{total//3600}h {(total%3600)//60}min"


# ── Endpoints de disparo ───────────────────────────────────────────────────────

@router.post("/run", summary="ETL cron (incremental automático)")
async def trigger_etl_cron(
    authorization: str | None = Header(default=None),
    x_cron_secret: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> dict:
    # Vercel injeta: Authorization: Bearer <CRON_SECRET>
    bearer = (authorization or "").removeprefix("Bearer ").strip()
    secret = settings.cron_secret or ""
    if secret and bearer != secret and x_cron_secret != secret:
        raise HTTPException(status_code=401, detail="Cron secret inválido.")
    if not settings.r2_account_id:
        raise HTTPException(status_code=503, detail="R2 não configurado.")
    return await run_full_etl(session, triggered_by="cron")


@router.post("/run/manual", summary="Disparar ETL manualmente (admin)")
async def trigger_etl_manual(
    force_full: bool = False,
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_admin),
) -> dict:
    if not settings.r2_account_id:
        raise HTTPException(status_code=503, detail="R2 não configurado.")
    return await run_full_etl(session, force_full=force_full, triggered_by=current.role)


# ── Histórico de execuções ─────────────────────────────────────────────────────

@router.get("/runs", summary="Histórico de execuções")
async def list_runs(
    limit: int = Query(default=20, le=100),
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_admin),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT id, run_date, mode, status, started_at, completed_at,
               duration_s, bronze_rows, silver_rows, gold_files,
               neon_kb, error_msg, triggered_by
        FROM etl_runs ORDER BY started_at DESC LIMIT :lim
    """), {"lim": limit})).fetchall()
    return [dict(r._mapping) for r in rows]


@router.get("/runs/{run_id}", summary="Detalhe de execução com tasks")
async def get_run(
    run_id: str,
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_admin),
) -> dict:
    run = (await session.execute(text("""
        SELECT id, run_date, mode, status, started_at, completed_at,
               duration_s, bronze_rows, silver_rows, gold_files,
               neon_kb, error_msg, triggered_by
        FROM etl_runs WHERE id = :rid
    """), {"rid": run_id})).fetchone()
    if not run:
        raise HTTPException(status_code=404)

    tasks = (await session.execute(text("""
        SELECT task_name, status, started_at, completed_at,
               duration_s, rows_in, rows_out, detail
        FROM etl_task_runs WHERE run_id = :rid ORDER BY started_at ASC
    """), {"rid": run_id})).fetchall()

    return {**dict(run._mapping), "tasks": [dict(t._mapping) for t in tasks]}


# ── Governança completa ────────────────────────────────────────────────────────

@router.get("/governance", summary="Visão completa do pipeline — arquivos, tamanhos, schedule, saúde")
async def governance(
    session: AsyncSession = Depends(get_session),
    current: CurrentUser = Depends(require_admin),
) -> dict:
    """
    Endpoint central de governança. Retorna:
    - Próximas execuções (schedule)
    - Status de todas as camadas no R2 (bronze/prata/ouro) com tamanhos
    - Últimas 5 execuções com status
    - Estatísticas acumuladas
    - Alertas ativos
    """
    if not settings.r2_account_id:
        return {"configured": False}

    client = _r2_client()
    today = datetime.now(timezone.utc).date().isoformat()

    # ── Schedule ─────────────────────────────────────────────────────────────
    proximas = _next_runs()

    # ── Metadata do R2 ────────────────────────────────────────────────────────
    try:
        meta_obj = client.get_object(Bucket=settings.r2_bucket_name, Key="_controle/estado_etl.json")
        metadata = json.loads(meta_obj["Body"].read())
    except Exception:
        metadata = {}

    # ── Inventário completo do R2 — todas as chamadas boto3 em paralelo ─────────
    def _layer(prefix):
        files = _list_prefix(client, prefix)
        total_kb = sum(f["size_kb"] for f in files)
        return {"arquivos": files, "total_arquivos": len(files), "total_kb": round(total_kb, 1)}

    def _hist():
        try:
            h = client.list_objects_v2(
                Bucket=settings.r2_bucket_name, Prefix="bronze/historico/", Delimiter="/"
            )
            return sorted(
                [p["Prefix"].replace("bronze/historico/", "").rstrip("/") for p in h.get("CommonPrefixes", [])],
                reverse=True,
            )[:10]
        except Exception:
            return []

    loop = asyncio.get_running_loop()
    (
        bronze_atual, prata_hoje,
        ouro_financeiro, ouro_moradores, ouro_encomendas,
        ouro_operacional, ouro_equipe,
        bronze_historico_datas,
    ) = await asyncio.gather(
        loop.run_in_executor(None, _layer, "bronze/atual/"),
        loop.run_in_executor(None, _layer, f"prata/{today}/"),
        loop.run_in_executor(None, _layer, "ouro/financeiro/"),
        loop.run_in_executor(None, _layer, "ouro/moradores/"),
        loop.run_in_executor(None, _layer, "ouro/encomendas/"),
        loop.run_in_executor(None, _layer, "ouro/operacional/"),
        loop.run_in_executor(None, _layer, "ouro/equipe/"),
        loop.run_in_executor(None, _hist),
    )

    total_ouro_kb = sum([
        ouro_financeiro["total_kb"], ouro_moradores["total_kb"],
        ouro_encomendas["total_kb"], ouro_operacional["total_kb"],
        ouro_equipe["total_kb"]
    ])

    # ── Últimas execuções ─────────────────────────────────────────────────────
    runs_rows = (await session.execute(text("""
        SELECT id, run_date, mode, status, started_at, completed_at,
               duration_s, bronze_rows, silver_rows, gold_files, neon_kb, error_msg, triggered_by
        FROM etl_runs ORDER BY started_at DESC LIMIT 10
    """))).fetchall()
    runs = [dict(r._mapping) for r in runs_rows]

    # ── Estatísticas acumuladas ───────────────────────────────────────────────
    stats_row = (await session.execute(text("""
        SELECT
            COUNT(*)                                               AS total_runs,
            COUNT(*) FILTER (WHERE status = 'success')            AS successos,
            COUNT(*) FILTER (WHERE status = 'failed')             AS falhas,
            ROUND(AVG(duration_s) FILTER (WHERE status='success'),1) AS avg_duracao_s,
            ROUND(SUM(neon_kb), 1)                                AS total_neon_kb,
            MAX(started_at)                                       AS ultimo_run
        FROM etl_runs
    """))).fetchone()
    estatisticas = dict(stats_row._mapping) if stats_row else {}

    taxa_sucesso = round(
        estatisticas.get("successos", 0) / max(estatisticas.get("total_runs", 1), 1) * 100, 1
    )

    # ── Alertas ativos ────────────────────────────────────────────────────────
    alertas = []

    # Falha recente
    if runs and runs[0]["status"] == "failed":
        alertas.append({
            "nivel": "critico",
            "mensagem": f"Última execução falhou: {runs[0].get('error_msg', '')[:120]}",
            "run_id": str(runs[0]["id"]),
        })

    # Sem execução há mais de 24h
    if estatisticas.get("ultimo_run"):
        ultimo = datetime.fromisoformat(str(estatisticas["ultimo_run"]).replace("+00:00", "+00:00"))
        if datetime.now(timezone.utc) - ultimo > timedelta(hours=24):
            alertas.append({
                "nivel": "aviso",
                "mensagem": f"Nenhuma execução nas últimas 24h. Último run: {ultimo.strftime('%d/%m %H:%M')}",
            })

    # Ouro vazio
    if total_ouro_kb < 10:
        alertas.append({
            "nivel": "aviso",
            "mensagem": "Camada Ouro parece vazia. Execute a carga completa.",
        })

    # Bronze sem atualização
    if bronze_atual["arquivos"]:
        mais_antigo = min(f["atualizado_em"] for f in bronze_atual["arquivos"])
        dt_antigo = datetime.fromisoformat(mais_antigo)
        if datetime.now(timezone.utc) - dt_antigo > timedelta(hours=25):
            alertas.append({
                "nivel": "aviso",
                "mensagem": "Bronze/atual não atualizado há mais de 24h.",
            })

    return {
        "configured":     True,
        "bucket":         settings.r2_bucket_name,
        "timestamp":      datetime.now(timezone.utc).isoformat(),

        # Schedule
        "proximas_execucoes": proximas,
        "cron_horarios_brasilia": ["09:00", "17:00"],

        # Metadata
        "ultimo_etl_metadata": metadata,

        # Inventário R2
        "camadas": {
            "bronze": {
                "atual":     bronze_atual,
                "historico": {"datas_disponiveis": bronze_historico_datas},
            },
            "prata": {
                "hoje": prata_hoje,
            },
            "ouro": {
                "total_kb":   round(total_ouro_kb, 1),
                "financeiro": ouro_financeiro,
                "moradores":  ouro_moradores,
                "encomendas": ouro_encomendas,
                "operacional":ouro_operacional,
                "equipe":     ouro_equipe,
            },
        },

        # Execuções
        "ultimas_execucoes": runs,
        "estatisticas": {
            **estatisticas,
            "taxa_sucesso_pct": taxa_sucesso,
        },

        # Alertas
        "alertas": alertas,
        "saude": "ok" if not any(a["nivel"] == "critico" for a in alertas) else "critico",
    }


@router.get("/status", summary="Status simplificado (retrocompatibilidade)")
async def etl_status(
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Versão simplificada — use /governance para visão completa."""
    if not settings.r2_account_id:
        return {"configured": False}

    client = _r2_client()
    today = datetime.now(timezone.utc).date().isoformat()

    def _list(prefix):
        return _list_prefix(client, prefix)

    last_run_db = (await session.execute(text("""
        SELECT id, run_date, mode, status, started_at, completed_at,
               duration_s, bronze_rows, silver_rows, gold_files, neon_kb, error_msg
        FROM etl_runs ORDER BY started_at DESC LIMIT 1
    """))).fetchone()

    try:
        meta_obj = client.get_object(Bucket=settings.r2_bucket_name, Key="_controle/estado_etl.json")
        metadata = json.loads(meta_obj["Body"].read())
    except Exception:
        metadata = {}

    return {
        "configured":        True,
        "bucket":            settings.r2_bucket_name,
        "metadata":          metadata,
        "last_run_db":       dict(last_run_db._mapping) if last_run_db else None,
        "ouro_financeiro":   _list("ouro/financeiro/"),
        "ouro_moradores":    _list("ouro/moradores/"),
        "ouro_encomendas":   _list("ouro/encomendas/"),
        "ouro_operacional":  _list("ouro/operacional/"),
        "ouro_equipe":       _list("ouro/equipe/"),
        "bronze_atual":      _list("bronze/atual/"),
        "prata_hoje":        _list(f"prata/{today}/"),
    }
