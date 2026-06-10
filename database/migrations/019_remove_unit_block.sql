-- Remove campos unit e block de todas as tabelas
ALTER TABLE residents DROP COLUMN IF EXISTS unit;
ALTER TABLE residents DROP COLUMN IF EXISTS block;

ALTER TABLE packages DROP COLUMN IF EXISTS unit;
ALTER TABLE packages DROP COLUMN IF EXISTS block;

ALTER TABLE service_orders DROP COLUMN IF EXISTS unit;
ALTER TABLE service_orders DROP COLUMN IF EXISTS block;

DROP INDEX IF EXISTS idx_residents_unit_block;
DROP INDEX IF EXISTS idx_packages_unit_block;
