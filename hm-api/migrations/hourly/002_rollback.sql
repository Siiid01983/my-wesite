-- ════════════════════════════════════════════════════════════════════════════
--  002_rollback.sql — undo 001. Drops the interval columns (their data is lost).
--  booking_slots (the band data) is never touched, so band scheduling is intact.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE bookings
  DROP KEY bookings_start_at_idx,
  DROP KEY bookings_end_at_idx,
  DROP COLUMN start_at,
  DROP COLUMN end_at;
