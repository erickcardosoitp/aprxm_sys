"""
Data Lake Service — ETL Bronze > Silver > Gold para Cloudflare R2.

Estrutura Medallion Architecture:
  bronze/{data}/  <- copia exata do banco (UMA query por tabela)
  silver/{data}/  <- transformado EM MEMORIA a partir do bronze (zero queries extras)
  gold/latest/    <- KPIs agregados prontos para Power BI (GROUP BY leves)

Impacto Neon estimado: ~2.7 MB/run x 2 runs/dia = ~37 MB/semana (~0.7% do limite 5GB)
"""
import io
import json
import logging
from datetime import date, datetime, timezone

import boto3
import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def _r2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
    )


def _upload(client, df: pd.DataFrame, key: str) -> int:
    if df.empty:
        return 0
    buf = io.BytesIO()
    df.to_parquet(buf, index=False, engine="pyarrow", compression="snappy")
    buf.seek(0)
    client.put_object(
        Bucket=settings.r2_bucket_name,
        Key=key,
        Body=buf.getvalue(),
        ContentType="application/octet-stream",
    )
    logger.info("R2 upload: %s (%d rows, %.1f KB)", key, len(df), len(buf.getvalue()) / 1024)
    return len(df)


async def _fetch(session: AsyncSession, sql: str) -> pd.DataFrame:
    rows = (await session.execute(text(sql))).fetchall()
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows, columns=list(rows[0]._mapping.keys()))


# ── BRONZE — uma query por tabela ─────────────────────────────────────────────

async def export_bronze(session: AsyncSession, today: str) -> tuple[dict, dict]:
    stats = {}
    frames: dict[str, pd.DataFrame] = {}
    client = _r2_client()

    tables = {
        "associations": """
            SELECT id, name, slug, is_active, simplifica_enabled, created_at
            FROM associations WHERE is_active = TRUE
        """,
        "users": """
            SELECT id, full_name, email, role, association_id, is_active, created_at
            FROM users WHERE is_active = TRUE
        """,
        "payment_methods": "SELECT id, name, is_active, association_id FROM payment_methods WHERE is_active = TRUE",
        "transaction_categories": "SELECT id, name, type, association_id FROM transaction_categories WHERE is_active = TRUE",
        "residents": """
            SELECT id, association_id, type, status, full_name, cpf, unit, block,
                   address_street, address_neighborhood, address_city, address_cep,
                   phone_primary, email, monthly_payment_day, is_member_confirmed,
                   internet_access, has_sewage, has_pests, uses_public_transport,
                   neighborhood_problems, move_in_date, move_out_date,
                   created_at, updated_at
            FROM residents
        """,
        "mensalidades": """
            SELECT id, association_id, resident_id, reference_month, due_date,
                   amount::float AS amount, status, paid_at, created_at
            FROM mensalidades
        """,
        "transactions": """
            SELECT id, association_id, cash_session_id, type, income_subtype,
                   amount::float AS amount, description, transaction_at,
                   payment_method_id, category_id, resident_id,
                   is_reversal, reversed_at, reversed_by,
                   sangria_reason, sangria_destination,
                   approval_status, created_by, created_at
            FROM transactions
            WHERE created_at > NOW() - INTERVAL '12 months'
        """,
        "cash_sessions": """
            SELECT id, association_id, opened_by, closed_by, status,
                   opening_balance::float, closing_balance::float,
                   expected_balance::float, difference::float,
                   quebra_caixa::float, notes,
                   opened_at, closed_at, created_at
            FROM cash_sessions
            WHERE opened_at > NOW() - INTERVAL '12 months'
        """,
        "packages": """
            SELECT id, association_id, status, unit, block,
                   carrier_name, tracking_code, has_delivery_fee,
                   delivery_fee_amount::float, delivery_fee_paid,
                   received_at, delivered_at, returned_at,
                   resident_id, received_by, delivered_by,
                   delivered_to_name
            FROM packages
            WHERE received_at > NOW() - INTERVAL '12 months'
        """,
        "daily_tasks": """
            SELECT id, association_id, title, description,
                   assigned_to, assigned_to_name, due_date, status,
                   checklist, service_order_id,
                   created_by, created_at, updated_at, deleted_at
            FROM daily_tasks
            WHERE created_at > NOW() - INTERVAL '12 months'
        """,
        "service_orders": """
            SELECT id, association_id, number, title, status, priority,
                   area, unit, requester_name, assigned_to,
                   created_at, updated_at
            FROM service_orders
            WHERE status NOT IN ('cancelled', 'archived')
        """,
    }

    for name, sql in tables.items():
        df = await _fetch(session, sql)
        frames[name] = df
        if not df.empty:
            stats[name] = _upload(client, df, f"bronze/{today}/{name}.parquet")
        else:
            stats[name] = 0

    return stats, frames


