ALTER TABLE service_orders ALTER COLUMN status DROP DEFAULT;

ALTER TABLE service_orders
    ALTER COLUMN status TYPE service_order_status_new
    USING CASE status::text
        WHEN 'open' THEN 'pending'
        WHEN 'waiting_third_party' THEN 'in_progress'
        ELSE status::text
    END::service_order_status_new;

ALTER TABLE service_orders ALTER COLUMN status SET DEFAULT 'pending'::service_order_status_new;

ALTER TABLE service_order_history
    ALTER COLUMN from_status TYPE service_order_status_new
    USING CASE from_status::text
        WHEN 'open' THEN 'pending'
        WHEN 'waiting_third_party' THEN 'in_progress'
        ELSE from_status::text
    END::service_order_status_new;

ALTER TABLE service_order_history
    ALTER COLUMN to_status TYPE service_order_status_new
    USING CASE to_status::text
        WHEN 'open' THEN 'pending'
        WHEN 'waiting_third_party' THEN 'in_progress'
        ELSE to_status::text
    END::service_order_status_new;

DROP TYPE service_order_status CASCADE;
ALTER TYPE service_order_status_new RENAME TO service_order_status;
