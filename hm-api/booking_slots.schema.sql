-- ════════════════════════════════════════════════════════════════════════════
--  booking_slots.schema.sql — Smart Booking Engine, Phase 0 (ADDITIVE)
--
--  A dedicated slot table that makes "one booking per (date, time-band)" a
--  DATABASE-ENFORCED invariant. The UNIQUE(booking_date, time_band, slot_index)
--  constraint is the actual lock — race-proof regardless of which code path
--  inserts. Nothing reads or writes this table until Phase 2; creating it is a
--  no-op for the live booking / admin / portal flows.
--
--  Canonical `time_band` = a STABLE band ID ('am' | 'pm' | 'ev' | 'nt'), NOT the
--  display label — so renaming a slot label in hm_booking_config never orphans a
--  lock (Open Item #4). Flexible / 時間指定なし bookings are NOT slot-locked and
--  get no row here.
--
--  Capacity is 1 per band today (single vehicle). `slot_index` (always 0 now)
--  makes capacity > 1 a config change later with NO migration: indices 0..N-1.
--
--  Apply via: hm-api/backfill-slots.php  (CLI: `php hm-api/backfill-slots.php`,
--  or HTTP with ?token=<admin_setup_token>). Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS booking_slots (
  id           CHAR(36)    NOT NULL,
  booking_date VARCHAR(40) NOT NULL,               -- 'YYYY-MM-DD' (matches bookings.booking_date)
  time_band    VARCHAR(20) NOT NULL,               -- canonical band ID: am|pm|ev|nt
  slot_index   INT         NOT NULL DEFAULT 0,     -- 0..(capacity-1); always 0 while capacity = 1
  booking_id   CHAR(36)    NOT NULL,               -- logical ref to bookings.id (no FK, house style)
  status       VARCHAR(20) NOT NULL DEFAULT 'reserved',
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY slot_unique (booking_date, time_band, slot_index),   -- the lock
  KEY slot_date_idx (booking_date),                               -- availability.php lookups
  KEY slot_booking_idx (booking_id)                               -- release-by-booking
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
