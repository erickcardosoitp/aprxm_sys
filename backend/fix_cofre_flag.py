import os, psycopg2
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
conn = psycopg2.connect(url)
conn.autocommit = True
cur = conn.cursor()

# Marca is_cofre=true para caixas chamadas 'Cofre' que não são malote
cur.execute("""
    UPDATE cash_boxes
    SET is_cofre = true
    WHERE name ILIKE '%cofre%' AND is_malote = false
""")
print(f"is_cofre corrigido em {cur.rowcount} caixa(s)")

# Também garante migration 015 para attributed_association_id
cur.execute("""
    ALTER TABLE inventory_records
    ADD COLUMN IF NOT EXISTS attributed_association_id UUID REFERENCES associations(id)
""")
print("Coluna attributed_association_id adicionada")

cur.close()
conn.close()
print("Concluido.")
