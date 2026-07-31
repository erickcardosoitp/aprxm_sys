CREATE TABLE IF NOT EXISTS community_post_likes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    resident_id UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (post_id, resident_id)
);
CREATE INDEX IF NOT EXISTS idx_community_post_likes_post ON community_post_likes(post_id);
