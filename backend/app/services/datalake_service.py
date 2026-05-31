"""
Data Lake Service — Medallion Architecture: Bronze → Silver → Gold

Bronze : queries ao Neon (unica fonte de dados)
Silver : transformacoes em memoria a partir do Bronze (zero queries ao banco)
Gold   : agregacoes pandas a partir do Silver/Bronze (zero queries ao banco)

Fluxo:
  Neon DB --> Bronze (SQL) --> Silver (pandas transform) --> Gold (pandas groupby) --> R2
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


# ── Helpers ───────────────────────────────────────────────────────────────────

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
    kb = len(buf.getvalue()) / 1024
    logger.info("R2 %-50s %4d rows %6.1f KB", key, len(df), kb)
    return len(df)


async def _fetch(session: AsyncSession, sql: str) -> pd.DataFrame:
    rows = (await session.execute(text(sql))).fetchall()
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows, columns=list(rows[0]._mapping.keys()))


def _parse_jsonb(val) -> list:
    if val is None:
        return []
    if isinstance(val, list):
        return val
    try:
        return json.loads(val)
    except Exception:
        return []


def _week(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series).dt.to_period("W").apply(lambda x: x.start_time)


def _month(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series).dt.to_period("M").apply(lambda x: x.start_time)


# ── BRONZE — unica camada que conecta ao Neon ─────────────────────────────────

async def export_bronze(session: AsyncSession, today: str) -> tuple[dict, dict]:
    """
    Extrai dados brutos do Neon.
    Retorna (stats, frames) — frames usados por Silver e Gold sem tocar no banco.
    """
    stats: dict = {}
    frames: dict[str, pd.DataFrame] = {}
    client = _r2_client()

    queries = {
        "associations": """
            SELECT id, name, slug, is_active, simplifica_enabled, created_at
            FROM associations WHERE is_active = TRUE
        """,
        "users": """
            SELECT id, full_name, email, role, association_id, is_active, created_at
            FROM users WHERE is_active = TRUE
        """,
        "payment_methods": """
            SELECT id, name, is_active, association_id
            FROM payment_methods WHERE is_active = TRUE
        """,
        "transaction_categories": """
            SELECT id, name, type, association_id
            FROM transaction_categories WHERE is_active = TRUE
        """,
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
                   is_reversal, reversed_at,
                   sangria_reason, sangria_destination,
                   approval_status, created_by, created_at
            FROM transactions
            WHERE created_at > NOW() - INTERVAL '12 months'
        """,
        "cash_sessions": """
            SELECT id, association_id, opened_by, closed_by, status,
                   opening_balance::float, closing_balance::float,
                   expected_balance::float, difference::float,
                   quebra_caixa::float, notes, opened_at, closed_at
            FROM cash_sessions
            WHERE opened_at > NOW() - INTERVAL '12 months'
        """,
        "packages": """
            SELECT id, association_id, status, unit, block,
                   carrier_name, tracking_code, has_delivery_fee,
                   delivery_fee_amount::float, delivery_fee_paid,
                   received_at, delivered_at, returned_at,
                   resident_id, received_by, delivered_by, delivered_to_name
            FROM packages
            WHERE received_at > NOW() - INTERVAL '12 months'
        """,
        "daily_tasks": """
            SELECT id, association_id, title, description,
                   assigned_to, assigned_to_name, due_date, status,
                   checklist, created_by, created_at, updated_at, deleted_at
            FROM daily_tasks
            WHERE created_at > NOW() - INTERVAL '12 months'
        """,
        "service_orders": """
            SELECT id, association_id, number, title, status, priority,
                   area, unit, requester_name, assigned_to, created_at, updated_at
            FROM service_orders
            WHERE status NOT IN ('cancelled','archived')
        """,
    }

    for name, sql in queries.items():
        df = await _fetch(session, sql)
        frames[name] = df
        if not df.empty:
            stats[name] = _upload(client, df, f"bronze/{today}/{name}.parquet")
        else:
            stats[name] = 0

    return stats, frames


# ── SILVER — transformacoes em memoria, zero queries ao banco ──────────────────

