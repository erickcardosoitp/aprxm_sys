-- Rodar direto no Neon (producao). Read-only, sem risco.
-- So pra confirmar: a coluna packages.resident_cep e usada em ALGUM
-- registro (pra saber se vale a pena insistir nessa fonte ou se e coluna
-- morta/nunca preenchida).
SELECT COUNT(*) AS total_pacotes,
       COUNT(*) FILTER (WHERE resident_cep IS NOT NULL AND resident_cep != '') AS com_cep_preenchido
FROM packages;
