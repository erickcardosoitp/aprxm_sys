-- Rodar direto no Neon (producao). Read-only, sem risco.
-- packages tem colunas proprias resident_cep/resident_name/resident_cpf
-- (denormalizadas, capturadas na hora de bipar a encomenda) separadas do
-- cadastro do morador. Ve quantos moradores sem CEP no cadastro tem CEP
-- real guardado em alguma encomenda deles.

SELECT
    r.id AS resident_id, r.full_name, a.name AS unidade,
    r.address_street AS rua_no_cadastro, r.address_cep AS cep_no_cadastro,
    array_agg(DISTINCT p.resident_cep) FILTER (WHERE p.resident_cep IS NOT NULL AND p.resident_cep != '') AS ceps_achados_nas_encomendas,
    COUNT(p.id) AS qtd_encomendas
FROM residents r
JOIN associations a ON a.id = r.association_id
JOIN packages p ON p.resident_id = r.id
WHERE r.status = 'active'
  AND (r.address_cep IS NULL OR r.address_cep = '')
GROUP BY r.id, r.full_name, a.name, r.address_street, r.address_cep
HAVING COUNT(p.id) FILTER (WHERE p.resident_cep IS NOT NULL AND p.resident_cep != '') > 0
ORDER BY a.name, r.full_name;

-- Resumo
SELECT
    COUNT(DISTINCT r.id) FILTER (WHERE r.address_cep IS NULL OR r.address_cep = '') AS sem_cep_no_cadastro,
    COUNT(DISTINCT r.id) FILTER (
        WHERE (r.address_cep IS NULL OR r.address_cep = '')
          AND EXISTS (SELECT 1 FROM packages p WHERE p.resident_id = r.id AND p.resident_cep IS NOT NULL AND p.resident_cep != '')
    ) AS desses_tem_cep_em_alguma_encomenda
FROM residents r
WHERE r.status = 'active' AND r.type = 'member';
