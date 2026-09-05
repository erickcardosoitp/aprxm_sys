-- Conta as linhas de TODAS as tabelas do schema public num resultado so
-- (uma UNION ALL montada dinamicamente), pra dar pra comparar origem x
-- destino com um simples `diff`.
-- Uso: psql "$DATABASE_URL" -At -F',' -f count_all.sql
SELECT string_agg(
  format('SELECT %L::text AS tabela, COUNT(*)::bigint AS linhas FROM %I.%I', tablename, schemaname, tablename),
  ' UNION ALL '
) AS query
FROM pg_tables
WHERE schemaname = 'public'
\gexec
