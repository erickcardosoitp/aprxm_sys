-- ============================================================
-- APROXIMA (APRXM) — PostgreSQL DDL
-- Instituto Tia Pretinha — Multi-tenant Community Management
-- Version: 1.0.0
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM (
    'superadmin',   -- platform-level, cross-tenant
    'admin',        -- association admin
    'operator',     -- day-to-day staff
    'viewer'        -- read-only
);

CREATE TYPE resident_type AS ENUM (
    'member',       -- associado com CPF
    'guest'         -- visitante / dependente
);

CREATE TYPE resident_status AS ENUM (
    'active',
    'inactive',
    'suspended'
);

CREATE TYPE transaction_type AS ENUM (
    'income',       -- entrada
    'expense',      -- saída
    'sangria'       -- sangria de caixa
);

CREATE TYPE cash_session_status AS ENUM (
    'open',
    'closed'
);

CREATE TYPE package_status AS ENUM (
    'received',     -- recebido na portaria
    'notified',     -- morador notificado
    'delivered',    -- entregue ao morador
    'returned'      -- devolvido ao remetente
);

CREATE TYPE service_order_status AS ENUM (
    'open',
    'in_progress',
    'resolved',
    'cancelled'
);

CREATE TYPE service_order_priority AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);

-- ============================================================
-- ASSOCIATIONS  (multi-tenant root)
-- ============================================================

CREATE TABLE associations (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255)    NOT NULL,
    slug                VARCHAR(100)    NOT NULL UNIQUE,
    cnpj                VARCHAR(18),
    address_street      VARCHAR(255),
    address_number      VARCHAR(20),
    address_complement  VARCHAR(100),
    address_district    VARCHAR(100),
    address_city        VARCHAR(100),
    address_state       CHAR(2),
    address_zip         VARCHAR(9),
    phone               VARCHAR(20),
    email               VARCHAR(255),
    logo_url            TEXT,
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    plan_name           VARCHAR(50)     NOT NULL DEFAULT 'basic',
    plan_expires_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_associations_slug     ON associations (slug);
CREATE INDEX idx_associations_active   ON associations (is_active);

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id      UUID            NOT NULL REFERENCES associations (id) ON DELETE CASCADE,
    full_name           VARCHAR(255)    NOT NULL,
    email               VARCHAR(255)    NOT NULL,
    phone               VARCHAR(20),
    hashed_password     TEXT            NOT NULL,
    role                user_role       NOT NULL DEFAULT 'operator',
    avatar_url          TEXT,
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_users_email_assoc UNIQUE (email, association_id)
);

CREATE INDEX idx_users_association_id  ON users (association_id);
CREATE INDEX idx_users_email           ON users (email);
CREATE INDEX idx_users_role            ON users (role);

-- ============================================================
-- RESIDENTS
-- ============================================================

