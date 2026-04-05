-- ============================================================
-- APRXM — Dados de teste financeiros (despesas + sessão fechada)
-- ============================================================

DO $$
DECLARE
    v_assoc_id   UUID;
    v_user_id    UUID;
    v_session_id UUID;
    v_closed_id  UUID;
    v_cat_id     UUID;
    v_exp_cat_id UUID;
    v_pm_id      UUID;
BEGIN
    SELECT id INTO v_assoc_id FROM associations LIMIT 1;
    SELECT id INTO v_user_id  FROM users WHERE association_id = v_assoc_id AND role IN ('admin','superadmin','conferente') LIMIT 1;

    IF v_assoc_id IS NULL OR v_user_id IS NULL THEN
        RAISE NOTICE 'Nenhuma associação/usuário encontrado. Abortando.';
        RETURN;
    END IF;

    -- Categorias
    INSERT INTO transaction_categories (id, association_id, name, type, is_active)
    VALUES (gen_random_uuid(), v_assoc_id, 'Mensalidade', 'income', true)
    ON CONFLICT DO NOTHING;
    SELECT id INTO v_cat_id FROM transaction_categories WHERE association_id = v_assoc_id AND name = 'Mensalidade' LIMIT 1;

    INSERT INTO transaction_categories (id, association_id, name, type, is_active)
    VALUES (gen_random_uuid(), v_assoc_id, 'Material de limpeza', 'expense', true)
    ON CONFLICT DO NOTHING;
    SELECT id INTO v_exp_cat_id FROM transaction_categories WHERE association_id = v_assoc_id AND name = 'Material de limpeza' LIMIT 1;

    -- Método de pagamento
    INSERT INTO payment_methods (id, association_id, name, is_active)
    VALUES (gen_random_uuid(), v_assoc_id, 'PIX', true)
    ON CONFLICT DO NOTHING;
    SELECT id INTO v_pm_id FROM payment_methods WHERE association_id = v_assoc_id AND name = 'PIX' LIMIT 1;

    -- ── Sessão fechada (mês passado) ──────────────────────────

    -- Verifica se já existe sessão fechada
    SELECT id INTO v_closed_id FROM cash_sessions
    WHERE association_id = v_assoc_id AND status = 'closed' LIMIT 1;

    IF v_closed_id IS NULL THEN
        INSERT INTO cash_sessions (id, association_id, opened_by, closed_by, status,
            opening_balance, closing_balance, expected_balance, difference,
            opened_at, closed_at)
        VALUES (gen_random_uuid(), v_assoc_id, v_user_id, v_user_id, 'closed',
            200.00, 350.00, 340.00, 10.00,
            NOW() - INTERVAL '35 days', NOW() - INTERVAL '34 days')
        RETURNING id INTO v_closed_id;

        -- Receitas da sessão fechada
        INSERT INTO transactions (id, association_id, cash_session_id, category_id, payment_method_id,
            type, amount, description, created_by, transaction_at)
        VALUES
            (gen_random_uuid(), v_assoc_id, v_closed_id, v_cat_id, v_pm_id,
             'income', 20.00, 'Mensalidade março — Roberto Nunes Silva', v_user_id, NOW() - INTERVAL '35 days'),
            (gen_random_uuid(), v_assoc_id, v_closed_id, v_cat_id, v_pm_id,
             'income', 20.00, 'Mensalidade março — Ana Carolina Ferreira', v_user_id, NOW() - INTERVAL '35 days'),
            (gen_random_uuid(), v_assoc_id, v_closed_id, v_cat_id, v_pm_id,
             'income', 20.00, 'Mensalidade março — Carlos Mendes', v_user_id, NOW() - INTERVAL '35 days'),
            (gen_random_uuid(), v_assoc_id, v_closed_id, v_cat_id, v_pm_id,
             'income', 20.00, 'Taxa de entrega — encomenda #001', v_user_id, NOW() - INTERVAL '34 days'),
            (gen_random_uuid(), v_assoc_id, v_closed_id, v_cat_id, v_pm_id,
             'income', 20.00, 'Comprovante de residência — Joana da Silva', v_user_id, NOW() - INTERVAL '34 days'),
            -- Despesas da sessão fechada
            (gen_random_uuid(), v_assoc_id, v_closed_id, v_exp_cat_id, v_pm_id,
             'expense', 45.00, 'Material de limpeza portaria', v_user_id, NOW() - INTERVAL '34 days'),
            (gen_random_uuid(), v_assoc_id, v_closed_id, NULL, v_pm_id,
             'expense', 15.00, 'Impressões/cópias', v_user_id, NOW() - INTERVAL '34 days')
        ON CONFLICT DO NOTHING;
    END IF;

    -- ── Sessão aberta atual — adiciona mais movimentos ────────

    SELECT id INTO v_session_id FROM cash_sessions
    WHERE association_id = v_assoc_id AND status = 'open' LIMIT 1;

    IF v_session_id IS NULL THEN
        INSERT INTO cash_sessions (id, association_id, opened_by, status, opening_balance)
        VALUES (gen_random_uuid(), v_assoc_id, v_user_id, 'open', 200.00)
        RETURNING id INTO v_session_id;
    END IF;

    -- Receitas do mês atual
    INSERT INTO transactions (id, association_id, cash_session_id, category_id, payment_method_id,
        type, amount, description, created_by, transaction_at)
    VALUES
        (gen_random_uuid(), v_assoc_id, v_session_id, v_cat_id, v_pm_id,
         'income', 20.00, 'Mensalidade abril — Roberto Nunes Silva', v_user_id, NOW() - INTERVAL '3 days'),
        (gen_random_uuid(), v_assoc_id, v_session_id, v_cat_id, v_pm_id,
         'income', 20.00, 'Mensalidade abril — Ana Carolina Ferreira', v_user_id, NOW() - INTERVAL '2 days'),
        (gen_random_uuid(), v_assoc_id, v_session_id, v_cat_id, v_pm_id,
         'income', 20.00, 'Mensalidade abril — Roberto Nunes', v_user_id, NOW() - INTERVAL '1 day'),
        (gen_random_uuid(), v_assoc_id, v_session_id, v_cat_id, v_pm_id,
         'income', 2.50, 'Taxa de entrega — encomenda #003', v_user_id, NOW() - INTERVAL '1 day'),
        (gen_random_uuid(), v_assoc_id, v_session_id, v_cat_id, v_pm_id,
         'income', 10.00, 'Comprovante de residência — Carlos Mendes', v_user_id, NOW()),
        -- Despesas do mês atual
        (gen_random_uuid(), v_assoc_id, v_session_id, v_exp_cat_id, v_pm_id,
         'expense', 38.90, 'Produtos de limpeza — mercado', v_user_id, NOW() - INTERVAL '2 days'),
        (gen_random_uuid(), v_assoc_id, v_session_id, NULL, NULL,
         'expense', 12.00, 'Canetas e papel A4', v_user_id, NOW() - INTERVAL '1 day')
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Dados financeiros de teste inseridos com sucesso.';
END $$;
