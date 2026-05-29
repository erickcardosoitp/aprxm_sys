from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user, require_admin
from app.database import get_session

router = APIRouter(prefix="/ti", tags=["TI"])


@router.get("/routes", summary="Listar todos os endpoints registrados")
async def list_routes(
    request: Request,
    current: CurrentUser = Depends(require_admin),
) -> list[dict]:
    routes = []
    for route in request.app.routes:
        if not hasattr(route, "methods"):
            continue
        routes.append({
            "path": route.path,
            "methods": sorted(route.methods - {"HEAD", "OPTIONS"}),
            "name": route.name,
            "tags": list(getattr(route, "tags", []) or []),
            "summary": getattr(route, "summary", None),
        })
    routes.sort(key=lambda r: (r["tags"][0] if r["tags"] else "z", r["path"]))
    return routes


@router.get("/db", summary="Estatísticas do banco de dados")
async def db_stats(
    current: CurrentUser = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    # Tamanho e contagem por tabela
    tables = (await session.execute(text("""
        SELECT
            t.tablename                                         AS name,
            pg_size_pretty(pg_total_relation_size(quote_ident(t.tablename))) AS total_size,
            pg_total_relation_size(quote_ident(t.tablename))   AS total_bytes,
            pg_size_pretty(pg_relation_size(quote_ident(t.tablename)))       AS data_size,
            pg_size_pretty(pg_total_relation_size(quote_ident(t.tablename))
                         - pg_relation_size(quote_ident(t.tablename)))       AS index_size,
            COALESCE(s.n_live_tup, 0)                          AS row_estimate,
            COALESCE(s.n_dead_tup, 0)                          AS dead_rows,
            s.last_vacuum,
            s.last_analyze
        FROM pg_tables t
        LEFT JOIN pg_stat_user_tables s ON s.relname = t.tablename
        WHERE t.schemaname = 'public'
        ORDER BY pg_total_relation_size(quote_ident(t.tablename)) DESC
    """))).fetchall()

    # Índices: uso e tamanho
    indexes = (await session.execute(text("""
        SELECT
            i.indexname,
            i.tablename,
            pg_size_pretty(pg_relation_size(quote_ident(i.indexname))) AS size,
            COALESCE(s.idx_scan, 0)   AS scans,
            COALESCE(s.idx_tup_read, 0) AS tuples_read
        FROM pg_indexes i
        LEFT JOIN pg_stat_user_indexes s ON s.indexrelname = i.indexname
        WHERE i.schemaname = 'public'
        ORDER BY COALESCE(s.idx_scan, 0) ASC, pg_relation_size(quote_ident(i.indexname)) DESC
        LIMIT 50
    """))).fetchall()

    # Sequências de bloqueio / locks ativos
    locks = (await session.execute(text("""
        SELECT pid, state, wait_event_type, wait_event,
               LEFT(query, 120) AS query,
               NOW() - query_start AS duration
        FROM pg_stat_activity
        WHERE state != 'idle' AND pid != pg_backend_pid()
        ORDER BY duration DESC NULLS LAST
        LIMIT 20
    """))).fetchall()

    # Cache hit ratio
    cache = (await session.execute(text("""
        SELECT
            SUM(heap_blks_hit)  AS heap_hit,
            SUM(heap_blks_read) AS heap_read,
            CASE WHEN SUM(heap_blks_hit) + SUM(heap_blks_read) = 0 THEN 0
                 ELSE ROUND(100.0 * SUM(heap_blks_hit)
                      / (SUM(heap_blks_hit) + SUM(heap_blks_read)), 2)
            END AS cache_hit_pct
        FROM pg_statio_user_tables
    """))).fetchone()

    # Contagem real de rows para tabelas principais (amostra rapida via estimate)
    row_counts = (await session.execute(text("""
        SELECT relname, reltuples::bigint AS estimate
        FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
        ORDER BY reltuples DESC
        LIMIT 20
    """))).fetchall()

    return {
        "tables": [
            {
                "name": r[0], "total_size": r[1], "total_bytes": r[2],
                "data_size": r[3], "index_size": r[4],
                "row_estimate": r[5], "dead_rows": r[6],
                "last_vacuum": str(r[7])[:16] if r[7] else None,
                "last_analyze": str(r[8])[:16] if r[8] else None,
            }
            for r in tables
        ],
        "indexes": [
            {
                "name": r[0], "table": r[1], "size": r[2],
                "scans": r[3], "tuples_read": r[4],
            }
            for r in indexes
        ],
        "active_queries": [
            {
                "pid": r[0], "state": r[1],
                "wait_type": r[2], "wait_event": r[3],
                "query": r[4],
                "duration_s": round(r[5].total_seconds(), 1) if r[5] else 0,
            }
            for r in locks
        ],
        "cache": {
            "hit": int(cache[0] or 0),
            "read": int(cache[1] or 0),
            "hit_pct": float(cache[2] or 0),
        },
        "row_counts": [
            {"table": r[0], "estimate": r[1]} for r in row_counts
        ],
    }
