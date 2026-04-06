"""
Seed script: cria associação "Geral" — agregador read-only de Vaz Lobo + Congonha.
Execução: python seed_geral.py
NOTA: Executar APÓS seed_vaz_lobo.py e seed_congonha.py.
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
USER_VIEWER = str(uuid.uuid4())

conn = psycopg2.connect(DB_URL)
cur  = conn.cursor()

print("Conectando ao banco (Geral)…")

# ── 1. Garante migração linked_association_slugs ──────────────────────────────
cur.execute("""
ALTER TABLE associations
  ADD COLUMN IF NOT EXISTS linked_association_slugs TEXT[] DEFAULT '{}';
""")

# ── 2. Limpa dados existentes da associação Geral (se houver) ─────────────────
cur.execute("SELECT id FROM associations WHERE slug = 'geral'")
existing = cur.fetchone()
if existing:
    old_id = existing[0]
    print(f"  → Removendo dados existentes de geral ({old_id})…")
    cur.execute("DELETE FROM users WHERE association_id = %s", (old_id,))
    cur.execute("DELETE FROM associations WHERE id = %s", (old_id,))

# ── 3. Associação Geral ───────────────────────────────────────────────────────
cur.execute("""
INSERT INTO associations
  (id, name, slug, email, plan_name, plan_expires_at, is_active,
   linked_association_slugs, created_at, updated_at)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
""", (
    ORG_ID,
    "Geral — Painel Consolidado",
    "geral",
    "admin@geral.org",
    "aggregator",
    now + timedelta(days=3650),
    True,
    ["vaz-lobo", "congonha"],
    now, now,
))

# ── 4. Usuários ───────────────────────────────────────────────────────────────
users = [
    (USER_ADMIN,  "Administrador Geral", "admin@geral.org",  "(21) 90000-0001", h("Geral@2025"), "admin"),
    (USER_VIEWER, "Visualizador Geral",  "viewer@geral.org", "(21) 90000-0002", h("Geral@2025"), "viewer"),
]
for uid_, name, email, phone, pw, role in users:
    cur.execute("""
    INSERT INTO users
      (id, association_id, full_name, email, phone, hashed_password, role, is_active, created_at, updated_at)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    ON CONFLICT (email, association_id) DO NOTHING
    """, (uid_, ORG_ID, name, email, phone, pw, role, True, now, now))

conn.commit()
cur.close()
conn.close()

print("\n✅ Seed Geral concluído!\n")
print("=" * 55)
print("  ORG SLUG : geral")
print("  LOGINS (senha Geral@2025):")
print("    admin@geral.org   → Admin (visualização consolidada)")
print("    viewer@geral.org  → Viewer")
print("  Associações vinculadas: vaz-lobo, congonha")
print("=" * 55)
