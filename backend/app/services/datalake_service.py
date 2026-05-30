"""
Data Lake Service — Exporta dados do Neon para Cloudflare R2.

Estrutura Medallion Architecture:
  bronze/{data}/   ← cópia exata do banco (UMA query por tabela)
  silver/{data}/   ← transformado EM MEMÓRIA a partir do bronze (zero queries extras)
  gold/latest/     ← KPIs agregados (queries leves de GROUP BY)

Impacto no Neon:
  Bronze: ~2.5 MB/run (queries diretas)
  Silver: 0 MB/run (transformação em memória dos dataframes bronze)
  Gold:   ~0.2 MB/run (GROUP BY agregações)
  Total:  ~2.7 MB/run × 8 runs/dia = ~21 MB/dia = ~147 MB/semana (2.9% do limite 5GB)
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


# ── BRONZE — uma query por tabela, sem joins ───────────────────────────────────

async def export_bronze(session: AsyncSession, today: str) -> tuple[dict, dict]:
    """Extrai dados brutos. Retorna (stats, dataframes) — dataframes usados pelo silver."""
    stats = {}
    frames: dict[str, pd.DataFrame] = {}
    client = _r2_client()

    tables = {
        "transactions": """
            SELECT id, type, income_subtype, amount::float AS amount, description,
                   transaction_at, payment_method_id, category_id,
                   resident_id, cash_session_id, approval_status,
                   is_reversal, reversed_at, created_by, created_at, association_id
            FROM transactions
            WHERE created_at > NOW() - INTERVAL '90 days'
        """,
        "packages": """
            SELECT id, status, unit, block, carrier_name, tracking_code,
                   has_delivery_fee, delivery_fee_amount::float AS delivery_fee_amount,
                   delivery_fee_paid, received_at, delivered_at, returned_at,
                   resident_id, received_by, delivered_by, delivered_to_name, association_id
            FROM packages
            WHERE received_at > NOW() - INTERVAL '90 days'
        """,
        "residents": """
            SELECT id, type, status, full_name, cpf, unit, block,
                   address_cep, address_street, address_neighborhood,
                   address_city, address_state, phone_primary, email,
                   monthly_payment_day, is_member_confirmed,
                   internet_access, has_sewage, has_pests,
                   move_in_date, created_at, association_id
            FROM residents WHERE status = 'active'
        """,
        "mensalidades": """
            SELECT id, reference_month, due_date, amount::float AS amount,
                   status, paid_at, resident_id, association_id
            FROM mensalidades
        """,
        "cash_sessions": """
            SELECT id, status, opening_balance::float, closing_balance::float,
                   expected_balance::float, difference::float,
                   opened_at, closed_at, opened_by, association_id
            FROM cash_sessions
            WHERE opened_at > NOW() - INTERVAL '90 days'
        """,
        "service_orders": """
            SELECT id, number, title, status, priority, area, unit, block,
                   requester_name, assigned_to, created_at, updated_at, association_id
            FROM service_orders
            WHERE status NOT IN ('cancelled', 'archived')
        """,
        "users": "SELECT id, full_name, role, association_id FROM users WHERE is_active = TRUE",
        "payment_methods": "SELECT id, name, association_id FROM payment_methods WHERE is_active = TRUE",
        "transaction_categories": "SELECT id, name, type, association_id FROM transaction_categories WHERE is_active = TRUE",
        "associations": "SELECT id, name FROM associations WHERE is_active = TRUE",
    }

    for name, sql in tables.items():
        df = await _fetch(session, sql)
        frames[name] = df
        if not df.empty:
            stats[name] = _upload(client, df, f"bronze/{today}/{name}.parquet")
        else:
            stats[name] = 0

    return stats, frames


# ── SILVER — transformação em memória, zero queries ao banco ──────────────────

def build_silver(frames: dict[str, pd.DataFrame], today: str, client) -> dict:
    """Enriquece e transforma dataframes bronze. Nenhuma query ao banco."""
    stats = {}

    tx      = frames.get("transactions", pd.DataFrame())
    pkgs    = frames.get("packages", pd.DataFrame())
    res     = frames.get("residents", pd.DataFrame())
    mens    = frames.get("mensalidades", pd.DataFrame())
    users   = frames.get("users", pd.DataFrame())
    pm      = frames.get("payment_methods", pd.DataFrame())
    cats    = frames.get("transaction_categories", pd.DataFrame())
    assocs  = frames.get("associations", pd.DataFrame())

    # transactions_enriched — join com residents, payment_methods, categories, users
    if not tx.empty:
        df = tx.copy()
        df = df[df["reversed_at"].isna() & (~df["is_reversal"])]
        if not pm.empty:
            df = df.merge(pm.rename(columns={"name": "payment_method_name", "id": "payment_method_id"})[["payment_method_id", "payment_method_name"]], on="payment_method_id", how="left")
        if not cats.empty:
            df = df.merge(cats.rename(columns={"name": "category_name", "id": "category_id"})[["category_id", "category_name"]], on="category_id", how="left")
        if not res.empty:
            df = df.merge(res[["id", "full_name", "type", "unit"]].rename(columns={"id": "resident_id", "full_name": "resident_name", "type": "resident_type"}), on="resident_id", how="left")
        if not users.empty:
            df = df.merge(users[["id", "full_name"]].rename(columns={"id": "created_by", "full_name": "created_by_name"}), on="created_by", how="left")
        if not assocs.empty:
            df = df.merge(assocs.rename(columns={"id": "association_id", "name": "association_name"}), on="association_id", how="left")
        df["date"] = pd.to_datetime(df["transaction_at"]).dt.date
        df["hour"] = pd.to_datetime(df["transaction_at"]).dt.hour
        df["day_of_week"] = pd.to_datetime(df["transaction_at"]).dt.dayofweek
        stats["transactions_enriched"] = _upload(client, df, f"silver/{today}/transactions_enriched.parquet")

    # packages_enriched — join com residents e usuários
    if not pkgs.empty:
        df = pkgs.copy()
        if not res.empty:
            df = df.merge(res[["id", "full_name", "type"]].rename(columns={"id": "resident_id", "full_name": "resident_name", "type": "resident_type"}), on="resident_id", how="left")
        if not users.empty:
            rec = users[["id", "full_name"]].rename(columns={"id": "received_by", "full_name": "received_by_name"})
            dlv = users[["id", "full_name"]].rename(columns={"id": "delivered_by", "full_name": "delivered_by_name"})
            df = df.merge(rec, on="received_by", how="left").merge(dlv, on="delivered_by", how="left")
        if not assocs.empty:
            df = df.merge(assocs.rename(columns={"id": "association_id", "name": "association_name"}), on="association_id", how="left")
        # Calcula tempo de espera
        df["received_at"] = pd.to_datetime(df["received_at"])
        df["delivered_at"] = pd.to_datetime(df["delivered_at"])
        df["wait_hours"] = (df["delivered_at"] - df["received_at"]).dt.total_seconds() / 3600
        df["received_date"] = df["received_at"].dt.date
        df["delivered_date"] = df["delivered_at"].dt.date
        stats["packages_enriched"] = _upload(client, df, f"silver/{today}/packages_enriched.parquet")

    # residents_clean — com inadimplência calculada a partir de mensalidades
    if not res.empty:
        df = res.copy()
        if not mens.empty:
            today_dt = pd.Timestamp.now().normalize()
            overdue = mens[
                (mens["status"] == "pending") &
                (pd.to_datetime(mens["due_date"]) < today_dt)
            ].groupby("resident_id").agg(
                overdue_months=("id", "count"),
                total_owed=("amount", "sum")
            ).reset_index()
            df = df.merge(overdue, left_on="id", right_on="resident_id", how="left")
            df["overdue_months"] = df["overdue_months"].fillna(0).astype(int)
            df["total_owed"] = df["total_owed"].fillna(0)
        if not assocs.empty:
            df = df.merge(assocs.rename(columns={"id": "association_id", "name": "association_name"}), on="association_id", how="left")
        stats["residents_clean"] = _upload(client, df, f"silver/{today}/residents_clean.parquet")

    return stats


# ── GOLD — agregações leves (GROUP BY apenas) ─────────────────────────────────

async def export_gold(session: AsyncSession) -> dict:
    """KPIs aggregados — queries leves de GROUP BY, sem JOINs pesados."""
    stats = {}
    client = _r2_client()

    # daily_revenue
    df = await _fetch(session, """
        SELECT DATE(transaction_at) AS date, association_id,
               SUM(amount::float) FILTER (WHERE type='income' AND reversed_at IS NULL AND NOT is_reversal) AS total_income,
               SUM(amount::float) FILTER (WHERE type IN ('expense','sangria') AND reversed_at IS NULL AND NOT is_reversal) AS total_expense,
               SUM(amount::float) FILTER (WHERE income_subtype='mensalidade' AND reversed_at IS NULL) AS mensalidade_income,
               SUM(amount::float) FILTER (WHERE income_subtype='delivery_fee' AND reversed_at IS NULL) AS delivery_fee_income,
               COUNT(*) FILTER (WHERE type='income' AND reversed_at IS NULL) AS income_count,
               COUNT(*) FILTER (WHERE type='expense' AND reversed_at IS NULL) AS expense_count
        FROM transactions WHERE created_at > NOW() - INTERVAL '90 days'
        GROUP BY DATE(transaction_at), association_id ORDER BY date DESC
    """)
    if not df.empty:
        df["net"] = df["total_income"].fillna(0) - df["total_expense"].fillna(0)
        stats["daily_revenue"] = _upload(client, df, "gold/latest/daily_revenue.parquet")

    # package_summary
    df = await _fetch(session, """
        SELECT DATE(received_at) AS date, association_id,
               COUNT(*) AS total_received,
               COUNT(*) FILTER (WHERE status='delivered') AS delivered,
               COUNT(*) FILTER (WHERE status='returned') AS returned,
               COUNT(*) FILTER (WHERE status IN ('received','notified')) AS pending,
               AVG(EXTRACT(EPOCH FROM (delivered_at-received_at))/3600) FILTER (WHERE delivered_at IS NOT NULL) AS avg_wait_hours
        FROM packages WHERE received_at > NOW() - INTERVAL '90 days'
        GROUP BY DATE(received_at), association_id ORDER BY date DESC
    """)
    if not df.empty:
        stats["package_summary"] = _upload(client, df, "gold/latest/package_summary.parquet")

    # resident_overview
    df = await _fetch(session, """
        SELECT a.id AS association_id, a.name AS association_name,
               COUNT(r.id) AS total, COUNT(r.id) FILTER (WHERE r.type='member') AS members,
               COUNT(r.id) FILTER (WHERE r.type='guest') AS guests,
               COUNT(r.id) FILTER (WHERE r.is_member_confirmed) AS confirmed,
               COUNT(r.id) FILTER (WHERE r.internet_access IS NULL OR r.internet_access='nenhum') AS sem_internet,
               COUNT(DISTINCT r.unit) AS units
        FROM residents r JOIN associations a ON a.id=r.association_id
        WHERE r.status='active' GROUP BY a.id, a.name
    """)
    if not df.empty:
        stats["resident_overview"] = _upload(client, df, "gold/latest/resident_overview.parquet")

    # delinquency_report
    df = await _fetch(session, """
        SELECT r.full_name, r.unit, r.block, r.phone_primary, r.type, r.association_id,
               COUNT(m.id) AS overdue_months, SUM(m.amount::float) AS total_owed, MIN(m.due_date) AS oldest_due
        FROM residents r JOIN mensalidades m ON m.resident_id=r.id
        WHERE m.status='pending' AND m.due_date < CURRENT_DATE AND r.status='active'
        GROUP BY r.id, r.full_name, r.unit, r.block, r.phone_primary, r.type, r.association_id
        ORDER BY total_owed DESC
    """)
    if not df.empty:
        stats["delinquency_report"] = _upload(client, df, "gold/latest/delinquency_report.parquet")

    # operational_kpis
    df = await _fetch(session, """
        SELECT a.id AS association_id, a.name,
               (SELECT COUNT(*) FROM cash_sessions cs WHERE cs.association_id=a.id AND cs.status='open') AS open_sessions,
               (SELECT COALESCE(SUM(t.amount::float),0) FROM transactions t WHERE t.association_id=a.id AND t.type='income' AND t.reversed_at IS NULL AND DATE(t.transaction_at)=CURRENT_DATE) AS today_income,
               (SELECT COUNT(*) FROM packages p WHERE p.association_id=a.id AND p.status IN ('received','notified')) AS pending_packages,
               (SELECT COUNT(*) FROM residents r WHERE r.association_id=a.id AND r.status='active') AS active_residents,
               (SELECT COUNT(DISTINCT m.resident_id) FROM mensalidades m JOIN residents r ON r.id=m.resident_id WHERE r.association_id=a.id AND m.status='pending' AND m.due_date < CURRENT_DATE) AS delinquent,
               NOW() AS exported_at
        FROM associations a WHERE a.is_active=TRUE
    """)
    if not df.empty:
        stats["operational_kpis"] = _upload(client, df, "gold/latest/operational_kpis.parquet")

    return stats


# ── Orchestrator ───────────────────────────────────────────────────────────────

async def run_full_etl(session: AsyncSession) -> dict:
    today = date.today().isoformat()
    started_at = datetime.now(timezone.utc)
    client = _r2_client()

    # Bronze: UMA query por tabela → dataframes em memória
    bronze_stats, frames = await export_bronze(session, today)

    # Silver: transformação em memória (ZERO queries extras ao banco)
    silver_stats = build_silver(frames, today, client)

    # Gold: apenas GROUP BY (queries leves)
    gold_stats = await export_gold(session)

    return {
        "status": "ok",
        "date": today,
        "duration_s": round((datetime.now(timezone.utc) - started_at).total_seconds(), 1),
        "neon_bytes_approx_mb": 2.7,
        "bronze": bronze_stats,
        "silver": silver_stats,
        "gold": gold_stats,
    }
