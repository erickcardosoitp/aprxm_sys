-- Recriar coluna status com tipo correto
ALTER TABLE service_orders ADD COLUMN status service_order_status NOT NULL DEFAULT 'pending';

-- Recuperar status mais recente de cada OS via histórico
UPDATE service_orders so
SET status = h.to_status
FROM (
    SELECT DISTINCT ON (service_order_id) service_order_id, to_status
    FROM service_order_history
    ORDER BY service_order_id, changed_at DESC
) h
WHERE h.service_order_id = so.id;

-- Verificar resultado
SELECT status, COUNT(*) FROM service_orders GROUP BY status ORDER BY status;
