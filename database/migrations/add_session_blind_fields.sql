ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS blind_pix NUMERIC(12, 2);
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS blind_dinheiro NUMERIC(12, 2);
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS troco_deixado NUMERIC(12, 2);
