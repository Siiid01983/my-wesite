-- ════════════════════════════════════════════════════════════════════════════
--  001_timeline.sql — allow-list availability windows + booking duration
--  REVIEW ONLY. Run manually (cPanel → phpMyAdmin) after reviewing. Back up first.
--  Reversible via 001_rollback.sql. Idempotent: re-running is safe.
--
--  MODEL: the admin draws AVAILABLE working periods (allow-list) on an hourly
--  timeline. `availability_windows` stores those periods as [start_at, end_at)
--  ranges. A customer's bookable times are the 30-min steps INSIDE a window that
--  do NOT overlap a busy interval (bookings / blocks). Depends on the hourly
--  interval columns (migrations/hourly/001_bookings_hourly.sql) — run that first.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Availability windows (the admin's drawn working periods).
CREATE TABLE IF NOT EXISTS availability_windows (
  id          CHAR(36)  NOT NULL,
  window_date DATE      NOT NULL,
  start_at    DATETIME  NOT NULL,
  end_at      DATETIME  NOT NULL,
  created_at  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY availability_windows_date_idx     (window_date),
  KEY availability_windows_start_at_idx (start_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) Booking duration in minutes (default 120 = 2h). Existing rows backfilled
--    from end_at-start_at where both are set; otherwise the default applies.
--    NOTE: MySQL 8 supports ADD COLUMN IF NOT EXISTS; on older servers drop the
--    "IF NOT EXISTS" and just skip this line on re-run.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS duration_min INT NULL AFTER end_at;

UPDATE bookings
   SET duration_min = TIMESTAMPDIFF(MINUTE, start_at, end_at)
 WHERE duration_min IS NULL
   AND start_at IS NOT NULL
   AND end_at   IS NOT NULL
   AND end_at > start_at;

-- 3) Sanity report (run manually if you like; no-op otherwise):
-- SELECT COUNT(*) AS windows FROM availability_windows;
-- SELECT SUM(duration_min IS NOT NULL) AS with_duration,
--        SUM(duration_min IS NULL)     AS without_duration FROM bookings;
