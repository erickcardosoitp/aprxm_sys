"""
Data Lake Service — Exporta dados do Neon para Cloudflare R2.

Estrutura Medallion Architecture:
  bronze/YYYY-MM-DD/   ← cópia exata do banco (tabela por tabela)
  silver/YYYY-MM-DD/   ← enriquecido com joins e tipos corretos
  gold/latest/         ← KPIs agregados prontos para Power BI
"""
import io
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
    """Faz upload de DataFrame como Parquet para o R2. Retorna nº de linhas."""
    buf = io.BytesIO()
    df.to_parquet(buf, index=False, engine="pyarrow", compression="snappy")
    buf.seek(0)
    client.put_object(
        Bucket=settings.r2_bucket_name,
        Key=key,
        Body=buf.getvalue(),
        ContentType="application/octet-stream",
    )
    logger.info("R2 upload: %s (%d rows)", key, len(df))
    return len(df)


# ── BRONZE ────────────────────────────────────────────────────────────────────

async def export_bronze(session: AsyncSession, today: str) -> dict:
    """Extrai dados brutos do Neon para bronze/{today}/."""
    stats = {}

    queries = {
        "transactions": f"""
            SELECT t.id, t.type, t.income_subtype, t.amount, t.description,
                   t.transaction_at, t.payment_method_id, t.category_id,
                   t.resident_id, t.cash_session_id, t.approval_status,
                   t.is_reversal, t.reversed_at, t.created_by, t.created_at,
                   t.association_id, pm.name AS payment_method_name
            FROM transactions t
            LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
            WHERE t.created_at >= NOW() - INTERVAL '90 days'
        """,
        "packages": f"""
            SELECT p.id, p.status, p.unit, p.block, p.carrier_name,
                   p.tracking_code, p.has_delivery_fee, p.delivery_fee_amount,
                   p.delivery_fee_paid, p.received_at, p.delivered_at,
                   p.returned_at, p.resident_id, p.received_by, p.delivered_by,
                   p.delivered_to_name, p.association_id,
                   r.full_name AS resident_name, r.type AS resident_type,
                   u_rec.full_name AS received_by_name,
                   u_del.full_name AS delivered_by_name
            FROM packages p
            LEFT JOIN residents r ON r.id = p.resident_id
            LEFT JOIN users u_rec ON u_rec.id = p.received_by
            LEFT JOIN users u_del ON u_del.id = p.delivered_by
            WHERE p.received_at >= NOW() - INTERVAL '90 days'
        """,
        "residents": """
            SELECT id, type, status, full_name, cpf, unit, block,
                   address_cep, address_street, address_neighborhood,
                   address_city, address_state, phone_primary, email,
                   monthly_payment_day, is_member_confirmed,
                   internet_access, has_sewage, has_pests,
                   move_in_date, created_at, association_id
            FROM residents
            WHERE status = 'active'
        """,
        "mensalidades": """
            SELECT m.id, m.reference_month, m.due_date, m.amount,
                   m.status, m.paid_at, m.resident_id, m.association_id,
                   r.full_name AS resident_name, r.unit, r.type AS resident_type
            FROM mensalidades m
            LEFT JOIN residents r ON r.id = m.resident_id
        """,
        "cash_sessions": """
            SELECT cs.id, cs.status, cs.opening_balance, cs.closing_balance,
                   cs.expected_balance, cs.difference, cs.opened_at,
                   cs.closed_at, cs.association_id,
                   u.full_name AS operador_name
            FROM cash_sessions cs
            LEFT JOIN users u ON u.id = cs.opened_by
            WHERE cs.opened_at >= NOW() - INTERVAL '90 days'
        """,
        "service_orders": """
            SELECT id, number, title, status, priority, area, unit, block,
                   requester_name, assigned_to, created_at, updated_at,
                   association_id
            FROM service_orders
            WHERE status NOT IN ('cancelled', 'archived')
        """,
    }

    client = _r2_client()
    for name, sql in queries.items():
        rows = (await session.execute(text(sql))).fetchall()
        if rows:
            df = pd.DataFrame(rows, columns=[d[0] for d in (await session.execute(text(f"SELECT * FROM ({sql}) q LIMIT 0"))).cursor.description] if False else [k for k in rows[0]._mapping.keys()])
            stats[name] = _upload(client, df, f"bronze/{today}/{name}.parquet")
        else:
            stats[name] = 0

    return stats


