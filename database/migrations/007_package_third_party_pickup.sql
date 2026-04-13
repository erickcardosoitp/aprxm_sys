-- Migration 007: Add third-party pickup fields to packages table
ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS third_party_pickup   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS owner_id_photo_url   TEXT,
  ADD COLUMN IF NOT EXISTS picker_id_photo_url  TEXT,
  ADD COLUMN IF NOT EXISTS picker_phone         VARCHAR(30);

-- Also make proof_of_residence_url nullable if it isn't already
-- (handled by model; no DDL change needed since it's already nullable in existing schema)
