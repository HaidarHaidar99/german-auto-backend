CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    name TEXT NOT NULL,

    rating INTEGER NOT NULL
        CHECK (rating BETWEEN 1 AND 5),

    text TEXT NOT NULL,

    image_url TEXT,

    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PUBLISHED', 'HIDDEN', 'DELETED')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reviews_user_id ON reviews(user_id);
CREATE INDEX idx_reviews_status ON reviews(status);
CREATE INDEX idx_reviews_created_at ON reviews(created_at DESC);