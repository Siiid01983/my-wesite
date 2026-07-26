-- ════════════════════════════════════════════════════════════════════════════
--  002_rollback.sql — restore the legacy band tables from the 002 snapshot
--  Use ONLY if 002_drop_band_tables.sql was run WITH the _bak_* snapshot step.
--  If you dropped without snapshots, restore from your database backup instead.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS booking_slots        LIKE _bak_booking_slots;
INSERT INTO booking_slots        SELECT * FROM _bak_booking_slots;
CREATE TABLE IF NOT EXISTS slot_capacity        LIKE _bak_slot_capacity;
INSERT INTO slot_capacity        SELECT * FROM _bak_slot_capacity;
CREATE TABLE IF NOT EXISTS calendar_availability LIKE _bak_calendar_availability;
INSERT INTO calendar_availability SELECT * FROM _bak_calendar_availability;

-- Once verified restored, drop the snapshots:
-- DROP TABLE IF EXISTS _bak_booking_slots, _bak_slot_capacity, _bak_calendar_availability;
