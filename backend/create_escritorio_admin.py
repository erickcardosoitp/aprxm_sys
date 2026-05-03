import os, bcrypt, psycopg2
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
conn = psycopg2.connect(url)
conn.autocommit = True
cur = conn.cursor()

cur.execute("SELECT id FROM associations WHERE slug = 'escritorio'")
row = cur.fetchone()
if not row:
    print("Associacao escritorio nao encontrada")
    exit(1)

escritorio_id = str(row[0])
hashed = bcrypt.hashpw("Esc@2026".encode(), bcrypt.gensalt()).decode()

cur.execute("""
    INSERT INTO users (association_id, full_name, email, hashed_password, role, is_active)
    VALUES (%s, 'Administrador', 'erickcardoso@institutotiapretinha.org', %s, 'superadmin', true)
    ON CONFLICT (email, association_id) DO UPDATE
        SET hashed_password = EXCLUDED.hashed_password,
            role = 'superadmin',
            is_active = true
""", (escritorio_id, hashed))

print(f"Admin criado/atualizado: erickcardoso@institutotiapretinha.org | Esc@2026 | superadmin")
cur.close()
conn.close()
