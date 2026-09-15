-- Rodar direto no Neon (producao). Read-only, sem risco.
-- Levantamento de qualidade de cadastro dos moradores: endereco incompleto,
-- variantes do mesmo logradouro escrito diferente, nome mal formatado,
-- CPF ausente/invalido, cadastro duplicado.

-- ============================================================
-- 1) Endereco incompleto: tem rua mas nao tem CEP, ou tem CEP mas nao tem rua.
--    So associados/visitantes ativos (quem realmente importa cobrar/entregar).
-- ============================================================
SELECT
    r.full_name, a.name AS unidade, r.type, r.status,
    r.address_street, r.address_number, r.address_cep,
    CASE
        WHEN r.address_street IS NOT NULL AND (r.address_cep IS NULL OR r.address_cep = '') THEN 'tem rua, falta CEP'
        WHEN (r.address_street IS NULL OR r.address_street = '') AND r.address_cep IS NOT NULL THEN 'tem CEP, falta rua'
        WHEN (r.address_street IS NULL OR r.address_street = '') AND (r.address_cep IS NULL OR r.address_cep = '') THEN 'sem rua e sem CEP'
    END AS problema
FROM residents r
JOIN associations a ON a.id = r.association_id
WHERE r.status = 'active'
  AND (
    (r.address_street IS NOT NULL AND (r.address_cep IS NULL OR r.address_cep = ''))
    OR ((r.address_street IS NULL OR r.address_street = '') AND r.address_cep IS NOT NULL)
    OR ((r.address_street IS NULL OR r.address_street = '') AND (r.address_cep IS NULL OR r.address_cep = '') AND r.type = 'member')
  )
ORDER BY a.name, problema, r.full_name;

-- ============================================================
-- 2) Variantes do mesmo logradouro escrito diferente (ex: "Macunaima" vs
--    "Rua Macunaima"). Normaliza tirando prefixo (Rua/Av/Alameda/etc.),
--    acento e case, agrupa por unidade -- se aparecer mais de 1 grafia
--    "crua" pro mesmo nome normalizado, e provavel variante do mesmo lugar.
-- ============================================================
WITH normalizado AS (
    SELECT
        r.id, r.full_name, r.association_id, r.address_street,
        trim(regexp_replace(
            unaccent(lower(r.address_street)),
            '^(rua|r\.|av|av\.|avenida|alameda|al\.|travessa|tv\.|praca|pca\.|estrada|rodovia)\s+', '', 'i'
        )) AS rua_normalizada
    FROM residents r
    WHERE r.address_street IS NOT NULL AND r.address_street != ''
)
SELECT
    a.name AS unidade,
    n.rua_normalizada,
    array_agg(DISTINCT n.address_street ORDER BY n.address_street) AS grafias_diferentes,
    COUNT(DISTINCT n.address_street) AS qtd_grafias,
    COUNT(*) AS qtd_moradores
FROM normalizado n
JOIN associations a ON a.id = n.association_id
GROUP BY a.name, n.rua_normalizada
HAVING COUNT(DISTINCT n.address_street) > 1
ORDER BY a.name, qtd_moradores DESC;

-- ============================================================
-- 3) CPF ausente (associado deveria ter) ou com formato invalido
--    (depois de tirar pontuacao, tem que sobrar 11 digitos).
-- ============================================================
SELECT
    r.full_name, a.name AS unidade, r.type, r.status, r.cpf,
    CASE
        WHEN r.cpf IS NULL OR r.cpf = '' THEN 'sem CPF'
        WHEN length(regexp_replace(r.cpf, '\D', '', 'g')) != 11 THEN 'CPF com formato invalido'
    END AS problema
FROM residents r
JOIN associations a ON a.id = r.association_id
WHERE r.type = 'member' AND r.status = 'active'
  AND (r.cpf IS NULL OR r.cpf = '' OR length(regexp_replace(r.cpf, '\D', '', 'g')) != 11)
ORDER BY a.name, r.full_name;

-- ============================================================
-- 4) CPF duplicado entre moradores da mesma unidade (nao deveria existir,
--    mas a migration v21 so aplica a constraint se nao tiver nenhum --
--    esses aqui sao os que bloquearam ela).
-- ============================================================
SELECT r.association_id, a.name AS unidade, r.cpf, array_agg(r.full_name) AS moradores, COUNT(*) AS qtd
FROM residents r
JOIN associations a ON a.id = r.association_id
WHERE r.cpf IS NOT NULL AND r.cpf != ''
GROUP BY r.association_id, a.name, r.cpf
HAVING COUNT(*) > 1
ORDER BY qtd DESC;

-- ============================================================
-- 5) Nome mal formatado: tudo maiusculo, tudo minusculo, espacos duplos,
--    espaco no inicio/fim, ou nome de 1 palavra so (associado deveria ter
--    nome completo).
-- ============================================================
SELECT
    r.id, r.full_name, a.name AS unidade, r.type,
    CASE
        WHEN r.full_name != trim(r.full_name) THEN 'espaco sobrando no inicio/fim'
        WHEN r.full_name ~ '\s{2,}' THEN 'espaco duplo no meio'
        WHEN r.full_name = upper(r.full_name) AND r.full_name != lower(r.full_name) THEN 'tudo maiusculo'
        WHEN r.full_name = lower(r.full_name) AND r.full_name != upper(r.full_name) THEN 'tudo minusculo'
        WHEN r.type = 'member' AND array_length(regexp_split_to_array(trim(r.full_name), '\s+'), 1) = 1 THEN 'associado com nome de 1 palavra so'
    END AS problema
FROM residents r
JOIN associations a ON a.id = r.association_id
WHERE r.status = 'active'
  AND (
    r.full_name != trim(r.full_name)
    OR r.full_name ~ '\s{2,}'
    OR (r.full_name = upper(r.full_name) AND r.full_name != lower(r.full_name))
    OR (r.full_name = lower(r.full_name) AND r.full_name != upper(r.full_name))
    OR (r.type = 'member' AND array_length(regexp_split_to_array(trim(r.full_name), '\s+'), 1) = 1)
  )
ORDER BY a.name, r.full_name;

-- ============================================================
-- 6) Possivel cadastro duplicado: mesmo nome (normalizado) na mesma
--    unidade, residents diferentes.
-- ============================================================
SELECT
    a.name AS unidade,
    trim(unaccent(lower(r.full_name))) AS nome_normalizado,
    array_agg(r.id) AS resident_ids,
    array_agg(r.status) AS status_de_cada,
    COUNT(*) AS qtd
FROM residents r
JOIN associations a ON a.id = r.association_id
GROUP BY a.name, trim(unaccent(lower(r.full_name)))
HAVING COUNT(*) > 1
ORDER BY qtd DESC;

-- ============================================================
-- 7) Resumo geral (contagem por unidade, pra dimensionar o problema)
-- ============================================================
SELECT
    a.name AS unidade,
    COUNT(*) FILTER (WHERE r.status = 'active') AS total_ativos,
    COUNT(*) FILTER (WHERE r.status = 'active' AND (r.address_street IS NULL OR r.address_street = '')) AS sem_rua,
    COUNT(*) FILTER (WHERE r.status = 'active' AND (r.address_cep IS NULL OR r.address_cep = '')) AS sem_cep,
    COUNT(*) FILTER (WHERE r.type = 'member' AND r.status = 'active' AND (r.cpf IS NULL OR r.cpf = '')) AS associado_sem_cpf
FROM residents r
JOIN associations a ON a.id = r.association_id
GROUP BY a.name
ORDER BY a.name;
