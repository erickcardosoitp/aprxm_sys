-- Migration 011: add receive_batch_id to packages for bulk receive grouping
ALTER TABLE packages
    ADD COLUMN IF NOT EXISTS receive_batch_id UUID DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_packages_receive_batch ON packages (receive_batch_id) WHERE receive_batch_id IS NOT NULL;
