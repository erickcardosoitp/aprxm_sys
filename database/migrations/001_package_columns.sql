-- Add deliverer and proof_of_residence fields to packages
ALTER TABLE packages ADD COLUMN IF NOT EXISTS deliverer_name VARCHAR(255);
ALTER TABLE packages ADD COLUMN IF NOT EXISTS deliverer_signature_url TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS proof_of_residence_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS proof_of_residence_url TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS recipient_id_photo_url TEXT;
