"""
Seed script: cria associação "Vaz Lobo" com admin + config básica.
SEM dados de teste — ambiente de produção.
Execução: python seed_vaz_lobo.py
"""
import uuid
import bcrypt
import psycopg2
from datetime import datetime, timedelta, timezone
from decimal import Decimal

DB_URL = "postgresql://neondb_owner:npg_I0UVZq5jmdzM@ep-rough-tooth-an10po6b.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require"

def h(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

now = datetime.now(timezone.utc)
ORG_ID     = str(uuid.uuid4())
USER_ADMIN = str(uuid.uuid4())
USER_CONF  = str(uuid.uuid4())

conn = psycopg2.connect(DB_URL)
cur  = conn.cursor()

print("Conectando ao banco (Vaz Lobo)…")

# ── 1. Limpa dados existentes da associação Vaz Lobo (se houver) ──────────────
cur.execute("SELECT id FROM associations WHERE slug = 'vaz-lobo'")
existing = cur.fetchone()
if existing:
    old_id = existing[0]
    print(f"  → Removendo dados existentes de vaz-lobo ({old_id})…")
    for table in [
        "mensalidades", "transactions", "bank_statements",
        "cash_sessions", "service_orders", "packages",
        "residents", "transaction_categories", "payment_methods",
        "association_settings", "users",
    ]:
        cur.execute(f"DELETE FROM {table} WHERE association_id = %s", (old_id,))
    cur.execute("DELETE FROM associations WHERE id = %s", (old_id,))

# ── 2. Associação ─────────────────────────────────────────────────────────────
cur.execute("""
INSERT INTO associations
  (id, name, slug, phone, email, plan_name, plan_expires_at, is_active,
   address_city, address_state, created_at, updated_at)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
""", (
    ORG_ID,
    "Associação de Moradores de Vaz Lobo",
    "vaz-lobo",
    "(21) 3333-0001",
    "admin@vazlobo.org",
    "basic",
    now + timedelta(days=365),
    True,
    "Rio de Janeiro", "RJ",
    now, now,
))

# ── 3. Usuários ───────────────────────────────────────────────────────────────
users = [
    (USER_ADMIN, "Administrador Vaz Lobo", "admin@vazlobo.org",  "(21) 91111-0001", h("VazLobo@2025"), "admin"),
    (USER_CONF,  "Conferente Vaz Lobo",    "conf@vazlobo.org",   "(21) 91111-0002", h("VazLobo@2025"), "conferente"),
]
for uid_, name, email, phone, pw, role in users:
    cur.execute("""
    INSERT INTO users
      (id, association_id, full_name, email, phone, hashed_password, role, is_active, created_at, updated_at)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    ON CONFLICT (email, association_id) DO NOTHING
    """, (uid_, ORG_ID, name, email, phone, pw, role, True, now, now))

# ── 4. Configurações ──────────────────────────────────────────────────────────
cur.execute("""
INSERT INTO association_settings
  (association_id, default_cash_balance, max_cash_before_sangria, updated_at)
VALUES (%s,%s,%s,%s)
ON CONFLICT (association_id) DO NOTHING
""", (ORG_ID, Decimal("200.00"), Decimal("800.00"), now))

# ── 5. Categorias padrão ──────────────────────────────────────────────────────
categories = [
    ("Mensalidade",         "income",  "#22c55e"),
    ("Taxa de Entrega",     "income",  "#3b82f6"),
    ("Declaração",          "income",  "#8b5cf6"),
    ("Outros (Receita)",    "income",  "#06b6d4"),
    ("Material",            "expense", "#ef4444"),
    ("Manutenção",          "expense", "#f97316"),
    ("Serviços",            "expense", "#f59e0b"),
    ("Outros (Despesa)",    "expense", "#6b7280"),
    ("Sangria",             "sangria", "#64748b"),
]
for name, ctype, color in categories:
    cur.execute("""
    INSERT INTO transaction_categories
      (id, association_id, name, type, color, is_active, created_at, updated_at)
    VALUES (%s,%s,%s,%s,%s,true,%s,%s)
    ON CONFLICT (association_id, name, type) DO NOTHING
    """, (str(uuid.uuid4()), ORG_ID, name, ctype, color, now, now))

# ── 6. Métodos de pagamento ───────────────────────────────────────────────────
payment_methods = ["Dinheiro", "PIX", "Cartão Débito", "Cartão Crédito", "Transferência"]
for pm in payment_methods:
    cur.execute("""
    INSERT INTO payment_methods (id, association_id, name, is_active, created_at, updated_at)
    VALUES (%s,%s,%s,true,%s,%s)
    ON CONFLICT (association_id, name) DO NOTHING
    """, (str(uuid.uuid4()), ORG_ID, pm, now, now))

conn.commit()
cur.close()
conn.close()

print("\n✅ Seed Vaz Lobo concluído!\n")
print("=" * 52)
print("  ORG SLUG : vaz-lobo")
print("  LOGINS (senha VazLobo@2025):")
print("    admin@vazlobo.org   → Admin")
print("    conf@vazlobo.org    → Conferente")
print("=" * 52)
