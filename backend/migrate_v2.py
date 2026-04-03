"""
Migration v2: diretoria_adjunta role, new SO statuses/fields, package_events,
service_order_comments, association data on settings.
Run: python migrate_v2.py
"""
import psycopg2

DB_URL = "postgresql://neondb_owner:npg_I0UVZq5jmdzM@ep-rough-tooth-an10po6b.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require"

conn = psycopg2.connect(DB_URL)
conn.autocommit = True
cur = conn.cursor()

print("Connected. Running migration v2…")

steps = [
    # 1. Add diretoria_adjunta to user_role enum
    ("Add diretoria_adjunta to user_role",
     "ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'diretoria_adjunta'"),

    # 2. Add new service_order_status values
    ("Add pending to service_order_status",
     "ALTER TYPE service_order_status ADD VALUE IF NOT EXISTS 'pending'"),
    ("Add waiting_third_party to service_order_status",
     "ALTER TYPE service_order_status ADD VALUE IF NOT EXISTS 'waiting_third_party'"),
    ("Add archived to service_order_status",
     "ALTER TYPE service_order_status ADD VALUE IF NOT EXISTS 'archived'"),

    # 3. New columns on service_orders
    ("Add service_impacted column",
     "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS service_impacted TEXT"),
    ("Add category_name column",
     "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS category_name TEXT"),
    ("Add org_responsible column",
     "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS org_responsible TEXT"),
    ("Add requester_email column",
     "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS requester_email TEXT"),
    ("Add reference_point column",
     "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS reference_point TEXT"),
    ("Add request_date column",
     "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS request_date TIMESTAMPTZ"),
    ("Add address_cep column on service_orders",
     "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS address_cep TEXT"),
    ("Add use_requester_address column",
     "ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS use_requester_address BOOLEAN DEFAULT FALSE"),

    # 4. Create package_events table
    ("Create package_events table", """
        CREATE TABLE IF NOT EXISTS package_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            association_id UUID NOT NULL REFERENCES associations(id),
            package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
            created_by UUID NOT NULL REFERENCES users(id),
            event_type TEXT NOT NULL DEFAULT 'comment',
            comment TEXT,
            attachment_url TEXT,
            attachment_name TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """),
    ("Create index on package_events.package_id",
     "CREATE INDEX IF NOT EXISTS idx_pkg_events_package ON package_events(package_id)"),

    # 5. Create service_order_comments table
    ("Create service_order_comments table", """
        CREATE TABLE IF NOT EXISTS service_order_comments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            service_order_id UUID NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
            association_id UUID NOT NULL REFERENCES associations(id),
            created_by UUID NOT NULL REFERENCES users(id),
            comment TEXT NOT NULL,
            attachment_urls JSONB DEFAULT '[]',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """),
    ("Create index on so_comments.service_order_id",
     "CREATE INDEX IF NOT EXISTS idx_so_comments_so ON service_order_comments(service_order_id)"),

    # 6. Extra columns for settings — association data
    ("Add assoc name col to association_settings",
     "ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS assoc_name TEXT"),
    ("Add assoc phone col",
     "ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS assoc_phone TEXT"),
    ("Add assoc email col",
     "ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS assoc_email TEXT"),
    ("Add assoc address col",
     "ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS assoc_address TEXT"),
    ("Add assoc cep col",
     "ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS assoc_cep TEXT"),
    ("Add assoc president_user_id col",
     "ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS president_user_id UUID REFERENCES users(id)"),

    # 7. Add operator_id to transactions for filtering
    ("Add column resident_name to packages if missing",
     "ALTER TABLE packages ADD COLUMN IF NOT EXISTS resident_name TEXT"),
    ("Add column resident_cpf to packages if missing",
     "ALTER TABLE packages ADD COLUMN IF NOT EXISTS resident_cpf TEXT"),
    ("Add column resident_cep to packages if missing",
     "ALTER TABLE packages ADD COLUMN IF NOT EXISTS resident_cep TEXT"),

    # 8. Index for package_events
    ("Create index pkg_events assoc",
     "CREATE INDEX IF NOT EXISTS idx_pkg_events_assoc ON package_events(association_id)"),
]

for label, sql in steps:
    try:
        cur.execute(sql)
        print(f"  ✓ {label}")
    except Exception as e:
        print(f"  ✗ {label}: {e}")

cur.close()
conn.close()
print("\nMigration v2 done.")
