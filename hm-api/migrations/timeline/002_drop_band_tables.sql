-- ════════════════════════════════════════════════════════════════════════════
--  002_drop_band_tables.sql — retire the legacy band tables (STAGING-FIRST)
--  REVIEW ONLY. DO NOT run until verified on staging. BACK UP THE DATABASE FIRST.
--  Reversible only from a backup — a DROP is destructive. See rollback note below.
--
--  ⚠ PRECONDITION: run ONLY after confirming ZERO runtime dependencies:
--    • availability.php is timeline-only (no booking_slots / slot_capacity read) ✅
--    • create-booking.php band-free ✅
--    • booking-status.php / reschedule.php: the band path is LEGACY-ONLY (fires
--      only for interval-less bookings). Confirm NO interval-less bookings remain
--      that still need band reserve/transfer, OR accept losing band handling for
--      them, BEFORE dropping. Until then these tables are still written for legacy.
--    • rest.php / slot-capacity.php still reference the band engine — retire those
--      first (delete slot-capacity.php + drop the band allowlist rows in rest.php).
--
--  These tables hold ONLY band/day-closure state. Bookings keep their schedule in
--  bookings.start_at/end_at/duration_min + availability_windows (untouched here).
-- ════════════════════════════════════════════════════════════════════════════

-- Snapshot for rollback (optional but recommended — lets you restore without a
-- full DB backup). Comment out if you rely on your backup instead.
CREATE TABLE IF NOT EXISTS _bak_slot_capacity       LIKE slot_capacity;
INSERT INTO _bak_slot_capacity       SELECT * FROM slot_capacity;
CREATE TABLE IF NOT EXISTS _bak_booking_slots        LIKE booking_slots;
INSERT INTO _bak_booking_slots        SELECT * FROM booking_slots;
CREATE TABLE IF NOT EXISTS _bak_calendar_availability LIKE calendar_availability;
INSERT INTO _bak_calendar_availability SELECT * FROM calendar_availability;

-- Drop the legacy band tables.
DROP TABLE IF EXISTS booking_slots;
DROP TABLE IF EXISTS slot_capacity;
DROP TABLE IF EXISTS calendar_availability;
