-- ════════════════════════════════════════════════════════════════════════════
--  001_rollback.sql — reverse 001_timeline.sql
--  REVIEW ONLY. Run manually (cPanel → phpMyAdmin). Back up first.
--
--  Drops the availability_windows table and the bookings.duration_min column.
--  Existing bookings keep their start_at/end_at (owned by the hourly migration,
--  not this one) — no booking data is lost by rolling back the timeline layer.
-- ════════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS availability_windows;

-- MySQL 8: DROP COLUMN IF EXISTS. On older servers, drop the "IF EXISTS".
ALTER TABLE bookings
  DROP COLUMN IF EXISTS duration_min;
