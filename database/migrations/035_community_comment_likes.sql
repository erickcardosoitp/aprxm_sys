CREATE TABLE IF NOT EXISTS community_comment_likes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id  UUID NOT NULL REFERENCES community_comments(id) ON DELETE CASCADE,
    resident_id UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (comment_id, resident_id)
);
CREATE INDEX IF NOT EXISTS idx_community_comment_likes_comment ON community_comment_likes(comment_id);
