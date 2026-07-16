-- 027: Governanca Empresa/ESC — Fase 1 (aditivo, schema_migrations v5)
-- Espelha o bloco aplicado de verdade em backend/app/main.py (_run_migrations, v5).
-- Este arquivo e documentacao/reproducao — a migration real roda no lifespan do backend.

CREATE TABLE IF NOT EXISTS empresas (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    VARCHAR(255) NOT NULL,
    slug                    VARCHAR(100) UNIQUE NOT NULL,
    financeiro_centralizado BOOLEAN NOT NULL DEFAULT FALSE,
    plan_name               VARCHAR(50) NOT NULL DEFAULT 'basic',
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- associations.empresa_id: NULLABLE nesta fase (backfill na Fase 2, NOT NULL so na Fase 7)
ALTER TABLE associations ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id);
CREATE INDEX IF NOT EXISTS ix_associations_empresa ON associations(empresa_id);

-- users.association_id: DROP NOT NULL — aditivo, afrouxa constraint, nao quebra ninguem
ALTER TABLE users ALTER COLUMN association_id DROP NOT NULL;

-- role_permissions e audit_log: association_id vira nullable + ganham empresa_id
ALTER TABLE role_permissions ALTER COLUMN association_id DROP NOT NULL;
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id);
ALTER TABLE audit_log ALTER COLUMN association_id DROP NOT NULL;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id);

-- provisioning_runs — log de execucao do script de criacao (empresa/associacao)
DO $$ BEGIN
    CREATE TYPE provisioning_run_type AS ENUM ('create_empresa', 'create_associacao');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE provisioning_run_status AS ENUM ('running', 'success', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS provisioning_runs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id   UUID REFERENCES empresas(id),
    run_type     provisioning_run_type NOT NULL,
    status       provisioning_run_status NOT NULL DEFAULT 'running',
    payload      JSONB NOT NULL,
    steps        JSONB NOT NULL DEFAULT '[]'::jsonb,
    error_detail TEXT,
    started_by   UUID NOT NULL REFERENCES users(id),
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at  TIMESTAMPTZ
);
