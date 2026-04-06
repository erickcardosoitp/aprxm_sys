-- Migration 005: Suporte a associações agregadoras (cross-tenant read-only)
-- Aplicado automaticamente pelo seed_geral.py — pode ser executado separadamente.

ALTER TABLE associations
  ADD COLUMN IF NOT EXISTS linked_association_slugs TEXT[] DEFAULT '{}';

COMMENT ON COLUMN associations.linked_association_slugs IS
  'Para associações agregadoras (plan_name = aggregator): slugs das associações cujos dados serão consolidados em modo leitura.';
