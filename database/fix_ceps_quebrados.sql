-- Rodar direto no Neon (producao). Transacao aberta, nao commita sozinho.
-- Zera (NULL) CEPs com formato invalido: placeholder "00000-x" ou numero
-- de digitos diferente de 8 (CEP brasileiro sempre tem 8 digitos). Nao
-- inventa CEP nenhum, so limpa lixo que hoje conta como "preenchido".

BEGIN;

-- Preview de quem vai ser afetado
SELECT r.full_name, a.name AS unidade, r.address_cep AS cep_atual,
    CASE
        WHEN regexp_replace(r.address_cep, '\D', '', 'g') ~ '^0+$' THEN 'placeholder (so zeros)'
        ELSE 'numero de digitos invalido (' || length(regexp_replace(r.address_cep, '\D', '', 'g')) || ')'
    END AS motivo
FROM residents r
JOIN associations a ON a.id = r.association_id
WHERE r.address_cep IS NOT NULL AND r.address_cep != ''
  AND (
    regexp_replace(r.address_cep, '\D', '', 'g') ~ '^0+$'
    OR length(regexp_replace(r.address_cep, '\D', '', 'g')) != 8
  )
ORDER BY a.name, r.full_name;

-- Aplica a limpeza
UPDATE residents
SET address_cep = NULL, updated_at = now()
WHERE address_cep IS NOT NULL AND address_cep != ''
  AND (
    regexp_replace(address_cep, '\D', '', 'g') ~ '^0+$'
    OR length(regexp_replace(address_cep, '\D', '', 'g')) != 8
  );

-- Conferencia pos-update: nao deveria sobrar nenhum CEP quebrado
SELECT COUNT(*) AS ainda_quebrados
FROM residents
WHERE address_cep IS NOT NULL AND address_cep != ''
  AND (
    regexp_replace(address_cep, '\D', '', 'g') ~ '^0+$'
    OR length(regexp_replace(address_cep, '\D', '', 'g')) != 8
  );

-- Se bater com o preview (0 ainda_quebrados): COMMIT;
-- Se algo parecer errado: ROLLBACK;
