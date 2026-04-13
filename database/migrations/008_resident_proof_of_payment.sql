-- Migration 008: Add proof_of_payment_url to residents
ALTER TABLE residents
  ADD COLUMN IF NOT EXISTS proof_of_payment_url TEXT;
