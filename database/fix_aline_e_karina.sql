-- Rodar direto no Neon (producao). Transacao aberta, nao commita sozinho.

BEGIN;

-- ============================================================
-- 1) Aline Viana Rocha -- pagamento em 2 partes (R$10 + R$10 = 1 mes de
--    R$20), nao e duplicata. Linka a segunda parte via transaction_id_2/
--    amount_2 (campos feitos pra exatamente esse caso) e corrige o total.
-- ============================================================
UPDATE mensalidades
SET amount = 20.00, transaction_id_2 = '6adddae9-9ebc-46cb-bb03-a6abab1ba38c', amount_2 = 10.00, updated_at = now()
WHERE transaction_id = 'c7b8b798-bd08-41d4-b49d-8f7e97576acf' AND status = 'paid';

-- ============================================================
-- 2) Karina Dias Velozo -- as 2 transacoes miram os MESMOS meses
--    (Mai+Jun/2026), nenhuma vinculou mensalidade (bug a parte). Estorna
--    a mais bagunçada (12:07, "2022" no lugar de "2026") e faz o backfill
--    normal (Mai+Jun) na que sobra (14:25).
-- ============================================================
DO $$
DECLARE
    v_reversed_by uuid;
    orig RECORD;
    v_resident_id uuid;
    v_assoc_id uuid;
    v_created_by uuid;
    v_paid_at timestamptz;
BEGIN
    SELECT id INTO v_reversed_by FROM users WHERE email = 'erickcardoso@institutotiapretinha.org';

    -- 2a) estorna a transacao de 12:07 (mais bagunçada)
    SELECT t.id, t.association_id, t.cash_session_id, t.amount, t.description, t.is_reversal, t.reversed_at
    INTO orig FROM transactions t WHERE t.id = '7bb92bbd-8b68-4a01-8a8f-da58a68c6090';

    IF orig.id IS NOT NULL AND NOT orig.is_reversal AND orig.reversed_at IS NULL THEN
        INSERT INTO transactions (
            id, association_id, cash_session_id, type, amount, description,
            is_reversal, reversal_of_id, reversal_reason, created_by, transaction_at
        ) VALUES (
            gen_random_uuid(), orig.association_id, NULL, 'expense', orig.amount,
            'Estorno: ' || orig.description, TRUE, orig.id,
            'Duplicata confirmada -- mesmos meses (Mai/Jun 2026) da transacao 14:25, com erro de ano na descricao (revisao manual)',
            v_reversed_by, now()
        );
        UPDATE transactions SET reversed_by = v_reversed_by, reversed_at = now(), updated_at = now() WHERE id = orig.id;
    END IF;

    -- 2b) backfill Mai+Jun/2026 na transacao de 14:25 (a que fica valendo)
    SELECT t.association_id, t.resident_id, t.created_by, t.transaction_at
    INTO v_assoc_id, v_resident_id, v_created_by, v_paid_at
    FROM transactions t WHERE t.id = 'dc56c86f-d0e2-48e9-b97f-dc51211f772d';

    INSERT INTO mensalidades (id, association_id, resident_id, reference_month, due_date, amount, status, paid_at, transaction_id, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), v_assoc_id, v_resident_id, '2026-05', make_date(2026,5,10), 20.00, 'paid', v_paid_at, 'dc56c86f-d0e2-48e9-b97f-dc51211f772d', v_created_by, now(), now())
    ON CONFLICT (association_id, resident_id, reference_month) DO NOTHING;

    INSERT INTO mensalidades (id, association_id, resident_id, reference_month, due_date, amount, status, paid_at, transaction_id, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), v_assoc_id, v_resident_id, '2026-06', make_date(2026,6,10), 20.00, 'paid', v_paid_at, 'dc56c86f-d0e2-48e9-b97f-dc51211f772d', v_created_by, now(), now())
    ON CONFLICT (association_id, resident_id, reference_month) DO NOTHING;
END $$;

-- CONFERENCIA
SELECT 'aline' AS caso, m.reference_month, m.amount, m.amount_2, m.transaction_id, m.transaction_id_2::text AS transaction_id_2, m.status::text AS status
FROM mensalidades m WHERE m.transaction_id = 'c7b8b798-bd08-41d4-b49d-8f7e97576acf'
UNION ALL
SELECT 'karina' AS caso, m.reference_month, m.amount, m.amount_2, m.transaction_id, m.transaction_id_2::text, m.status::text
FROM mensalidades m WHERE m.transaction_id = 'dc56c86f-d0e2-48e9-b97f-dc51211f772d'
UNION ALL
SELECT 'karina_estorno' AS caso, NULL, t.amount, NULL, t.id, t.reversal_of_id::text, CASE WHEN t.is_reversal THEN 'estorno' ELSE 'original' END
FROM transactions t WHERE t.id = '7bb92bbd-8b68-4a01-8a8f-da58a68c6090' OR t.reversal_of_id = '7bb92bbd-8b68-4a01-8a8f-da58a68c6090';

-- Se bater: COMMIT;
-- Se algo parecer errado: ROLLBACK;
