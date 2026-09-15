-- Rodar direto no Neon (producao). Read-only, sem risco.
SELECT
    a.name AS unidade, r.full_name AS morador, r.address_cep AS cep_no_cadastro, r.address_street AS rua_no_cadastro,
    p.id AS encomenda_id, p.received_at,
    p.resident_cep AS coluna_propria_da_encomenda,
    p.resident_name AS nome_gravado_na_encomenda,
    p.notes
FROM residents r
JOIN packages p ON p.resident_id = r.id
JOIN associations a ON a.id = r.association_id
WHERE r.status = 'active'
  AND (r.address_cep IS NULL OR r.address_cep = '')
ORDER BY a.name, r.full_name, p.received_at DESC
LIMIT 100;
