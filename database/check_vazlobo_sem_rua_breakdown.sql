-- Rodar direto no Neon (producao). Read-only, sem risco. So contagem.
SELECT
    COUNT(*) FILTER (WHERE r.address_cep IS NULL OR r.address_cep = '') AS sem_cep_nenhum,
    COUNT(*) FILTER (WHERE r.address_cep IS NOT NULL AND r.address_cep != '' AND length(regexp_replace(r.address_cep, '\D', '', 'g')) != 8) AS cep_com_digitos_errados,
    COUNT(*) FILTER (WHERE r.address_cep IS NOT NULL AND length(regexp_replace(r.address_cep, '\D', '', 'g')) = 8) AS cep_valido_mas_sem_rua_ainda
FROM residents r
JOIN associations a ON a.id = r.association_id
WHERE a.name = 'Associação de Moradores de Vaz Lobo'
  AND r.status = 'active'
  AND (r.address_street IS NULL OR r.address_street = '');
