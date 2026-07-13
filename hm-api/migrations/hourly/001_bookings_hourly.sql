-- ════════════════════════════════════════════════════════════════════════════
--  001_bookings_hourly.sql — add interval columns + backfill from bands
--  REVIEW ONLY. Run manually (cPanel → phpMyAdmin) after reviewing. Back up first.
--  Reversible via 002_rollback.sql.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Schema: nullable interval columns + indexes for overlap/day queries.
ALTER TABLE bookings
  ADD COLUMN start_at DATETIME NULL AFTER booking_date,
  ADD COLUMN end_at   DATETIME NULL AFTER start_at,
  ADD KEY bookings_start_at_idx (start_at),
  ADD KEY bookings_end_at_idx   (end_at);

-- 2) Backfill from the existing band model (booking_slots). Band → fixed hours:
--      am 09:00–12:00 · pm 12:00–15:00 · ev 15:00–18:00 · nt 18:00–21:00
--    booking_date is VARCHAR; take its leading YYYY-MM-DD only, and skip rows
--    whose booking_date isn't a clean date. Bookings with no slot row stay NULL
--    (flexible/unscheduled) — the app treats NULL as "needs a time set".
UPDATE bookings b
JOIN booking_slots s ON s.booking_id = b.id
SET
  b.start_at = STR_TO_DATE(
    CONCAT(SUBSTRING(b.booking_date, 1, 10), ' ',
      CASE s.time_band
        WHEN 'am' THEN '09:00:00' WHEN 'pm' THEN '12:00:00'
        WHEN 'ev' THEN '15:00:00' WHEN 'nt' THEN '18:00:00'
      END), '%Y-%m-%d %H:%i:%s'),
  b.end_at = STR_TO_DATE(
    CONCAT(SUBSTRING(b.booking_date, 1, 10), ' ',
      CASE s.time_band
        WHEN 'am' THEN '12:00:00' WHEN 'pm' THEN '15:00:00'
        WHEN 'ev' THEN '18:00:00' WHEN 'nt' THEN '21:00:00'
      END), '%Y-%m-%d %H:%i:%s')
WHERE b.start_at IS NULL
  AND s.time_band IN ('am','pm','ev','nt')
  AND s.status = 'reserved'
  AND b.booking_date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';

-- 3) Sanity report (run manually to see coverage; no-op if you skip it):
-- SELECT
--   SUM(start_at IS NOT NULL) AS scheduled,
--   SUM(start_at IS NULL)     AS unscheduled
-- FROM bookings;
