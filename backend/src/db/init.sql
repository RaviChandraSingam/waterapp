-- WaterApp Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE user_role AS ENUM ('plumber', 'accountant', 'watercommittee', 'guest');
CREATE TYPE record_status AS ENUM ('draft', 'captured', 'reviewed', 'final');

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role user_role NOT NULL,
    is_active BOOLEAN DEFAULT true,
    must_change_password BOOLEAN DEFAULT false,
    can_manage_users BOOLEAN DEFAULT false,
    is_superadmin BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- BLOCKS & FLATS
-- ============================================================

CREATE TABLE blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(10) UNIQUE NOT NULL,  -- 'A', 'B', 'C', 'D', 'E'
    display_name VARCHAR(50) NOT NULL  -- 'A Block', 'B Block', etc.
);

CREATE TABLE flats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    block_id UUID NOT NULL REFERENCES blocks(id),
    flat_number VARCHAR(10) NOT NULL,  -- e.g., '1101', '2201'
    is_active BOOLEAN DEFAULT true,
    UNIQUE(block_id, flat_number)
);

-- ============================================================
-- COMMON AREAS
-- ============================================================

CREATE TABLE common_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,       -- 'A02 Office room'
    description VARCHAR(255),
    is_active BOOLEAN DEFAULT true
);

-- ============================================================
-- WATER SOURCES
-- ============================================================

CREATE TABLE water_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,         -- 'A block Borewell', '12000 ltrs per Tanker'
    source_type VARCHAR(20) NOT NULL,   -- 'borewell' or 'tanker'
    capacity_litres NUMERIC,            -- e.g., 12000 for tankers
    cost_per_unit NUMERIC,              -- e.g., 2000 per tanker, 1400 per Kaveri tanker
    is_active BOOLEAN DEFAULT true
);

-- ============================================================
-- MONTHLY RECORDS (the billing period)
-- ============================================================

CREATE TABLE monthly_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year INT NOT NULL,
    month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
    status record_status DEFAULT 'draft',
    period_start_date DATE NOT NULL,
    period_end_date DATE NOT NULL,
    mid_period_date DATE,               -- for bi-weekly reading
    cost_per_litre NUMERIC(10, 6),      -- calculated total cost / total input
    total_water_input NUMERIC,
    total_water_usage NUMERIC,
    notes TEXT,
    created_by UUID REFERENCES users(id),
    reviewed_by UUID REFERENCES users(id),
    finalized_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP,
    finalized_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(year, month)
);

-- ============================================================
-- COST ITEMS (monthly expenses)
-- ============================================================

CREATE TABLE cost_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    monthly_record_id UUID NOT NULL REFERENCES monthly_records(id) ON DELETE CASCADE,
    item_name VARCHAR(100) NOT NULL,    -- 'Salt', 'E Bill 1', etc.
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(monthly_record_id, item_name)
);

-- ============================================================
-- WATER SOURCE READINGS (monthly borewell/tanker readings)
-- ============================================================

CREATE TABLE water_source_readings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    monthly_record_id UUID NOT NULL REFERENCES monthly_records(id) ON DELETE CASCADE,
    water_source_id UUID NOT NULL REFERENCES water_sources(id),
    start_reading NUMERIC,              -- for borewells
    end_reading NUMERIC,                -- for borewells
    unit_count NUMERIC,                 -- for tankers (number of tankers)
    cost_per_unit NUMERIC,              -- per-month tanker cost (defaults from previous month or water_sources)
    consumption_litres NUMERIC,         -- calculated
    total_cost NUMERIC(12, 2),          -- calculated: unit_count * cost_per_unit
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(monthly_record_id, water_source_id)
);

-- ============================================================
-- METER READINGS (per flat, per reading date within month)
-- ============================================================

CREATE TABLE meter_readings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    monthly_record_id UUID NOT NULL REFERENCES monthly_records(id) ON DELETE CASCADE,
    flat_id UUID NOT NULL REFERENCES flats(id),
    reading_date DATE NOT NULL,
    reading_value NUMERIC NOT NULL,
    reading_sequence INT NOT NULL,      -- 1=start, 2=mid, 3=end (or week number)
    captured_by UUID REFERENCES users(id),
    has_warning BOOLEAN DEFAULT false,
    warning_message TEXT,
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(monthly_record_id, flat_id, reading_sequence)
);

-- ============================================================
-- COMMON AREA READINGS
-- ============================================================

CREATE TABLE common_area_readings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    monthly_record_id UUID NOT NULL REFERENCES monthly_records(id) ON DELETE CASCADE,
    common_area_id UUID NOT NULL REFERENCES common_areas(id),
    start_reading NUMERIC NOT NULL,
    end_reading NUMERIC NOT NULL,
    consumption_litres NUMERIC,         -- calculated: (end - start) * 1000
    captured_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(monthly_record_id, common_area_id)
);

-- ============================================================
-- FLAT BILLING (computed per flat per month)
-- ============================================================

CREATE TABLE flat_billing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    monthly_record_id UUID NOT NULL REFERENCES monthly_records(id) ON DELETE CASCADE,
    flat_id UUID NOT NULL REFERENCES flats(id),
    start_reading NUMERIC,
    end_reading NUMERIC,
    consumption_litres NUMERIC,         -- (end - start) * 1000
    slab1_qty NUMERIC DEFAULT 0,        -- up to 15000
    slab2_qty NUMERIC DEFAULT 0,        -- 15001-20000
    slab3_qty NUMERIC DEFAULT 0,        -- above 20000
    slab1_cost NUMERIC(12, 2) DEFAULT 0,
    slab2_cost NUMERIC(12, 2) DEFAULT 0,
    slab3_cost NUMERIC(12, 2) DEFAULT 0,
    total_cost NUMERIC(12, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(monthly_record_id, flat_id)
);

-- ============================================================
-- BILLING CONFIG (slab definitions, configurable by admin)
-- ============================================================

CREATE TABLE billing_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key VARCHAR(50) UNIQUE NOT NULL,
    config_value NUMERIC NOT NULL,
    description VARCHAR(255),
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_flats_block ON flats(block_id);
CREATE INDEX idx_meter_readings_monthly ON meter_readings(monthly_record_id);
CREATE INDEX idx_meter_readings_flat ON meter_readings(flat_id);
CREATE INDEX idx_flat_billing_monthly ON flat_billing(monthly_record_id);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_monthly_records_status ON monthly_records(status);
