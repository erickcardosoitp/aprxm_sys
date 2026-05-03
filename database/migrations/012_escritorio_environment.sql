-- 012: Ambiente Escritório — is_office flag + inventory_day_of_month
ALTER TABLE associations
  ADD COLUMN IF NOT EXISTS is_office BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS inventory_day_of_month SMALLINT NOT NULL DEFAULT 1;
