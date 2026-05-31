"""
Data Lake Service — Medallion Architecture com Incremental Extract

Fluxo:
  1a execucao (carga inicial):
    Neon -> Bronze FULL -> Silver -> Gold -> R2

  2a+ execucao (incremental):
    Neon -> Bronze DELTA (so novos/alterados) -> merge com Bronze atual no R2
    Bronze consolidado -> Silver -> Gold -> R2

Metadata de controle:
    R2: _metadata/last_run.json -> { "last_extracted_at": "ISO8601", "is_initial": false }

Impacto Neon:
    Full (1a vez):   ~3.0 MB
    Incremental:     ~50 KB/dia  (98% de reducao)
    Semanal:         ~350 KB     (vs 21 MB no full diario)
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

METADATA_KEY = "_metadata/last_run.json"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _r2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
    )


def _upload_df(client, df: pd.DataFrame, key: str) -> int:
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
    logger.info("R2 %-55s %5d rows  %6.1f KB", key, len(df), len(buf.getvalue()) / 1024)
    return len(df)


def _download_df(client, key: str) -> pd.DataFrame:
    """Baixa parquet do R2. Retorna DataFrame vazio se nao existir."""
    try:
        obj = client.get_object(Bucket=settings.r2_bucket_name, Key=key)
        return pd.read_parquet(io.BytesIO(obj["Body"].read()))
    except client.exceptions.NoSuchKey:
        return pd.DataFrame()
    except Exception:
        return pd.DataFrame()


def _get_last_run(client) -> dict:
    """Le o metadata da ultima execucao no R2."""
    try:
        obj = client.get_object(Bucket=settings.r2_bucket_name, Key=METADATA_KEY)
        return json.loads(obj["Body"].read())
    except Exception:
        return {"last_extracted_at": None, "is_initial": True}


def _save_last_run(client, extracted_at: datetime) -> None:
    data = {
        "last_extracted_at": extracted_at.isoformat(),
        "is_initial": False,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    client.put_object(
        Bucket=settings.r2_bucket_name,
        Key=METADATA_KEY,
        Body=json.dumps(data, indent=2).encode(),
        ContentType="application/json",
    )


def _merge_bronze(existing: pd.DataFrame, delta: pd.DataFrame, id_col: str = "id",
                  ts_col: str = "updated_at") -> pd.DataFrame:
    """
    Faz merge do delta com o bronze existente.
    Para cada id: mantém o registro com o updated_at mais recente.
    """
    if existing.empty:
        return delta
    if delta.empty:
        return existing

    combined = pd.concat([existing, delta], ignore_index=True)

    if ts_col in combined.columns:
        combined[ts_col] = pd.to_datetime(combined[ts_col], utc=True, errors="coerce")
        combined = combined.sort_values(ts_col, ascending=False)

    if id_col in combined.columns:
        combined = combined.drop_duplicates(subset=[id_col], keep="first")

    return combined.reset_index(drop=True)


async def _fetch(session: AsyncSession, sql: str) -> pd.DataFrame:
    rows = (await session.execute(text(sql))).fetchall()
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows, columns=list(rows[0]._mapping.keys()))


def _parse_jsonb(val) -> list:
    if isinstance(val, list):
        return val
    try:
        return json.loads(val) if val else []
    except Exception:
        return []


def _week(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s).dt.to_period("W").apply(lambda x: x.start_time)


def _month(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s).dt.to_period("M").apply(lambda x: x.start_time)


# ── BRONZE ────────────────────────────────────────────────────────────────────

async def export_bronze(session: AsyncSession, today: str,
                        last_run: dict, client) -> tuple[dict, dict]:
    """
    Carga inicial (is_initial=True): extrai TUDO do Neon.
    Incremental (is_initial=False): so busca registros novos/alterados
    desde last_extracted_at, faz merge com Bronze existente no R2.
    """
    is_initial       = last_run.get("is_initial", True)
    last_ts_raw      = last_run.get("last_extracted_at")
    last_ts          = last_ts_raw or "1970-01-01T00:00:00+00:00"
    mode             = "FULL" if is_initial else f"INCREMENTAL desde {last_ts[:19]}"

    logger.info("Bronze mode: %s", mode)
    stats: dict = {}
    frames: dict[str, pd.DataFrame] = {}

    # Tabelas SEMPRE full (pequenas, < 10 KB): associations, users, payment_methods, categories
    small_tables = {
        "associations": "SELECT id, name, slug, is_active, simplifica_enabled, created_at FROM associations WHERE is_active = TRUE",
        "users": "SELECT id, full_name, email, role, association_id, is_active, created_at FROM users WHERE is_active = TRUE",
        "payment_methods": "SELECT id, name, is_active, association_id FROM payment_methods WHERE is_active = TRUE",
        "transaction_categories": "SELECT id, name, type, association_id FROM transaction_categories WHERE is_active = TRUE",
    }

    # Tabelas INCREMENTAIS: filtro por created_at/updated_at
    # Na carga inicial: sem filtro de data (traz tudo)
    # No incremental: WHERE updated_at > :ts OR created_at > :ts
    delta_filter = "" if is_initial else f"AND (updated_at > '{last_ts}' OR created_at > '{last_ts}')"
    delta_filter_created = "" if is_initial else f"AND created_at > '{last_ts}'"

    incremental_tables = {
        "residents": f"""
            SELECT id, association_id, type, status, full_name, cpf, unit, block,
                   address_street, address_neighborhood, address_city, address_cep,
                   phone_primary, email, monthly_payment_day, is_member_confirmed,
                   internet_access, has_sewage, has_pests, uses_public_transport,
                   neighborhood_problems, move_in_date, move_out_date,
                   created_at, updated_at
            FROM residents
            WHERE TRUE {delta_filter}
        """,
        "mensalidades": f"""
            SELECT id, association_id, resident_id, reference_month, due_date,
                   amount::float AS amount, status, paid_at, created_at, updated_at
            FROM mensalidades
            WHERE TRUE {delta_filter}
        """,
        "transactions": f"""
            SELECT id, association_id, cash_session_id, type, income_subtype,
                   amount::float AS amount, description, transaction_at,
                   payment_method_id, category_id, resident_id,
                   is_reversal, reversed_at,
                   sangria_reason, sangria_destination,
                   approval_status, created_by, created_at
            FROM transactions
            WHERE TRUE {delta_filter_created}
        """,
        "cash_sessions": f"""
            SELECT id, association_id, opened_by, closed_by, status,
                   opening_balance::float, closing_balance::float,
                   expected_balance::float, difference::float,
                   quebra_caixa::float, notes, opened_at, closed_at, updated_at,
                   created_at
            FROM cash_sessions
            WHERE TRUE {delta_filter}
        """,
        "packages": f"""
            SELECT id, association_id, status, unit, block,
                   carrier_name, tracking_code, has_delivery_fee,
                   delivery_fee_amount::float, delivery_fee_paid,
                   received_at, delivered_at, returned_at,
                   resident_id, received_by, delivered_by, delivered_to_name,
                   updated_at, created_at
            FROM packages
            WHERE TRUE {delta_filter}
        """,
        "daily_tasks": f"""
            SELECT id, association_id, title, description,
                   assigned_to, assigned_to_name, due_date, status,
                   checklist, created_by, created_at, updated_at, deleted_at
            FROM daily_tasks
            WHERE TRUE {delta_filter}
        """,
        "service_orders": f"""
            SELECT id, association_id, number, title, status, priority,
                   area, unit, requester_name, assigned_to, created_at, updated_at
            FROM service_orders
            WHERE status NOT IN ('cancelled','archived') {delta_filter}
        """,
    }

    # 1. Tabelas small: sempre full, sem merge
    for name, sql in small_tables.items():
        df = await _fetch(session, sql)
        frames[name] = df
        consolidated_key = f"bronze/current/{name}.parquet"
        if not df.empty:
            stats[name] = _upload_df(client, df, consolidated_key)
            # Tambem salva snapshot do dia
            _upload_df(client, df, f"bronze/{today}/{name}.parquet")

    # 2. Tabelas incrementais: busca delta + merge com existente
    for name, sql in incremental_tables.items():
        consolidated_key = f"bronze/current/{name}.parquet"
        delta_key        = f"bronze/{today}/{name}_delta.parquet"

        # Busca delta do Neon (carga inicial: tudo; incremental: so novos/alterados)
        delta_df = await _fetch(session, sql)
        logger.info("Bronze delta %-20s %d linhas do Neon", name, len(delta_df))

        if is_initial:
            # Carga inicial: delta JA é o tudo
            consolidated = delta_df
        else:
            # Incremental: merge delta com bronze existente no R2
            existing = _download_df(client, consolidated_key)
            logger.info("Bronze existing %-18s %d linhas no R2", name, len(existing))
            consolidated = _merge_bronze(existing, delta_df)

        frames[name] = consolidated

        # Salva bronze consolidado (fonte de verdade para Silver/Gold)
        if not consolidated.empty:
            stats[name] = _upload_df(client, consolidated, consolidated_key)

        # Salva delta do dia (auditoria)
        if not delta_df.empty:
            _upload_df(client, delta_df, delta_key)
            stats[f"{name}_delta_rows"] = len(delta_df)

    return stats, frames


# ── SILVER — pandas, zero queries ao banco ────────────────────────────────────

def build_silver(frames: dict[str, pd.DataFrame], today: str, client) -> tuple[dict, dict]:
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

    # transactions_enriched
    if not tx.empty:
        df = tx.copy()
        df = df[df["reversed_at"].isna() & (~df["is_reversal"])]
        df["association_name"]    = df["association_id"].map(assoc_map)
        df["created_by_name"]     = df["created_by"].map(user_map)
        df["payment_method_name"] = df["payment_method_id"].map(pm_map)
        df["category_name"]       = df["category_id"].map(cat_map)
        if not res.empty:
            res_slim = res.set_index("id")[["full_name", "type", "unit", "address_street"]].rename(
                columns={"full_name": "resident_name", "type": "resident_type"})
            df = df.join(res_slim, on="resident_id", how="left")
        df["date"]       = pd.to_datetime(df["transaction_at"]).dt.normalize()
        df["week"]       = _week(df["transaction_at"])
        df["month"]      = _month(df["transaction_at"])
        df["hour"]       = pd.to_datetime(df["transaction_at"]).dt.hour
        df["day_of_week"]= pd.to_datetime(df["transaction_at"]).dt.day_name()
        silver["transactions_enriched"] = df
        stats["transactions_enriched"] = _upload_df(client, df, f"silver/{today}/transactions_enriched.parquet")

    # packages_enriched
    if not pkgs.empty:
        df = pkgs.copy()
        df["association_name"]   = df["association_id"].map(assoc_map)
        df["received_by_name"]   = df["received_by"].map(user_map)
        df["delivered_by_name"]  = df["delivered_by"].map(user_map)
        if not res.empty:
            res_slim = res.set_index("id")[["full_name", "type", "address_street"]].rename(
                columns={"full_name": "resident_name", "type": "resident_type"})
            df = df.join(res_slim, on="resident_id", how="left")
        df["received_at"]   = pd.to_datetime(df["received_at"])
        df["delivered_at"]  = pd.to_datetime(df["delivered_at"])
        df["wait_hours"]    = (df["delivered_at"] - df["received_at"]).dt.total_seconds() / 3600
        df["received_week"] = _week(df["received_at"])
        df["received_month"]= _month(df["received_at"])
        silver["packages_enriched"] = df
        stats["packages_enriched"] = _upload_df(client, df, f"silver/{today}/packages_enriched.parquet")

    # residents_clean
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
        df["problems_list"] = df["neighborhood_problems"].apply(_parse_jsonb)
        df["problem_count"] = df["problems_list"].apply(len)
        df["has_problems"]  = df["problem_count"] > 0
        df["sem_internet"]  = df["internet_access"].isin(["Sem acesso", "Nenhum"]) | df["internet_access"].isna()
        df["created_week"]  = _week(df["created_at"])
        df["created_month"] = _month(df["created_at"])
        silver["residents_clean"] = df
        stats["residents_clean"] = _upload_df(client, df, f"silver/{today}/residents_clean.parquet")

    # cash_sessions_enriched
    if not cs.empty:
        df = cs.copy()
        df["association_name"] = df["association_id"].map(assoc_map)
        df["operador_name"]    = df["opened_by"].map(user_map)
        df["tem_quebra"]       = df["quebra_caixa"].notna() & (df["quebra_caixa"] != 0)
        df["tem_diferenca"]    = df["difference"].notna() & (df["difference"].abs() > 0.01)
        df["week"]             = _week(df["opened_at"])
        df["month"]            = _month(df["opened_at"])
        silver["cash_sessions_enriched"] = df
        stats["cash_sessions_enriched"] = _upload_df(client, df, f"silver/{today}/cash_sessions_enriched.parquet")

    # daily_tasks_enriched
    if not tasks.empty:
        df = tasks.copy()
        df["association_name"] = df["association_id"].map(assoc_map)
        df["created_by_name"]  = df["created_by"].map(user_map)
        df["is_deleted"]       = df["deleted_at"].notna()
        df["week"]             = _week(df["created_at"])
        df["month"]            = _month(df["created_at"])
        df["overdue"] = (
            (df["status"] != "done") &
            df["due_date"].notna() &
            (pd.to_datetime(df["due_date"]) < pd.Timestamp.now().normalize())
        )
        silver["daily_tasks_enriched"] = df
        stats["daily_tasks_enriched"] = _upload_df(client, df, f"silver/{today}/daily_tasks_enriched.parquet")

    return stats, silver


# ── GOLD — pandas puro, zero queries ao banco ─────────────────────────────────

def build_gold(frames: dict[str, pd.DataFrame], silver: dict[str, pd.DataFrame], client) -> dict:
    """
    17 arquivos gold construidos inteiramente com pandas groupby.
    Nenhuma conexao ao banco de dados.
    """
    stats: dict = {}
    pfx = "gold/latest"

    tx   = silver.get("transactions_enriched", pd.DataFrame())
    pkgs = silver.get("packages_enriched", pd.DataFrame())
    res  = silver.get("residents_clean", pd.DataFrame())
    cs   = silver.get("cash_sessions_enriched", pd.DataFrame())
    tsk  = silver.get("daily_tasks_enriched", pd.DataFrame())
    mens = frames.get("mensalidades", pd.DataFrame())

    def up(df, name):
        stats[name] = _upload_df(client, df, f"{pfx}/{name}.parquet")

    # 1. Receita diaria / semanal / mensal
    if not tx.empty:
        def agg_tx(grp):
            return pd.Series({
                "total_income":   grp.loc[grp["type"] == "income",  "amount"].sum(),
                "total_expense":  grp.loc[grp["type"].isin(["expense","sangria"]), "amount"].sum(),
                "mensalidade":    grp.loc[grp["income_subtype"] == "mensalidade", "amount"].sum(),
                "delivery_fee":   grp.loc[grp["income_subtype"] == "delivery_fee", "amount"].sum(),
                "sangria_total":  grp.loc[grp["type"] == "sangria", "amount"].sum(),
                "income_count":   (grp["type"] == "income").sum(),
                "expense_count":  (grp["type"] == "expense").sum(),
            })
        df = tx.groupby(["date","week","month","association_id","association_name"]).apply(agg_tx).reset_index()
        df["net"] = df["total_income"] - df["total_expense"]
        up(df, "daily_revenue")

    # 2. Crescimento semanal de associados
    if not res.empty:
        df = res[res["status"].isin(["active","inactive"])].groupby(
            ["created_week","association_id","association_name","type"]
        ).agg(novos=("id","count")).reset_index().rename(columns={"created_week":"week"})
        up(df, "member_growth_weekly")

    # 3. Snapshot de moradores
    if not res.empty:
        active = res[res["status"] == "active"]
        now    = pd.Timestamp.now()
        week0  = now - pd.Timedelta(days=now.dayofweek)
        month0 = now.replace(day=1)
        df = active.groupby(["association_id","association_name"]).apply(lambda g: pd.Series({
            "total_ativos":  len(g),
            "members":       (g["type"]=="member").sum(),
            "guests":        (g["type"]=="guest").sum(),
            "dependents":    (g["type"]=="dependent").sum(),
            "confirmed":     g["is_member_confirmed"].sum(),
            "sem_internet":  g["sem_internet"].sum(),
            "novos_semana":  (pd.to_datetime(g["created_at"]) >= week0).sum(),
            "novos_mes":     (pd.to_datetime(g["created_at"]) >= month0).sum(),
        })).reset_index()
        up(df, "resident_overview")

    # 4. Taxa de cobranca
    if not mens.empty:
        df = mens.copy()
        df["month"] = _month(mens["due_date"].fillna(mens["created_at"]))
        agg = df.groupby(["month","association_id"]).apply(lambda g: pd.Series({
            "total":       len(g),
            "paid":        (g["status"]=="paid").sum(),
            "valor_total": g["amount"].sum(),
            "valor_pago":  g.loc[g["status"]=="paid","amount"].sum(),
        })).reset_index()
        agg["taxa_pct"] = (agg["paid"] / agg["total"].replace(0, pd.NA) * 100).round(1)
        up(agg, "collection_rate")

    # 5. Inadimplencia
    if not res.empty and "overdue_months" in res.columns:
        df = res[res["overdue_months"] > 0][[
            "full_name","unit","block","phone_primary","type",
            "address_street","association_id","association_name",
            "overdue_months","total_owed"
        ]].sort_values("total_owed", ascending=False)
        up(df, "delinquency_report")

    # 6. SLA por tipo de morador
    if not pkgs.empty:
        delivered = pkgs[pkgs["status"]=="delivered"]
        df = delivered.groupby(["received_week","association_id","association_name","resident_type"]).agg(
            entregues     =("id","count"),
            avg_wait_hours=("wait_hours","mean"),
            med_wait_hours=("wait_hours","median"),
        ).reset_index().rename(columns={"received_week":"week"})
        df[["avg_wait_hours","med_wait_hours"]] = df[["avg_wait_hours","med_wait_hours"]].round(1)
        up(df, "sla_by_type")

        # Encomendas paradas
        pending = pkgs[pkgs["status"].isin(["received","notified"])].copy()
        if not pending.empty:
            now = pd.Timestamp.now()
            pending["dias_parada"] = (now - pending["received_at"]).dt.days
            up(pending.groupby("association_id").agg(
                paradas_3d=("dias_parada", lambda x: (x>=3).sum()),
                paradas_7d=("dias_parada", lambda x: (x>=7).sum()),
            ).reset_index(), "packages_stuck")

    # 7. Ranking de moradores
    if not pkgs.empty:
        df = pkgs.groupby(["resident_id","resident_name","unit","resident_type",
                           "address_street","association_id","association_name"]).agg(
            total_packages=("id","count"),
            avg_wait_hours=("wait_hours","mean"),
            delivered     =("status", lambda x: (x=="delivered").sum()),
            pending_now   =("status", lambda x: x.isin(["received","notified"]).sum()),
        ).reset_index()
        df["avg_wait_hours"] = df["avg_wait_hours"].round(1)
        up(df.sort_values("total_packages",ascending=False).head(200), "resident_package_ranking")

    # 8. Encomendas por rua
    if not pkgs.empty:
        df = pkgs.copy()
        df["street"] = df["address_street"].fillna("Nao informado").str.strip().replace("","Nao informado")
        up(df.groupby(["street","association_id","association_name"]).agg(
            total=("id","count"),
            distinct_res=("resident_id","nunique"),
            guests      =("resident_type", lambda x: (x=="guest").sum()),
            members     =("resident_type", lambda x: (x=="member").sum()),
            avg_wait    =("wait_hours","mean"),
        ).reset_index().sort_values("total",ascending=False), "packages_by_street")

    # 9. Performance operadores
    if not pkgs.empty:
        users_df = frames.get("users", pd.DataFrame())
        if not users_df.empty:
            ops = users_df[users_df["role"]=="operator"]
            recv = pkgs.groupby("received_by").agg(enc_recv=("id","count")).reset_index().rename(columns={"received_by":"id"})
            delv = pkgs.groupby("delivered_by").agg(enc_delv=("id","count")).reset_index().rename(columns={"delivered_by":"id"})
            sess_df = cs if not cs.empty else pd.DataFrame()
            sess = (sess_df.groupby("opened_by").agg(sessoes=("id","count")).reset_index().rename(columns={"opened_by":"id"})
                    if not sess_df.empty else pd.DataFrame(columns=["id","sessoes"]))
            df = ops.merge(recv,on="id",how="left").merge(delv,on="id",how="left").merge(sess,on="id",how="left")
            assoc_map = frames["associations"].set_index("id")["name"].to_dict() if not frames.get("associations",pd.DataFrame()).empty else {}
            df["association_name"] = df["association_id"].map(assoc_map)
            up(df[["full_name","association_id","association_name","sessoes","enc_recv","enc_delv"]].fillna(0),
               "operator_performance")

    # 10. Receita por operador
    if not tx.empty:
        users_df = frames.get("users", pd.DataFrame())
        op_ids = set(users_df[users_df["role"]=="operator"]["id"].tolist()) if not users_df.empty else set()
        df = tx[tx["created_by"].isin(op_ids)].copy()
        df = df.groupby(["created_by_name","association_id","association_name","week"]).apply(lambda g: pd.Series({
            "receita":     g.loc[g["type"]=="income","amount"].sum(),
            "saidas":      g.loc[g["type"].isin(["expense","sangria"]),"amount"].sum(),
            "n_transacoes":len(g),
        })).reset_index()
        up(df, "operator_revenue")

    # 11. Quebra de caixa
    if not cs.empty:
        df = cs.groupby(["week","association_id","association_name","operador_name"]).agg(
            total          =("id","count"),
            com_diferenca  =("tem_diferenca","sum"),
            com_quebra     =("tem_quebra","sum"),
            total_diferenca=("difference", lambda x: x.abs().sum()),
            total_quebra   =("quebra_caixa", lambda x: x.abs().sum()),
        ).reset_index()
        df["pct_diferenca"] = (df["com_diferenca"]/df["total"].replace(0,pd.NA)*100).round(1)
        up(df, "cash_breaks")

    # 12. Motivos de baixas
    if not tx.empty:
        sangrias = tx[tx["type"]=="sangria"].copy()
        if not sangrias.empty:
            sangrias["motivo"]  = sangrias["sangria_reason"].fillna("Nao informado").str.strip().replace("","Nao informado")
            sangrias["destino"] = sangrias["sangria_destination"].fillna("Nao informado").str.strip().replace("","Nao informado")
            up(sangrias.groupby(["motivo","destino","month","association_id","association_name"]).agg(
                ocorrencias=("id","count"), valor=("amount","sum")
            ).reset_index().sort_values("valor",ascending=False), "sangria_reasons")

    # 13. Tarefas semanais
    if not tsk.empty:
        ativas = tsk[~tsk["is_deleted"]]
        df = ativas.groupby(["week","association_id","association_name"]).apply(lambda g: pd.Series({
            "total":       len(g),
            "concluidas":  (g["status"]=="done").sum(),
            "pendentes":   (g["status"]=="pending").sum(),
            "em_andamento":(g["status"]=="in_progress").sum(),
            "bloqueadas":  (g["status"]=="blocked").sum(),
            "em_atraso":   g["overdue"].sum(),
        })).reset_index()
        df["pct_conclusao"] = (df["concluidas"]/df["total"].replace(0,pd.NA)*100).round(1)
        up(df, "tasks_weekly")

    # 14. Ranking colaboradores
    if not tsk.empty:
        ativas = tsk[~tsk["is_deleted"] & tsk["assigned_to_name"].notna()]
        df = ativas.groupby(["assigned_to_name","association_id","association_name"]).apply(lambda g: pd.Series({
            "total":      len(g),
            "concluidas": (g["status"]=="done").sum(),
            "pendentes":  (g["status"]=="pending").sum(),
            "em_atraso":  g["overdue"].sum(),
        })).reset_index()
        df["pct_conclusao"] = (df["concluidas"]/df["total"].replace(0,pd.NA)*100).round(1)
        up(df.sort_values("concluidas",ascending=False), "tasks_by_collaborator")

    # 15. Censo por rua
    if not res.empty:
        active = res[res["status"]=="active"].copy()
        active["street"] = active["address_street"].fillna("Nao informado").str.strip().replace("","Nao informado")
        up(active.groupby(["street","association_id","association_name"]).agg(
            total        =("id","count"),
            associados   =("type", lambda x: (x=="member").sum()),
            visitantes   =("type", lambda x: (x=="guest").sum()),
            com_pragas   =("has_pests","sum"),
            sem_internet =("sem_internet","sum"),
            com_problemas=("has_problems","sum"),
        ).reset_index().sort_values("total",ascending=False), "census_by_street")

    # 16. Problemas da comunidade
    if not res.empty:
        rows = []
        for _, r in res[res["status"]=="active"].iterrows():
            for p in _parse_jsonb(r.get("neighborhood_problems")):
                if p and str(p).strip():
                    rows.append({"problem":str(p).strip(),"association_id":r["association_id"],
                                 "association_name":r.get("association_name"),"resident_type":r["type"]})
        if rows:
            df = pd.DataFrame(rows).groupby(["problem","association_id","association_name"]).agg(
                ocorrencias=("resident_type","count"),
                associados =("resident_type", lambda x: (x=="member").sum()),
                visitantes =("resident_type", lambda x: (x=="guest").sum()),
            ).reset_index().sort_values("ocorrencias",ascending=False)
            up(df, "community_problems")

    # 17. KPIs operacionais (snapshot)
    assocs_df = frames.get("associations", pd.DataFrame())
    if not assocs_df.empty:
        now   = pd.Timestamp.now()
        week0 = now - pd.Timedelta(days=now.dayofweek)
        rows_kpi = []
        for _, assoc in assocs_df.iterrows():
            aid, name = assoc["id"], assoc["name"]
            if "Teste" in name:
                continue
            r_active   = res[(res["association_id"]==aid)&(res["status"]=="active")] if not res.empty else pd.DataFrame()
            p_pending  = pkgs[(pkgs["association_id"]==aid)&(pkgs["status"].isin(["received","notified"]))] if not pkgs.empty else pd.DataFrame()
            cs_open    = cs[(cs["association_id"]==aid)&(cs["status"]=="open")] if not cs.empty else pd.DataFrame()
            t_open     = tsk[(tsk["association_id"]==aid)&(~tsk["is_deleted"])&(tsk["status"]!="done")] if not tsk.empty else pd.DataFrame()
            tx_hoje    = tx[(tx["association_id"]==aid)&(tx["type"]=="income")&(tx["date"]==now.date())] if not tx.empty else pd.DataFrame()
            rows_kpi.append({
                "association_id":   aid,
                "association_name": name,
                "caixas_abertos":   len(cs_open),
                "receita_hoje":     tx_hoje["amount"].sum() if not tx_hoje.empty else 0,
                "enc_pendentes":    len(p_pending),
                "enc_paradas_3d":   len(p_pending[p_pending["received_at"]<now-pd.Timedelta(days=3)]) if not p_pending.empty else 0,
                "associados_ativos":len(r_active),
                "inadimplentes":    len(r_active[r_active.get("overdue_months",pd.Series(0,index=r_active.index))>0]) if not r_active.empty else 0,
                "tarefas_abertas":  len(t_open),
                "novos_semana":     len(r_active[pd.to_datetime(r_active["created_at"])>=week0]) if not r_active.empty else 0,
                "snapshot_at":      now.isoformat(),
            })
        if rows_kpi:
            up(pd.DataFrame(rows_kpi), "operational_kpis")

    return stats


# ── Orchestrator ───────────────────────────────────────────────────────────────

async def run_full_etl(session: AsyncSession, force_full: bool = False) -> dict:
    today      = date.today().isoformat()
    started_at = datetime.now(timezone.utc)
    client     = _r2_client()

    # Le metadata da ultima execucao
    last_run = _get_last_run(client)
    if force_full:
        last_run = {"last_extracted_at": None, "is_initial": True}

    mode = "FULL (carga inicial)" if last_run.get("is_initial", True) else f"INCREMENTAL desde {last_run.get('last_extracted_at','?')[:19]}"
    logger.info("ETL iniciado — modo: %s", mode)

    # 1. Bronze: unica conexao ao Neon (full ou incremental)
    bronze_stats, bronze_frames = await export_bronze(session, today, last_run, client)

    # 2. Silver: pandas (zero banco)
    silver_stats, silver_frames = build_silver(bronze_frames, today, client)

    # 3. Gold: pandas (zero banco)
    gold_stats = build_gold(bronze_frames, silver_frames, client)

    # 4. Atualiza metadata
    _save_last_run(client, started_at)

    duration    = round((datetime.now(timezone.utc) - started_at).total_seconds(), 1)
    total_files = sum(1 for k, v in {**bronze_stats, **silver_stats, **gold_stats}.items()
                      if isinstance(v, int) and v > 0 and "delta_rows" not in k)

    return {
        "status":      "ok",
        "mode":        mode,
        "date":        today,
        "duration_s":  duration,
        "files_total": total_files,
        "bronze":      bronze_stats,
        "silver":      silver_stats,
        "gold":        gold_stats,
    }
