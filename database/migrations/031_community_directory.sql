DO $$ BEGIN
    CREATE TYPE community_place_category AS ENUM (
        'lanchonete', 'restaurante', 'mercado', 'servico', 'saude', 'beleza', 'educacao', 'outro'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS community_places (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    category       community_place_category NOT NULL DEFAULT 'outro',
    name           VARCHAR(150) NOT NULL,
    description    TEXT,
    phone          VARCHAR(20),
    whatsapp       VARCHAR(20),
    address        TEXT,
    image_urls     JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_community_places_assoc ON community_places(association_id, is_active, category);

CREATE TABLE IF NOT EXISTS community_place_ratings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id    UUID NOT NULL REFERENCES community_places(id) ON DELETE CASCADE,
    resident_id UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    stars       SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (place_id, resident_id)
);

CREATE TABLE IF NOT EXISTS community_place_update_requests (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id       UUID NOT NULL REFERENCES community_places(id) ON DELETE CASCADE,
    association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    resident_id    UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    changes        JSONB NOT NULL,
    notes          TEXT,
    status         VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_place_update_requests_status ON community_place_update_requests(association_id, status);