# ── SILVER ────────────────────────────────────────────────────────────────────

async def export_silver(session: AsyncSession, today: str) -> dict:
    """Transforma e enriquece os dados para silver/{today}/."""
    stats = {}
    client = _r2_client()

    # transactions_enriched — com categorias e sessões
    rows = (await session.execute(text("""
        SELECT
            t.id, t.type, t.income_subtype, t.amount::float AS amount,
            t.description, DATE(t.transaction_at) AS date,
            EXTRACT(HOUR FROM t.transaction_at) AS hour,
            EXTRACT(DOW FROM t.transaction_at) AS day_of_week,
            t.approval_status, t.is_reversal,
            pm.name AS payment_method,
            tc.name AS category,
            r.full_name AS resident_name, r.type AS resident_type, r.unit,
            u.full_name AS created_by_name,
            t.association_id,
            a.name AS association_name,
            t.transaction_at
        FROM transactions t
        LEFT JOIN payment_methods pm ON pm.id = t.payment_method_id
        LEFT JOIN transaction_categories tc ON tc.id = t.category_id
        LEFT JOIN residents r ON r.id = t.resident_id
        LEFT JOIN users u ON u.id = t.created_by
        LEFT JOIN associations a ON a.id = t.association_id
        WHERE t.created_at >= NOW() - INTERVAL '90 days'
          AND t.reversed_at IS NULL AND t.is_reversal = FALSE
        ORDER BY t.transaction_at DESC
    """))).fetchall()
    if rows:
        df = pd.DataFrame(rows, columns=[k for k in rows[0]._mapping.keys()])
        stats["transactions_enriched"] = _upload(client, df, f"silver/{today}/transactions_enriched.parquet")

    # packages_enriched — tempo de espera calculado
    rows = (await session.execute(text("""
        SELECT
            p.id, p.status, p.unit, p.block, p.carrier_name, p.tracking_code,
            p.has_delivery_fee, p.delivery_fee_amount::float,
            p.delivery_fee_paid,
            DATE(p.received_at) AS received_date,
            DATE(p.delivered_at) AS delivered_date,
            CASE WHEN p.delivered_at IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (p.delivered_at - p.received_at))/3600
                 ELSE NULL END AS wait_hours,
            r.full_name AS resident_name, r.type AS resident_type,
            u_rec.full_name AS received_by_name,
            u_del.full_name AS delivered_by_name,
            p.association_id, a.name AS association_name
        FROM packages p
        LEFT JOIN residents r ON r.id = p.resident_id
        LEFT JOIN users u_rec ON u_rec.id = p.received_by
        LEFT JOIN users u_del ON u_del.id = p.delivered_by
        LEFT JOIN associations a ON a.id = p.association_id
        WHERE p.received_at >= NOW() - INTERVAL '90 days'
    """))).fetchall()
    if rows:
        df = pd.DataFrame(rows, columns=[k for k in rows[0]._mapping.keys()])
        stats["packages_enriched"] = _upload(client, df, f"silver/{today}/packages_enriched.parquet")

    # residents_clean — com inadimplência calculada
    rows = (await session.execute(text("""
        SELECT
            r.id, r.type, r.status, r.full_name, r.unit, r.block,
            r.address_street, r.address_neighborhood, r.address_city,
            r.phone_primary, r.email, r.internet_access,
            r.monthly_payment_day, r.is_member_confirmed,
            r.move_in_date, r.created_at,
            COUNT(m.id) FILTER (WHERE m.status = 'pending' AND m.due_date < CURRENT_DATE) AS overdue_count,
            COALESCE(SUM(m.amount::float) FILTER (WHERE m.status = 'pending' AND m.due_date < CURRENT_DATE), 0) AS overdue_amount,
            r.association_id, a.name AS association_name
        FROM residents r
        LEFT JOIN mensalidades m ON m.resident_id = r.id
        LEFT JOIN associations a ON a.id = r.association_id
        WHERE r.status = 'active'
        GROUP BY r.id, a.name
    """))).fetchall()
    if rows:
        df = pd.DataFrame(rows, columns=[k for k in rows[0]._mapping.keys()])
        stats["residents_clean"] = _upload(client, df, f"silver/{today}/residents_clean.parquet")

    return stats


