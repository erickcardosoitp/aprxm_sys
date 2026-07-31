ALTER TABLE community_places ADD COLUMN IF NOT EXISTS owner_resident_id UUID REFERENCES residents(id) ON DELETE SET NULL;
ALTER TABLE community_places ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'approved';
ALTER TABLE community_places ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_community_places_owner ON community_places(owner_resident_id);
CREATE INDEX IF NOT EXISTS idx_community_places_status ON community_places(association_id, status);
