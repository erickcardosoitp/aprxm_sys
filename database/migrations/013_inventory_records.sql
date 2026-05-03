-- 013: Tabela de inventários financeiros do Escritório
CREATE TABLE IF NOT EXISTS inventory_records (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id      UUID            NOT NULL REFERENCES associations(id),
    pix_counted         NUMERIC(12,2)   NOT NULL DEFAULT 0,
    cash_counted        NUMERIC(12,2)   NOT NULL DEFAULT 0,
    total_counted       NUMERIC(12,2)   NOT NULL DEFAULT 0,
    expected_total      NUMERIC(12,2),
    difference          NUMERIC(12,2),
    justification       TEXT            NOT NULL DEFAULT '',
    signed_by           UUID            REFERENCES users(id),
    signed_at           TIMESTAMPTZ,
    status              VARCHAR(20)     NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'concluded', 'cancelled')),
    cancelled_by        UUID            REFERENCES users(id),
    cancelled_at        TIMESTAMPTZ,
    reference_month     DATE            NOT NULL,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Garante um único inventário ativo (draft ou concluded) por mês por associação
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_active_month
    ON inventory_records (association_id, reference_month)
    WHERE status != 'cancelled';
