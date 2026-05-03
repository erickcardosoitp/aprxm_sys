"""
Migrations 012, 013, 014 — Ambiente Escritório
"""
import os
import psycopg2

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
    DATABASE_URL = os.environ.get("DATABASE_URL", "")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL não definida")

url = DATABASE_URL.replace("postgres://", "postgresql://", 1)
url = url.replace("postgresql+asyncpg://", "postgresql://", 1)
conn = psycopg2.connect(url)
conn.autocommit = True
cur = conn.cursor()

print("=== Migration 012: is_office + inventory_day_of_month ===")
cur.execute("""
    ALTER TABLE associations
      ADD COLUMN IF NOT EXISTS is_office BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS inventory_day_of_month SMALLINT NOT NULL DEFAULT 1
""")
print("OK")

print("=== Migration 013: tabela inventory_records ===")
cur.execute("""
    CREATE TABLE IF NOT EXISTS inventory_records (
        id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
        association_id      UUID            NOT NULL REFERENCES associations(id),
        pix_counted         NUMERIC(12,2)   NOT NULL DEFAULT 0,
        cash_counted        NUMERIC(12,2)   NOT NULL DEFAULT 0,
        total_counted       NUMERIC(12,2)   NOT NULL DEFAULT 0,
        expected_total      NUMERIC(12,2),
        difference          NUMERIC(12,2),
        justification       TEXT            NOT NULL DEFAULT '',
        signed_by           UUID            REFERENCES users(id),
        signed_at           TIMESTAMPTZ,
        status              VARCHAR(20)     NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'concluded', 'cancelled')),
        cancelled_by        UUID            REFERENCES users(id),
        cancelled_at        TIMESTAMPTZ,
        reference_month     DATE            NOT NULL,
        created_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
    )
""")
cur.execute("""
    CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_active_month
        ON inventory_records (association_id, reference_month)
        WHERE status != 'cancelled'
""")
print("OK")

print("=== Migration 014: Criar associação Escritório + usuários ===")
cur.execute("""
    INSERT INTO associations (name, slug, is_active, plan_name, is_office, inventory_day_of_month)
    VALUES ('Escritório', 'escritorio', true, 'enterprise', true, 28)
    ON CONFLICT (slug) DO UPDATE
        SET is_office = true,
            name = 'Escritório',
            inventory_day_of_month = 28
""")

cur.execute("SELECT id FROM associations WHERE slug = 'escritorio'")
escritorio_id = str(cur.fetchone()[0])
print(f"  Escritório ID: {escritorio_id}")

cur.execute("""
    UPDATE associations
    SET linked_association_slugs = ARRAY['vaz-lobo', 'congonha']
    WHERE id = %s
""", (escritorio_id,))

# Cópia Célia
cur.execute("""
    INSERT INTO users (association_id, full_name, email, hashed_password, role, is_active)
    SELECT DISTINCT ON (u.email)
        %s, u.full_name, u.email, u.hashed_password, u.role, true
    FROM users u
    JOIN associations a ON a.id = u.association_id
    WHERE a.slug IN ('vaz-lobo', 'congonha')
      AND u.full_name ILIKE '%%c_lia%%'
      AND u.is_active = true
    ORDER BY u.email
    ON CONFLICT (email, association_id) DO NOTHING
""", (escritorio_id,))
print(f"  Célia: {cur.rowcount} usuário(s) copiado(s)")

# Cópia Felipe
cur.execute("""
    INSERT INTO users (association_id, full_name, email, hashed_password, role, is_active)
    SELECT DISTINCT ON (u.email)
        %s, u.full_name, u.email, u.hashed_password, u.role, true
    FROM users u
    JOIN associations a ON a.id = u.association_id
    WHERE a.slug IN ('vaz-lobo', 'congonha')
      AND u.full_name ILIKE '%%felipe%%'
      AND u.is_active = true
    ORDER BY u.email
    ON CONFLICT (email, association_id) DO NOTHING
""", (escritorio_id,))
print(f"  Felipe: {cur.rowcount} usuário(s) copiado(s)")

cur.close()
conn.close()
print("\n=== Todas as migrations concluídas ===")
