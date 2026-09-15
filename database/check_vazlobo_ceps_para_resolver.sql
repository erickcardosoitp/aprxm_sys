-- Rodar direto no Neon (producao). Read-only, sem risco.
-- Moradores/visitantes/dependentes ativos com CEP valido (8 digitos) mas
-- sem rua -- vou resolver a rua via API de CEP e devolver o UPDATE.
SELECT r.id, r.full_name, r.address_cep
FROM residents r
JOIN associations a ON a.id = r.association_id
WHERE a.name = 'Associação de Moradores de Vaz Lobo'
  AND r.status = 'active'
  AND (r.address_street IS NULL OR r.address_street = '')
  AND r.address_cep IS NOT NULL
  AND length(regexp_replace(r.address_cep, '\D', '', 'g')) = 8
ORDER BY r.address_cep;
