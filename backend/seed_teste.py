"""
Seed script: cria org "teste" com dados robustos para QA completo.
Execução: python seed_teste.py
"""
import uuid
import bcrypt
import psycopg2
from datetime import datetime, timedelta, timezone
from decimal import Decimal

DB_URL = "postgresql://neondb_owner:npg_I0UVZq5jmdzM@ep-rough-tooth-an10po6b.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require"

def h(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def uid() -> str:
    return str(uuid.uuid4())

now = datetime.now(timezone.utc)

# ── IDs fixos para referências cruzadas ──────────────────────────────────────
ORG_ID       = uid()
USER_ADMIN   = uid()
USER_CONF    = uid()
USER_OP      = uid()
USER_VIEWER  = uid()

RES_ANA      = uid()
RES_CARLOS   = uid()
RES_BEATRIZ  = uid()
RES_JOAO     = uid()
RES_MARCIA   = uid()
RES_DEP1     = uid()  # dependente de Ana
RES_DEP2     = uid()  # dependente de Carlos
RES_GUEST1   = uid()  # não-associado
RES_GUEST2   = uid()

SESSION_ID   = uid()
SESSION2_ID  = uid()

TX1 = uid(); TX2 = uid(); TX3 = uid(); TX4 = uid()
TX5 = uid(); TX6 = uid(); TX7 = uid()

PKG1 = uid(); PKG2 = uid(); PKG3 = uid(); PKG4 = uid(); PKG5 = uid()

SO1 = uid(); SO2 = uid(); SO3 = uid(); SO4 = uid()

conn = psycopg2.connect(DB_URL)
cur  = conn.cursor()

print("Conectado ao banco. Iniciando seed…")

# ── 1. Associação ─────────────────────────────────────────────────────────────
cur.execute("""
INSERT INTO associations
  (id, name, slug, cnpj, phone, email, plan_name, plan_expires_at, is_active,
   address_street, address_number, address_district, address_city, address_state, address_zip,
   created_at, updated_at)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON CONFLICT (slug) DO NOTHING
""", (
    ORG_ID,
    "Associação Teste QA",
    "teste",
    "12.345.678/0001-90",
    "(21) 3333-4444",
    "teste@asociacaoteste.org",
    "basic",
    now + timedelta(days=365),
    True,
    "Rua das Palmeiras", "100", "Centro", "Rio de Janeiro", "RJ", "20040-020",
    now, now,
))

# ── 2. Usuários ───────────────────────────────────────────────────────────────
users = [
    (USER_ADMIN,  "Admin Teste",     "admin@teste.org",    "(21) 91111-0001", h("Admin@2025"), "admin"),
    (USER_CONF,   "Conferente Maria","conf@teste.org",     "(21) 91111-0002", h("Admin@2025"), "conferente"),
    (USER_OP,     "Operador João",   "op@teste.org",       "(21) 91111-0003", h("Admin@2025"), "operator"),
    (USER_VIEWER, "Viewer Sandra",   "viewer@teste.org",   "(21) 91111-0004", h("Admin@2025"), "viewer"),
]
for uid_, name, email, phone, pw, role in users:
    cur.execute("""
    INSERT INTO users
      (id, association_id, full_name, email, phone, hashed_password, role, is_active, created_at, updated_at)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    ON CONFLICT (email, association_id) DO NOTHING
    """, (uid_, ORG_ID, name, email, phone, pw, role, True, now, now))

# ── 3. Configurações da associação ────────────────────────────────────────────
cur.execute("""
INSERT INTO association_settings
  (association_id, default_cash_balance, max_cash_before_sangria, updated_at)
VALUES (%s,%s,%s,%s)
ON CONFLICT (association_id) DO NOTHING
""", (ORG_ID, Decimal("300.00"), Decimal("800.00"), now))

# ── 4. Moradores – membros ────────────────────────────────────────────────────
members = [
    (RES_ANA,    "Ana Paula Souza",      "111.222.333-44", "(21) 99001-0001", "ana@email.com",    "101", "A"),
    (RES_CARLOS, "Carlos Henrique Lima", "222.333.444-55", "(21) 99001-0002", "carlos@email.com", "102", "A"),
    (RES_BEATRIZ,"Beatriz Fernandes",    "333.444.555-66", "(21) 99001-0003", "bea@email.com",    "201", "B"),
    (RES_JOAO,   "João Augusto Melo",    "444.555.666-77", "(21) 99001-0004", "joao@email.com",   "202", "B"),
    (RES_MARCIA, "Márcia Cristina Dias", "555.666.777-88", "(21) 99001-0005", "marcia@email.com", "301", "C"),
]
for rid, name, cpf, phone, email, unit, block in members:
    cur.execute("""
    INSERT INTO residents
      (id, association_id, type, status, full_name, cpf, phone_primary, email,
       unit, block, is_member_confirmed, terms_accepted, lgpd_accepted, created_at, updated_at)
    VALUES (%s,%s,'member','active',%s,%s,%s,%s,%s,%s,true,true,true,%s,%s)
    ON CONFLICT DO NOTHING
    """, (rid, ORG_ID, name, cpf, phone, email, unit, block, now, now))

# ── 5. Dependentes ────────────────────────────────────────────────────────────
deps = [
    (RES_DEP1, "Filho de Ana – Pedro Souza",    "(21) 99002-0001", "102", "A", RES_ANA),
    (RES_DEP2, "Esposa de Carlos – Lúcia Lima", "(21) 99002-0002", "102", "A", RES_CARLOS),
]
for rid, name, phone, unit, block, resp in deps:
    cur.execute("""
    INSERT INTO residents
      (id, association_id, type, status, full_name, phone_primary,
       unit, block, responsible_id, is_member_confirmed, terms_accepted, lgpd_accepted, created_at, updated_at)
    VALUES (%s,%s,'member','active',%s,%s,%s,%s,%s,false,true,true,%s,%s)
    ON CONFLICT DO NOTHING
    """, (rid, ORG_ID, name, phone, unit, block, resp, now, now))

# ── 6. Não-associados (guest) ─────────────────────────────────────────────────
guests = [
    (RES_GUEST1, "Roberto Nunes (visitante)",  "(21) 99003-0001",
     "Rua Sol", "50", "", "Rio de Janeiro", "RJ", "22210-010"),
    (RES_GUEST2, "Fernanda Costa (visitante)", "(21) 99003-0002",
     "Av. Brasil", "1200", "Ap 3", "Rio de Janeiro", "RJ", "21040-361"),
]
for rid, name, phone, st, num, comp, city, state, cep in guests:
    cur.execute("""
    INSERT INTO residents
      (id, association_id, type, status, full_name, phone_primary,
       address_street, address_number, address_complement,
       address_city, address_state, address_cep,
       is_member_confirmed, terms_accepted, lgpd_accepted, created_at, updated_at)
    VALUES (%s,%s,'guest','active',%s,%s,%s,%s,%s,%s,%s,%s,false,false,false,%s,%s)
    ON CONFLICT DO NOTHING
    """, (rid, ORG_ID, name, phone, st, num, comp, city, state, cep, now, now))

# ── 7. Sessão de caixa (encerrada) ────────────────────────────────────────────
opened1 = now - timedelta(days=3)
closed1 = now - timedelta(days=3, hours=-8)
cur.execute("""
INSERT INTO cash_sessions
  (id, association_id, opened_by, closed_by, status,
   opening_balance, closing_balance, expected_balance, difference,
   notes, opened_at, closed_at, created_at, updated_at)
VALUES (%s,%s,%s,%s,'closed',%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON CONFLICT DO NOTHING
""", (
    SESSION2_ID, ORG_ID, USER_CONF, USER_ADMIN,
    Decimal("300.00"), Decimal("780.00"), Decimal("775.00"), Decimal("5.00"),
    "Sessão de teste encerrada — divergência de R$5 identificada.",
    opened1, closed1, opened1, closed1,
))

# ── 8. Sessão de caixa (aberta) ───────────────────────────────────────────────
cur.execute("""
INSERT INTO cash_sessions
  (id, association_id, opened_by, status,
   opening_balance, opened_at, created_at, updated_at)
VALUES (%s,%s,%s,'open',%s,%s,%s,%s)
ON CONFLICT DO NOTHING
""", (SESSION_ID, ORG_ID, USER_CONF, Decimal("300.00"), now - timedelta(hours=2), now, now))

# ── 9. Transações na sessão aberta ───────────────────────────────────────────
transactions = [
    (TX1, "income",  Decimal("50.00"),  "Mensalidade – Ana Paula Souza",      now - timedelta(minutes=90)),
    (TX2, "income",  Decimal("50.00"),  "Mensalidade – Carlos Henrique Lima",  now - timedelta(minutes=80)),
    (TX3, "income",  Decimal("50.00"),  "Mensalidade – Beatriz Fernandes",     now - timedelta(minutes=70)),
    (TX4, "income",  Decimal("50.00"),  "Mensalidade – João Augusto Melo",     now - timedelta(minutes=60)),
    (TX5, "expense", Decimal("35.00"),  "Compra de material de limpeza",       now - timedelta(minutes=50)),
    (TX6, "expense", Decimal("15.00"),  "Impressão de documentos",             now - timedelta(minutes=40)),
    (TX7, "sangria", Decimal("100.00"), "Sangria preventiva – cofre",          now - timedelta(minutes=20)),
]
for tid, ttype, amount, desc, tx_at in transactions:
    cur.execute("""
    INSERT INTO transactions
      (id, association_id, cash_session_id, type, amount, description,
       created_by, transaction_at, created_at, updated_at)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    ON CONFLICT DO NOTHING
    """, (tid, ORG_ID, SESSION_ID, ttype, amount, desc, USER_CONF, tx_at, tx_at, tx_at))

# ── 10. Encomendas ────────────────────────────────────────────────────────────
import json

packages = [
    # (id, resident_id, unit, block, status, carrier, tracking, sender, has_fee, fee_amount, delivered_to, sig_url, received_at)
    (PKG1, RES_ANA,    "101","A","received",  "Correios",     "AA123456789BR","Amazon Brasil",     False, None, None, None, now - timedelta(hours=5)),
    (PKG2, RES_CARLOS, "102","A","notified",  "Mercado Envios","ME9876543210", "Mercado Livre",    False, None, None, None, now - timedelta(hours=3)),
    (PKG3, RES_BEATRIZ,"201","B","delivered", "iFood",        "IF0011223344", "Restaurante Sol",   False, None, "Beatriz Fernandes", "data:sig/stub", now - timedelta(days=1)),
    (PKG4, RES_GUEST1, None, None,"received", "Jadlog",       "JD5544332211", "Loja XYZ",         True,  Decimal("2.50"), None, None, now - timedelta(hours=1)),
    (PKG5, RES_JOAO,   "202","B","returned",  "DHL",          "DH9988776655", "Alibaba",           False, None, None, None, now - timedelta(days=2)),
]
photo_stub = json.dumps([{"url": "https://placehold.co/400x300?text=Etiqueta", "label": "Foto da etiqueta", "taken_at": now.isoformat()}])

for pid, rid, unit, block, status, carrier, tracking, sender, has_fee, fee_amt, delivered_to, sig, recv_at in packages:
    delivered_at = recv_at + timedelta(hours=6) if status == "delivered" else None
    returned_at  = recv_at + timedelta(hours=12) if status == "returned" else None
    cur.execute("""
    INSERT INTO packages
      (id, association_id, resident_id, unit, block, status,
       carrier_name, tracking_code, sender_name, photo_urls,
       has_delivery_fee, delivery_fee_amount,
       delivered_to_name, signature_url, delivered_at, returned_at,
       received_by, received_at, created_at, updated_at)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    ON CONFLICT DO NOTHING
    """, (
        pid, ORG_ID, rid, unit, block, status,
        carrier, tracking, sender, photo_stub,
        has_fee, fee_amt,
        delivered_to, sig, delivered_at, returned_at,
        USER_OP, recv_at, recv_at, recv_at,
    ))

# ── 11. Ordens de serviço ─────────────────────────────────────────────────────
orders = [
    (SO1, 1, "Infiltração no teto – Bl. A",        "Mancha de umidade no teto do corredor do 1º andar, próximo ao apartamento 102.", "open",        "high",     RES_CARLOS, "Bl. A corredor 1º andar", None),
    (SO2, 2, "Lâmpada queimada – área de lazer",   "Luminária da piscina apagada há 3 dias.",                                         "in_progress", "medium",   RES_ANA,    "Área de lazer",           USER_OP),
    (SO3, 3, "Portão eletrônico com falha",         "Portão principal travando ao abrir.",                                             "resolved",    "critical",  RES_BEATRIZ,"Portão principal",        USER_ADMIN),
    (SO4, 4, "Solicitação de chave extra – Unid 301","Moradora solicita cópia da chave do salão de festas.",                          "open",        "low",       RES_MARCIA, "Administração",           None),
]
for oid, num, title, desc, status, priority, req_rid, location, assigned in orders:
    resolved_at = now - timedelta(days=1) if status == "resolved" else None
    assigned_at = now - timedelta(hours=4) if assigned else None
    cur.execute("""
    INSERT INTO service_orders
      (id, association_id, number, title, description, status, priority,
       requester_resident_id, location_detail,
       assigned_to, assigned_at,
       resolved_at, created_by, created_at, updated_at)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    ON CONFLICT DO NOTHING
    """, (
        oid, ORG_ID, num, title, desc, status, priority,
        req_rid, location,
        assigned, assigned_at,
        resolved_at, USER_ADMIN, now - timedelta(days=num), now,
    ))

conn.commit()
cur.close()
conn.close()

print("\n✅ Seed concluído com sucesso!\n")
print("=" * 52)
print("  ORG SLUG : teste")
print("  LOGINS (senha Admin@2025):")
print("    admin@teste.org      → Admin")
print("    conf@teste.org       → Conferente")
print("    op@teste.org         → Operador")
print("    viewer@teste.org     → Viewer")
print("=" * 52)
print(f"\n  Moradores   : 5 membros + 2 dependentes + 2 visitantes")
print(f"  Sessão caixa: 1 aberta (R$300 abertura, 7 transações)")
print(f"                1 encerrada (histórico)")
print(f"  Encomendas  : 5 (recebida, notificada, entregue, não-associado, devolvida)")
print(f"  Ordens      : 4 (aberta/alta, em andamento, resolvida, aberta/baixa)")
