ALTER TABLE associations ADD COLUMN IF NOT EXISTS chat_group VARCHAR(50);
UPDATE associations SET chat_group = 'main' WHERE slug IN ('vaz-lobo', 'congonha');
