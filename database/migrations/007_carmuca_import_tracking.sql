-- ============================================
-- 007 CARMUCA IMPORT TRACKING
-- ============================================

-- Track external inventory origin
ALTER TABLE cars
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'local';

ALTER TABLE cars
ADD COLUMN IF NOT EXISTS dealership_slug TEXT;

ALTER TABLE cars
ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Prevent duplicate external imports while allowing NULL for local cars
CREATE UNIQUE INDEX IF NOT EXISTS idx_cars_source_external_id_unique
ON cars(source, external_id)
WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cars_source
ON cars(source);

CREATE INDEX IF NOT EXISTS idx_cars_external_id
ON cars(external_id);
