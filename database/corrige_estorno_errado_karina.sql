-- Rodar direto no Neon (producao). Transacao aberta, nao commita sozinho.
-- Corrige o engano: eu estornei 7bb92bbd (que era a transacao LEGITIMA,
-- so com transaction_id nulo nos meses) em vez de dc56c86f (a duplicata
-- de verdade). Aqui:
--   1) desfaz o estorno errado da 7bb92bbd (ela nao e um estorno real de
--      negocio, foi engano deste script minutos atras -- apaga o registro
--      de estorno em vez de encadear "estorno do estorno")
--   2) estorna a dc56c86f de verdade (a duplicata)
--   3) linka maio/junho da Karina (que ja estavam pagos, so sem
--      transaction_id) na 7bb92bbd, que volta a ser a transacao valida

BEGIN;

-- 1) desfaz o estorno errado
DELETE FROM transactions WHERE id = 'e2f25a61-5793-4ca9-b392-aba28c417501';
UPDATE transactions SET reversed_by = NULL, reversed_at = NULL, updated_at = now()
WHERE id = '7bb92bbd-8b68-4a01-8a8f-da58a68c6090';

-- 2) estorna a duplicata de verdade
DO $$
DECLARE
    v_reversed_by uuid;
    orig RECORD;
BEGIN
    SELECT id INTO v_reversed_by FROM users WHERE email = 'erickcardoso@institutotiapretinha.org';

    SELECT t.id, t.association_id, t.cash_session_id, t.amount, t.description, t.is_reversal, t.reversed_at
    INTO orig FROM transactions t WHERE t.id = 'dc56c86f-d0e2-48e9-b97f-dc51211f772d';

    IF orig.id IS NOT NULL AND NOT orig.is_reversal AND orig.reversed_at IS NULL THEN
        INSERT INTO transactions (
            id, association_id, cash_session_id, type, amount, description,
            is_reversal, reversal_of_id, reversal_reason, created_by, transaction_at
        ) VALUES (
            gen_random_uuid(), orig.association_id, NULL, 'expense', orig.amount,
            'Estorno: ' || orig.description, TRUE, orig.id,
            'Duplicata confirmada -- mesmos meses (Mai/Jun 2026) ja pagos pela transacao das 12:07 (revisao manual, correcao)',
            v_reversed_by, now()
        );
        UPDATE transactions SET reversed_by = v_reversed_by, reversed_at = now(), updated_at = now() WHERE id = orig.id;
    END IF;
END $$;

-- 3) linka maio/junho (ja pagos) na transacao que volta a ser valida
UPDATE mensalidades
SET transaction_id = '7bb92bbd-8b68-4a01-8a8f-da58a68c6090', updated_at = now()
WHERE resident_id = (SELECT resident_id FROM transactions WHERE id = '7bb92bbd-8b68-4a01-8a8f-da58a68c6090')
  AND association_id = (SELECT association_id FROM transactions WHERE id = '7bb92bbd-8b68-4a01-8a8f-da58a68c6090')
  AND reference_month IN ('2026-05', '2026-06')
  AND transaction_id IS NULL;

-- CONFERENCIA
SELECT 'transacoes' AS bloco, t.id::text, t.amount::text, t.is_reversal::text, t.reversed_at::text, t.reversal_of_id::text
FROM transactions t
WHERE t.id IN ('7bb92bbd-8b68-4a01-8a8f-da58a68c6090', 'dc56c86f-d0e2-48e9-b97f-dc51211f772d', 'e2f25a61-5793-4ca9-b392-aba28c417501')
   OR t.reversal_of_id = 'dc56c86f-d0e2-48e9-b97f-dc51211f772d'
UNION ALL
SELECT 'mensalidades' AS bloco, m.reference_month, m.amount::text, m.status::text, m.transaction_id::text, NULL
FROM mensalidades m
WHERE m.resident_id = (SELECT resident_id FROM transactions WHERE id = '7bb92bbd-8b68-4a01-8a8f-da58a68c6090')
  AND m.association_id = (SELECT association_id FROM transactions WHERE id = '7bb92bbd-8b68-4a01-8a8f-da58a68c6090')
ORDER BY 1;

-- Esperado: 7bb92bbd com is_reversal=false, reversed_at=null (voltou ao normal);
-- dc56c86f com reversed_at preenchido; e2f25a61 SUMIU (foi deletado);
-- 1 novo estorno com reversal_of_id=dc56c86f; mensalidades mai/jun com
-- transaction_id = 7bb92bbd.
-- Se bater: COMMIT;
-- Se algo parecer errado: ROLLBACK;