# ── SILVER — transformacao em memoria ─────────────────────────────────────────

def _parse_jsonb_list(val) -> list:
    if val is None:
        return []
    if isinstance(val, list):
        return val
    try:
        return json.loads(val)
    except Exception:
        return []


def build_silver(frames: dict[str, pd.DataFrame], today: str, client) -> dict:
    stats = {}

    assocs  = frames.get("associations", pd.DataFrame())
    users   = frames.get("users", pd.DataFrame())
    pm      = frames.get("payment_methods", pd.DataFrame())
    cats    = frames.get("transaction_categories", pd.DataFrame())
    res     = frames.get("residents", pd.DataFrame())
    mens    = frames.get("mensalidades", pd.DataFrame())
    tx      = frames.get("transactions", pd.DataFrame())
    cs      = frames.get("cash_sessions", pd.DataFrame())
    pkgs    = frames.get("packages", pd.DataFrame())
    tasks   = frames.get("daily_tasks", pd.DataFrame())

    assoc_map = assocs.set_index("id")["name"].to_dict() if not assocs.empty else {}
    user_map  = users.set_index("id")["full_name"].to_dict() if not users.empty else {}

    # transactions_enriched
    if not tx.empty:
        df = tx.copy()
        df = df[df["reversed_at"].isna() & (~df["is_reversal"])]
        df["association_name"] = df["association_id"].map(assoc_map)
        df["created_by_name"]  = df["created_by"].map(user_map)
        if not res.empty:
            df = df.merge(
                res[["id", "full_name", "type", "unit"]].rename(
                    columns={"id": "resident_id", "full_name": "resident_name", "type": "resident_type"}),
                on="resident_id", how="left")
        if not pm.empty:
            df = df.merge(
                pm[["id", "name"]].rename(columns={"id": "payment_method_id", "name": "payment_method_name"}),
                on="payment_method_id", how="left")
        if not cats.empty:
            df = df.merge(
                cats[["id", "name"]].rename(columns={"id": "category_id", "name": "category_name"}),
                on="category_id", how="left")
        df["date"]         = pd.to_datetime(df["transaction_at"]).dt.normalize()
        df["week"]         = pd.to_datetime(df["transaction_at"]).dt.to_period("W").apply(lambda x: x.start_time)
        df["month"]        = pd.to_datetime(df["transaction_at"]).dt.to_period("M").apply(lambda x: x.start_time)
        df["hour"]         = pd.to_datetime(df["transaction_at"]).dt.hour
        df["day_of_week"]  = pd.to_datetime(df["transaction_at"]).dt.day_name()
        stats["transactions_enriched"] = _upload(client, df, f"silver/{today}/transactions_enriched.parquet")

    # packages_enriched — com SLA e tipo do morador
    if not pkgs.empty:
        df = pkgs.copy()
        df["association_name"] = df["association_id"].map(assoc_map)
        df["received_by_name"] = df["received_by"].map(user_map)
        df["delivered_by_name"] = df["delivered_by"].map(user_map)
        if not res.empty:
            df = df.merge(
                res[["id", "full_name", "type"]].rename(
                    columns={"id": "resident_id", "full_name": "resident_name", "type": "resident_type"}),
                on="resident_id", how="left")
        df["received_at"]  = pd.to_datetime(df["received_at"])
        df["delivered_at"] = pd.to_datetime(df["delivered_at"])
        df["wait_hours"]   = (df["delivered_at"] - df["received_at"]).dt.total_seconds() / 3600
        df["received_date"] = df["received_at"].dt.date
        df["received_week"] = df["received_at"].dt.to_period("W").apply(lambda x: x.start_time)
        df["received_month"] = df["received_at"].dt.to_period("M").apply(lambda x: x.start_time)
        stats["packages_enriched"] = _upload(client, df, f"silver/{today}/packages_enriched.parquet")

    # residents_clean — com inadimplencia e campos de censo parseados
    if not res.empty:
        df = res.copy()
        df["association_name"] = df["association_id"].map(assoc_map)
        # Inadimplencia
        if not mens.empty:
            today_ts = pd.Timestamp.now().normalize()
            overdue = mens[
                (mens["status"] == "pending") &
                (pd.to_datetime(mens["due_date"]) < today_ts)
            ].groupby("resident_id").agg(
                overdue_months=("id", "count"),
                total_owed=("amount", "sum")
            ).reset_index()
            df = df.merge(overdue, left_on="id", right_on="resident_id", how="left")
            df["overdue_months"] = df["overdue_months"].fillna(0).astype(int)
            df["total_owed"]     = df["total_owed"].fillna(0)
        # Census: parseia JSONB arrays
        df["neighborhood_problems_list"] = df["neighborhood_problems"].apply(_parse_jsonb_list)
        df["problem_count"] = df["neighborhood_problems_list"].apply(len)
        df["has_problems"]  = df["problem_count"] > 0
        df["sem_internet"]  = df["internet_access"].isin(["Sem acesso", "Nenhum", None]) | df["internet_access"].isna()
        df["tempo_casa_anos"] = (pd.Timestamp.now() - pd.to_datetime(df["move_in_date"])).dt.days / 365
        stats["residents_clean"] = _upload(client, df, f"silver/{today}/residents_clean.parquet")

    # daily_tasks_enriched
    if not tasks.empty:
        df = tasks.copy()
        df["association_name"] = df["association_id"].map(assoc_map)
        df["created_by_name"]  = df["created_by"].map(user_map)
        df["is_deleted"]       = df["deleted_at"].notna()
        df["week"]             = pd.to_datetime(df["created_at"]).dt.to_period("W").apply(lambda x: x.start_time)
        df["month"]            = pd.to_datetime(df["created_at"]).dt.to_period("M").apply(lambda x: x.start_time)
        df["overdue"] = (
            df["status"] != "done"
        ) & (
            pd.to_datetime(df["due_date"]).notna()
        ) & (
            pd.to_datetime(df["due_date"]) < pd.Timestamp.now().normalize()
        )
        stats["daily_tasks_enriched"] = _upload(client, df, f"silver/{today}/daily_tasks_enriched.parquet")

    # cash_sessions_enriched
    if not cs.empty:
        df = cs.copy()
        df["association_name"] = df["association_id"].map(assoc_map)
        df["operador_name"]    = df["opened_by"].map(user_map)
        df["tem_quebra"]       = df["quebra_caixa"].notna() & (df["quebra_caixa"] != 0)
        df["tem_diferenca"]    = df["difference"].notna() & (df["difference"].abs() > 0.01)
        df["week"]             = pd.to_datetime(df["opened_at"]).dt.to_period("W").apply(lambda x: x.start_time)
        df["month"]            = pd.to_datetime(df["opened_at"]).dt.to_period("M").apply(lambda x: x.start_time)
        stats["cash_sessions_enriched"] = _upload(client, df, f"silver/{today}/cash_sessions_enriched.parquet")

    return stats


