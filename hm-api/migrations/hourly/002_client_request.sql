-- ════════════════════════════════════════════════════════════════════════════
--  002_client_request.sql — Client-Request booking model: preferred time columns
--  REVIEW / operator-run. Apply in cPanel → phpMyAdmin AFTER 001_bookings_hourly
--  and BEFORE flipping hourly_enabled. Back up first.
--
--  Adds the customer's two preferred appointment datetimes. The admin later sets
--  the FINAL start_at/end_at (added by 001) and status='confirmed' via
--  confirm-request.php. status ('pending'|'confirmed'|'rejected'|…) already exists
--  and is already indexed (bookings_status_idx) — no change needed there.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE bookings
  ADD COLUMN preferred_start_1 DATETIME NULL AFTER end_at,
  ADD COLUMN preferred_start_2 DATETIME NULL AFTER preferred_start_1;

-- Optional coverage check (run manually):
-- SELECT
--   SUM(preferred_start_1 IS NOT NULL) AS with_pref,
--   SUM(status = 'pending')            AS pending
-- FROM bookings;
