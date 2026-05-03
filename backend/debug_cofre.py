import os, psycopg2
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
conn = psycopg2.connect(url)
cur = conn.cursor()

slugs = ['vaz-lobo', 'congonha']
cur.execute("SELECT id, name, slug FROM associations WHERE slug = ANY(%s)", (slugs,))
assocs = cur.fetchall()
print("=== ASSOCIAÇÕES ===")
for a in assocs:
    aid, name, slug = str(a[0]), a[1], a[2]
    print(f"\n{name} ({slug}) — {aid}")

    cur.execute("SELECT name, balance, is_cofre, is_malote, is_active FROM cash_boxes WHERE association_id = %s", (aid,))
    boxes = cur.fetchall()
    print(f"  cash_boxes: {boxes or 'nenhum'}")

    cur.execute("""
        SELECT status, COUNT(*), COALESCE(SUM(closing_balance),0), COALESCE(SUM(expected_balance),0)
        FROM cash_sessions WHERE association_id = %s GROUP BY status
    """, (aid,))
    sessions = cur.fetchall()
    print(f"  cash_sessions por status: {sessions}")

    cur.execute("""
        SELECT COALESCE(SUM(amount),0) FROM transactions
        WHERE association_id = %s AND type = 'income' AND reversed_at IS NULL AND is_reversal = false
    """, (aid,))
    total_income = cur.fetchone()[0]
    print(f"  total income: {total_income}")

cur.close()
conn.close()
