-- Add cadastros JSONB column to association_settings table
-- Stores categorias, servicos_impactados, and orgaos_responsaveis lists
ALTER TABLE association_settings
    ADD COLUMN IF NOT EXISTS cadastros JSONB NOT NULL DEFAULT '{}'::jsonb;
