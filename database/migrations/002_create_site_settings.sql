CREATE TABLE site_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    settings JSONB NOT NULL DEFAULT '{}'::jsonb,

    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    singleton BOOLEAN NOT NULL DEFAULT TRUE UNIQUE
        CHECK (singleton = TRUE)
);