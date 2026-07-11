-- Adiciona campo de anexo (comprovante) aos registros de migração de mensalidades
ALTER TABLE migration_payments ADD COLUMN IF NOT EXISTS proof_url TEXT;
