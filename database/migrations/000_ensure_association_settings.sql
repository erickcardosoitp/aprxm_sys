-- ============================================================
-- Ensure association_settings table has all required columns
-- Safe to run on existing DBs (all additive, IF NOT EXISTS)
-- ============================================================

CREATE TABLE IF NOT EXISTS association_settings (
    association_id      UUID PRIMARY KEY REFERENCES associations(id) ON DELETE CASCADE,
    default_cash_balance    NUMERIC(10,2) NOT NULL DEFAULT 200.00,
    max_cash_before_sangria NUMERIC(10,2) NOT NULL DEFAULT 500.00,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by          UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Extended columns used by settings router (added incrementally)
ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS assoc_name        VARCHAR(255);
ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS assoc_phone       VARCHAR(30);
ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS assoc_email       VARCHAR(255);
ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS assoc_address     TEXT;
ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS assoc_cep         VARCHAR(9);
ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS president_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS access_groups     JSONB;
ALTER TABLE association_settings ADD COLUMN IF NOT EXISTS cadastros         JSONB NOT NULL DEFAULT '{}'::jsonb;
