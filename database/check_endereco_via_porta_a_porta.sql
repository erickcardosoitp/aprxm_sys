-- Rodar direto no Neon (producao). Read-only, sem risco.
-- Moradores sem rua no cadastro, mas com endereco real vindo do
-- lead de porta a porta (que tem rua/numero obrigatorios).

SELECT
    r.id AS resident_id, r.full_name, a.name AS unidade,
    r.address_street AS rua_atual_no_cadastro, r.address_cep AS cep_atual_no_cadastro,
    p.address_street AS rua_no_porta_a_porta, p.address_number AS numero_no_porta_a_porta,
    p.address_complement AS complemento_no_porta_a_porta
FROM residents r
JOIN associations a ON a.id = r.association_id
JOIN porta_a_porta_leads p ON p.resident_id = r.id
WHERE r.status = 'active'
  AND (r.address_street IS NULL OR r.address_street = '')
ORDER BY a.name, r.full_name;

-- Resumo: quantos dos "sem endereco" tem lead de porta a porta pra puxar
SELECT
    COUNT(*) FILTER (WHERE r.address_street IS NULL OR r.address_street = '') AS sem_rua_no_cadastro,
    COUNT(*) FILTER (
        WHERE (r.address_street IS NULL OR r.address_street = '')
          AND EXISTS (SELECT 1 FROM porta_a_porta_leads p WHERE p.resident_id = r.id)
    ) AS desses_tem_lead_com_endereco
FROM residents r
WHERE r.status = 'active' AND r.type = 'member';