# ── GOLD ──────────────────────────────────────────────────────────────────────

async def export_gold(session: AsyncSession) -> dict:
    """Agrega KPIs para gold/latest/ — consumido direto pelo Power BI."""
    stats = {}
    client = _r2_client()

    # daily_revenue — receita/despesa por dia (últimos 90 dias)
    rows = (await session.execute(text("""
        SELECT
            DATE(transaction_at) AS date,
            association_id,
            SUM(amount::float) FILTER (WHERE type = 'income' AND reversed_at IS NULL AND is_reversal = FALSE) AS total_income,
            SUM(amount::float) FILTER (WHERE type IN ('expense','sangria') AND reversed_at IS NULL AND is_reversal = FALSE) AS total_expense,
            SUM(amount::float) FILTER (WHERE income_subtype = 'mensalidade' AND reversed_at IS NULL) AS mensalidade_income,
            SUM(amount::float) FILTER (WHERE income_subtype = 'delivery_fee' AND reversed_at IS NULL) AS delivery_fee_income,
            SUM(amount::float) FILTER (WHERE income_subtype = 'proof_of_residence' AND reversed_at IS NULL) AS proof_income,
            COUNT(*) FILTER (WHERE type = 'income' AND reversed_at IS NULL) AS income_count,
            COUNT(*) FILTER (WHERE type = 'expense' AND reversed_at IS NULL) AS expense_count
        FROM transactions
        WHERE created_at >= NOW() - INTERVAL '90 days'
        GROUP BY DATE(transaction_at), association_id
        ORDER BY date DESC
    """))).fetchall()
    if rows:
        df = pd.DataFrame(rows, columns=[k for k in rows[0]._mapping.keys()])
        df["net"] = df["total_income"].fillna(0) - df["total_expense"].fillna(0)
        stats["daily_revenue"] = _upload(client, df, "gold/latest/daily_revenue.parquet")

    # package_summary — encomendas por dia
    rows = (await session.execute(text("""
        SELECT
            DATE(received_at) AS date,
            association_id,
            COUNT(*) AS total_received,
            COUNT(*) FILTER (WHERE status = 'delivered') AS total_delivered,
            COUNT(*) FILTER (WHERE status = 'returned') AS total_returned,
            COUNT(*) FILTER (WHERE status IN ('received','notified')) AS total_pending,
            COUNT(*) FILTER (WHERE has_delivery_fee = TRUE) AS with_fee,
            AVG(CASE WHEN delivered_at IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (delivered_at - received_at))/3600
                     ELSE NULL END) AS avg_wait_hours
        FROM packages
        WHERE received_at >= NOW() - INTERVAL '90 days'
        GROUP BY DATE(received_at), association_id
        ORDER BY date DESC
    """))).fetchall()
    if rows:
        df = pd.DataFrame(rows, columns=[k for k in rows[0]._mapping.keys()])
        stats["package_summary"] = _upload(client, df, "gold/latest/package_summary.parquet")

    # resident_overview — visão geral de moradores
    rows = (await session.execute(text("""
        SELECT
            a.name AS association_name, a.id AS association_id,
            COUNT(r.id) AS total_residents,
            COUNT(r.id) FILTER (WHERE r.type = 'member') AS total_members,
            COUNT(r.id) FILTER (WHERE r.type = 'guest') AS total_guests,
            COUNT(r.id) FILTER (WHERE r.type = 'dependent') AS total_dependents,
            COUNT(r.id) FILTER (WHERE r.is_member_confirmed = TRUE) AS confirmed_members,
            COUNT(r.id) FILTER (WHERE r.internet_access IS NULL OR r.internet_access = 'nenhum') AS sem_internet,
            COUNT(DISTINCT r.address_street) AS distinct_streets,
            COUNT(DISTINCT r.unit) AS distinct_units,
            -- Novos moradores no mês atual
            COUNT(r.id) FILTER (WHERE DATE_TRUNC('month', r.created_at) = DATE_TRUNC('month', NOW())) AS new_this_month
        FROM residents r
        JOIN associations a ON a.id = r.association_id
        WHERE r.status = 'active'
        GROUP BY a.id, a.name
    """))).fetchall()
    if rows:
        df = pd.DataFrame(rows, columns=[k for k in rows[0]._mapping.keys()])
        stats["resident_overview"] = _upload(client, df, "gold/latest/resident_overview.parquet")

    # delinquency_report — inadimplência detalhada
    rows = (await session.execute(text("""
        SELECT
            r.full_name, r.unit, r.block, r.phone_primary, r.type,
            COUNT(m.id) AS overdue_months,
            SUM(m.amount::float) AS total_owed,
            MIN(m.due_date) AS oldest_due_date,
            r.association_id, a.name AS association_name
        FROM residents r
        JOIN mensalidades m ON m.resident_id = r.id
        JOIN associations a ON a.id = r.association_id
        WHERE m.status = 'pending'
          AND m.due_date < CURRENT_DATE
          AND r.status = 'active'
        GROUP BY r.id, r.full_name, r.unit, r.block, r.phone_primary, r.type, r.association_id, a.name
        ORDER BY total_owed DESC
    """))).fetchall()
    if rows:
        df = pd.DataFrame(rows, columns=[k for k in rows[0]._mapping.keys()])
        stats["delinquency_report"] = _upload(client, df, "gold/latest/delinquency_report.parquet")

    # operational_kpis — snapshot operacional do momento
    rows = (await session.execute(text("""
        SELECT
            a.id AS association_id,
            a.name AS association_name,
            -- Financeiro
            (SELECT COUNT(*) FROM cash_sessions cs WHERE cs.association_id = a.id AND cs.status = 'open') AS open_sessions,
            (SELECT COALESCE(SUM(t.amount::float),0) FROM transactions t
             WHERE t.association_id = a.id AND t.type = 'income'
               AND t.reversed_at IS NULL AND DATE(t.transaction_at) = CURRENT_DATE) AS today_income,
            -- Encomendas
            (SELECT COUNT(*) FROM packages p WHERE p.association_id = a.id AND p.status IN ('received','notified')) AS pending_packages,
            (SELECT COUNT(*) FROM packages p WHERE p.association_id = a.id AND DATE(p.received_at) = CURRENT_DATE) AS received_today,
            (SELECT COUNT(*) FROM packages p WHERE p.association_id = a.id AND DATE(p.delivered_at) = CURRENT_DATE) AS delivered_today,
            -- Moradores
            (SELECT COUNT(*) FROM residents r WHERE r.association_id = a.id AND r.status = 'active') AS active_residents,
            (SELECT COUNT(DISTINCT m.resident_id) FROM mensalidades m
             JOIN residents r ON r.id = m.resident_id
             WHERE r.association_id = a.id AND m.status = 'pending' AND m.due_date < CURRENT_DATE) AS delinquent_residents,
            -- OS
            (SELECT COUNT(*) FROM service_orders so WHERE so.association_id = a.id AND so.status NOT IN ('resolved','archived','cancelled')) AS open_orders,
            NOW() AS exported_at
        FROM associations a
        WHERE a.is_active = TRUE
    """))).fetchall()
    if rows:
        df = pd.DataFrame(rows, columns=[k for k in rows[0]._mapping.keys()])
        stats["operational_kpis"] = _upload(client, df, "gold/latest/operational_kpis.parquet")

    return stats


# ── Orchestrator ───────────────────────────────────────────────────────────────

async def run_full_etl(session: AsyncSession) -> dict:
    today = date.today().isoformat()
    started_at = datetime.now(timezone.utc)

    bronze = await export_bronze(session, today)
    silver = await export_silver(session, today)
    gold = await export_gold(session)

    return {
        "status": "ok",
        "date": today,
        "duration_s": round((datetime.now(timezone.utc) - started_at).total_seconds(), 1),
        "bronze": bronze,
        "silver": silver,
        "gold": gold,
    }