# ── GOLD — KPIs agregados (queries leves) + metricas calculadas ───────────────

async def export_gold(session: AsyncSession) -> dict:
    stats = {}
    client = _r2_client()

    # 1. RECEITA DIARIA E SEMANAL
    df = await _fetch(session, """
        SELECT DATE(t.transaction_at) AS date,
               DATE_TRUNC('week', t.transaction_at) AS week,
               DATE_TRUNC('month', t.transaction_at) AS month,
               t.association_id, a.name AS association_name,
               SUM(t.amount::float) FILTER (WHERE t.type='income' AND t.reversed_at IS NULL AND NOT t.is_reversal) AS total_income,
               SUM(t.amount::float) FILTER (WHERE t.type IN ('expense','sangria') AND t.reversed_at IS NULL AND NOT t.is_reversal) AS total_expense,
               SUM(t.amount::float) FILTER (WHERE t.income_subtype='mensalidade' AND t.reversed_at IS NULL) AS mensalidade_income,
               SUM(t.amount::float) FILTER (WHERE t.income_subtype='delivery_fee' AND t.reversed_at IS NULL) AS delivery_fee_income,
               SUM(t.amount::float) FILTER (WHERE t.income_subtype='proof_of_residence' AND t.reversed_at IS NULL) AS proof_income,
               COUNT(*) FILTER (WHERE t.type='income' AND t.reversed_at IS NULL) AS income_count,
               COUNT(*) FILTER (WHERE t.type='expense' AND t.reversed_at IS NULL) AS expense_count,
               COUNT(*) FILTER (WHERE t.type='sangria' AND t.reversed_at IS NULL) AS sangria_count,
               SUM(t.amount::float) FILTER (WHERE t.type='sangria' AND t.reversed_at IS NULL) AS sangria_total
        FROM transactions t JOIN associations a ON a.id = t.association_id
        WHERE t.created_at > NOW() - INTERVAL '12 months'
        GROUP BY DATE(t.transaction_at), DATE_TRUNC('week', t.transaction_at),
                 DATE_TRUNC('month', t.transaction_at), t.association_id, a.name
        ORDER BY date DESC
    """)
    if not df.empty:
        df["net"] = df["total_income"].fillna(0) - df["total_expense"].fillna(0)
        stats["daily_revenue"] = _upload(client, df, "gold/latest/daily_revenue.parquet")

    # 2. CRESCIMENTO SEMANAL DE ASSOCIADOS (retencao por diferenca)
    df = await _fetch(session, """
        SELECT DATE_TRUNC('week', created_at) AS week,
               association_id, a.name AS association_name,
               type,
               COUNT(*) AS novos
        FROM residents r JOIN associations a ON a.id = r.association_id
        WHERE created_at > NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('week', created_at), r.association_id, a.name, r.type
        ORDER BY week DESC
    """)
    if not df.empty:
        stats["member_growth_weekly"] = _upload(client, df, "gold/latest/member_growth_weekly.parquet")

    # 3. RETENCAO — snapshot atual por associacao
    df = await _fetch(session, """
        SELECT a.name AS association_name, a.id AS association_id,
               COUNT(r.id) AS total_ativos,
               COUNT(r.id) FILTER (WHERE r.type='member') AS members,
               COUNT(r.id) FILTER (WHERE r.type='guest') AS guests,
               COUNT(r.id) FILTER (WHERE r.type='dependent') AS dependents,
               COUNT(r.id) FILTER (WHERE r.is_member_confirmed) AS confirmed_members,
               COUNT(r.id) FILTER (WHERE r.status='inactive') AS inativos,
               COUNT(r.id) FILTER (WHERE DATE_TRUNC('month', r.created_at) = DATE_TRUNC('month', NOW())) AS novos_mes,
               COUNT(r.id) FILTER (WHERE DATE_TRUNC('week', r.created_at) = DATE_TRUNC('week', NOW())) AS novos_semana
        FROM residents r JOIN associations a ON a.id = r.association_id
        WHERE r.status IN ('active','inactive')
        GROUP BY a.id, a.name
    """)
    if not df.empty:
        stats["resident_overview"] = _upload(client, df, "gold/latest/resident_overview.parquet")

    # 4. TAXA DE COBRANCA MENSAL
    df = await _fetch(session, """
        SELECT DATE_TRUNC('month', COALESCE(paid_at, due_date)) AS month,
               m.association_id, a.name AS association_name,
               COUNT(*) AS total_esperado,
               COUNT(*) FILTER (WHERE m.status='paid') AS cobrado,
               SUM(m.amount::float) AS valor_esperado,
               SUM(m.amount::float) FILTER (WHERE m.status='paid') AS valor_cobrado,
               ROUND(100.0 * COUNT(*) FILTER (WHERE m.status='paid') / NULLIF(COUNT(*),0), 1) AS taxa_cobranca_pct
        FROM mensalidades m JOIN associations a ON a.id = m.association_id
        GROUP BY DATE_TRUNC('month', COALESCE(paid_at, due_date)), m.association_id, a.name
        ORDER BY month DESC
    """)
    if not df.empty:
        stats["collection_rate"] = _upload(client, df, "gold/latest/collection_rate.parquet")

    # 5. INADIMPLENCIA DETALHADA
    df = await _fetch(session, """
        SELECT r.full_name, r.unit, r.block, r.phone_primary, r.type,
               r.address_street, r.association_id, a.name AS association_name,
               COUNT(m.id) AS overdue_months,
               SUM(m.amount::float) AS total_owed,
               MIN(m.due_date) AS oldest_due
        FROM residents r
        JOIN mensalidades m ON m.resident_id = r.id
        JOIN associations a ON a.id = r.association_id
        WHERE m.status='pending' AND m.due_date < CURRENT_DATE AND r.status='active'
        GROUP BY r.id, r.full_name, r.unit, r.block, r.phone_primary,
                 r.type, r.address_street, r.association_id, a.name
        ORDER BY total_owed DESC
    """)
    if not df.empty:
        stats["delinquency_report"] = _upload(client, df, "gold/latest/delinquency_report.parquet")

    # 6. SLA ENCOMENDAS POR TIPO DE MORADOR E SEMANA
    df = await _fetch(session, """
        SELECT DATE_TRUNC('week', p.received_at) AS week,
               p.association_id, a.name AS association_name,
               r.type AS resident_type,
               COUNT(*) FILTER (WHERE p.status='delivered') AS entregues,
               AVG(EXTRACT(EPOCH FROM (p.delivered_at - p.received_at))/3600)
                   FILTER (WHERE p.status='delivered' AND p.delivered_at IS NOT NULL) AS avg_wait_hours,
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY
                   EXTRACT(EPOCH FROM (p.delivered_at - p.received_at))/3600)
                   FILTER (WHERE p.status='delivered' AND p.delivered_at IS NOT NULL) AS median_wait_hours,
               COUNT(*) FILTER (WHERE p.status IN ('received','notified')
                   AND p.received_at < NOW() - INTERVAL '3 days') AS paradas_3_dias,
               COUNT(*) FILTER (WHERE p.status IN ('received','notified')
                   AND p.received_at < NOW() - INTERVAL '7 days') AS paradas_7_dias
        FROM packages p
        LEFT JOIN residents r ON r.id = p.resident_id
        JOIN associations a ON a.id = p.association_id
        WHERE p.received_at > NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('week', p.received_at), p.association_id, a.name, r.type
        ORDER BY week DESC
    """)
    if not df.empty:
        stats["sla_by_type"] = _upload(client, df, "gold/latest/sla_by_type.parquet")

    # 7. RANKING MORADORES — encomendas e velocidade de retirada
    df = await _fetch(session, """
        SELECT r.full_name, r.unit, r.type AS resident_type,
               r.address_street, p.association_id, a.name AS association_name,
               COUNT(*) AS total_packages,
               AVG(EXTRACT(EPOCH FROM (p.delivered_at - p.received_at))/3600)
                   FILTER (WHERE p.status='delivered') AS avg_wait_hours,
               COUNT(*) FILTER (WHERE p.status='delivered') AS delivered_count,
               COUNT(*) FILTER (WHERE p.status IN ('received','notified')) AS pending_now
        FROM packages p
        JOIN residents r ON r.id = p.resident_id
        JOIN associations a ON a.id = p.association_id
        WHERE p.received_at > NOW() - INTERVAL '12 months'
        GROUP BY r.id, r.full_name, r.unit, r.type, r.address_street, p.association_id, a.name
        ORDER BY total_packages DESC
        LIMIT 200
    """)
    if not df.empty:
        stats["resident_package_ranking"] = _upload(client, df, "gold/latest/resident_package_ranking.parquet")

    # 8. ENCOMENDAS POR RUA
    df = await _fetch(session, """
        SELECT COALESCE(NULLIF(TRIM(r.address_street), ''), 'Nao informado') AS street,
               p.association_id, a.name AS association_name,
               COUNT(*) AS total_packages,
               COUNT(DISTINCT r.id) AS distinct_residents,
               COUNT(*) FILTER (WHERE r.type='guest') AS guest_packages,
               COUNT(*) FILTER (WHERE r.type='member') AS member_packages,
               AVG(EXTRACT(EPOCH FROM (p.delivered_at - p.received_at))/3600)
                   FILTER (WHERE p.status='delivered') AS avg_wait_hours
        FROM packages p
        LEFT JOIN residents r ON r.id = p.resident_id
        JOIN associations a ON a.id = p.association_id
        WHERE p.received_at > NOW() - INTERVAL '12 months'
        GROUP BY COALESCE(NULLIF(TRIM(r.address_street), ''), 'Nao informado'), p.association_id, a.name
        ORDER BY total_packages DESC
    """)
    if not df.empty:
        stats["packages_by_street"] = _upload(client, df, "gold/latest/packages_by_street.parquet")

    # 9. PERFORMANCE DE OPERADORES
    df = await _fetch(session, """
        SELECT u.full_name AS operador, u.id AS user_id,
               u.association_id, a.name AS association_name,
               COUNT(DISTINCT cs.id) AS sessoes_abertas,
               COUNT(DISTINCT cs.id) FILTER (WHERE cs.status='conferido') AS sessoes_conferidas,
               COUNT(DISTINCT p_rec.id) AS enc_recebidas,
               COUNT(DISTINCT p_del.id) AS enc_entregues
        FROM users u
        JOIN associations a ON a.id = u.association_id
        LEFT JOIN cash_sessions cs ON cs.opened_by = u.id
            AND cs.opened_at > NOW() - INTERVAL '12 months'
        LEFT JOIN packages p_rec ON p_rec.received_by = u.id
            AND p_rec.received_at > NOW() - INTERVAL '12 months'
        LEFT JOIN packages p_del ON p_del.delivered_by = u.id
            AND p_del.delivered_at > NOW() - INTERVAL '12 months'
        WHERE u.role = 'operator' AND u.is_active = TRUE
        GROUP BY u.id, u.full_name, u.association_id, a.name
    """)
    if not df.empty:
        stats["operator_performance"] = _upload(client, df, "gold/latest/operator_performance.parquet")

    # 10. RECEITA POR OPERADOR (query separada para evitar cartesian product)
    df = await _fetch(session, """
        SELECT u.full_name AS operador, u.association_id, a.name AS association_name,
               SUM(t.amount::float) FILTER (WHERE t.type='income' AND t.reversed_at IS NULL) AS receita_gerada,
               SUM(t.amount::float) FILTER (WHERE t.type IN ('expense','sangria') AND t.reversed_at IS NULL) AS saidas,
               COUNT(*) FILTER (WHERE t.type='income' AND t.reversed_at IS NULL) AS transacoes_entrada,
               DATE_TRUNC('week', t.transaction_at) AS week
        FROM transactions t
        JOIN users u ON u.id = t.created_by
        JOIN associations a ON a.id = u.association_id
        WHERE t.created_at > NOW() - INTERVAL '12 months'
          AND u.role = 'operator'
        GROUP BY u.id, u.full_name, u.association_id, a.name, DATE_TRUNC('week', t.transaction_at)
        ORDER BY week DESC, receita_gerada DESC NULLS LAST
    """)
    if not df.empty:
        stats["operator_revenue"] = _upload(client, df, "gold/latest/operator_revenue.parquet")

    # 11. QUEBRA DE CAIXA — incidencia e valores
    df = await _fetch(session, """
        SELECT DATE_TRUNC('week', cs.opened_at) AS week,
               cs.association_id, a.name AS association_name,
               u.full_name AS operador,
               COUNT(*) AS total_sessoes,
               COUNT(*) FILTER (WHERE ABS(cs.difference) > 0.01) AS com_diferenca,
               COUNT(*) FILTER (WHERE cs.quebra_caixa IS NOT NULL AND cs.quebra_caixa != 0) AS com_quebra,
               SUM(ABS(cs.difference)) FILTER (WHERE cs.difference IS NOT NULL) AS total_diferenca,
               SUM(ABS(cs.quebra_caixa)) FILTER (WHERE cs.quebra_caixa IS NOT NULL) AS total_quebra,
               ROUND(100.0 * COUNT(*) FILTER (WHERE ABS(cs.difference) > 0.01) /
                   NULLIF(COUNT(*), 0), 1) AS pct_com_diferenca
        FROM cash_sessions cs
        JOIN associations a ON a.id = cs.association_id
        LEFT JOIN users u ON u.id = cs.opened_by
        WHERE cs.status IN ('closed','conferido')
          AND cs.opened_at > NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('week', cs.opened_at), cs.association_id, a.name, u.full_name
        ORDER BY week DESC
    """)
    if not df.empty:
        stats["cash_breaks"] = _upload(client, df, "gold/latest/cash_breaks.parquet")

    # 12. MOTIVOS DE BAIXAS (sangrias)
    df = await _fetch(session, """
        SELECT COALESCE(NULLIF(TRIM(t.sangria_reason), ''), 'Nao informado') AS motivo,
               COALESCE(NULLIF(TRIM(t.sangria_destination), ''), 'Nao informado') AS destino,
               t.association_id, a.name AS association_name,
               DATE_TRUNC('month', t.transaction_at) AS month,
               COUNT(*) AS ocorrencias,
               SUM(t.amount::float) AS valor_total
        FROM transactions t
        JOIN associations a ON a.id = t.association_id
        WHERE t.type = 'sangria' AND t.reversed_at IS NULL
          AND t.created_at > NOW() - INTERVAL '12 months'
        GROUP BY COALESCE(NULLIF(TRIM(t.sangria_reason), ''), 'Nao informado'),
                 COALESCE(NULLIF(TRIM(t.sangria_destination), ''), 'Nao informado'),
                 t.association_id, a.name,
                 DATE_TRUNC('month', t.transaction_at)
        ORDER BY valor_total DESC
    """)
    if not df.empty:
        stats["sangria_reasons"] = _upload(client, df, "gold/latest/sangria_reasons.parquet")

    # 13. TAREFAS DIARIAS — resumo semanal
    df = await _fetch(session, """
        SELECT DATE_TRUNC('week', created_at) AS week,
               association_id, a.name AS association_name,
               COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total_ativas,
               COUNT(*) FILTER (WHERE status='done' AND deleted_at IS NULL) AS concluidas,
               COUNT(*) FILTER (WHERE status='pending' AND deleted_at IS NULL) AS pendentes,
               COUNT(*) FILTER (WHERE status='in_progress' AND deleted_at IS NULL) AS em_andamento,
               COUNT(*) FILTER (WHERE status='blocked' AND deleted_at IS NULL) AS bloqueadas,
               COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS deletadas,
               ROUND(100.0 * COUNT(*) FILTER (WHERE status='done' AND deleted_at IS NULL) /
                   NULLIF(COUNT(*) FILTER (WHERE deleted_at IS NULL), 0), 1) AS pct_conclusao
        FROM daily_tasks dt JOIN associations a ON a.id = dt.association_id
        WHERE created_at > NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('week', created_at), dt.association_id, a.name
        ORDER BY week DESC
    """)
    if not df.empty:
        stats["tasks_weekly"] = _upload(client, df, "gold/latest/tasks_weekly.parquet")

    # 14. RANKING DE COLABORADORES NAS TAREFAS
    df = await _fetch(session, """
        SELECT assigned_to_name, association_id, a.name AS association_name,
               COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total_tarefas,
               COUNT(*) FILTER (WHERE status='done' AND deleted_at IS NULL) AS concluidas,
               COUNT(*) FILTER (WHERE status='pending' AND deleted_at IS NULL) AS pendentes,
               COUNT(*) FILTER (WHERE status IN ('pending','in_progress') AND deleted_at IS NULL
                   AND due_date < CURRENT_DATE) AS em_atraso,
               ROUND(100.0 * COUNT(*) FILTER (WHERE status='done' AND deleted_at IS NULL) /
                   NULLIF(COUNT(*) FILTER (WHERE deleted_at IS NULL), 0), 1) AS pct_conclusao,
               AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600)
                   FILTER (WHERE status='done' AND deleted_at IS NULL) AS avg_horas_conclusao
        FROM daily_tasks dt JOIN associations a ON a.id = dt.association_id
        WHERE created_at > NOW() - INTERVAL '12 months'
          AND assigned_to_name IS NOT NULL
        GROUP BY assigned_to_name, dt.association_id, a.name
        ORDER BY concluidas DESC
    """)
    if not df.empty:
        stats["tasks_by_collaborator"] = _upload(client, df, "gold/latest/tasks_by_collaborator.parquet")

    # 15. CENSO — resumo por rua e associacao
    df = await _fetch(session, """
        SELECT COALESCE(NULLIF(TRIM(address_street), ''), 'Nao informado') AS street,
               association_id, a.name AS association_name,
               COUNT(*) AS total_moradores,
               COUNT(*) FILTER (WHERE type='member') AS associados,
               COUNT(*) FILTER (WHERE type='guest') AS visitantes,
               COUNT(*) FILTER (WHERE has_pests = TRUE) AS com_pragas,
               COUNT(*) FILTER (WHERE has_sewage = FALSE) AS sem_saneamento,
               COUNT(*) FILTER (WHERE uses_public_transport = TRUE) AS usa_transporte,
               COUNT(*) FILTER (WHERE internet_access IS NULL
                   OR internet_access IN ('Sem acesso', 'Nenhum')) AS sem_internet
        FROM residents r JOIN associations a ON a.id = r.association_id
        WHERE r.status = 'active'
        GROUP BY COALESCE(NULLIF(TRIM(address_street), ''), 'Nao informado'),
                 r.association_id, a.name
        ORDER BY total_moradores DESC
    """)
    if not df.empty:
        stats["census_by_street"] = _upload(client, df, "gold/latest/census_by_street.parquet")

    # 16. PROBLEMAS DA COMUNIDADE (neighborhood_problems JSONB)
    df = await _fetch(session, """
        SELECT UNNEST(neighborhood_problems) AS problem,
               association_id, a.name AS association_name,
               COUNT(*) AS ocorrencias,
               COUNT(*) FILTER (WHERE type='member') AS de_associados,
               COUNT(*) FILTER (WHERE type='guest') AS de_visitantes
        FROM residents r JOIN associations a ON a.id = r.association_id
        WHERE r.status = 'active'
          AND neighborhood_problems IS NOT NULL
          AND jsonb_array_length(neighborhood_problems) > 0
        GROUP BY UNNEST(neighborhood_problems), r.association_id, a.name
        ORDER BY ocorrencias DESC
    """)
    if not df.empty:
        stats["community_problems"] = _upload(client, df, "gold/latest/community_problems.parquet")

    # 17. KPIs OPERACIONAIS SNAPSHOT (tempo real)
    df = await _fetch(session, """
        SELECT a.id AS association_id, a.name AS association_name,
               (SELECT COUNT(*) FROM cash_sessions cs WHERE cs.association_id=a.id AND cs.status='open') AS caixas_abertos,
               (SELECT COALESCE(SUM(t.amount::float),0) FROM transactions t
                WHERE t.association_id=a.id AND t.type='income' AND t.reversed_at IS NULL
                  AND DATE(t.transaction_at)=CURRENT_DATE) AS receita_hoje,
               (SELECT COUNT(*) FROM packages p WHERE p.association_id=a.id
                AND p.status IN ('received','notified')) AS enc_pendentes,
               (SELECT COUNT(*) FROM packages p WHERE p.association_id=a.id
                AND p.status IN ('received','notified')
                AND p.received_at < NOW() - INTERVAL '3 days') AS enc_paradas_3d,
               (SELECT COUNT(*) FROM residents r WHERE r.association_id=a.id AND r.status='active') AS associados_ativos,
               (SELECT COUNT(DISTINCT m.resident_id) FROM mensalidades m
                JOIN residents r ON r.id=m.resident_id
                WHERE r.association_id=a.id AND m.status='pending' AND m.due_date < CURRENT_DATE) AS inadimplentes,
               (SELECT COUNT(*) FROM daily_tasks dt WHERE dt.association_id=a.id
                AND dt.status != 'done' AND dt.deleted_at IS NULL) AS tarefas_abertas,
               NOW() AS snapshot_at
        FROM associations a WHERE a.is_active=TRUE AND a.name NOT LIKE '%Teste%'
    """)
    if not df.empty:
        stats["operational_kpis"] = _upload(client, df, "gold/latest/operational_kpis.parquet")

    return stats


# ── Orchestrator ───────────────────────────────────────────────────────────────

async def run_full_etl(session: AsyncSession) -> dict:
    today = date.today().isoformat()
    started_at = datetime.now(timezone.utc)

    # Bronze: UMA query por tabela
    bronze_stats, frames = await export_bronze(session, today)

    # Silver: transformacao em memoria (ZERO queries extras ao banco)
    silver_stats = build_silver(frames, today, _r2_client())

    # Gold: GROUP BY leves (17 arquivos para Power BI)
    gold_stats = await export_gold(session)

    duration = round((datetime.now(timezone.utc) - started_at).total_seconds(), 1)

    return {
        "status": "ok",
        "date": today,
        "duration_s": duration,
        "files_total": sum(1 for v in {**bronze_stats, **silver_stats, **gold_stats}.values() if v > 0),
        "bronze": bronze_stats,
        "silver": silver_stats,
        "gold": gold_stats,
    }
