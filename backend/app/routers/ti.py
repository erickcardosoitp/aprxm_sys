import time as _time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import CurrentUser, get_current_user, require_admin_master
from app.database import get_session

router = APIRouter(prefix="/ti", tags=["TI"])


@router.get("/health", summary="Saúde do sistema em tempo real")
async def health_check(
    current: CurrentUser = Depends(require_admin_master),
    session: AsyncSession = Depends(get_session),
) -> dict:
    t0 = _time.monotonic()
    # Ping DB
    try:
        await session.execute(text("SELECT 1"))
        db_ms = round((_time.monotonic() - t0) * 1000)
        db_ok = True
    except Exception:
        db_ms = -1
        db_ok = False

    # Sessoes de caixa abertas
    open_sessions = (await session.execute(
        text("SELECT COUNT(*) FROM cash_sessions WHERE status = 'open'")
    )).scalar() or 0

    # Erros nas ultimas 1h
    errors_1h = (await session.execute(text("""
        SELECT COUNT(*) FROM api_request_logs
        WHERE status_code >= 400 AND created_at > NOW() - INTERVAL '1 hour'
    """))).scalar() or 0

    # Requests na ultima hora
    req_1h = (await session.execute(text("""
        SELECT COUNT(*), ROUND(AVG(duration_ms))
        FROM api_request_logs
        WHERE created_at > NOW() - INTERVAL '1 hour'
    """))).fetchone()

    # Schema migrations status
    migration_row = (await session.execute(text("""
        SELECT COALESCE(MAX(version), 0), MAX(applied_at), MAX(description)
        FROM schema_migrations
    """))).fetchone()

    # Trend horário — últimas 24h em buckets de 1h
    trend_rows = (await session.execute(text("""
        SELECT
            DATE_TRUNC('hour', created_at)              AS hour,
            COUNT(*)                                    AS requests,
            COUNT(*) FILTER (WHERE status_code >= 400) AS errors,
            ROUND(AVG(duration_ms))::int                AS avg_ms
        FROM api_request_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY 1
        ORDER BY 1 ASC
    """))).fetchall()

    # Moradores ativos
    residents_count = (await session.execute(
        text("SELECT COUNT(*) FROM residents WHERE status = 'active'")
    )).scalar() or 0

    # Encomendas pendentes
    packages_pending = (await session.execute(
        text("SELECT COUNT(*) FROM packages WHERE status IN ('received','notified')")
    )).scalar() or 0

    # Tamanho total do banco
    db_size = (await session.execute(
        text("SELECT pg_size_pretty(pg_database_size(current_database()))")
    )).scalar() or "?"

    from app.core.resilience import all_circuit_breakers
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "db": {"ok": db_ok, "ping_ms": db_ms, "size": db_size},
        "api": {"requests_1h": int(req_1h[0] or 0), "avg_ms": int(req_1h[1] or 0), "errors_1h": int(errors_1h)},
        "business": {
            "open_cash_sessions": int(open_sessions),
            "active_residents": int(residents_count),
            "pending_packages": int(packages_pending),
        },
        "migrations": {
            "current_version": int(migration_row[0]),
            "applied_at": migration_row[1].isoformat() if migration_row[1] else None,
            "description": migration_row[2],
        },
        "circuit_breakers": all_circuit_breakers(),
        "trend_24h": [
            {
                "hour": r[0].isoformat() if hasattr(r[0], 'isoformat') else str(r[0]),
                "requests": int(r[1]),
                "errors": int(r[2]),
                "avg_ms": int(r[3] or 0),
            }
            for r in trend_rows
        ],
    }


