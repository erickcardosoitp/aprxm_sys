-- Rodar direto no Neon (producao). Read-only, sem risco. So contagem, leve.

-- 1) Quantos moradores do Vaz Lobo ainda estao sem rua (deveria ter caido
--    de ~74 pra so os 7 com CEP invalido)
SELECT COUNT(*) AS ainda_sem_rua
FROM residents r
JOIN associations a ON a.id = r.association_id
WHERE a.name = 'Associação de Moradores de Vaz Lobo'
  AND r.status = 'active'
  AND (r.address_street IS NULL OR r.address_street = '');

-- 2) Quantos moradores da unidade Vaz Lobo foram atualizados nos ultimos
--    30 minutos (confirma o volume exato, sem trazer linha de detalhe)
SELECT COUNT(*) AS atualizados_recentemente
FROM residents r
JOIN associations a ON a.id = r.association_id
WHERE a.name = 'Associação de Moradores de Vaz Lobo'
  AND r.updated_at >= now() - INTERVAL '30 minutes';
