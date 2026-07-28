-- Rodar direto no Neon (read-only, sem risco) antes de decidir se da pra
-- adicionar UNIQUE(association_id, cpf) em residents.
SELECT association_id, cpf, COUNT(*) AS qtd
FROM residents
WHERE cpf IS NOT NULL AND cpf != ''
GROUP BY association_id, cpf
HAVING COUNT(*) > 1
ORDER BY qtd DESC;
