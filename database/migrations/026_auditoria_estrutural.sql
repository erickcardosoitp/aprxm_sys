-- Auditoria estrutural completa (2026-07-12) — ja aplicada em producao via
-- script ad-hoc; este arquivo documenta e versiona as mudancas pra reproduzir
-- em outro ambiente (ex: staging) se necessario.

-- 1. Corrige vazamento cross-tenant existente em packages (10 registros:
--    association_id do pacote nao batia com association_id do morador vinculado)
UPDATE packages p
SET association_id = r.association_id
FROM residents r
WHERE p.resident_id = r.id AND p.association_id != r.association_id;

-- 2. Trigger pra impedir recorrencia do vazamento acima
CREATE OR REPLACE FUNCTION check_package_resident_tenant() RETURNS TRIGGER AS $$
DECLARE
    resident_assoc UUID;
    delivered_to_assoc UUID;
BEGIN
    SELECT association_id INTO resident_assoc FROM residents WHERE id = NEW.resident_id;
    IF resident_assoc IS NOT NULL AND resident_assoc != NEW.association_id THEN
        RAISE EXCEPTION 'packages.association_id (%) nao bate com residents.association_id (%) do resident_id %', NEW.association_id, resident_assoc, NEW.resident_id;
    END IF;
    IF NEW.delivered_to_resident_id IS NOT NULL THEN
        SELECT association_id INTO delivered_to_assoc FROM residents WHERE id = NEW.delivered_to_resident_id;
        IF delivered_to_assoc IS NOT NULL AND delivered_to_assoc != NEW.association_id THEN
            RAISE EXCEPTION 'packages.association_id (%) nao bate com residents.association_id (%) do delivered_to_resident_id %', NEW.association_id, delivered_to_assoc, NEW.delivered_to_resident_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_package_resident_tenant ON packages;
CREATE TRIGGER trg_check_package_resident_tenant
BEFORE INSERT OR UPDATE ON packages
FOR EACH ROW EXECUTE FUNCTION check_package_resident_tenant();

-- 3 e 4: FK faltando + padronizacao de ON DELETE CASCADE em association_id,
-- tudo idempotente (seguro rodar de novo em qualquer ambiente)
DO $$
DECLARE
    fk RECORD;
BEGIN
    -- 3. FK nova em daily_tasks/daily_task_comments (nao existia)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_daily_tasks_assoc') THEN
        ALTER TABLE daily_tasks ADD CONSTRAINT fk_daily_tasks_assoc
            FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_daily_task_comments_assoc') THEN
        ALTER TABLE daily_task_comments ADD CONSTRAINT fk_daily_task_comments_assoc
            FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE CASCADE;
    END IF;

    -- 4. Recria como CASCADE só se a constraint existir e ainda nao for CASCADE
    FOR fk IN
        SELECT tc.table_name, tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'association_id'
          AND rc.delete_rule != 'CASCADE'
          AND tc.table_name IN ('agent_visits','association_settings','audit_log',
              'inventory_records','mensalidades','migration_payments',
              'package_events','service_order_comments','service_order_phases')
    LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', fk.table_name, fk.constraint_name);
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (association_id) REFERENCES associations(id) ON DELETE CASCADE',
            fk.table_name, fk.constraint_name);
    END LOOP;
END $$;

-- 5. Indices faltando em association_id (16 tabelas)
CREATE INDEX IF NOT EXISTS idx_agent_visits_assoc ON agent_visits (association_id);
CREATE INDEX IF NOT EXISTS idx_cash_box_movements_assoc ON cash_box_movements (association_id);
CREATE INDEX IF NOT EXISTS idx_cash_boxes_assoc ON cash_boxes (association_id);
CREATE INDEX IF NOT EXISTS idx_daily_task_comments_assoc ON daily_task_comments (association_id);
CREATE INDEX IF NOT EXISTS idx_notifications_assoc ON notifications (association_id);
CREATE INDEX IF NOT EXISTS idx_porta_a_porta_payments_assoc ON porta_a_porta_payments (association_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_assoc ON push_subscriptions (association_id);
CREATE INDEX IF NOT EXISTS idx_reconciliations_assoc ON reconciliations (association_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_assoc ON refresh_tokens (association_id);
CREATE INDEX IF NOT EXISTS idx_sangria_destinations_assoc ON sangria_destinations (association_id);
CREATE INDEX IF NOT EXISTS idx_service_order_comments_assoc ON service_order_comments (association_id);
CREATE INDEX IF NOT EXISTS idx_service_order_phases_assoc ON service_order_phases (association_id);
CREATE INDEX IF NOT EXISTS idx_session_transaction_reviews_assoc ON session_transaction_reviews (association_id);
CREATE INDEX IF NOT EXISTS idx_so_presence_assoc ON so_presence (association_id);
CREATE INDEX IF NOT EXISTS idx_user_association_roles_assoc ON user_association_roles (association_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_assoc ON webauthn_credentials (association_id);

-- 6. Remove indices redundantes (duplicavam unique/outro indice na mesma coluna)
DROP INDEX IF EXISTS idx_users_email;
DROP INDEX IF EXISTS idx_associations_slug;
DROP INDEX IF EXISTS ix_det_assoc;
DROP INDEX IF EXISTS idx_reconciliations_stmt;
DROP INDEX IF EXISTS idx_api_logs_errors;

-- 7. Remove enums orfaos (criados automaticamente pelo SQLModel em algum
--    deploy, sem nenhuma coluna usando - confirmado via pg_attribute antes de dropar)
DROP TYPE IF EXISTS cashsessionstatus;
DROP TYPE IF EXISTS packagestatus;
DROP TYPE IF EXISTS residentstatus;
DROP TYPE IF EXISTS residenttype;
DROP TYPE IF EXISTS serviceorderpriority;
DROP TYPE IF EXISTS serviceorderstatus;
DROP TYPE IF EXISTS transactiontype;
DROP TYPE IF EXISTS userrole;

-- 8. Limpa dados de notificacoes (pedido explicito)
TRUNCATE TABLE notifications;
