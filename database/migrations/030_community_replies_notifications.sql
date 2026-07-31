DO $$ BEGIN
    ALTER TYPE community_post_status ADD VALUE IF NOT EXISTS 'resolved';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS admin_reply TEXT;
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS admin_reply_at TIMESTAMPTZ;
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS admin_reply_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS resident_notifications (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id UUID NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    resident_id    UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    type           VARCHAR(30) NOT NULL,
    title          VARCHAR(255) NOT NULL,
    body           TEXT,
    post_id        UUID REFERENCES community_posts(id) ON DELETE CASCADE,
    read_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resident_notif_unread ON resident_notifications(resident_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_resident_notif_resident ON resident_notifications(resident_id, created_at DESC);
