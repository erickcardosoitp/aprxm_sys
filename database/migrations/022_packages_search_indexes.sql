-- GIN trigram index para busca por código de rastreio (ILIKE '%termo%')
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_packages_tracking_trgm
    ON packages USING gin (tracking_code gin_trgm_ops);

-- GIN trigram index para busca por transportadora
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_packages_carrier_trgm
    ON packages USING gin (carrier_name gin_trgm_ops);
