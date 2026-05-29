-- Migration 018: Modo Simplifica — feature flag por tenant + preferência por usuário
ALTER TABLE associations ADD COLUMN IF NOT EXISTS simplifica_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS simplifica_mode BOOLEAN NOT NULL DEFAULT FALSE;
