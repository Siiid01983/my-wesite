-- ════════════════════════════════════════════════════════════════════════════
--  customer_profiles.schema.sql — Customer Profile System, Phase 1 (ADDITIVE)
--
--  A denormalized per-customer profile keyed by email. Purely additive: the
--  bookings table and every existing table/workflow are untouched. Nothing in
--  the Booking Engine or slot-lock reads or writes this table.
--
--  Statistics strategy = LAZY COMPUTE (approved): the stored total/first/last
--  columns are a CACHE. They are (re)computed from `bookings` by the profile
--  service layer (_profiles.php) on read, and populated in bulk by
--  backfill-customer-profiles.php. No triggers, no booking-engine changes.
--
--  Apply via: hm-api/backfill-customer-profiles.php  (CLI: `php …`, or HTTP
--  with ?token=<admin_setup_token>). Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS customer_profiles (
  id                 CHAR(36)     NOT NULL,
  customer_email     VARCHAR(255) NOT NULL,               -- stored lower-cased
  customer_name      TEXT,
  customer_phone     VARCHAR(60),
  total_bookings     INT          NOT NULL DEFAULT 0,     -- cache: non-cancelled count
  first_booking_date VARCHAR(40),                         -- cache: MIN(booking_date)
  last_booking_date  VARCHAR(40),                         -- cache: MAX(booking_date)
  notes              TEXT,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY customer_email_unique (customer_email),      -- one profile per email; upsert key
  KEY profile_last_booking_idx (last_booking_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