def build_silver(frames: dict[str, pd.DataFrame], today: str, client) -> dict[str, pd.DataFrame]:
    """
    Enriquece e normaliza os DataFrames do Bronze.
    Retorna silver_frames para o Gold usar diretamente.
    """
    stats: dict = {}
    silver: dict[str, pd.DataFrame] = {}

    assocs = frames.get("associations", pd.DataFrame())
    users  = frames.get("users", pd.DataFrame())
    pm     = frames.get("payment_methods", pd.DataFrame())
    cats   = frames.get("transaction_categories", pd.DataFrame())
    res    = frames.get("residents", pd.DataFrame())
    mens   = frames.get("mensalidades", pd.DataFrame())
    tx     = frames.get("transactions", pd.DataFrame())
    cs     = frames.get("cash_sessions", pd.DataFrame())
    pkgs   = frames.get("packages", pd.DataFrame())
    tasks  = frames.get("daily_tasks", pd.DataFrame())

    assoc_map = assocs.set_index("id")["name"].to_dict() if not assocs.empty else {}
    user_map  = users.set_index("id")["full_name"].to_dict() if not users.empty else {}
    pm_map    = pm.set_index("id")["name"].to_dict() if not pm.empty else {}
    cat_map   = cats.set_index("id")["name"].to_dict() if not cats.empty else {}

    # ── transactions_enriched
    if not tx.empty:
        df = tx.copy()
        df = df[df["reversed_at"].isna() & (~df["is_reversal"])]
        df["association_name"]    = df["association_id"].map(assoc_map)
        df["created_by_name"]     = df["created_by"].map(user_map)
        df["payment_method_name"] = df["payment_method_id"].map(pm_map)
        df["category_name"]       = df["category_id"].map(cat_map)
        if not res.empty:
            res_map = res.set_index("id")[["full_name", "type", "unit", "address_street"]].rename(
                columns={"full_name": "resident_name", "type": "resident_type"})
            df = df.join(res_map, on="resident_id", how="left")
        df["date"]        = pd.to_datetime(df["transaction_at"]).dt.normalize()
        df["week"]        = _week(df["transaction_at"])
        df["month"]       = _month(df["transaction_at"])
        df["hour"]        = pd.to_datetime(df["transaction_at"]).dt.hour
        df["day_of_week"] = pd.to_datetime(df["transaction_at"]).dt.day_name()
        silver["transactions_enriched"] = df
        stats["transactions_enriched"] = _upload(client, df, f"silver/{today}/transactions_enriched.parquet")

    # ── packages_enriched
    if not pkgs.empty:
        df = pkgs.copy()
        df["association_name"]  = df["association_id"].map(assoc_map)
        df["received_by_name"]  = df["received_by"].map(user_map)
        df["delivered_by_name"] = df["delivered_by"].map(user_map)
        if not res.empty:
            res_map = res.set_index("id")[["full_name", "type", "address_street"]].rename(
                columns={"full_name": "resident_name", "type": "resident_type"})
            df = df.join(res_map, on="resident_id", how="left")
        df["received_at"]  = pd.to_datetime(df["received_at"])
        df["delivered_at"] = pd.to_datetime(df["delivered_at"])
        df["wait_hours"]   = (df["delivered_at"] - df["received_at"]).dt.total_seconds() / 3600
        df["received_date"]  = df["received_at"].dt.date
        df["received_week"]  = _week(df["received_at"])
        df["received_month"] = _month(df["received_at"])
        silver["packages_enriched"] = df
        stats["packages_enriched"] = _upload(client, df, f"silver/{today}/packages_enriched.parquet")

    # ── residents_clean
    if not res.empty:
        df = res.copy()
        df["association_name"] = df["association_id"].map(assoc_map)
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
            df["total_owed"]     = df["total_owed"].fillna(0.0)
        df["problems_list"]  = df["neighborhood_problems"].apply(_parse_jsonb)
        df["problem_count"]  = df["problems_list"].apply(len)
        df["has_problems"]   = df["problem_count"] > 0
        df["sem_internet"]   = df["internet_access"].isin(["Sem acesso", "Nenhum"]) | df["internet_access"].isna()
        df["created_week"]   = _week(df["created_at"])
        df["created_month"]  = _month(df["created_at"])
        silver["residents_clean"] = df
        stats["residents_clean"] = _upload(client, df, f"silver/{today}/residents_clean.parquet")

    # ── cash_sessions_enriched
    if not cs.empty:
        df = cs.copy()
        df["association_name"] = df["association_id"].map(assoc_map)
        df["operador_name"]    = df["opened_by"].map(user_map)
        df["tem_quebra"]       = df["quebra_caixa"].notna() & (df["quebra_caixa"] != 0)
        df["tem_diferenca"]    = df["difference"].notna() & (df["difference"].abs() > 0.01)
        df["week"]             = _week(df["opened_at"])
        df["month"]            = _month(df["opened_at"])
        silver["cash_sessions_enriched"] = df
        stats["cash_sessions_enriched"] = _upload(client, df, f"silver/{today}/cash_sessions_enriched.parquet")

    # ── daily_tasks_enriched
    if not tasks.empty:
        df = tasks.copy()
        df["association_name"] = df["association_id"].map(assoc_map)
        df["created_by_name"]  = df["created_by"].map(user_map)
        df["is_deleted"]       = df["deleted_at"].notna()
        df["week"]             = _week(df["created_at"])
        df["month"]            = _month(df["created_at"])
        df["overdue"]          = (
            (df["status"] != "done") &
            df["due_date"].notna() &
            (pd.to_datetime(df["due_date"]) < pd.Timestamp.now().normalize())
        )
        silver["daily_tasks_enriched"] = df
        stats["daily_tasks_enriched"] = _upload(client, df, f"silver/{today}/daily_tasks_enriched.parquet")

    return stats, silver


