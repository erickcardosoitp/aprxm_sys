"""
Migration v3: Add access_groups column to association_settings
"""
import os
import psycopg2

DATABASE_URL = os.environ.get("DATABASE_URL", "")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable not set")

# psycopg2 needs postgresql:// not postgres://
url = DATABASE_URL.replace("postgres://", "postgresql://", 1)

conn = psycopg2.connect(url)
conn.autocommit = True
cur = conn.cursor()

print("Adding access_groups column to association_settings...")
cur.execute("""
    ALTER TABLE association_settings
    ADD COLUMN IF NOT EXISTS access_groups JSONB DEFAULT '{}'::jsonb
""")
print("Done.")

cur.close()
conn.close()
print("Migration v3 complete.")
