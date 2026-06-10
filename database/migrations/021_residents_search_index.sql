-- Habilita extensão de trigrama (necessária para GIN index com ILIKE)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Índice GIN trigram no nome do morador (elimina full table scan no /residents/search)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_residents_full_name_trgm
    ON residents USING gin (full_name gin_trgm_ops);

-- Índice simples no CPF (exact/prefix match)
CREATE INDEX IF NOT EXISTS idx_residents_cpf
    ON residents (association_id, cpf);

-- Índice simples no telefone
CREATE INDEX IF NOT EXISTS idx_residents_phone
    ON residents (association_id, phone_primary);
