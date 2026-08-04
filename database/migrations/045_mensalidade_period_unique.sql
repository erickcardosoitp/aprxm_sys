-- Garante a constraint usada pelo ON CONFLICT no registro de mensalidades.
-- Faltava em producao (schema.sql documentava, mas nunca foi migrada).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_mensalidade_period'
    ) THEN
        ALTER TABLE mensalidades
            ADD CONSTRAINT uq_mensalidade_period UNIQUE (association_id, resident_id, reference_month);
    END IF;
END $$;
