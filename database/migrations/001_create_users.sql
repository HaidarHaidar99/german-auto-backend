CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    full_name TEXT NOT NULL,

    email TEXT NOT NULL UNIQUE,

    password_hash TEXT NOT NULL,

    is_verified BOOLEAN NOT NULL DEFAULT FALSE,

    link TEXT,

    link_expires_at TIMESTAMPTZ,

    reset_link TEXT,

    reset_link_expires_at TIMESTAMPTZ,

    role TEXT NOT NULL DEFAULT 'CUSTOMER'
        CHECK (role IN ('CUSTOMER', 'ADMIN', 'SUPER_ADMIN')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);