# ── GOLD — pandas puro, zero queries ao banco ─────────────────────────────────

def build_gold(frames: dict[str, pd.DataFrame], silver: dict[str, pd.DataFrame], client) -> dict:
    """
    Todas as 17 metricas do dashboard construidas a partir dos DataFrames
    em memoria. Nenhuma conexao ao banco de dados.
    """
    stats: dict = {}
    prefix = "gold/latest"

    # Atalhos para os DataFrames mais usados
    tx   = silver.get("transactions_enriched", pd.DataFrame())
    pkgs = silver.get("packages_enriched", pd.DataFrame())
    res  = silver.get("residents_clean", pd.DataFrame())
    cs   = silver.get("cash_sessions_enriched", pd.DataFrame())
    tsk  = silver.get("daily_tasks_enriched", pd.DataFrame())
    mens = frames.get("mensalidades", pd.DataFrame())

    # ── 1. RECEITA DIARIA / SEMANAL / MENSAL
    if not tx.empty:
        income_mask  = (tx["type"] == "income")
        expense_mask = tx["type"].isin(["expense", "sangria"])
        sangria_mask = (tx["type"] == "sangria")

        df = tx.groupby(["date", "week", "month", "association_id", "association_name"]).agg(
            total_income    =("amount", lambda x: x[income_mask.loc[x.index]].sum()),
            total_expense   =("amount", lambda x: x[expense_mask.loc[x.index]].sum()),
            mensalidade     =("amount", lambda x: x[(tx.loc[x.index, "income_subtype"] == "mensalidade")].sum()),
            delivery_fee    =("amount", lambda x: x[(tx.loc[x.index, "income_subtype"] == "delivery_fee")].sum()),
            sangria_total   =("amount", lambda x: x[sangria_mask.loc[x.index]].sum()),
            income_count    =("id", lambda x: income_mask.loc[x.index].sum()),
            expense_count   =("id", lambda x: expense_mask.loc[x.index].sum()),
        ).reset_index()
        df["net"] = df["total_income"] - df["total_expense"]
        stats["daily_revenue"] = _upload(client, df, f"{prefix}/daily_revenue.parquet")

    # ── 2. CRESCIMENTO SEMANAL DE ASSOCIADOS
    if not res.empty:
        df = res[res["status"].isin(["active", "inactive"])].copy()
        df = df.groupby(["created_week", "association_id", "association_name", "type"]).agg(
            novos=("id", "count")
        ).reset_index().rename(columns={"created_week": "week"})
        stats["member_growth_weekly"] = _upload(client, df, f"{prefix}/member_growth_weekly.parquet")

    # ── 3. SNAPSHOT DE MORADORES POR ASSOCIACAO
    if not res.empty:
        active = res[res["status"] == "active"]
        today_ts = pd.Timestamp.now().normalize()
        week_start = today_ts - pd.Timedelta(days=today_ts.dayofweek)
        month_start = today_ts.replace(day=1)

        df = active.groupby(["association_id", "association_name"]).agg(
            total_ativos    =("id", "count"),
            members         =("type", lambda x: (x == "member").sum()),
            guests          =("type", lambda x: (x == "guest").sum()),
            dependents      =("type", lambda x: (x == "dependent").sum()),
            confirmed       =("is_member_confirmed", "sum"),
            sem_internet    =("sem_internet", "sum"),
            novos_semana    =("created_at", lambda x: (pd.to_datetime(x) >= week_start).sum()),
            novos_mes       =("created_at", lambda x: (pd.to_datetime(x) >= month_start).sum()),
        ).reset_index()
        df["inativos"] = res[res["status"] == "inactive"].groupby("association_id")["id"].count().reindex(df["association_id"].values, fill_value=0).values
        stats["resident_overview"] = _upload(client, df, f"{prefix}/resident_overview.parquet")

    # ── 4. TAXA DE COBRANCA MENSAL
    if not mens.empty:
        df = mens.copy()
        df["month"] = _month(mens["due_date"].fillna(mens["created_at"]))
        agg = df.groupby(["month", "association_id"]).agg(
            total       =("id", "count"),
            paid        =("status", lambda x: (x == "paid").sum()),
            valor_total =("amount", "sum"),
            valor_pago  =("amount", lambda x: x[df.loc[x.index, "status"] == "paid"].sum()),
        ).reset_index()
        agg["taxa_cobranca_pct"] = (agg["paid"] / agg["total"].replace(0, pd.NA) * 100).round(1)
        stats["collection_rate"] = _upload(client, df.merge(
            agg, on=["month", "association_id"], how="left"
        ).drop_duplicates(["month", "association_id"]), f"{prefix}/collection_rate.parquet")

        # versao simplificada
        stats["collection_rate"] = _upload(agg, f"{prefix}/collection_rate.parquet")

    # ── 5. INADIMPLENCIA DETALHADA
    if not res.empty and "overdue_months" in res.columns:
        df = res[res["overdue_months"] > 0][
            ["full_name", "unit", "block", "phone_primary", "type",
             "address_street", "association_id", "association_name",
             "overdue_months", "total_owed"]
        ].copy()
        df = df.sort_values("total_owed", ascending=False)
        stats["delinquency_report"] = _upload(client, df, f"{prefix}/delinquency_report.parquet")

    # ── 6. SLA ENCOMENDAS POR TIPO E SEMANA
    if not pkgs.empty:
        delivered = pkgs[pkgs["status"] == "delivered"].copy()
        today_ts  = pd.Timestamp.now()

        df_sla = delivered.groupby(
            ["received_week", "association_id", "association_name", "resident_type"]
        ).agg(
            entregues     =("id", "count"),
            avg_wait_hours=("wait_hours", "mean"),
            med_wait_hours=("wait_hours", "median"),
        ).reset_index().rename(columns={"received_week": "week"})
        df_sla["avg_wait_hours"] = df_sla["avg_wait_hours"].round(1)
        df_sla["med_wait_hours"] = df_sla["med_wait_hours"].round(1)

        # Paradas ha mais de 3/7 dias
        pending = pkgs[pkgs["status"].isin(["received", "notified"])].copy()
        if not pending.empty:
            pending["dias_parada"] = (today_ts - pending["received_at"]).dt.days
            paradas = pending.groupby(["association_id"]).agg(
                paradas_3d=("dias_parada", lambda x: (x >= 3).sum()),
                paradas_7d=("dias_parada", lambda x: (x >= 7).sum()),
            ).reset_index()
            # Salva separado
            stats["packages_stuck"] = _upload(client, paradas, f"{prefix}/packages_stuck.parquet")

        stats["sla_by_type"] = _upload(client, df_sla, f"{prefix}/sla_by_type.parquet")

    # ── 7. RANKING DE MORADORES (encomendas)
    if not pkgs.empty:
        df = pkgs.groupby(
            ["resident_id", "resident_name", "unit", "resident_type",
             "address_street", "association_id", "association_name"]
        ).agg(
            total_packages=("id", "count"),
            avg_wait_hours=("wait_hours", "mean"),
            delivered     =("status", lambda x: (x == "delivered").sum()),
            pending_now   =("status", lambda x: x.isin(["received", "notified"]).sum()),
        ).reset_index()
        df["avg_wait_hours"] = df["avg_wait_hours"].round(1)
        df = df.sort_values("total_packages", ascending=False).head(200)
        stats["resident_package_ranking"] = _upload(client, df, f"{prefix}/resident_package_ranking.parquet")

    # ── 8. ENCOMENDAS POR RUA
    if not pkgs.empty:
        df = pkgs.copy()
        df["street"] = df["address_street"].fillna("Nao informado").str.strip().replace("", "Nao informado")
        df = df.groupby(["street", "association_id", "association_name"]).agg(
            total_packages   =("id", "count"),
            distinct_residents=("resident_id", "nunique"),
            guest_packages   =("resident_type", lambda x: (x == "guest").sum()),
            member_packages  =("resident_type", lambda x: (x == "member").sum()),
            avg_wait_hours   =("wait_hours", "mean"),
        ).reset_index()
        df["avg_wait_hours"] = df["avg_wait_hours"].round(1)
        df = df.sort_values("total_packages", ascending=False)
        stats["packages_by_street"] = _upload(client, df, f"{prefix}/packages_by_street.parquet")

    # ── 9. PERFORMANCE DE OPERADORES (encomendas e sessoes)
    if not pkgs.empty and not cs.empty:
        pkg_recv = pkgs.groupby("received_by").agg(enc_recebidas=("id", "count")).reset_index().rename(columns={"received_by": "user_id"})
        pkg_delv = pkgs.groupby("delivered_by").agg(enc_entregues=("id", "count")).reset_index().rename(columns={"delivered_by": "user_id"})
        sess     = cs.groupby("opened_by").agg(
            sessoes         =("id", "count"),
            sessoes_conferidas=("status", lambda x: (x == "conferido").sum()),
        ).reset_index().rename(columns={"opened_by": "user_id"})

        users_df = frames.get("users", pd.DataFrame())
        if not users_df.empty:
            ops = users_df[users_df["role"] == "operator"].copy()
            df = ops.merge(sess, on="user_id", how="left") \
                    .merge(pkg_recv, on="user_id", how="left") \
                    .merge(pkg_delv, on="user_id", how="left")
            df["association_name"] = df["association_id"].map(
                frames["associations"].set_index("id")["name"].to_dict() if not frames.get("associations", pd.DataFrame()).empty else {}
            )
            df = df.fillna(0)
            stats["operator_performance"] = _upload(client, df[
                ["full_name", "association_id", "association_name",
                 "sessoes", "sessoes_conferidas", "enc_recebidas", "enc_entregues"]
            ], f"{prefix}/operator_performance.parquet")

    # ── 10. RECEITA POR OPERADOR POR SEMANA
    if not tx.empty:
        op_ids = set(frames.get("users", pd.DataFrame()).query("role == 'operator'")["id"].tolist()) if not frames.get("users", pd.DataFrame()).empty else set()
        df = tx[tx["created_by"].isin(op_ids)].copy()
        df = df.groupby(["created_by_name", "association_id", "association_name", "week"]).agg(
            receita_gerada=("amount", lambda x: x[tx.loc[x.index, "type"] == "income"].sum()),
            saidas        =("amount", lambda x: x[tx.loc[x.index, "type"].isin(["expense","sangria"])].sum()),
            n_transacoes  =("id", "count"),
        ).reset_index()
        stats["operator_revenue"] = _upload(client, df, f"{prefix}/operator_revenue.parquet")

    # ── 11. QUEBRA DE CAIXA
    if not cs.empty:
        df = cs.groupby(["week", "association_id", "association_name", "operador_name"]).agg(
            total_sessoes  =("id", "count"),
            com_diferenca  =("tem_diferenca", "sum"),
            com_quebra     =("tem_quebra", "sum"),
            total_diferenca=("difference", lambda x: x.abs().sum()),
            total_quebra   =("quebra_caixa", lambda x: x.abs().sum()),
        ).reset_index()
        df["pct_com_diferenca"] = (df["com_diferenca"] / df["total_sessoes"].replace(0, pd.NA) * 100).round(1)
        stats["cash_breaks"] = _upload(client, df, f"{prefix}/cash_breaks.parquet")

    # ── 12. MOTIVOS DE BAIXAS (SANGRIAS)
    if not tx.empty:
        sangrias = tx[tx["type"] == "sangria"].copy()
        if not sangrias.empty:
            sangrias["motivo"]  = sangrias["sangria_reason"].fillna("Nao informado").str.strip().replace("", "Nao informado")
            sangrias["destino"] = sangrias["sangria_destination"].fillna("Nao informado").str.strip().replace("", "Nao informado")
            df = sangrias.groupby(["motivo", "destino", "month", "association_id", "association_name"]).agg(
                ocorrencias=("id", "count"),
                valor_total=("amount", "sum"),
            ).reset_index().sort_values("valor_total", ascending=False)
            stats["sangria_reasons"] = _upload(client, df, f"{prefix}/sangria_reasons.parquet")

    # ── 13. TAREFAS SEMANAIS
    if not tsk.empty:
        ativas = tsk[~tsk["is_deleted"]]
        df = ativas.groupby(["week", "association_id", "association_name"]).agg(
            total      =("id", "count"),
            concluidas =("status", lambda x: (x == "done").sum()),
            pendentes  =("status", lambda x: (x == "pending").sum()),
            em_andamento=("status", lambda x: (x == "in_progress").sum()),
            bloqueadas =("status", lambda x: (x == "blocked").sum()),
            em_atraso  =("overdue", "sum"),
        ).reset_index()
        df["pct_conclusao"] = (df["concluidas"] / df["total"].replace(0, pd.NA) * 100).round(1)
        stats["tasks_weekly"] = _upload(client, df, f"{prefix}/tasks_weekly.parquet")

    # ── 14. RANKING DE COLABORADORES NAS TAREFAS
    if not tsk.empty:
        ativas = tsk[~tsk["is_deleted"] & tsk["assigned_to_name"].notna()]
        df = ativas.groupby(["assigned_to_name", "association_id", "association_name"]).agg(
            total      =("id", "count"),
            concluidas =("status", lambda x: (x == "done").sum()),
            pendentes  =("status", lambda x: (x == "pending").sum()),
            em_atraso  =("overdue", "sum"),
        ).reset_index()
        df["pct_conclusao"] = (df["concluidas"] / df["total"].replace(0, pd.NA) * 100).round(1)
        df = df.sort_values("concluidas", ascending=False)
        stats["tasks_by_collaborator"] = _upload(client, df, f"{prefix}/tasks_by_collaborator.parquet")

    # ── 15. CENSO POR RUA
    if not res.empty:
        active = res[res["status"] == "active"].copy()
        active["street"] = active["address_street"].fillna("Nao informado").str.strip().replace("", "Nao informado")
        df = active.groupby(["street", "association_id", "association_name"]).agg(
            total           =("id", "count"),
            associados      =("type", lambda x: (x == "member").sum()),
            visitantes      =("type", lambda x: (x == "guest").sum()),
            com_pragas      =("has_pests", "sum"),
            sem_saneamento  =("has_sewage", lambda x: (~x.fillna(True)).sum()),
            usa_transporte  =("uses_public_transport", "sum"),
            sem_internet    =("sem_internet", "sum"),
            com_problemas   =("has_problems", "sum"),
        ).reset_index().sort_values("total", ascending=False)
        stats["census_by_street"] = _upload(client, df, f"{prefix}/census_by_street.parquet")

    # ── 16. PROBLEMAS DA COMUNIDADE
    if not res.empty:
        active = res[res["status"] == "active"].copy()
        rows = []
        for _, r in active.iterrows():
            for p in _parse_jsonb(r.get("neighborhood_problems")):
                if p and str(p).strip():
                    rows.append({
                        "problem": str(p).strip(),
                        "association_id": r["association_id"],
                        "association_name": r.get("association_name"),
                        "resident_type": r["type"],
                    })
        if rows:
            df = pd.DataFrame(rows)
            df = df.groupby(["problem", "association_id", "association_name"]).agg(
                ocorrencias=("resident_type", "count"),
                de_associados=("resident_type", lambda x: (x == "member").sum()),
                de_visitantes=("resident_type", lambda x: (x == "guest").sum()),
            ).reset_index().sort_values("ocorrencias", ascending=False)
            stats["community_problems"] = _upload(client, df, f"{prefix}/community_problems.parquet")

    # ── 17. KPIs OPERACIONAIS SNAPSHOT
    assocs_df = frames.get("associations", pd.DataFrame())
    if not assocs_df.empty:
        today_ts = pd.Timestamp.now()
        rows_kpi = []
        for _, assoc in assocs_df.iterrows():
            aid  = assoc["id"]
            name = assoc["name"]
            if "Teste" in name:
                continue

            r_active    = res[(res["association_id"] == aid) & (res["status"] == "active")] if not res.empty else pd.DataFrame()
            r_inadimpl  = r_active[r_active.get("overdue_months", pd.Series(0, index=r_active.index)) > 0] if not r_active.empty else pd.DataFrame()
            p_pending   = pkgs[(pkgs["association_id"] == aid) & (pkgs["status"].isin(["received","notified"]))] if not pkgs.empty else pd.DataFrame()
            p_stuck_3d  = p_pending[p_pending["received_at"] < today_ts - pd.Timedelta(days=3)] if not p_pending.empty else pd.DataFrame()
            cs_open     = cs[(cs["association_id"] == aid) & (cs["status"] == "open")] if not cs.empty else pd.DataFrame()
            t_open      = tsk[(tsk["association_id"] == aid) & (~tsk["is_deleted"]) & (tsk["status"] != "done")] if not tsk.empty else pd.DataFrame()

            tx_hoje = pd.DataFrame()
            if not tx.empty:
                tx_hoje = tx[(tx["association_id"] == aid) &
                             (tx["type"] == "income") &
                             (tx["date"] == today_ts.date())]

            rows_kpi.append({
                "association_id":   aid,
                "association_name": name,
                "caixas_abertos":   len(cs_open),
                "receita_hoje":     tx_hoje["amount"].sum() if not tx_hoje.empty else 0,
                "enc_pendentes":    len(p_pending),
                "enc_paradas_3d":   len(p_stuck_3d),
                "associados_ativos":len(r_active),
                "inadimplentes":    len(r_inadimpl),
                "tarefas_abertas":  len(t_open),
                "snapshot_at":      today_ts.isoformat(),
            })

        if rows_kpi:
            stats["operational_kpis"] = _upload(client, pd.DataFrame(rows_kpi), f"{prefix}/operational_kpis.parquet")

    return stats


# ── Orchestrator ───────────────────────────────────────────────────────────────

async def run_full_etl(session: AsyncSession) -> dict:
    today      = date.today().isoformat()
    started_at = datetime.now(timezone.utc)
    client     = _r2_client()

    # 1. Bronze: UNICA conexao ao banco
    bronze_stats, bronze_frames = await export_bronze(session, today)

    # 2. Silver: pandas puro (zero queries ao banco)
    silver_stats, silver_frames = build_silver(bronze_frames, today, client)

    # 3. Gold: pandas puro (zero queries ao banco)
    gold_stats = build_gold(bronze_frames, silver_frames, client)

    duration = round((datetime.now(timezone.utc) - started_at).total_seconds(), 1)

    total_files = sum(1 for v in {**bronze_stats, **silver_stats, **gold_stats}.values() if v > 0)

    return {
        "status":      "ok",
        "date":        today,
        "duration_s":  duration,
        "files_total": total_files,
        "bronze":      bronze_stats,
        "silver":      silver_stats,
        "gold":        gold_stats,
    }
