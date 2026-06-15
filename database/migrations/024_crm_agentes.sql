-- 024: CRM de Associados + Agentes
-- Adiciona suporte a baixa remota, role agente e registro de visitas porta a porta

-- 1. Novas colunas em mensalidades (retrocompatível via DEFAULT)
ALTER TABLE mensalidades
  ADD COLUMN IF NOT EXISTS payment_channel VARCHAR(20) NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS payment_proof_url TEXT;

-- 2. Nova role agente
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agente';

-- 3. Tabela de visitas porta a porta
CREATE TABLE IF NOT EXISTS agent_visits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  association_id   UUID NOT NULL REFERENCES associations(id),
  agent_id         UUID NOT NULL REFERENCES users(id),
  resident_id      UUID NOT NULL REFERENCES residents(id),
  visited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result           VARCHAR(20) NOT NULL CHECK (result IN ('paid','will_pay','absent','refused')),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_visits_resident  ON agent_visits(resident_id, association_id);
CREATE INDEX IF NOT EXISTS idx_agent_visits_agent     ON agent_visits(agent_id, visited_at);

-- 4. Índice auxiliar para query CRM (packages por morador)
CREATE INDEX IF NOT EXISTS idx_packages_resident_del  ON packages(resident_id, delivered_at);
