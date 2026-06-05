-- ════════════════════════════════════════════════════════════════════════════
-- Hello Moving — Initial Schema
-- Migration: 001_initial_schema
-- ════════════════════════════════════════════════════════════════════════════


-- ── Shared trigger function: keep updated_at current ─────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ════════════════════════════════════════════════════════════════════════════
-- 1. bookings
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE bookings (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT        NOT NULL,
  email         TEXT,
  phone         TEXT,
  move_date     DATE        NOT NULL,
  move_from     TEXT,
  move_to       TEXT,
  service_type  TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes: calendar view, status filter, customer lookup, recent-first list
CREATE INDEX idx_bookings_move_date  ON bookings (move_date);
CREATE INDEX idx_bookings_status     ON bookings (status);
CREATE INDEX idx_bookings_email      ON bookings (email);
CREATE INDEX idx_bookings_created_at ON bookings (created_at DESC);

CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE bookings DISABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. calendar_availability
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE calendar_availability (
  date           DATE        PRIMARY KEY,
  status         TEXT        NOT NULL DEFAULT 'available'
                             CHECK (status IN ('available', 'limited', 'full', 'blocked')),
  capacity       INTEGER     NOT NULL DEFAULT 5  CHECK (capacity       >= 0),
  bookings_count INTEGER     NOT NULL DEFAULT 0  CHECK (bookings_count >= 0),
  notes          TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index: status filter for public calendar widget
CREATE INDEX idx_calendar_status ON calendar_availability (status);

CREATE TRIGGER trg_calendar_updated_at
  BEFORE UPDATE ON calendar_availability
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE calendar_availability DISABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════════════════════
-- 3. reviews
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE reviews (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    UUID        REFERENCES bookings (id) ON DELETE SET NULL,
  customer_name TEXT,
  rating        INTEGER     CHECK (rating BETWEEN 1 AND 5),
  review_text   TEXT,
  approved      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes: website display (approved only), admin join on booking, recent-first
CREATE INDEX idx_reviews_approved   ON reviews (approved);
CREATE INDEX idx_reviews_booking_id ON reviews (booking_id);
CREATE INDEX idx_reviews_created_at ON reviews (created_at DESC);

ALTER TABLE reviews DISABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════════════════════
-- 4. services
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE services (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT    NOT NULL,
  description   TEXT,
  icon          TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT TRUE
);

-- Composite index: website widget fetches active services in order
CREATE INDEX idx_services_active_order ON services (active, display_order);

ALTER TABLE services DISABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════════════════════
-- 5. media_library
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE media_library (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name  TEXT        NOT NULL,
  file_url   TEXT        NOT NULL,
  file_type  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes: recent-first grid, filter by type (image / video)
CREATE INDEX idx_media_created_at ON media_library (created_at DESC);
CREATE INDEX idx_media_file_type  ON media_library (file_type);

ALTER TABLE media_library DISABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════════════════════
-- hm_data (key-value store — existing table, patch RLS)
-- ════════════════════════════════════════════════════════════════════════════
-- Created in a prior migration; RLS must be disabled so the anon key
-- used by the admin panel can read and write.
ALTER TABLE hm_data DISABLE ROW LEVEL SECURITY;
