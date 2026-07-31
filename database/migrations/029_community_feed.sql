DO $$ BEGIN
    CREATE TYPE community_author_type AS ENUM ('resident', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE community_post_category AS ENUM ('anuncio', 'reclamacao', 'aviso', 'outro');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE community_post_status AS ENUM ('pending', 'approved', 'rejected', 'removed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS community_posts (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id       UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    author_type          community_author_type NOT NULL,
    author_resident_id   UUID REFERENCES residents(id) ON DELETE SET NULL,
    author_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    author_name          VARCHAR(255) NOT NULL,
    category             community_post_category NOT NULL DEFAULT 'outro',
    title                VARCHAR(150),
    body                 TEXT NOT NULL,
    image_urls           JSONB NOT NULL DEFAULT '[]'::jsonb,
    status               community_post_status NOT NULL DEFAULT 'pending',
    moderation_reason    TEXT,
    moderated_by_ai      BOOLEAN NOT NULL DEFAULT FALSE,
    moderated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    pinned               BOOLEAN NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_community_posts_feed ON community_posts(association_id, status, pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_posts_author_resident ON community_posts(author_resident_id);

CREATE TABLE IF NOT EXISTS community_comments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id            UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    association_id     UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    author_type        community_author_type NOT NULL,
    author_resident_id UUID REFERENCES residents(id) ON DELETE SET NULL,
    author_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    author_name        VARCHAR(255) NOT NULL,
    body               TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_community_comments_post ON community_comments(post_id, created_at);
