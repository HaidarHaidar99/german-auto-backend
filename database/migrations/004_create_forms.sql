CREATE TABLE forms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    form_type TEXT NOT NULL
        CHECK (form_type IN ('CONTACT', 'SELL_CAR')),

    data JSONB NOT NULL DEFAULT '{}'::jsonb,

    status TEXT NOT NULL DEFAULT 'NEW'
        CHECK (status IN ('NEW', 'READ', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED')),

    admin_notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forms_type ON forms(form_type);
CREATE INDEX idx_forms_status ON forms(status);
CREATE INDEX idx_forms_created_at ON forms(created_at DESC);