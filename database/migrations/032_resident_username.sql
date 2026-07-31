ALTER TABLE residents ADD COLUMN IF NOT EXISTS username VARCHAR(50);
CREATE UNIQUE INDEX IF NOT EXISTS uq_residents_assoc_username
    ON residents (association_id, LOWER(username)) WHERE username IS NOT NULL;
