-- 1. Create service_order_phases table
CREATE TABLE IF NOT EXISTS service_order_phases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id UUID NOT NULL REFERENCES associations(id),
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#9333ea',
    sort_order INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Seed default phases for all existing associations
INSERT INTO service_order_phases (association_id, name, color, sort_order)
SELECT id, 'Ag. Terceiros', '#9333ea', 0 FROM associations
ON CONFLICT DO NOTHING;

INSERT INTO service_order_phases (association_id, name, color, sort_order)
SELECT id, 'Ag. Validação', '#d97706', 1 FROM associations
ON CONFLICT DO NOTHING;

INSERT INTO service_order_phases (association_id, name, color, sort_order)
SELECT id, 'Ag. Material', '#2563eb', 2 FROM associations
ON CONFLICT DO NOTHING;

INSERT INTO service_order_phases (association_id, name, color, sort_order)
SELECT id, 'Ag. Recurso Financeiro', '#16a34a', 3 FROM associations
ON CONFLICT DO NOTHING;

-- 3. Add phase_id column to service_orders
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES service_order_phases(id);

-- 4. Migrate open → pending
UPDATE service_orders SET status = 'pending' WHERE status = 'open';

-- 5. Migrate waiting_third_party → in_progress + phase
UPDATE service_orders so
SET status = 'in_progress',
    phase_id = (
        SELECT sop.id FROM service_order_phases sop
        WHERE sop.association_id = so.association_id
          AND sop.name = 'Ag. Terceiros'
          AND sop.active = true
        LIMIT 1
    )
WHERE so.status = 'waiting_third_party';

-- 6. Recreate service_order_status enum without open/waiting_third_party
-- Step 6a: create new type
CREATE TYPE service_order_status_new AS ENUM ('draft', 'pending', 'in_progress', 'resolved', 'archived', 'cancelled');

-- Step 6b: alter service_orders column
ALTER TABLE service_orders
    ALTER COLUMN status TYPE service_order_status_new
    USING status::text::service_order_status_new;

-- Step 6c: alter service_order_history columns
ALTER TABLE service_order_history
    ALTER COLUMN from_status TYPE service_order_status_new
    USING from_status::text::service_order_status_new;

ALTER TABLE service_order_history
    ALTER COLUMN to_status TYPE service_order_status_new
    USING to_status::text::service_order_status_new;

-- Step 6d: drop old type and rename
DROP TYPE service_order_status;
ALTER TYPE service_order_status_new RENAME TO service_order_status;
