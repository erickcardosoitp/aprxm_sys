-- Bank statements imported from CSV
CREATE TABLE IF NOT EXISTS bank_statements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id  UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    bank            VARCHAR(20) NOT NULL,  -- 'cora' | 'itau'
    date            DATE NOT NULL,
    amount          NUMERIC(12,2) NOT NULL,
    name            VARCHAR(255),          -- normalized uppercase, sem acento
    cpf             VARCHAR(14),           -- nullable (Cora doesn't provide CPF)
    tipo            VARCHAR(10) NOT NULL DEFAULT 'entrada',
    description     TEXT,
    conciliado      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_statements_assoc ON bank_statements(association_id);
CREATE INDEX IF NOT EXISTS idx_bank_statements_date  ON bank_statements(date);
CREATE INDEX IF NOT EXISTS idx_bank_statements_cpf   ON bank_statements(cpf) WHERE cpf IS NOT NULL;

-- Reconciliation links
CREATE TABLE IF NOT EXISTS reconciliations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id  UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    statement_id    UUID NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
    transaction_id  UUID REFERENCES transactions(id) ON DELETE SET NULL,
    score           INTEGER NOT NULL DEFAULT 0,
    status          VARCHAR(20) NOT NULL DEFAULT 'pendente', -- 'automatico' | 'sugestao' | 'pendente'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_reconciliation_statement UNIQUE (statement_id)
);
