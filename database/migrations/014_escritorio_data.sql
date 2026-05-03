-- 014: Cria associação Escritório e vincula usuários Célia e Felipe
DO $$
DECLARE
    escritorio_id UUID;
BEGIN
    -- Upsert associação Escritório
    INSERT INTO associations (name, slug, is_active, plan_name, is_office, inventory_day_of_month)
    VALUES ('Escritório', 'escritorio', true, 'enterprise', true, 28)
    ON CONFLICT (slug) DO UPDATE
        SET is_office = true,
            name = 'Escritório',
            inventory_day_of_month = 28;

    SELECT id INTO escritorio_id FROM associations WHERE slug = 'escritorio';

    -- Vincula Vaz Lobo + Congonha como linked_association_slugs
    UPDATE associations
    SET linked_association_slugs = ARRAY['vaz-lobo', 'congonha']
    WHERE id = escritorio_id;

    -- Copia Célia das associações vinculadas para o Escritório
    INSERT INTO users (association_id, full_name, email, hashed_password, role, is_active)
    SELECT DISTINCT ON (u.email)
        escritorio_id, u.full_name, u.email, u.hashed_password, u.role, true
    FROM users u
    JOIN associations a ON a.id = u.association_id
    WHERE a.slug IN ('vaz-lobo', 'congonha')
      AND u.full_name ILIKE '%c_lia%'
      AND u.is_active = true
    ORDER BY u.email
    ON CONFLICT (email, association_id) DO NOTHING;

    -- Copia Felipe das associações vinculadas para o Escritório
    INSERT INTO users (association_id, full_name, email, hashed_password, role, is_active)
    SELECT DISTINCT ON (u.email)
        escritorio_id, u.full_name, u.email, u.hashed_password, u.role, true
    FROM users u
    JOIN associations a ON a.id = u.association_id
    WHERE a.slug IN ('vaz-lobo', 'congonha')
      AND u.full_name ILIKE '%felipe%'
      AND u.is_active = true
    ORDER BY u.email
    ON CONFLICT (email, association_id) DO NOTHING;

END $$;
