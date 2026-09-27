-- ============================================
-- 006 FINAL DATABASE CORRECTIONS
-- ============================================

-- USERS
ALTER TABLE users
ADD COLUMN IF NOT EXISTS favorite_car_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT '{
    "forms": true,
    "reviews": true,
    "push": true,
    "sound": true
}'::jsonb;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS push_subscriptions JSONB NOT NULL DEFAULT '[]'::jsonb;


-- CARS
ALTER TABLE cars
ADD COLUMN IF NOT EXISTS slug TEXT;

ALTER TABLE cars
ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE cars
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'AVAILABLE';

-- Make sure existing/default values are valid
UPDATE cars
SET status = 'AVAILABLE'
WHERE status IS NULL;

-- Prevent invalid future values
ALTER TABLE cars
DROP CONSTRAINT IF EXISTS cars_status_check;

ALTER TABLE cars
ADD CONSTRAINT cars_status_check
CHECK (status IN ('AVAILABLE', 'RESERVED', 'SOLD', 'HIDDEN'));


-- FORMS
ALTER TABLE forms
ADD COLUMN IF NOT EXISTS user_id UUID
REFERENCES users(id)
ON DELETE SET NULL;


-- INDEXES
CREATE UNIQUE INDEX IF NOT EXISTS idx_cars_slug_unique
ON cars(slug)
WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_favorite_car_ids
ON users USING GIN (favorite_car_ids);

CREATE INDEX IF NOT EXISTS idx_forms_user_id
ON forms(user_id);

CREATE INDEX IF NOT EXISTS idx_forms_created_at
ON forms(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_status_created_at
ON reviews(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cars_status
ON cars(status);