import os, psycopg2
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
conn = psycopg2.connect(url)
conn.autocommit = True
cur = conn.cursor()

cur.execute("SELECT id, name FROM associations WHERE slug = 'geral'")
row = cur.fetchone()
if row:
    geral_id = str(row[0])
    print(f"Encontrado: {row[1]} ({geral_id})")
    cur.execute("DELETE FROM audit_log WHERE association_id = %s", (geral_id,))
    print(f"  audit_log deletados: {cur.rowcount}")
    cur.execute("DELETE FROM audit_log WHERE user_id IN (SELECT id FROM users WHERE association_id = %s)", (geral_id,))
    print(f"  audit_log (por user) deletados: {cur.rowcount}")
    cur.execute("DELETE FROM users WHERE association_id = %s", (geral_id,))
    print(f"  Users deletados: {cur.rowcount}")
    cur.execute("DELETE FROM associations WHERE id = %s", (geral_id,))
    print(f"  Associacao deletada: {cur.rowcount}")
else:
    print("Associacao geral nao encontrada")

cur.close()
conn.close()
print("Concluido.")