CREATE TABLE residents (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id      UUID            NOT NULL REFERENCES associations (id) ON DELETE CASCADE,
    type                resident_type   NOT NULL DEFAULT 'member',
    status              resident_status NOT NULL DEFAULT 'active',

    -- identification
    full_name           VARCHAR(255)    NOT NULL,
    cpf                 VARCHAR(14),
    rg                  VARCHAR(20),
    date_of_birth       DATE,
    photo_url           TEXT,

    -- contact
    email               VARCHAR(255),
    phone_primary       VARCHAR(20),
    phone_secondary     VARCHAR(20),

    -- unit within condominium
    unit                VARCHAR(50),
    block               VARCHAR(50),
    parking_spot        VARCHAR(50),

    -- guest → responsible member link
    responsible_id      UUID            REFERENCES residents (id) ON DELETE SET NULL,

    -- member-specific
    ownership_type      VARCHAR(50),
    move_in_date        DATE,
    move_out_date       DATE,
    notes               TEXT,

    created_by          UUID            REFERENCES users (id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_residents_assoc           ON residents (association_id);
CREATE INDEX idx_residents_type            ON residents (type);
CREATE INDEX idx_residents_status          ON residents (status);
CREATE INDEX idx_residents_unit_block      ON residents (association_id, block, unit);
CREATE INDEX idx_residents_responsible     ON residents (responsible_id);
CREATE INDEX idx_residents_name_trgm       ON residents USING gin (full_name gin_trgm_ops);

-- ============================================================
-- FINANCE — TRANSACTION CATEGORIES
-- ============================================================

CREATE TABLE transaction_categories (
    id                  UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id      UUID                NOT NULL REFERENCES associations (id) ON DELETE CASCADE,
    name                VARCHAR(100)        NOT NULL,
    description         TEXT,
    type                transaction_type    NOT NULL,
    color               CHAR(7),            -- hex color, e.g. #4CAF50
    is_active           BOOLEAN             NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_category_name_type_assoc UNIQUE (association_id, name, type)
);

CREATE INDEX idx_tx_categories_assoc ON transaction_categories (association_id);
CREATE INDEX idx_tx_categories_type  ON transaction_categories (type);

-- ============================================================
-- FINANCE — PAYMENT METHODS
-- ============================================================

CREATE TABLE payment_methods (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id      UUID            NOT NULL REFERENCES associations (id) ON DELETE CASCADE,
    name                VARCHAR(100)    NOT NULL,
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_payment_method_name_assoc UNIQUE (association_id, name)
);

CREATE INDEX idx_payment_methods_assoc ON payment_methods (association_id);

-- ============================================================
-- FINANCE — CASH SESSIONS
-- ============================================================

CREATE TABLE cash_sessions (
    id                  UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id      UUID                    NOT NULL REFERENCES associations (id) ON DELETE CASCADE,
    opened_by           UUID                    NOT NULL REFERENCES users (id),
    closed_by           UUID                    REFERENCES users (id),
    status              cash_session_status     NOT NULL DEFAULT 'open',
    opening_balance     NUMERIC(12, 2)          NOT NULL DEFAULT 0.00,
    closing_balance     NUMERIC(12, 2),
    expected_balance    NUMERIC(12, 2),
    difference          NUMERIC(12, 2),
    notes               TEXT,
    opened_at           TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    closed_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ             NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_session_close CHECK (
        (status = 'open'   AND closed_at IS NULL     AND closed_by IS NULL)
        OR
        (status = 'closed' AND closed_at IS NOT NULL AND closed_by IS NOT NULL)
    )
);

CREATE INDEX idx_cash_sessions_assoc     ON cash_sessions (association_id);
CREATE INDEX idx_cash_sessions_status    ON cash_sessions (status);
CREATE INDEX idx_cash_sessions_opened_at ON cash_sessions (opened_at DESC);

-- ============================================================
-- FINANCE — TRANSACTIONS
-- ============================================================

CREATE TABLE transactions (
    id                  UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id      UUID                NOT NULL REFERENCES associations (id) ON DELETE CASCADE,
    cash_session_id     UUID                NOT NULL REFERENCES cash_sessions (id),
    category_id         UUID                REFERENCES transaction_categories (id) ON DELETE SET NULL,
    payment_method_id   UUID                REFERENCES payment_methods (id) ON DELETE SET NULL,
    resident_id         UUID                REFERENCES residents (id) ON DELETE SET NULL,

    type                transaction_type    NOT NULL,
    amount              NUMERIC(12, 2)      NOT NULL CHECK (amount > 0),
    description         TEXT                NOT NULL,
    reference_number    VARCHAR(100),

    -- sangria-specific
    is_sangria          BOOLEAN             NOT NULL DEFAULT FALSE,
    sangria_reason      TEXT,
    sangria_destination VARCHAR(255),
    receipt_photo_url   TEXT,               -- foto do recibo (obrigatório em sangria)

    -- package delivery fee link
    package_id          UUID,               -- FK added below after packages table

    created_by          UUID                NOT NULL REFERENCES users (id),
    transaction_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_sangria_type CHECK (
        (is_sangria = FALSE)
        OR
        (is_sangria = TRUE AND type = 'sangria' AND sangria_reason IS NOT NULL)
    )
);

CREATE INDEX idx_tx_assoc          ON transactions (association_id);
CREATE INDEX idx_tx_session        ON transactions (cash_session_id);
CREATE INDEX idx_tx_category       ON transactions (category_id);
CREATE INDEX idx_tx_resident       ON transactions (resident_id);
CREATE INDEX idx_tx_type           ON transactions (type);
CREATE INDEX idx_tx_at             ON transactions (transaction_at DESC);
CREATE INDEX idx_tx_sangria        ON transactions (is_sangria) WHERE is_sangria = TRUE;

-- ============================================================
-- PACKAGES  (Encomendas / Correspondências)
-- ============================================================

CREATE TABLE packages (
    id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id              UUID            NOT NULL REFERENCES associations (id) ON DELETE CASCADE,
    resident_id                 UUID            REFERENCES residents (id) ON DELETE SET NULL,

    status                      package_status  NOT NULL DEFAULT 'received',

    -- sender / carrier
    sender_name                 VARCHAR(255),
    carrier_name                VARCHAR(100),
    tracking_code               VARCHAR(100),
    object_type                 VARCHAR(100),

    -- unit routing (denormalized for speed)
    unit                        VARCHAR(50),
    block                       VARCHAR(50),

    -- photos: [{url: string, label: string, taken_at: ISO8601}]
    photo_urls                  JSONB           NOT NULL DEFAULT '[]'::jsonb,

    -- delivery fee
    has_delivery_fee            BOOLEAN         NOT NULL DEFAULT FALSE,
    delivery_fee_amount         NUMERIC(8, 2),
    delivery_fee_paid           BOOLEAN         NOT NULL DEFAULT FALSE,
    delivery_fee_tx_id          UUID            REFERENCES transactions (id) ON DELETE SET NULL,

    -- delivery confirmation
    delivered_to_name           VARCHAR(255),
    delivered_to_cpf            VARCHAR(14),
    delivered_to_resident_id    UUID            REFERENCES residents (id) ON DELETE SET NULL,
    signature_url               TEXT,
    delivered_at                TIMESTAMPTZ,

    -- return
    returned_at                 TIMESTAMPTZ,
    return_reason               TEXT,

    notes                       TEXT,
    received_by                 UUID            NOT NULL REFERENCES users (id),
    delivered_by                UUID            REFERENCES users (id),
    received_at                 TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_delivery_fee CHECK (
        (has_delivery_fee = FALSE AND delivery_fee_amount IS NULL)
        OR
        (has_delivery_fee = TRUE  AND delivery_fee_amount IS NOT NULL AND delivery_fee_amount > 0)
    ),
    CONSTRAINT chk_delivered_fields CHECK (
        (status != 'delivered')
        OR
        (status = 'delivered' AND delivered_at IS NOT NULL AND delivered_to_name IS NOT NULL)
    )
);

-- Deferred FK on transactions → packages
ALTER TABLE transactions
    ADD CONSTRAINT fk_tx_package
    FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE SET NULL;

CREATE INDEX idx_packages_assoc        ON packages (association_id);
CREATE INDEX idx_packages_resident     ON packages (resident_id);
CREATE INDEX idx_packages_status       ON packages (status);
CREATE INDEX idx_packages_unit_block   ON packages (association_id, block, unit);
CREATE INDEX idx_packages_received_at  ON packages (received_at DESC);
CREATE INDEX idx_packages_tracking     ON packages (tracking_code);
CREATE INDEX idx_packages_fee_unpaid   ON packages (has_delivery_fee, delivery_fee_paid)
    WHERE has_delivery_fee = TRUE AND delivery_fee_paid = FALSE;

-- ============================================================
-- SERVICE ORDERS  (OS — Ofícios / Ordens de Serviço)
-- ============================================================

CREATE TABLE service_orders (
    id                      UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id          UUID                        NOT NULL REFERENCES associations (id) ON DELETE CASCADE,
    number                  INTEGER                     NOT NULL,   -- per-tenant sequence enforced below
    title                   VARCHAR(255)                NOT NULL,
    description             TEXT                        NOT NULL,
    status                  service_order_status        NOT NULL DEFAULT 'open',
    priority                service_order_priority      NOT NULL DEFAULT 'medium',

    -- requester
    requester_resident_id   UUID                        REFERENCES residents (id) ON DELETE SET NULL,
    requester_user_id       UUID                        REFERENCES users (id) ON DELETE SET NULL,
    requester_name          VARCHAR(255),
    requester_phone         VARCHAR(20),

    -- assignment
    assigned_to             UUID                        REFERENCES users (id) ON DELETE SET NULL,
    assigned_at             TIMESTAMPTZ,

    -- location
    unit                    VARCHAR(50),
    block                   VARCHAR(50),
    location_detail         TEXT,
    area                    VARCHAR(100),   -- Elétrica, Hidráulica, etc.

    -- resolution
    resolution_notes        TEXT,
    resolved_at             TIMESTAMPTZ,
    cancelled_at            TIMESTAMPTZ,
    cancellation_reason     TEXT,

    -- generated document
    pdf_url                 TEXT,
    pdf_generated_at        TIMESTAMPTZ,

    -- attachments: [{url, filename, uploaded_at}]
    attachments             JSONB           NOT NULL DEFAULT '[]'::jsonb,

    created_by              UUID            NOT NULL REFERENCES users (id),
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_so_number_assoc   UNIQUE (association_id, number),
    CONSTRAINT chk_resolved         CHECK (status != 'resolved'  OR resolved_at IS NOT NULL),
    CONSTRAINT chk_cancelled        CHECK (status != 'cancelled' OR cancelled_at IS NOT NULL)
);

-- Per-tenant auto-increment for OS number
CREATE SEQUENCE IF NOT EXISTS service_order_number_seq;

CREATE OR REPLACE FUNCTION next_service_order_number(p_association_id UUID)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    next_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(number), 0) + 1
      INTO next_num
      FROM service_orders
     WHERE association_id = p_association_id;
    RETURN next_num;
END;
$$;

CREATE INDEX idx_so_assoc       ON service_orders (association_id);
CREATE INDEX idx_so_status      ON service_orders (status);
CREATE INDEX idx_so_priority    ON service_orders (priority);
CREATE INDEX idx_so_assigned    ON service_orders (assigned_to);
CREATE INDEX idx_so_requester   ON service_orders (requester_resident_id);
CREATE INDEX idx_so_created_at  ON service_orders (created_at DESC);
CREATE INDEX idx_so_title_trgm  ON service_orders USING gin (title gin_trgm_ops);

-- ============================================================
-- SERVICE ORDER HISTORY  (audit trail)
-- ============================================================

CREATE TABLE service_order_history (
    id                  UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    service_order_id    UUID                    NOT NULL REFERENCES service_orders (id) ON DELETE CASCADE,
    association_id      UUID                    NOT NULL REFERENCES associations (id) ON DELETE CASCADE,
    from_status         service_order_status,
    to_status           service_order_status    NOT NULL,
    changed_by          UUID                    NOT NULL REFERENCES users (id),
    notes               TEXT,
    changed_at          TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_so_history_order  ON service_order_history (service_order_id);
CREATE INDEX idx_so_history_assoc  ON service_order_history (association_id);
CREATE INDEX idx_so_history_at     ON service_order_history (changed_at DESC);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$
DECLARE tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'associations', 'users', 'residents',
        'transaction_categories', 'payment_methods',
        'cash_sessions', 'transactions',
        'packages', 'service_orders'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%I_set_updated_at
             BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
            tbl, tbl
        );
    END LOOP;
END
$$;

-- ============================================================
-- ROW-LEVEL SECURITY (template)
-- Uncomment and configure per-deployment
-- ============================================================
--
-- ALTER TABLE associations          ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE users                 ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE residents             ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE transaction_categories ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE payment_methods       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE cash_sessions         ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE transactions          ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE packages              ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE service_orders        ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY tenant_isolation ON transactions
--     USING (association_id = current_setting('app.current_association_id')::uuid);

-- ============================================================
-- SEED — Default data (optional dev bootstrap)
-- ============================================================

-- INSERT INTO associations (name, slug, email) VALUES
--     ('Associação Vaz Lobo',  'vaz-lobo',  'admin@vazlobo.org'),
--     ('Associação Congonha',  'congonha',  'admin@congonha.org');
