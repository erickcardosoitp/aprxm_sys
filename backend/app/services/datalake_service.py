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

METADATA_KEY = "_controle/estado_etl.json"

# Mapeamento: nome interno -> nome no R2 (portugues)
BRONZE_NAMES = {
    "associations":          "associacoes",
    "users":                 "usuarios",
    "payment_methods":       "formas_pagamento",
    "transaction_categories":"categorias",
    "residents":             "moradores",
    "mensalidades":          "mensalidades",
    "migration_payments":    "pagamentos_migrados",
    "transactions":          "transacoes",
    "cash_sessions":         "sessoes_caixa",
    "packages":              "encomendas",
    "daily_tasks":           "tarefas",
    "service_orders":        "ordens_servico",
}

SILVER_NAMES = {
    "transactions_enriched":    "transacoes_enriquecidas",
    "packages_enriched":        "encomendas_enriquecidas",
    "residents_clean":          "moradores_limpos",
    "cash_sessions_enriched":   "sessoes_enriquecidas",
    "daily_tasks_enriched":     "tarefas_enriquecidas",
}

# Gold: (nome_interno, dominio, nome_arquivo)
GOLD_PATHS = {
    "daily_revenue":             ("financeiro", "receita_diaria"),
    "collection_rate":           ("financeiro", "taxa_cobranca"),
    "cash_breaks":               ("financeiro", "quebras_caixa"),
    "sangria_reasons":           ("financeiro", "motivos_baixas"),
    "delinquency_report":        ("financeiro", "inadimplencia"),
    "resident_overview":         ("moradores",  "visao_geral"),
    "member_growth_weekly":      ("moradores",  "crescimento_semanal"),
    "census_by_street":          ("moradores",  "censo_por_rua"),
    "community_problems":        ("moradores",  "problemas_comunidade"),
    "sla_by_type":               ("encomendas", "sla_por_tipo"),
    "packages_by_street":        ("encomendas", "encomendas_por_rua"),
    "packages_stuck":            ("encomendas", "encomendas_paradas"),
    "resident_package_ranking":  ("encomendas", "ranking_moradores"),
    "operator_performance":      ("operacional","desempenho_operadores"),
    "operator_revenue":          ("operacional","receita_por_operador"),
    "operational_kpis":          ("operacional","kpis_operacionais"),
    "tasks_weekly":              ("equipe",     "tarefas_semanais"),
    "tasks_by_collaborator":     ("equipe",     "ranking_colaboradores"),
    "runway":                    ("financeiro", "runway"),
    "receita_por_operador_tipo":  ("financeiro", "receita_por_operador_tipo"),
    "cobranca_por_rua":           ("financeiro", "cobranca_por_rua"),
    "cash_session_anomalies":     ("operacional","anomalias_caixa"),
}


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
        combined[ts_col] = _to_dt(combined[ts_col])  # sempre tz-naive para consistencia
        combined = combined.sort_values(ts_col, ascending=False)

    if id_col in combined.columns:
        combined = combined.drop_duplicates(subset=[id_col], keep="first")

    return combined.reset_index(drop=True)


async def _fetch(session: AsyncSession, sql: str) -> pd.DataFrame:
    rows = (await session.execute(text(sql))).fetchall()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=list(rows[0]._mapping.keys()))
    # Converte UUID e tipos asyncpg nao suportados pelo PyArrow
    for col in df.columns:
        if df[col].dtype == object:
            try:
                sample = df[col].dropna().iloc[0] if not df[col].dropna().empty else None
                if sample is None:
                    pass
                elif hasattr(sample, 'hex'):  # UUID asyncpg
                    df[col] = df[col].apply(lambda x: str(x) if x is not None else None)
                elif hasattr(sample, 'tzinfo'):  # datetime com timezone (object dtype)
                    df[col] = pd.to_datetime(df[col], utc=True).dt.tz_localize(None)
            except Exception:
                pass
        # Remove timezone de colunas datetime64 para comparacoes uniformes
        elif hasattr(df[col], 'dt') and df[col].dt.tz is not None:
            df[col] = df[col].dt.tz_localize(None)
    return df


def _parse_jsonb(val) -> list:
    if isinstance(val, list):
        return val
    try:
        return json.loads(val) if val else []
    except Exception:
        return []


def _to_dt(s: pd.Series) -> pd.Series:
    """Converte para datetime64[ns] sem timezone (tz-naive) de forma segura."""
    converted = pd.to_datetime(s, errors="coerce", utc=True)
    if converted.dt.tz is not None:
        converted = converted.dt.tz_localize(None)
    return converted


def _normalize_street(s: pd.Series) -> pd.Series:
    """Normaliza nomes de rua: strip + Title Case + remove duplicatas por acento/case."""
    import unicodedata

    def _clean(val):
        if not val or not str(val).strip():
            return "Não Informado"
        v = str(val).strip()
        # Remove acentos para comparação (normaliza NFD → só ASCII)
        v_norm = unicodedata.normalize("NFD", v)
        v_ascii = "".join(c for c in v_norm if unicodedata.category(c) != "Mn").lower()
        # Retorna title case do original se válido, senão usa ascii limpo
        if len(v_ascii) < 2:
            return "Não Informado"
        # Re-aplica title case na versão original (preserva acentos corretos)
        return v.title()

    return s.apply(_clean)


def _week(s: pd.Series) -> pd.Series:
    return _to_dt(s).dt.to_period("W").apply(lambda x: x.start_time)


