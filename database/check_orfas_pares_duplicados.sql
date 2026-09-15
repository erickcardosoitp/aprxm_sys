-- Rodar direto no Neon (producao). Read-only, sem risco.
-- Pra cada uma das transacoes orfas (sem mensalidade vinculada) que tem
-- par no mesmo dia/mesmo valor, mostra os DOIS lados lado a lado: a orfa
-- e a(s) transacao(oes) irma(s) do mesmo morador/valor/dia -- pra decidir
-- qual das duas (se for duplicata de verdade) deve ser estornada.

WITH orfas AS (
    SELECT t.id, t.transaction_at, t.association_id, t.resident_id, t.amount, t.description, t.created_by
    FROM transactions t
    WHERE t.type = 'income' AND t.income_subtype = 'mensalidade'
      AND t.is_reversal = FALSE AND t.reversed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM mensalidades m WHERE m.transaction_id = t.id)
)
SELECT
    o.id AS orfa_id,
    o.transaction_at AS orfa_em,
    a.name AS unidade,
    r.full_name AS morador,
    o.amount,
    o.description AS orfa_descricao,
    u1.full_name AS orfa_lancado_por,
    irmao.id AS irmao_id,
    irmao.transaction_at AS irmao_em,
    irmao.description AS irmao_descricao,
    u2.full_name AS irmao_lancado_por,
    (SELECT COUNT(*) FROM mensalidades m WHERE m.transaction_id = irmao.id) AS irmao_meses_vinculados
FROM orfas o
JOIN associations a ON a.id = o.association_id
LEFT JOIN residents r ON r.id = o.resident_id
LEFT JOIN users u1 ON u1.id = o.created_by
JOIN transactions irmao
  ON irmao.resident_id = o.resident_id
 AND irmao.association_id = o.association_id
 AND irmao.amount = o.amount
 AND irmao.type = 'income' AND irmao.income_subtype = 'mensalidade'
 AND irmao.is_reversal = FALSE
 AND irmao.id <> o.id
 AND irmao.transaction_at::date = o.transaction_at::date
LEFT JOIN users u2 ON u2.id = irmao.created_by
ORDER BY r.full_name, o.transaction_at;
