-- Rodar direto no Neon (producao). Read-only, sem risco.
-- Pega as moradoras "Ana" de Congonha sem CEP no cadastro e mostra,
-- pra cada encomenda delas, TODAS as colunas relacionadas a endereco/CEP
-- que existem na tabela packages (nao so as que o codigo atual usa) --
-- pra garantir que nao estou deixando passar nada.

SELECT
    r.full_name AS morador, r.address_cep AS cep_no_cadastro, r.address_street AS rua_no_cadastro,
    p.id AS encomenda_id, p.received_at,
    p.resident_cep AS coluna_propria_da_encomenda,
    p.resident_name AS nome_gravado_na_encomenda,
    p.resident_cpf AS cpf_gravado_na_encomenda,
    p.notes
FROM residents r
JOIN packages p ON p.resident_id = r.id
JOIN associations a ON a.id = r.association_id
WHERE a.name = 'Associação de Moradores de Congonha'
  AND r.full_name ILIKE 'Ana%'
  AND (r.address_cep IS NULL OR r.address_cep = '')
ORDER BY r.full_name, p.received_at DESC;