def _month(s: pd.Series) -> pd.Series:
    return _to_dt(s).dt.to_period("M").apply(lambda x: x.start_time)


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
        "migration_payments": "SELECT id, resident_id, association_id, competencia, valor_pago::float AS valor_pago FROM migration_payments",
    }

    # Tabelas INCREMENTAIS: filtro por created_at/updated_at
    # Na carga inicial: sem filtro de data (traz tudo)
    # No incremental: WHERE updated_at > :ts OR created_at > :ts
    delta_filter = "" if is_initial else f"AND (updated_at > '{last_ts}' OR created_at > '{last_ts}')"
    delta_filter_created = "" if is_initial else f"AND created_at > '{last_ts}'"

    incremental_tables = {
        "residents": f"""
            SELECT id, association_id, type, status, full_name, cpf,
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
                   created_at,
                   dinheiro_contado::float, pix_contado::float, quebra_motivo
            FROM cash_sessions
            WHERE TRUE {delta_filter}
        """,
        "packages": f"""
            SELECT id, association_id, status,
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
                   area, requester_name, assigned_to, created_at, updated_at
            FROM service_orders
            WHERE status NOT IN ('cancelled','archived') {delta_filter}
        """,
    }

    # Particionamento de data para historico: YYYY/MM/DD
    date_parts = today.replace("-", "/")  # 2026-06-01 -> 2026/06/01

    # 1. Tabelas small: sempre full, sem merge
    for name, sql in small_tables.items():
        df = await _fetch(session, sql)
        frames[name] = df
        pt = BRONZE_NAMES.get(name, name)
        consolidated_key = f"bronze/atual/{pt}.parquet"
        if not df.empty:
            stats[name] = _upload_df(client, df, consolidated_key)

    # 2. Tabelas incrementais: busca delta + merge com existente
    for name, sql in incremental_tables.items():
        pt               = BRONZE_NAMES.get(name, name)
        consolidated_key = f"bronze/atual/{pt}.parquet"
        delta_key        = f"bronze/historico/{date_parts}/{pt}_delta.parquet"

        delta_df = await _fetch(session, sql)
        logger.info("Bronze delta %-25s %d linhas do Neon", pt, len(delta_df))

        if is_initial:
            consolidated = delta_df
        else:
            existing = _download_df(client, consolidated_key)
            logger.info("Bronze atual  %-25s %d linhas no R2", pt, len(existing))
            consolidated = _merge_bronze(existing, delta_df)

        frames[name] = consolidated

        if not consolidated.empty:
            stats[name] = _upload_df(client, consolidated, consolidated_key)

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
            res_slim = res.set_index("id")[["full_name", "type", "address_street"]].rename(
                columns={"full_name": "resident_name", "type": "resident_type"})
            df = df.join(res_slim, on="resident_id", how="left")
        _ta              = _to_dt(df["transaction_at"])
        df["date"]       = _ta.dt.normalize()
        df["week"]       = _week(df["transaction_at"])
        df["month"]      = _month(df["transaction_at"])
        df["hour"]       = _ta.dt.hour
        df["day_of_week"]= _ta.dt.day_name()
        silver["transactions_enriched"] = df
        stats["transactions_enriched"] = _upload_df(client, df, f"prata/{today}/{SILVER_NAMES['transactions_enriched']}.parquet")

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
        df["address_street"] = _normalize_street(df["address_street"])
        df["received_at"]   = _to_dt(df["received_at"])
        df["delivered_at"]  = _to_dt(df["delivered_at"])
        df["wait_hours"]    = (df["delivered_at"] - df["received_at"]).dt.total_seconds() / 3600
        df["received_week"] = _week(df["received_at"])
        df["received_month"]= _month(df["received_at"])
        silver["packages_enriched"] = df
        stats["packages_enriched"] = _upload_df(client, df, f"prata/{today}/{SILVER_NAMES['packages_enriched']}.parquet")

    # residents_clean
    if not res.empty:
        df = res.copy()
        df["association_name"]  = df["association_id"].map(assoc_map)
        df["address_street"]    = _normalize_street(df["address_street"])
        if not mens.empty:
            today_ts = pd.Timestamp.now().normalize()
            grace_cutoff = today_ts - pd.Timedelta(days=2)
            migr = frames.get("migration_payments", pd.DataFrame())
            # Meses cobertos por migration_payments (não são inadimplência real)
            migr_keys = set()
            if not migr.empty and "resident_id" in migr.columns and "competencia" in migr.columns:
                migr_keys = set(zip(migr["resident_id"].astype(str), migr["competencia"].astype(str)))
            # Aplica mesma lógica do sistema: grace 2d + exclui migration_payments
            mens_overdue = mens[
                (mens["status"].isin(["pending"])) &
                (_to_dt(mens["due_date"]) < grace_cutoff)
            ].copy()
            if migr_keys:
                mens_overdue = mens_overdue[
                    ~mens_overdue.apply(
                        lambda r: (str(r["resident_id"]), str(r["reference_month"])) in migr_keys,
                        axis=1
                    )
                ]
            overdue = mens_overdue.groupby("resident_id").agg(
                overdue_months=("id", "count"),
                total_owed=("amount", "sum")
            ).reset_index()
            df = df.merge(overdue, left_on="id", right_on="resident_id", how="left")
            df["overdue_months"] = df["overdue_months"].fillna(0).astype(int)
            df["total_owed"]     = df["total_owed"].fillna(0.0)
        df["problems_list"] = df["neighborhood_problems"].apply(_parse_jsonb)
        df["problem_count"] = df["problems_list"].apply(len)
        df["has_problems"]  = df["problem_count"] > 0
        df["sem_internet"]  = df["internet_access"].isin(["Sem acesso", "Nenhum"])
        df["created_week"]  = _week(df["created_at"])
        df["created_month"] = _month(df["created_at"])
        silver["residents_clean"] = df
        stats["residents_clean"] = _upload_df(client, df, f"prata/{today}/{SILVER_NAMES['residents_clean']}.parquet")

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
        stats["cash_sessions_enriched"] = _upload_df(client, df, f"prata/{today}/{SILVER_NAMES['cash_sessions_enriched']}.parquet")

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
            (pd.to_datetime(df["due_date"]).dt.tz_localize(None) < pd.Timestamp.now().normalize())
        )
        silver["daily_tasks_enriched"] = df
        stats["daily_tasks_enriched"] = _upload_df(client, df, f"prata/{today}/{SILVER_NAMES['daily_tasks_enriched']}.parquet")

    return stats, silver


