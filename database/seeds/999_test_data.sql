-- ============================================================
-- APRXM — Test Data (org de testes)
-- ATENÇÃO: rodar apenas em ambiente de desenvolvimento/teste
-- ============================================================

-- Requer: ter a association_id e user_id da org de testes
-- Substituir os UUIDs pelos valores reais via psql \set ou script

DO $$
DECLARE
    v_assoc_id    UUID;
    v_user_id     UUID;
    v_session_id  UUID;
    v_cat_id      UUID;
    v_pm_id       UUID;
    v_r1 UUID; v_r2 UUID; v_r3 UUID; v_r4 UUID; v_r5 UUID;
    v_p1 UUID; v_p2 UUID; v_p3 UUID; v_p4 UUID; v_p5 UUID;
BEGIN
    -- Pega a primeira associação e admin disponível
    SELECT id INTO v_assoc_id FROM associations LIMIT 1;
    SELECT id INTO v_user_id  FROM users WHERE association_id = v_assoc_id AND role IN ('admin','superadmin','conferente') LIMIT 1;

    IF v_assoc_id IS NULL OR v_user_id IS NULL THEN
        RAISE NOTICE 'Nenhuma associação ou usuário admin encontrado. Abortando.';
        RETURN;
    END IF;

    RAISE NOTICE 'Usando association_id: %', v_assoc_id;
    RAISE NOTICE 'Usando user_id: %', v_user_id;

    -- ── Moradores ──────────────────────────────────────────

    -- Membro ativo com CPF (conciliação automática possível)
    INSERT INTO residents (id, association_id, type, status, full_name, cpf, phone_primary, unit, block,
        address_cep, is_member_confirmed, terms_accepted, lgpd_accepted)
    VALUES (gen_random_uuid(), v_assoc_id, 'member', 'active',
        'Roberto Nunes Silva', '123.456.789-00', '21 99001-1234',
        '101', 'A', '20040-020', true, true, true)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_r1;
    IF v_r1 IS NULL THEN
        SELECT id INTO v_r1 FROM residents WHERE association_id = v_assoc_id AND full_name = 'Roberto Nunes Silva' LIMIT 1;
    END IF;

    -- Membro ativo sem CPF (conciliação por nome)
    INSERT INTO residents (id, association_id, type, status, full_name, phone_primary, unit, block,
        is_member_confirmed, terms_accepted, lgpd_accepted)
    VALUES (gen_random_uuid(), v_assoc_id, 'member', 'active',
        'Ana Carolina Ferreira', '21 98765-4321',
        '202', 'B', true, true, true)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_r2;
    IF v_r2 IS NULL THEN
        SELECT id INTO v_r2 FROM residents WHERE association_id = v_assoc_id AND full_name = 'Ana Carolina Ferreira' LIMIT 1;
    END IF;

    -- Membro inativo (taxa obrigatória, entregador diferente)
    INSERT INTO residents (id, association_id, type, status, full_name, cpf, phone_primary, unit,
        is_member_confirmed, terms_accepted, lgpd_accepted)
    VALUES (gen_random_uuid(), v_assoc_id, 'member', 'inactive',
        'Carlos Mendes', '987.654.321-00', '21 91234-5678',
        '305', true, true, true)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_r3;
    IF v_r3 IS NULL THEN
        SELECT id INTO v_r3 FROM residents WHERE association_id = v_assoc_id AND full_name = 'Carlos Mendes' LIMIT 1;
    END IF;

    -- Visitante (sem membro — sempre paga taxa se entregador diferente)
    INSERT INTO residents (id, association_id, type, status, full_name, phone_primary,
        address_cep, is_member_confirmed, terms_accepted, lgpd_accepted)
    VALUES (gen_random_uuid(), v_assoc_id, 'guest', 'active',
        'Joana da Silva', '21 97777-8888',
        '20040-020', false, true, true)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_r4;
    IF v_r4 IS NULL THEN
        SELECT id INTO v_r4 FROM residents WHERE association_id = v_assoc_id AND full_name = 'Joana da Silva' LIMIT 1;
    END IF;

    -- Membro ativo com nome ambíguo (para testar conciliação por sugestão)
    INSERT INTO residents (id, association_id, type, status, full_name, cpf, unit,
        is_member_confirmed, terms_accepted, lgpd_accepted)
    VALUES (gen_random_uuid(), v_assoc_id, 'member', 'active',
        'Roberto Nunes', '111.222.333-44', '410',
        true, true, true)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_r5;
    IF v_r5 IS NULL THEN
        SELECT id INTO v_r5 FROM residents WHERE association_id = v_assoc_id AND full_name = 'Roberto Nunes' LIMIT 1;
    END IF;

    -- ── Categoria e método de pagamento ────────────────────

    INSERT INTO transaction_categories (id, association_id, name, type, is_active)
    VALUES (gen_random_uuid(), v_assoc_id, 'Mensalidade', 'income', true)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_cat_id;
    IF v_cat_id IS NULL THEN
        SELECT id INTO v_cat_id FROM transaction_categories WHERE association_id = v_assoc_id AND name = 'Mensalidade' LIMIT 1;
    END IF;

    INSERT INTO payment_methods (id, association_id, name, is_active)
    VALUES (gen_random_uuid(), v_assoc_id, 'PIX', true)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_pm_id;
    IF v_pm_id IS NULL THEN
        SELECT id INTO v_pm_id FROM payment_methods WHERE association_id = v_assoc_id AND name = 'PIX' LIMIT 1;
    END IF;

    -- ── Sessão de caixa aberta ──────────────────────────────

    SELECT id INTO v_session_id
    FROM cash_sessions
    WHERE association_id = v_assoc_id AND status = 'open'
    LIMIT 1;

    IF v_session_id IS NULL THEN
        INSERT INTO cash_sessions (id, association_id, opened_by, status, opening_balance)
        VALUES (gen_random_uuid(), v_assoc_id, v_user_id, 'open', 200.00)
        RETURNING id INTO v_session_id;
    END IF;

    -- ── Transações para conciliação PIX ────────────────────

    -- R$20,00 de mensalidade — Roberto Nunes Silva (CPF conhecido → conciliação automática)
    INSERT INTO transactions (id, association_id, cash_session_id, category_id, payment_method_id,
        resident_id, type, amount, description, created_by)
    VALUES (gen_random_uuid(), v_assoc_id, v_session_id, v_cat_id, v_pm_id,
        v_r1, 'income', 20.00, 'Mensalidade Roberto Nunes Silva', v_user_id)
    ON CONFLICT DO NOTHING;

    -- R$20,00 de mensalidade — Ana Carolina (sem CPF → conciliação por nome)
    INSERT INTO transactions (id, association_id, cash_session_id, category_id, payment_method_id,
        resident_id, type, amount, description, created_by)
    VALUES (gen_random_uuid(), v_assoc_id, v_session_id, v_cat_id, v_pm_id,
        v_r2, 'income', 20.00, 'Mensalidade Ana Carolina', v_user_id)
    ON CONFLICT DO NOTHING;

    -- R$20,00 ambíguo (dois "Roberto Nunes" → sugestão, não automático)
    INSERT INTO transactions (id, association_id, cash_session_id, category_id, payment_method_id,
        resident_id, type, amount, description, created_by)
    VALUES (gen_random_uuid(), v_assoc_id, v_session_id, v_cat_id, v_pm_id,
        v_r5, 'income', 20.00, 'Mensalidade Roberto Nunes', v_user_id)
    ON CONFLICT DO NOTHING;

    -- ── Encomendas em diferentes estados ───────────────────

    -- Encomenda aguardando (status=received) — membro ativo
    INSERT INTO packages (id, association_id, resident_id, status, carrier_name, tracking_code,
        unit, block, photo_urls, received_by, deliverer_name)
    VALUES (gen_random_uuid(), v_assoc_id, v_r1, 'received',
        'Correios', 'AA123456789BR', '101', 'A',
        '[{"url":"https://placehold.co/300x200?text=Etiqueta","label":"Etiqueta","taken_at":"2026-04-04T09:00:00"}]',
        v_user_id, 'João da Entregadora')
    ON CONFLICT DO NOTHING;

    -- Encomenda notificada — membro ativo
    INSERT INTO packages (id, association_id, resident_id, status, carrier_name,
        unit, photo_urls, received_by, deliverer_name)
    VALUES (gen_random_uuid(), v_assoc_id, v_r2, 'notified',
        'iFood Entrega', '202',
        '[{"url":"https://placehold.co/300x200?text=Box","label":"Caixa","taken_at":"2026-04-03T14:00:00"}]',
        v_user_id, 'Maria da Transportadora')
    ON CONFLICT DO NOTHING;

    -- Encomenda entregue a membro inativo — com taxa (entregador diferente)
    INSERT INTO packages (id, association_id, resident_id, status, carrier_name,
        unit, photo_urls, received_by, deliverer_name,
        delivered_to_name, delivered_to_cpf, signature_url, proof_of_residence_url,
        has_delivery_fee, delivery_fee_amount, delivery_fee_paid,
        delivered_by, delivered_at)
    VALUES (gen_random_uuid(), v_assoc_id, v_r3, 'delivered',
        'Rappi', '305',
        '[{"url":"https://placehold.co/300x200?text=Pkg","label":"Pacote","taken_at":"2026-04-02T11:00:00"}]',
        v_user_id, 'Entregador Rappi',
        'Carlos Mendes', '987.654.321-00',
        'https://placehold.co/300x100?text=Assinatura',
        'https://placehold.co/300x200?text=Comprovante',
        true, 2.50, true,
        v_user_id, NOW() - INTERVAL '1 day')
    ON CONFLICT DO NOTHING;

    -- Encomenda entregue a membro ativo pelo MESMO entregador — sem taxa
    INSERT INTO packages (id, association_id, resident_id, status, carrier_name,
        unit, photo_urls, received_by, deliverer_name,
        delivered_to_name, signature_url, proof_of_residence_url,
        has_delivery_fee, delivery_fee_paid,
        delivered_by, delivered_at)
    VALUES (gen_random_uuid(), v_assoc_id, v_r1, 'delivered',
        'Mercado Livre', '101',
        '[{"url":"https://placehold.co/300x200?text=ML","label":"Etiqueta","taken_at":"2026-04-01T16:00:00"}]',
        v_user_id, 'Pedro Portaria',
        'Roberto Nunes Silva',
        'https://placehold.co/300x100?text=Assinatura',
        'https://placehold.co/300x200?text=Comprovante',
        false, false,
        v_user_id, NOW() - INTERVAL '2 days')
    ON CONFLICT DO NOTHING;

    -- Encomenda devolvida — visitante
    INSERT INTO packages (id, association_id, resident_id, status,
        unit, photo_urls, received_by,
        returned_at, return_reason)
    VALUES (gen_random_uuid(), v_assoc_id, v_r4, 'returned',
        '050',
        '[{"url":"https://placehold.co/300x200?text=Dev","label":"Etiqueta","taken_at":"2026-03-28T10:00:00"}]',
        v_user_id,
        NOW() - INTERVAL '5 days', 'Destinatário não encontrado')
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Dados de teste inseridos com sucesso!';
    RAISE NOTICE 'Sessão de caixa ativa: %', v_session_id;

END $$;
