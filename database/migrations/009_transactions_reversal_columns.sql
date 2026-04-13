-- Migration 009: add reversal columns to transactions table
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS is_reversal     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reversal_of_id  UUID        REFERENCES transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
  ADD COLUMN IF NOT EXISTS reversed_by     UUID        REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reversed_at     TIMESTAMPTZ;
