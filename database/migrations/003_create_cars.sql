CREATE TABLE cars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    title TEXT NOT NULL,

    description_de TEXT,
    description_en TEXT,

    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    old_price NUMERIC(12,2) CHECK (old_price IS NULL OR old_price >= 0),

    condition TEXT NOT NULL DEFAULT 'USED'
        CHECK (condition IN ('NEW', 'USED')),

    fuel_type TEXT,
    transmission TEXT,

    mileage_km INTEGER CHECK (mileage_km IS NULL OR mileage_km >= 0),

    first_registration DATE,

    engine_displacement_cc INTEGER
        CHECK (engine_displacement_cc IS NULL OR engine_displacement_cc >= 0),

    performance_hp INTEGER
        CHECK (performance_hp IS NULL OR performance_hp >= 0),

    seats INTEGER
        CHECK (seats IS NULL OR seats > 0),

    vehicle_owners INTEGER
        CHECK (vehicle_owners IS NULL OR vehicle_owners >= 0),

    vehicle_condition TEXT,

    air_conditioning BOOLEAN NOT NULL DEFAULT FALSE,
    camera BOOLEAN NOT NULL DEFAULT FALSE,

    interior_design TEXT,
    interior_color TEXT,

    equipment JSONB NOT NULL DEFAULT '[]'::jsonb,

    custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,

    media JSONB NOT NULL DEFAULT '{}'::jsonb,

    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cars_brand ON cars(brand);
CREATE INDEX idx_cars_price ON cars(price);
CREATE INDEX idx_cars_fuel_type ON cars(fuel_type);
CREATE INDEX idx_cars_mileage_km ON cars(mileage_km);
CREATE INDEX idx_cars_condition ON cars(condition);
CREATE INDEX idx_cars_is_visible ON cars(is_visible);
CREATE INDEX idx_cars_created_at ON cars(created_at DESC);