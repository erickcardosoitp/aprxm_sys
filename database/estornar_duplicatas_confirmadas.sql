-- Rodar direto no Neon (producao). Transacao aberta, nao commita sozinho.
-- Estorna as 6 transacoes orfas confirmadas como duplicata clara (clique
-- duplo/reenvio em poucos minutos, mesma descricao, mesmo operador).
-- Reversao em nome de Erick Cardoso (erickcardoso@institutotiapretinha.org),
-- usando o MESMO mecanismo do botao "Estornar" do app (reverse_transaction):
-- cria uma transacao de expense oposta, marca a original como reversed_at/
-- reversed_by. Nao mexe em saldo de sessao de caixa aberta (todas essas sao
-- de meses atras, ja fechadas/conferidas) -- vira "devolucao" sem sessao,
-- so reduz faturamento no DRE, igual toda devolucao do sistema.
--
-- Fora deste lote (tratar separado, ja avisado):
--   - Aline Viana Rocha: NAO e duplicata, e pagamento em 2 partes (1/2, 2/2)
--     -- precisa so corrigir o valor da mensalidade de 10 pra 20.
--   - Karina Dias Velozo: as 2 transacoes estao orfas, nenhuma vinculou mes
--     -- precisa de backfill, nao estorno.
--   - Rosana Da Silva Oliveira, Thais Christine Gomes, Thatiane Cristine,
--     Danielle De Oliveira Souza: gap grande/contexto diferente, incerto.

BEGIN;

DO $$
DECLARE
    v_reversed_by uuid;
    v_ids uuid[] := ARRAY[
        '28e93fe0-a749-475a-a362-3beb36a9e300'::uuid,  -- Dea Guilherme
        'e7e3e89a-50ae-4f24-9bb6-ee9e516093bf'::uuid,  -- Jessica Oliveira
        '36a982e5-1ae5-4d30-a409-0a3d51a97ca1'::uuid,  -- Maria Lucia Pereira (1a orfa)
        '3aaf2e9a-9c94-4769-aa9c-3349879f2a3a'::uuid,  -- Maria Lucia Pereira (2a orfa)
        '63e4f2fc-78ed-470b-93fa-b5c0c746d2e4'::uuid,  -- Valdir Barbosa
        'f153e708-84c7-4873-9ba1-ea7ece32971d'::uuid   -- Osmira Coelho
    ];
    v_id uuid;
    orig RECORD;
    v_reversal_session uuid;
BEGIN
    SELECT id INTO v_reversed_by FROM users WHERE email = 'erickcardoso@institutotiapretinha.org';
    IF v_reversed_by IS NULL THEN
        RAISE EXCEPTION 'Usuario Erick Cardoso nao encontrado pelo e-mail.';
    END IF;

    FOREACH v_id IN ARRAY v_ids LOOP
        SELECT t.id, t.association_id, t.cash_session_id, t.amount, t.description, t.is_reversal, t.reversed_at
        INTO orig
        FROM transactions t WHERE t.id = v_id;

        IF orig.id IS NULL THEN
            RAISE NOTICE 'Transacao % nao encontrada, pulando.', v_id;
            CONTINUE;
        END IF;
        IF orig.is_reversal OR orig.reversed_at IS NOT NULL THEN
            RAISE NOTICE 'Transacao % ja e estorno ou ja foi estornada, pulando.', v_id;
            CONTINUE;
        END IF;

        -- so anexa a uma sessao se ela ainda estiver aberta (mesma regra do app)
        v_reversal_session := NULL;
        IF orig.cash_session_id IS NOT NULL THEN
            SELECT cs.id INTO v_reversal_session
            FROM cash_sessions cs
            WHERE cs.id = orig.cash_session_id AND cs.status = 'open';
        END IF;

        INSERT INTO transactions (
            id, association_id, cash_session_id, type, amount, description,
            is_reversal, reversal_of_id, reversal_reason, created_by, transaction_at
        ) VALUES (
            gen_random_uuid(), orig.association_id, v_reversal_session, 'expense', orig.amount,
            'Estorno: ' || orig.description, TRUE, orig.id,
            'Duplicata confirmada — mesmo morador/valor/descricao lancado 2x em poucos minutos (revisao manual)',
            v_reversed_by, now()
        );

        UPDATE transactions
        SET reversed_by = v_reversed_by, reversed_at = now(), updated_at = now()
        WHERE id = orig.id;
    END LOOP;
END $$;

-- CONFERENCIA -- olhe antes de decidir
SELECT t.id, t.transaction_at, t.amount, t.description, t.is_reversal, t.reversed_at, t.reversed_by
FROM transactions t
WHERE t.id IN (
    '28e93fe0-a749-475a-a362-3beb36a9e300', 'e7e3e89a-50ae-4f24-9bb6-ee9e516093bf',
    '36a982e5-1ae5-4d30-a409-0a3d51a97ca1', '3aaf2e9a-9c94-4769-aa9c-3349879f2a3a',
    '63e4f2fc-78ed-470b-93fa-b5c0c746d2e4', 'f153e708-84c7-4873-9ba1-ea7ece32971d'
) OR t.reversal_of_id IN (
    '28e93fe0-a749-475a-a362-3beb36a9e300', 'e7e3e89a-50ae-4f24-9bb6-ee9e516093bf',
    '36a982e5-1ae5-4d30-a409-0a3d51a97ca1', '3aaf2e9a-9c94-4769-aa9c-3349879f2a3a',
    '63e4f2fc-78ed-470b-93fa-b5c0c746d2e4', 'f153e708-84c7-4873-9ba1-ea7ece32971d'
)
ORDER BY t.transaction_at;

-- Se bater (6 originais com reversed_at preenchido + 6 estornos novos):
-- COMMIT;
-- Se algo parecer errado:
-- ROLLBACK;