# ── GOLD — pandas puro, zero queries ao banco ─────────────────────────────────

def build_gold(frames: dict[str, pd.DataFrame], silver: dict[str, pd.DataFrame], client) -> tuple[dict, dict]:
    """
    17 arquivos gold construidos inteiramente com pandas groupby.
    Nenhuma conexao ao banco de dados.
    Retorna (stats, gold_frames) para posterior carga no Analytics DB.
    """
    stats: dict = {}
    gold_frames: dict[str, pd.DataFrame] = {}

    tx   = silver.get("transactions_enriched", pd.DataFrame())
    pkgs = silver.get("packages_enriched", pd.DataFrame())
    res  = silver.get("residents_clean", pd.DataFrame())
    cs   = silver.get("cash_sessions_enriched", pd.DataFrame())
    tsk  = silver.get("daily_tasks_enriched", pd.DataFrame())
    mens = frames.get("mensalidades", pd.DataFrame())

    def up(df, name):
        dominio, arquivo = GOLD_PATHS.get(name, ("outros", name))
        key = f"ouro/{dominio}/{arquivo}.parquet"
        stats[name] = _upload_df(client, df, key)
        if not df.empty:
            gold_frames[name] = df

    # 1. Receita diaria / semanal / mensal
    if not tx.empty:
        def agg_tx(grp):
            inc = grp[grp["type"] == "income"]
            return pd.Series({
                "total_income":        inc["amount"].sum(),
                "total_expense":       grp.loc[grp["type"].isin(["expense","sangria"]), "amount"].sum(),
                "mensalidade":         inc.loc[inc["income_subtype"] == "mensalidade", "amount"].sum(),
                "delivery_fee":        inc.loc[inc["income_subtype"] == "delivery_fee", "amount"].sum(),
                "proof_of_residence":  inc.loc[inc["income_subtype"] == "proof_of_residence", "amount"].sum(),
                "other_income":        inc.loc[inc["income_subtype"] == "other", "amount"].sum(),
                "uncategorized":       inc.loc[inc["income_subtype"].isna(), "amount"].sum(),
                "sangria_total":       grp.loc[grp["type"] == "sangria", "amount"].sum(),
                "income_count":        (grp["type"] == "income").sum(),
                "expense_count":       (grp["type"] == "expense").sum(),
            })
        df = tx.groupby(["date","week","month","association_id","association_name"]).apply(agg_tx).reset_index()
        df["net"] = df["total_income"] - df["total_expense"]
        up(df, "daily_revenue")

    # 2. Crescimento semanal de associados
    if not res.empty:
        df = res[res["status"] == "active"].groupby(
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
            "novos_semana":  (_to_dt(g["created_at"]) >= week0).sum(),
            "novos_mes":     (_to_dt(g["created_at"]) >= month0).sum(),
        })).reset_index()
        up(df, "resident_overview")

    # 4. Taxa de cobranca — denominador = cobranças geradas no mês
    if not mens.empty:
        df = mens.copy()
        df["month"] = _month(mens["reference_month"].fillna(mens["due_date"]).fillna(mens["created_at"]))
        agg = df.groupby(["month","association_id"]).apply(lambda g: pd.Series({
            "paid":        (g["status"]=="paid").sum(),
            "total":       len(g),
            "valor_total": g["amount"].sum(),
            "valor_pago":  g.loc[g["status"]=="paid","amount"].sum(),
        })).reset_index()
        agg["pendentes"] = (agg["total"] - agg["paid"]).clip(lower=0)
        agg["taxa_pct"]  = (agg["paid"] / agg["total"].replace(0, pd.NA) * 100).round(1)
        up(agg, "collection_rate")

    # 5. Inadimplencia — apenas members ativos (alinhado com logica do sistema)
    if not res.empty and "overdue_months" in res.columns:
        df = res[
            (res["overdue_months"] > 0) &
            (res["type"] == "member") &
            (res["status"] == "active")
        ][[
            "full_name","phone_primary","type",
            "address_street","association_id","association_name",
            "overdue_months","total_owed"
        ]].sort_values("total_owed", ascending=False)
        up(df, "delinquency_report")

    # 6. SLA por tipo de morador — exclui wait_hours=0 (entregue no mesmo momento, dado espúrio)
    if not pkgs.empty:
        delivered = pkgs[(pkgs["status"]=="delivered") & (pkgs["wait_hours"] > 0)]
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
            up(pending.groupby(["association_id","association_name"]).agg(
                paradas_3d=("dias_parada", lambda x: (x>=3).sum()),
                paradas_7d=("dias_parada", lambda x: (x>=7).sum()),
            ).reset_index(), "packages_stuck")

    # 7. Ranking de moradores
    if not pkgs.empty:
        df = pkgs.groupby(["resident_id","resident_name","resident_type",
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
        df["street"] = _normalize_street(df["address_street"])
        up(df.groupby(["street","association_id","association_name"]).agg(
            total=("id","count"),
            distinct_res=("resident_id","nunique"),
            guests      =("resident_type", lambda x: (x=="guest").sum()),
            members     =("resident_type", lambda x: (x=="member").sum()),
            avg_wait    =("wait_hours","mean"),
        ).reset_index().sort_values("total",ascending=False), "packages_by_street")

    # 9. Performance operadores — usa Bronze diretamente (received_by/delivered_by intactos)
    pkgs_bronze = frames.get("packages", pd.DataFrame())
    if not pkgs_bronze.empty:
        users_df = frames.get("users", pd.DataFrame())
        if not users_df.empty:
            ops = users_df[users_df["role"]=="operator"]
            recv = pkgs_bronze.groupby("received_by").agg(enc_recv=("id","count")).reset_index().rename(columns={"received_by":"id"})
            delv = pkgs_bronze.groupby("delivered_by").agg(enc_delv=("id","count")).reset_index().rename(columns={"delivered_by":"id"})
            sess_df = cs if not cs.empty else pd.DataFrame()
            sess = (sess_df.groupby("opened_by").agg(sessoes=("id","count")).reset_index().rename(columns={"opened_by":"id"})
                    if not sess_df.empty else pd.DataFrame(columns=["id","sessoes"]))
            df = ops.merge(recv,on="id",how="left").merge(delv,on="id",how="left").merge(sess,on="id",how="left")
            assoc_map = frames.get("associations", pd.DataFrame())
            assoc_map = assoc_map.set_index("id")["name"].to_dict() if not assoc_map.empty else {}
            df["association_name"] = df["association_id"].map(assoc_map)
            up(df[["full_name","association_id","association_name","sessoes","enc_recv","enc_delv"]].fillna(0),
               "operator_performance")

    # 10. Receita por operador — exclui sangrias de repasse interno (movim. entre caixas)
    if not tx.empty:
        users_df = frames.get("users", pd.DataFrame())
        op_ids = set(users_df[users_df["role"]=="operator"]["id"].tolist()) if not users_df.empty else set()
        df = tx[tx["created_by"].isin(op_ids)].copy()
        desc_op = df["description"].fillna("").str.lower() if "description" in df.columns else pd.Series("", index=df.index)
        is_repasse_op = desc_op.str.contains("repasse|caixinha", na=False)
        df = df.groupby(["created_by_name","association_id","association_name","week"]).apply(lambda g: pd.Series({
            "receita":     g.loc[g["type"]=="income","amount"].sum(),
            "saidas":      g.loc[(g["type"]=="expense") | ((g["type"]=="sangria") & ~is_repasse_op.reindex(g.index, fill_value=False)),"amount"].sum(),
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

    # 12. Motivos de baixas — exclui repassse interno para caixinha (movimento extinto)
    if not tx.empty:
        sangrias = tx[tx["type"]=="sangria"].copy()
        if not sangrias.empty:
            desc_s = sangrias["description"].fillna("").str.lower() if "description" in sangrias.columns else pd.Series("", index=sangrias.index)
            sangrias = sangrias[~desc_s.str.contains("repasse|caixinha", na=False)]
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
        active["street"] = _normalize_street(active["address_street"])
        # Converte booleanos para int para evitar erro no PyArrow
        for bcol in ["has_pests","has_sewage","uses_public_transport","sem_internet","has_problems"]:
            if bcol in active.columns:
                active[bcol] = pd.to_numeric(active[bcol].fillna(False), errors="coerce").fillna(0).astype(int)
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
            # Somente membros ativos para KPIs de associados
            r_members  = res[(res["association_id"]==aid)&(res["status"]=="active")&(res["type"]=="member")] if not res.empty else pd.DataFrame()
            p_pending  = pkgs[(pkgs["association_id"]==aid)&(pkgs["status"].isin(["received","notified"]))] if not pkgs.empty else pd.DataFrame()
            cs_open    = cs[(cs["association_id"]==aid)&(cs["status"]=="open")] if not cs.empty else pd.DataFrame()
            t_open     = tsk[(tsk["association_id"]==aid)&(~tsk["is_deleted"])&(tsk["status"]!="done")] if not tsk.empty else pd.DataFrame()
            tx_hoje    = tx[(tx["association_id"]==aid)&(tx["type"]=="income")&(tx["date"]==now.date())] if not tx.empty else pd.DataFrame()

            # Tempo médio de permanência de encomendas (últimos 30 dias, entregues)
            avg_dwell_dias = None
            if not pkgs.empty:
                cutoff_pkg = now - pd.Timedelta(days=30)
                p_assoc = pkgs[(pkgs["association_id"] == aid)]
                p_delivered = p_assoc[
                    (p_assoc["status"] == "delivered") &
                    (_to_dt(p_assoc["received_at"]) >= cutoff_pkg) &
                    p_assoc["delivered_at"].notna()
                ].copy()
                if not p_delivered.empty:
                    dwell = (_to_dt(p_delivered["delivered_at"]) - _to_dt(p_delivered["received_at"])).dt.total_seconds() / 86400
                    dwell = dwell[dwell >= 0]
                    if not dwell.empty:
                        avg_dwell_dias = round(float(dwell.mean()), 1)

            # Taxa de retenção: % de membros que pagaram em M-1 e voltaram a pagar em M
            # reference_month é varchar '2026-06' — comparar como string
            taxa_retencao_pct = None
            if not mens.empty:
                mens_assoc = mens[mens["association_id"] == aid].copy()
                now_period   = pd.Timestamp.now()
                mes_atual    = now_period.strftime("%Y-%m")
                mes_anterior = (now_period - pd.DateOffset(months=1)).strftime("%Y-%m")
                ref_col      = mens_assoc["reference_month"].astype(str).str[:7]
                pagadores_ant = set(
                    mens_assoc.loc[
                        (ref_col == mes_anterior) & (mens_assoc["status"] == "paid"),
                        "resident_id"
                    ].astype(str)
                )
                if pagadores_ant:
                    pagadores_atual = set(
                        mens_assoc.loc[
                            (ref_col == mes_atual) & (mens_assoc["status"] == "paid"),
                            "resident_id"
                        ].astype(str)
                    )
                    retidos = pagadores_ant & pagadores_atual
                    taxa_retencao_pct = round(len(retidos) / len(pagadores_ant) * 100, 1)

            rows_kpi.append({
                "association_id":   aid,
                "association_name": name,
                "caixas_abertos":   len(cs_open),
                "receita_hoje":     tx_hoje["amount"].sum() if not tx_hoje.empty else 0,
                "enc_pendentes":    len(p_pending),
                "enc_paradas_3d":   len(p_pending[p_pending["received_at"]<now-pd.Timedelta(days=3)]) if not p_pending.empty else 0,
                "associados_ativos":len(r_members),
                "inadimplentes":    len(r_members[r_members.get("overdue_months",pd.Series(0,index=r_members.index))>0]) if not r_members.empty else 0,
                "tarefas_abertas":  len(t_open),
                "novos_semana":     len(r_members[_to_dt(r_members["created_at"])>=week0]) if not r_members.empty else 0,
                "avg_dwell_dias":   avg_dwell_dias,
                "taxa_retencao_pct":taxa_retencao_pct,
                "snapshot_at":      now.isoformat(),
            })
        if rows_kpi:
            up(pd.DataFrame(rows_kpi), "operational_kpis")

    # ── 18. ANOMALIAS DE CAIXA ─────────────────────────────────────────────────
    if not cs.empty:
        now_ts = pd.Timestamp.now()
        cutoff  = now_ts - pd.Timedelta(days=30)
        cs30    = cs[_to_dt(cs["opened_at"]) >= cutoff].copy()
        if not cs30.empty:
            cs30["opened_dt"]  = _to_dt(cs30["opened_at"])
            cs30["closed_dt"]  = _to_dt(cs30["closed_at"])
            cs30["duracao_min"] = (cs30["closed_dt"] - cs30["opened_dt"]).dt.total_seconds() / 60

            def _anomalia(r):
                if pd.isna(r["closed_dt"]):
                    return "ABERTO_SEM_FECHAR"
                if r["opened_dt"].date() != r["closed_dt"].date():
                    return "FECHOU_DIA_SEGUINTE"
                if r["duracao_min"] < 30:
                    return "MUITO_CURTO"
                return "NORMAL"

            cs30["anomalia"] = cs30.apply(_anomalia, axis=1)
            anom = cs30[cs30["anomalia"] != "NORMAL"].copy()
            if not anom.empty:
                anom["dia"]          = anom["opened_dt"].dt.date.astype(str)
                anom["hora_abertura"] = anom["opened_dt"].dt.strftime("%H:%M")
                anom["hora_fechamento"] = anom["closed_dt"].dt.strftime("%H:%M").where(~anom["closed_dt"].isna(), "—")
                anom["duracao_min"]  = anom["duracao_min"].round(0).where(~anom["closed_dt"].isna(), pd.NA)
                cols = ["association_id","association_name","operador_name",
                        "dia","hora_abertura","hora_fechamento","duracao_min","anomalia"]
                available = [c for c in cols if c in anom.columns]
                up(anom[available].reset_index(drop=True), "cash_session_anomalies")

    # ── 19. RUNWAY FINANCEIRO ────────────────────────────────────────────────
    # Quanto tempo (em semanas) a associacao consegue operar com o saldo atual
    # sem nenhuma nova receita, baseado na media de despesas das ultimas 8 semanas
    if not tx.empty and not cs.empty:
        rows_runway = []
        assocs_df = frames.get("associations", pd.DataFrame())
        assoc_map_r = assocs_df.set_index("id")["name"].to_dict() if not assocs_df.empty else {}

        for aid, aname in assoc_map_r.items():
            if "Teste" in aname:
                continue

            # Saldo atual: 3 estratégias em cascata
            # 1) expected_balance da sessão aberta (ideal)
            # 2) closing_balance da última sessão fechada
            # 3) Fallback: opening da sessão mais recente + net das transações dela
            cs_assoc = cs[cs["association_id"] == aid] if not cs.empty else pd.DataFrame()
            tx_assoc_all = tx[tx["association_id"] == aid] if not tx.empty else pd.DataFrame()

            # Saldo = receita - despesa acumulada (faturamento líquido das últimas 8 semanas)
            # Sessões de caixa são isoladas e não refletem o saldo real da associação.
            cutoff_saldo = pd.Timestamp.now() - pd.Timedelta(weeks=8)
            saldo_atual = 0.0
            if not tx_assoc_all.empty:
                tx_periodo = tx_assoc_all[_to_dt(tx_assoc_all["transaction_at"]) >= cutoff_saldo]
                income_total  = float(tx_periodo[tx_periodo["type"] == "income"]["amount"].sum() or 0)
                expense_total = float(tx_periodo[tx_periodo["type"] == "expense"]["amount"].sum() or 0)
                saldo_atual = income_total - expense_total

            # Despesa media semanal (ultimas 8 semanas)
            # Exclui sangrias de repasse interno para caixinha (movimentacao interna,
            # nao e despesa operacional — dinheiro permanece na associacao)
            tx_assoc = tx[tx["association_id"] == aid] if not tx.empty else pd.DataFrame()
            despesa_semanal = 0.0
            if not tx_assoc.empty:
                cutoff = pd.Timestamp.now() - pd.Timedelta(weeks=8)
                desc_col = tx_assoc["description"].fillna("").str.lower() if "description" in tx_assoc.columns else pd.Series("", index=tx_assoc.index)
                is_repasse = desc_col.str.contains("repasse|caixinha", na=False)
                tx_recent = tx_assoc[
                    (tx_assoc["type"].isin(["expense", "sangria"])) &
                    (_to_dt(tx_assoc["transaction_at"]) >= cutoff) &
                    ~((tx_assoc["type"] == "sangria") & is_repasse)
                ]
                if not tx_recent.empty:
                    despesa_semanal = float(tx_recent["amount"].sum() / 8)

            # Receita media semanal (ultimas 8 semanas)
            receita_semanal = 0.0
            if not tx_assoc.empty:
                cutoff = pd.Timestamp.now() - pd.Timedelta(weeks=8)
                tx_rec = tx_assoc[
                    (tx_assoc["type"] == "income") &
                    (_to_dt(tx_assoc["transaction_at"]) >= cutoff)
                ]
                if not tx_rec.empty:
                    receita_semanal = float(tx_rec["amount"].sum() / 8)

            runway_semanas = None
            if despesa_semanal > 0:
                runway_semanas = round(saldo_atual / despesa_semanal, 1)

            rows_runway.append({
                "association_id":       aid,
                "association_name":     aname,
                "saldo_atual":          round(saldo_atual, 2),
                "despesa_media_semanal":round(despesa_semanal, 2),
                "receita_media_semanal":round(receita_semanal, 2),
                "resultado_medio_semanal": round(receita_semanal - despesa_semanal, 2),
                # Runway: semanas com saldo atual sem nova receita
                "runway_semanas":       runway_semanas,
                # Runway sustentavel: semanas ate saldo zerar considerando receita atual
                "runway_sustentavel_semanas": (
                    round(saldo_atual / max(despesa_semanal - receita_semanal, 0.01), 1)
                    if despesa_semanal > receita_semanal else None
                ),
                "situacao": (
                    "superavit" if receita_semanal > despesa_semanal
                    else "equilibrio" if abs(receita_semanal - despesa_semanal) < despesa_semanal * 0.05
                    else "deficit"
                ),
                "exportado_em": pd.Timestamp.now().isoformat(),
            })

        if rows_runway:
            up(pd.DataFrame(rows_runway), "runway")

    # 19. Receita por operador × tipo de receita (para aba FINANCEIRO do consolidado)
    # Exclui sangrias e despesas; exclui repassos internos (caixinha)
    if not tx.empty:
        users_df = frames.get("users", pd.DataFrame())
        op_ids = set(users_df[users_df["role"] == "operator"]["id"].tolist()) if not users_df.empty else set()
        df_op = tx[(tx["type"] == "income") & tx["created_by"].isin(op_ids)].copy()
        if not df_op.empty:
            df_op = df_op.groupby(
                ["created_by_name", "association_id", "association_name", "week", "month"]
            ).apply(lambda g: pd.Series({
                "mensalidade":        g.loc[g["income_subtype"] == "mensalidade",        "amount"].sum(),
                "delivery_fee":       g.loc[g["income_subtype"] == "delivery_fee",       "amount"].sum(),
                "proof_of_residence": g.loc[g["income_subtype"] == "proof_of_residence", "amount"].sum(),
                "other_income":       g.loc[g["income_subtype"] == "other",              "amount"].sum(),
                "total":              g["amount"].sum(),
                "n_transacoes":       len(g),
            })).reset_index()
            up(df_op, "receita_por_operador_tipo")

    # 20. Cobrança por rua — cobranças geradas (mensalidades a pagar, excl. isenção)
    # Cruza mensalidades com endereço do morador via residents_clean
    if not mens.empty and not res.empty:
        STATUS_VALIDOS = {"pending", "paid", "overdue", "agreement"}
        mens_v = mens[mens["status"].isin(STATUS_VALIDOS)].copy()
        mens_v["month"] = _month(mens_v["due_date"].fillna(mens_v["created_at"]))

        res_addr = res[["id", "address_street", "association_name"]].drop_duplicates("id")
        m_rua = mens_v.merge(
            res_addr, left_on="resident_id", right_on="id", how="left"
        )
        m_rua["street"] = _normalize_street(m_rua["address_street"].fillna("Não Informado"))

        df_rua = m_rua.groupby(
            ["street", "month", "association_id", "association_name"]
        ).apply(lambda g: pd.Series({
            "total":       len(g),
            "pagas":       (g["status"] == "paid").sum(),
            "pendentes":   (g["status"] == "pending").sum(),
            "vencidas":    (g["status"] == "overdue").sum(),
            "acordos":     (g["status"] == "agreement").sum(),
            "valor_total": g["amount"].sum(),
            "valor_pago":  g.loc[g["status"] == "paid", "amount"].sum(),
        })).reset_index()
        df_rua["taxa_pct"] = (
            df_rua["pagas"] / df_rua["total"].replace(0, pd.NA) * 100
        ).round(1)
        up(df_rua.sort_values("valor_total", ascending=False), "cobranca_por_rua")

    return stats, gold_frames


# ── Analytics Loader ──────────────────────────────────────────────────────────

def _write_gold_sync(gold_frames: dict[str, pd.DataFrame]) -> int:
    """Escreve todos os DataFrames Gold no Neon Analytics via SQLAlchemy sync.

    Cada tabela roda em transação independente para que uma falha não aborte
    as demais. Usa replace (DROP+CREATE) para lidar com mudanças de schema.
    """
    from sqlalchemy import create_engine
    engine = create_engine(settings.analytics_db_url, pool_pre_ping=True)
    total = 0
    try:
        for table_name, df in gold_frames.items():
            if df.empty:
                continue
            df_clean = df.copy()
            for col in df_clean.columns:
                dtype_str = str(df_clean[col].dtype)
                if dtype_str.startswith("period["):
                    try:
                        df_clean[col] = df_clean[col].dt.to_timestamp()
                    except Exception:
                        df_clean[col] = df_clean[col].astype(str)
                elif dtype_str == "bool":
                    df_clean[col] = df_clean[col].astype(int)
            try:
                with engine.begin() as conn:
                    df_clean.to_sql(table_name, conn, if_exists="replace",
                                    index=False, method="multi", chunksize=500)
                total += len(df_clean)
                logger.info("Analytics %-35s %5d rows", table_name, len(df_clean))
            except Exception as e:
                logger.warning("Analytics: falha em %s: %s", table_name, e)
    finally:
        engine.dispose()
    return total


async def load_gold_to_analytics(gold_frames: dict[str, pd.DataFrame]) -> int:
    """Task 5: carrega camada Gold no Neon Analytics (OLAP para Power BI)."""
    if not settings.analytics_database_url:
        logger.info("ANALYTICS_DATABASE_URL nao configurado — pulando carga OLAP")
        return 0
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    loop = asyncio.get_event_loop()
    with ThreadPoolExecutor(max_workers=1) as executor:
        return await loop.run_in_executor(executor, _write_gold_sync, gold_frames)


# ── Orchestrator ───────────────────────────────────────────────────────────────

def _validate_gold(silver: dict, gold_stats: dict) -> list[str]:
    """Validacoes basicas antes de considerar o ETL bem-sucedido."""
    errors = []
    tx = silver.get("transactions_enriched", pd.DataFrame())
    res = silver.get("residents_clean", pd.DataFrame())
    pkgs = silver.get("packages_enriched", pd.DataFrame())

    if tx.empty:
        errors.append("transactions_enriched vazio — nenhuma transacao encontrada")
    if res.empty:
        errors.append("residents_clean vazio — nenhum morador encontrado")
    if not gold_stats.get("daily_revenue"):
        errors.append("daily_revenue nao gerado")
    if not gold_stats.get("operational_kpis"):
        errors.append("operational_kpis nao gerado")
    if not tx.empty and tx["amount"].isnull().mean() > 0.5:
        errors.append("transactions: > 50% de valores nulos em amount")

    return errors


async def _log_task(session: AsyncSession, run_id: str, task: str, status: str,
                    started: datetime, rows_in: int = 0, rows_out: int = 0,
                    detail: dict | None = None) -> None:
    duration = round((datetime.now(timezone.utc) - started).total_seconds(), 1)
    try:
        await session.execute(text("""
            INSERT INTO etl_task_runs (run_id, task_name, status, started_at, completed_at,
                                       duration_s, rows_in, rows_out, detail)
            VALUES (:rid, :task, :status, :started, NOW(), :dur, :ri, :ro, :det::jsonb)
        """), {
            "rid": run_id, "task": task, "status": status,
            "started": started, "dur": duration,
            "ri": rows_in, "ro": rows_out,
            "det": json.dumps(detail or {}),
        })
        await session.commit()
    except Exception as e:
        logger.warning("Falha ao logar task %s: %s", task, e)


async def _send_alert(error_msg: str, mode: str) -> None:
    """Envia email de alerta quando o ETL falha."""
    try:
        from app.services.email_service import send_email
        await send_email(
            to=settings.smtp_user,
            subject=f"[APRXM] ETL Data Lake falhou — {date.today()}",
            body=f"Modo: {mode}\n\nErro:\n{error_msg}\n\nVerifique em /api/v1/datalake/runs",
        )
    except Exception as e:
        logger.error("Falha ao enviar alerta de email: %s", e)


async def run_full_etl(session: AsyncSession, force_full: bool = False,
                       triggered_by: str = "cron") -> dict:
    today_date = date.today()
    today      = today_date.isoformat()
    started_at = datetime.now(timezone.utc)
    client     = _r2_client()

    last_run = _get_last_run(client)
    if force_full:
        last_run = {"last_extracted_at": None, "is_initial": True}

    is_initial = last_run.get("is_initial", True)
    mode       = "full" if is_initial else "incremental"
    mode_label = "FULL (carga inicial)" if is_initial else f"INCREMENTAL desde {last_run.get('last_extracted_at','?')[:19]}"
    logger.info("ETL iniciado — %s | by=%s", mode_label, triggered_by)

    # Cria registro do run no banco
    run_id = None
    try:
        row = (await session.execute(text("""
            INSERT INTO etl_runs (run_date, mode, status, started_at, triggered_by)
            VALUES (:d, :m, 'running', :s, :t)
            RETURNING id
        """), {"d": today_date, "m": mode, "s": started_at, "t": triggered_by})).fetchone()
        await session.commit()
        run_id = str(row[0]) if row else None
    except Exception as e:
        logger.warning("Falha ao criar etl_run: %s", e)

    # Limpa logs antigos (mantém últimos 60 dias) para controlar crescimento do banco
    try:
        await session.execute(text(
            "DELETE FROM etl_task_runs WHERE started_at < NOW() - INTERVAL '60 days'"
        ))
        await session.execute(text(
            "DELETE FROM etl_runs WHERE started_at < NOW() - INTERVAL '60 days'"
        ))
        await session.commit()
    except Exception as e:
        logger.warning("Falha ao limpar logs antigos: %s", e)

    error_msg = None
    bronze_stats = silver_stats = gold_stats = {}
    bronze_frames: dict = {}
    silver_frames: dict = {}

    try:
        # ── Task 1: BRONZE ──────────────────────────────────────────────────
        t1 = datetime.now(timezone.utc)
        bronze_stats, bronze_frames = await export_bronze(session, today, last_run, client)
        bronze_rows = sum(len(v) for v in bronze_frames.values() if isinstance(v, pd.DataFrame))
        if run_id:
            await _log_task(session, run_id, "bronze", "success", t1,
                            rows_out=bronze_rows, detail={"tables": list(bronze_frames.keys())})

        # ── Task 2: SILVER ──────────────────────────────────────────────────
        t2 = datetime.now(timezone.utc)
        silver_stats, silver_frames = build_silver(bronze_frames, today, client)
        silver_rows = sum(len(v) for v in silver_frames.values() if isinstance(v, pd.DataFrame))
        if run_id:
            await _log_task(session, run_id, "silver", "success", t2,
                            rows_in=bronze_rows, rows_out=silver_rows)

        # ── Task 3: GOLD ────────────────────────────────────────────────────
        t3 = datetime.now(timezone.utc)
        gold_stats, gold_frames_result = build_gold(bronze_frames, silver_frames, client)
        gold_files = sum(1 for v in gold_stats.values() if isinstance(v, int) and v > 0)
        if run_id:
            await _log_task(session, run_id, "gold", "success", t3,
                            rows_in=silver_rows, rows_out=gold_files,
                            detail={"files": list(gold_stats.keys())})

        # ── Task 4: ANALYTICS (Neon OLAP) ───────────────────────────────────
        t4_analytics = datetime.now(timezone.utc)
        analytics_rows = await load_gold_to_analytics(gold_frames_result)
        if run_id:
            await _log_task(session, run_id, "analytics_load", "success", t4_analytics,
                            rows_in=gold_files, rows_out=analytics_rows)

        # ── Task 5: VALIDATE ────────────────────────────────────────────────
        t5 = datetime.now(timezone.utc)
        validation_errors = _validate_gold(silver_frames, gold_stats)
        v_status = "warning" if validation_errors else "success"
        if run_id:
            await _log_task(session, run_id, "validate", v_status, t5,
                            detail={"errors": validation_errors})
        if validation_errors:
            logger.warning("Validacao com avisos: %s", validation_errors)

        # ── Metadata ─────────────────────────────────────────────────────────
        _save_last_run(client, started_at)

    except Exception as exc:
        error_msg = str(exc)
        logger.error("ETL falhou: %s", error_msg, exc_info=True)
        if run_id:
            await _log_task(session, run_id, "error", "failed", started_at,
                            detail={"error": error_msg})
        await _send_alert(error_msg, mode_label)

    finally:
        duration = round((datetime.now(timezone.utc) - started_at).total_seconds(), 1)
        neon_kb  = round(sum(len(v) for v in bronze_frames.values()
                             if isinstance(v, pd.DataFrame)) * 0.4, 1)  # estimativa bytes→KB

        if run_id:
            try:
                try:
                    await session.rollback()
                except Exception:
                    pass
                await session.execute(text("""
                    UPDATE etl_runs SET
                        status       = :s,
                        completed_at = NOW(),
                        duration_s   = :d,
                        bronze_rows  = :br,
                        silver_rows  = :sr,
                        gold_files   = :gf,
                        neon_kb      = :nk,
                        error_msg    = :err
                    WHERE id = :rid
                """), {
                    "s":   "failed" if error_msg else "success",
                    "d":   duration,
                    "br":  sum(len(v) for v in bronze_frames.values() if isinstance(v, pd.DataFrame)),
                    "sr":  sum(len(v) for v in silver_frames.values() if isinstance(v, pd.DataFrame)),
                    "gf":  sum(1 for v in gold_stats.values() if isinstance(v, int) and v > 0),
                    "nk":  neon_kb,
                    "err": error_msg,
                    "rid": run_id,
                })
                await session.commit()
            except Exception as e:
                logger.warning("Falha ao atualizar etl_run: %s", e)

    total_files = sum(1 for k, v in {**bronze_stats, **silver_stats, **gold_stats}.items()
                      if isinstance(v, int) and v > 0 and "delta_rows" not in k)

    return {
        "status":      "failed" if error_msg else "success",
        "run_id":      run_id,
        "mode":        mode_label,
        "date":        today,
        "duration_s":  duration,
        "files_total": total_files,
        "error":       error_msg,
        "bronze":      bronze_stats,
        "silver":      silver_stats,
        "gold":        gold_stats,
    }
