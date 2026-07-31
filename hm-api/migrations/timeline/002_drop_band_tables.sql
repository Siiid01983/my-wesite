-- ════════════════════════════════════════════════════════════════════════════
--  002_drop_band_tables.sql — retire the legacy band tables (STAGING-FIRST)
--  REVIEW ONLY. DO NOT run until verified on staging. BACK UP THE DATABASE FIRST.
--  Reversible only from a backup — a DROP is destructive. See rollback note below.
--
--  ✅ PRECONDITIONS MET (verified 2026-08-01 — safe to run):
--    • availability.php is timeline-only (no booking_slots / slot_capacity read) ✅
--    • create-booking.php band-free ✅
--    • booking-status.php / reschedule.php act on the INTERVAL authority; the band
--      arms are gated on interval-less LEGACY rows only ✅
--    • slot-capacity.php + the whole band PHP engine (_capacity/slot-preflight/
--      booking-slot/block-slot) are DELETED; rest.php does NOT expose these tables ✅
--    • apiAdapter.js retired calendar_availability (getAvail derives from timeline;
--      setDate/clearAvail/syncAvailability are no-ops); GCal sync (calendar.js +
--      gcalSync.js) DELETED ✅
--    • git grep confirms ZERO live SQL against booking_slots/slot_capacity/
--      calendar_availability (only comments + this migration) ✅
--  Still: BACK UP FIRST — a DROP is destructive. The snapshot tables below let you
--  restore without a full backup.
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