@router.get("/perf", summary="Tempo médio por endpoint (últimas 24h)")
async def perf_stats(
    current: CurrentUser = Depends(require_admin_master),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT
            method,
            path,
            COUNT(*)                                    AS requests,
            ROUND(AVG(duration_ms))::int                AS avg_ms,
            ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_ms,
            ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms))::int AS p99_ms,
            MAX(duration_ms)                            AS max_ms,
            COUNT(*) FILTER (WHERE status_code >= 400)  AS errors,
            ROUND(100.0 * COUNT(*) FILTER (WHERE status_code >= 400) / COUNT(*), 1) AS error_pct,
            MAX(created_at)                             AS last_seen
        FROM api_request_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY method, path
        ORDER BY avg_ms DESC
        LIMIT 500
    """))).fetchall()
    return [
        {
            "method": r[0], "path": r[1], "requests": r[2],
            "avg_ms": r[3], "p95_ms": r[4], "p99_ms": r[5], "max_ms": r[6],
            "errors": r[7], "error_pct": float(r[8] or 0), "last_seen": r[9].isoformat() if r[9] else None,
        }
        for r in rows
    ]


@router.get("/activity", summary="Atividade de usuários — operações por dia e destaques de busca/login")
async def user_activity(
    current: CurrentUser = Depends(require_admin_master),
    session: AsyncSession = Depends(get_session),
) -> dict:
    # Operações por usuário por dia (últimos 7 dias) — requer user_id populado
    ops_by_user = (await session.execute(text("""
        SELECT
            u.full_name,
            DATE(l.created_at) AS dia,
            COUNT(*)           AS operacoes,
            COUNT(*) FILTER (WHERE l.status_code >= 400) AS erros
        FROM api_request_logs l
        JOIN users u ON u.id = l.user_id::uuid
        WHERE l.created_at > NOW() - INTERVAL '7 days'
          AND l.user_id IS NOT NULL
        GROUP BY u.full_name, DATE(l.created_at)
        ORDER BY dia DESC, operacoes DESC
        LIMIT 200
    """))).fetchall()

    # Total por usuário (últimas 24h)
    ops_24h = (await session.execute(text("""
        SELECT
            u.full_name,
            COUNT(*)  AS operacoes,
            COUNT(*) FILTER (WHERE l.status_code >= 400) AS erros,
            ROUND(AVG(l.duration_ms))::int AS avg_ms,
            MAX(l.created_at) AS ultimo_acesso,
            a.name AS associacao,
            (SELECT MIN(l2.created_at) FROM api_request_logs l2
             WHERE l2.user_id::uuid = u.id) AS primeiro_acesso
        FROM api_request_logs l
        JOIN users u ON u.id = l.user_id::uuid
        JOIN associations a ON a.id = u.association_id
        WHERE l.created_at > NOW() - INTERVAL '24 hours'
          AND l.user_id IS NOT NULL
        GROUP BY u.id, u.full_name, a.name
        ORDER BY operacoes DESC
        LIMIT 50
    """))).fetchall()

    # Destaque: endpoints de busca (últimas 24h)
    search_stats = (await session.execute(text("""
        SELECT
            path,
            COUNT(*)                            AS requests,
            ROUND(AVG(duration_ms))::int        AS avg_ms,
            ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_ms,
            MAX(duration_ms)                    AS max_ms
        FROM api_request_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
          AND (path ILIKE '%search%' OR path ILIKE '%buscar%' OR path ILIKE '%/residents%' AND method = 'GET')
        GROUP BY path
        ORDER BY avg_ms DESC
        LIMIT 20
    """))).fetchall()

    # Destaque: login/acesso ao sistema (últimas 24h)
    login_stats = (await session.execute(text("""
        SELECT
            COUNT(*)                            AS total_logins,
            COUNT(*) FILTER (WHERE status_code = 200) AS sucesso,
            COUNT(*) FILTER (WHERE status_code >= 400) AS falhas,
            ROUND(AVG(duration_ms))::int        AS avg_ms,
            ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS p95_ms,
            MAX(duration_ms)                    AS max_ms
        FROM api_request_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
          AND path ILIKE '%/auth/login%'
    """))).fetchone()

    return {
        "ops_by_user_7d": [
            {"nome": r[0], "dia": str(r[1]), "operacoes": r[2], "erros": r[3]}
            for r in ops_by_user
        ],
        "ops_24h": [
            {
                "nome": r[0], "operacoes": r[1], "erros": r[2],
                "avg_ms": r[3], "ultimo_acesso": r[4].isoformat() if r[4] else None,
                "associacao": r[5],
                "primeiro_acesso": r[6].isoformat() if r[6] else None,
            }
            for r in ops_24h
        ],
        "search_stats": [
            {"path": r[0], "requests": r[1], "avg_ms": r[2], "p95_ms": r[3], "max_ms": r[4]}
            for r in search_stats
        ],
        "login_stats": {
            "total": login_stats[0] or 0,
            "sucesso": login_stats[1] or 0,
            "falhas": login_stats[2] or 0,
            "avg_ms": login_stats[3] or 0,
            "p95_ms": login_stats[4] or 0,
            "max_ms": login_stats[5] or 0,
        } if login_stats else None,
    }


@router.get("/routes", summary="Listar todos os endpoints registrados")
async def list_routes(
    request: Request,
    current: CurrentUser = Depends(require_admin_master),
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
    current: CurrentUser = Depends(require_admin_master),
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

    # Seq scan candidates — tabelas com muitos seq scans e > 1k rows (índice provavelmente faltando)
    seq_scans = (await session.execute(text("""
        SELECT
            relname                                                          AS table_name,
            seq_scan,
            COALESCE(idx_scan, 0)                                           AS idx_scan,
            n_live_tup                                                       AS live_rows,
            CASE WHEN seq_scan + COALESCE(idx_scan, 0) = 0 THEN 0
                 ELSE ROUND(100.0 * seq_scan / (seq_scan + COALESCE(idx_scan, 0)), 1)
            END                                                             AS seq_pct
        FROM pg_stat_user_tables
        WHERE n_live_tup > 500
          AND seq_scan > 50
        ORDER BY seq_scan DESC
        LIMIT 15
    """))).fetchall()

    # Saturação de conexões
    conn_stats = (await session.execute(text("""
        SELECT
            COUNT(*)                                        AS total,
            COUNT(*) FILTER (WHERE state = 'active')       AS active,
            COUNT(*) FILTER (WHERE state = 'idle')         AS idle,
            COUNT(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_tx,
            (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn
        FROM pg_stat_activity
        WHERE datname = current_database()
    """))).fetchone()

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
        "seq_scan_candidates": [
            {
                "table": r[0], "seq_scan": int(r[1]), "idx_scan": int(r[2]),
                "live_rows": int(r[3]), "seq_pct": float(r[4]),
            }
            for r in seq_scans
        ],
        "connections": {
            "total": int(conn_stats[0] or 0),
            "active": int(conn_stats[1] or 0),
            "idle": int(conn_stats[2] or 0),
            "idle_in_tx": int(conn_stats[3] or 0),
            "max_conn": int(conn_stats[4] or 100),
            "saturation_pct": round(100.0 * int(conn_stats[0] or 0) / int(conn_stats[4] or 100), 1),
        },
    }


@router.get("/errors", summary="Últimos erros da API — 4xx e 5xx nas últimas 24h")
async def recent_errors(
    current: CurrentUser = Depends(require_admin_master),
    session: AsyncSession = Depends(get_session),
) -> dict:
    rows = (await session.execute(text("""
        SELECT
            l.path,
            l.method,
            l.status_code,
            l.duration_ms,
            u.full_name   AS user_name,
            l.created_at
        FROM api_request_logs l
        LEFT JOIN users u ON u.id = l.user_id::uuid
        WHERE l.status_code >= 400
          AND l.created_at > NOW() - INTERVAL '24 hours'
        ORDER BY l.created_at DESC
        LIMIT 100
        -- timestamps retornados em UTC; frontend ou AT TIME ZONE converte
    """))).fetchall()

    # Agrupamento por status code
    by_status = (await session.execute(text("""
        SELECT status_code, COUNT(*) AS n
        FROM api_request_logs
        WHERE status_code >= 400
          AND created_at > NOW() - INTERVAL '24 hours'
        GROUP BY status_code
        ORDER BY n DESC
    """))).fetchall()

    # Top paths com erro
    top_paths = (await session.execute(text("""
        SELECT path, method, status_code, COUNT(*) AS n
        FROM api_request_logs
        WHERE status_code >= 400
          AND created_at > NOW() - INTERVAL '24 hours'
        GROUP BY path, method, status_code
        ORDER BY n DESC
        LIMIT 15
    """))).fetchall()

    return {
        "recent": [
            {
                "path": r[0], "method": r[1], "status": r[2],
                "duration_ms": r[3], "user": r[4],
                "at": r[5].isoformat() if r[5] else None,
            }
            for r in rows
        ],
        "by_status": [{"status": r[0], "count": int(r[1])} for r in by_status],
        "top_paths": [
            {"path": r[0], "method": r[1], "status": r[2], "count": int(r[3])}
            for r in top_paths
        ],
    }


VACUUM_TABLES = [
    "associations",
    "users",
    "association_settings",
    "cash_boxes",
    "transaction_categories",
    "payment_methods",
    "service_order_phases",
    "residents",
    "packages",
    "service_orders",
    "mensalidades",
    "demands",
    "daily_tasks",
    "finance_transactions",
    "bank_statements",
]


@router.get("/analytics", summary="APDEX + atividade 7d + receita diária por associação")
async def analytics(
    assoc_id: str | None = None,
    current: CurrentUser = Depends(require_admin_master),
    session: AsyncSession = Depends(get_session),
) -> dict:
    # Lista de associações disponíveis
    assocs = (await session.execute(text(
        "SELECT id, name FROM associations ORDER BY name"
    ))).fetchall()

    # Filtro de associação
    assoc_filter = ""
    assoc_params: dict = {}
    if assoc_id:
        assoc_filter = "AND association_id = :assoc_id"
        assoc_params["assoc_id"] = assoc_id

    # APDEX global últimas 24h (T=300ms)
    apdex_row = (await session.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE duration_ms <= 300)          AS satisfied,
            COUNT(*) FILTER (WHERE duration_ms BETWEEN 301 AND 1200) AS tolerating,
            COUNT(*) AS total
        FROM api_request_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
    """))).fetchone()
    satisfied, tolerating, total = int(apdex_row[0] or 0), int(apdex_row[1] or 0), int(apdex_row[2] or 1)
    apdex = round((satisfied + tolerating / 2) / max(total, 1), 3)
    apdex_rating = "Excelente" if apdex >= 0.94 else "Bom" if apdex >= 0.85 else "Regular" if apdex >= 0.7 else "Ruim"

    # Atividade por dia — 7d (ops + erros)
    ops_7d = (await session.execute(text(f"""
        SELECT
            DATE(l.created_at AT TIME ZONE 'America/Sao_Paulo') AS dia,
            COUNT(*) AS operacoes,
            COUNT(*) FILTER (WHERE l.status_code >= 400) AS erros,
            ROUND(AVG(l.duration_ms))::int AS avg_ms
        FROM api_request_logs l
        JOIN users u ON u.id = l.user_id::uuid
        WHERE l.created_at > NOW() - INTERVAL '7 days'
          AND l.user_id IS NOT NULL
          {assoc_filter.replace('association_id', 'u.association_id')}
        GROUP BY DATE(l.created_at AT TIME ZONE 'America/Sao_Paulo')
        ORDER BY dia ASC
    """), assoc_params)).fetchall()

    # Receita diária — 7d
    receita_7d = (await session.execute(text(f"""
        SELECT
            DATE(transaction_at AT TIME ZONE 'America/Sao_Paulo') AS dia,
            SUM(amount) AS total
        FROM transactions
        WHERE type = 'income'
          AND is_reversal = false
          AND transaction_at > NOW() - INTERVAL '7 days'
          {assoc_filter}
        GROUP BY DATE(transaction_at AT TIME ZONE 'America/Sao_Paulo')
        ORDER BY dia ASC
    """), assoc_params)).fetchall()

    # APDEX por dia — 7d
    apdex_7d = (await session.execute(text("""
        SELECT
            DATE(created_at AT TIME ZONE 'America/Sao_Paulo') AS dia,
            COUNT(*) FILTER (WHERE duration_ms <= 300)               AS satisfied,
            COUNT(*) FILTER (WHERE duration_ms BETWEEN 301 AND 1200) AS tolerating,
            COUNT(*) AS total
        FROM api_request_logs
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY DATE(created_at AT TIME ZONE 'America/Sao_Paulo')
        ORDER BY dia ASC
    """))).fetchall()

    apdex_by_day = {}
    for r in apdex_7d:
        s, t, tot = int(r[1] or 0), int(r[2] or 0), int(r[3] or 1)
        apdex_by_day[str(r[0])] = round((s + t / 2) / max(tot, 1), 3)

    return {
        "associacoes": [{"id": str(r[0]), "name": r[1]} for r in assocs],
        "apdex": {"score": apdex, "rating": apdex_rating, "total_requests": total},
        "dias": [
            {
                "dia": str(r[0]),
                "operacoes": int(r[1]),
                "erros": int(r[2]),
                "avg_ms": int(r[3] or 0),
                "apdex": apdex_by_day.get(str(r[0]), None),
            }
            for r in ops_7d
        ],
        "receita": [
            {"dia": str(r[0]), "total": float(r[1])}
            for r in receita_7d
        ],
    }


@router.post("/vacuum", summary="VACUUM ANALYZE nas tabelas principais (cron semanal)")
async def run_vacuum(request: Request) -> dict:
    import os
    from app.database import engine

    secret = os.environ.get("CRON_SECRET", "")
    if secret:
        auth = request.headers.get("x-cron-secret", "")
        if auth != secret:
            from fastapi import HTTPException
            raise HTTPException(status_code=401, detail="Não autorizado.")

    results = []
    # VACUUM must run outside a transaction — use AUTOCOMMIT isolation
    async with engine.connect() as conn:
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        for table in VACUUM_TABLES:
            try:
                await conn.execute(text(f"VACUUM ANALYZE {table}"))
                results.append({"table": table, "ok": True})
            except Exception as exc:
                results.append({"table": table, "ok": False, "error": str(exc)})

    ok_count = sum(1 for r in results if r["ok"])
    return {
        "vacuumed": ok_count,
        "total": len(VACUUM_TABLES),
        "results": results,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
