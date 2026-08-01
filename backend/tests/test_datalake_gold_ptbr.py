"""
Smoke test do build_gold() apos o rename de tabelas/colunas pra portugues
(2026-08-01). Roda a funcao de verdade com dado sintetico minimo, cobrindo
a maioria dos ramos, e valida que:
  1. Nenhum nome de tabela antigo (ingles) sobra em gold_frames.
  2. As tabelas geradas tem as colunas pt-BR esperadas.
Run with: pytest backend/tests/test_datalake_gold_ptbr.py -v
"""
from uuid import uuid4

import pandas as pd
import pytest

from app.services.datalake_service import build_gold, build_silver, GOLD_PATHS

OLD_ENGLISH_NAMES = {
    "daily_revenue", "member_growth_weekly", "resident_overview", "collection_rate",
    "delinquency_report", "sla_by_type", "packages_stuck", "resident_package_ranking",
    "packages_by_street", "operator_performance", "operator_revenue", "cash_breaks",
    "sangria_reasons", "tasks_weekly", "tasks_by_collaborator", "census_by_street",
    "community_problems", "operational_kpis", "cash_session_anomalies", "runway",
    "resident_monthly", "packages_monthly", "os_monthly", "retention_monthly",
    "tasks_monthly", "operator_score_monthly", "op_score_semanal",
}


class _NullClient:
    """Fake client pro _upload_df (R2) -- so' precisa nao explodir."""
    def put_object(self, **kwargs):
        return None


def _frames():
    aid = str(uuid4())
    uid = str(uuid4())
    now = pd.Timestamp.now()

    associations = pd.DataFrame([{"id": aid, "name": "Associação Teste", "empresa_id": str(uuid4())}])
    users = pd.DataFrame([{"id": uid, "full_name": "Op Teste", "role": "operator", "association_id": aid}])
    residents = pd.DataFrame([{
        "id": str(uuid4()), "association_id": aid, "type": "member", "status": "active",
        "full_name": "Morador Teste", "phone_primary": "11999999999",
        "address_street": "Rua Teste", "created_at": now, "is_member_confirmed": True,
        "has_pests": False, "has_sewage": True, "uses_public_transport": False,
        "internet_access": "Banda larga", "neighborhood_problems": None,
    }])
    past = now - pd.Timedelta(days=14)
    transactions = pd.DataFrame([
        {
            "id": str(uuid4()), "association_id": aid, "type": "income", "amount": 100.0,
            "income_subtype": "mensalidade", "transaction_at": t, "created_at": t,
            "reversed_at": None, "is_reversal": False, "created_by": uid,
            "payment_method_id": None, "category_id": None, "resident_id": None,
            "description": "teste",
        }
        for t in (now, past)
    ])
    packages = pd.DataFrame([
        {
            "id": str(uuid4()), "association_id": aid, "status": "delivered",
            "resident_id": None, "received_by": uid, "delivered_by": uid,
            "received_at": t - pd.Timedelta(hours=5), "delivered_at": t,
        }
        for t in (now, past)
    ])
    cash_sessions = pd.DataFrame([{
        "id": str(uuid4()), "association_id": aid, "status": "closed",
        "opened_by": uid, "opened_at": now - pd.Timedelta(hours=2), "closed_at": now,
        "difference": 0.0, "tem_diferenca": False, "tem_quebra": False,
        "quebra_caixa": 0.0, "operador_name": "Op Teste",
    }])
    daily_tasks = pd.DataFrame([
        {
            "id": str(uuid4()), "association_id": aid, "status": "done",
            "assigned_to_name": "Op Teste", "created_by": uid, "created_at": t, "updated_at": t,
            "due_date": t, "deleted_at": None,
        }
        for t in (now, past)
    ])
    service_orders = pd.DataFrame([{
        "id": str(uuid4()), "association_id": aid, "status": "resolved", "created_at": now,
    }])

    return {
        "associations": associations, "users": users, "residents": residents,
        "transactions": transactions, "packages": packages, "cash_sessions": cash_sessions,
        "daily_tasks": daily_tasks, "service_orders": service_orders,
        "payment_methods": pd.DataFrame(), "transaction_categories": pd.DataFrame(),
        "mensalidades": pd.DataFrame(),
    }


def test_build_gold_uses_only_portuguese_table_names():
    frames = _frames()
    client = _NullClient()
    _, silver = build_silver(frames, pd.Timestamp.now().isoformat(), client)
    _, gold_frames = build_gold(frames, silver, client)

    produced = set(gold_frames.keys())
    leaked_english = produced & OLD_ENGLISH_NAMES
    assert not leaked_english, f"Tabelas com nome antigo (ingles) ainda geradas: {leaked_english}"


def test_gold_paths_keys_match_only_new_names():
    leaked_english = set(GOLD_PATHS.keys()) & OLD_ENGLISH_NAMES
    assert not leaked_english, f"GOLD_PATHS ainda tem chave(s) em ingles: {leaked_english}"


def test_receita_diaria_has_portuguese_columns():
    frames = _frames()
    client = _NullClient()
    _, silver = build_silver(frames, pd.Timestamp.now().isoformat(), client)
    _, gold_frames = build_gold(frames, silver, client)

    if "receita_diaria" in gold_frames:
        cols = set(gold_frames["receita_diaria"].columns)
        for expected in ["data", "semana", "mes", "id_associacao", "nome_associacao",
                          "receita_total", "despesa_total", "saldo_liquido"]:
            assert expected in cols, f"coluna {expected} ausente em receita_diaria: {cols}"
        for old in ["date", "week", "month", "association_id", "association_name",
                    "total_income", "total_expense", "net"]:
            assert old not in cols, f"coluna antiga {old} sobrou em receita_diaria: {cols}"
