-- ════════════════════════════════════════════════════════════════════════════
--  003_availability_blocks.sql — split availability BLOCKS out of `bookings`
--  REVIEW ONLY. Run manually (cPanel → phpMyAdmin) after reviewing. Back up first.
--  Reversible via 003_rollback.sql. Idempotent: re-running is safe.
--
--  A block is an AVAILABILITY entity, not a reservation. Historically a block was
--  written as a `bookings` row with status='admin_blocked' — which polluted the
--  Booking List / Customer List / reservation history and consumed a booking id.
--  This migration moves blocks into their OWN table `availability_blocks` and
--  removes the legacy admin_blocked rows from `bookings`, so:
--    availability_windows + availability_blocks → available slots → bookings.
--  The application already reads/writes availability_blocks (_blocks.php); the
--  table self-heals on first use, so this migration is a DATA move, not a gate.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) The blocks table (matches hm_blocks_ensure_table()).
CREATE TABLE IF NOT EXISTS availability_blocks (
  id          CHAR(36)     NOT NULL,
  block_date  DATE         NOT NULL,
  start_at    DATETIME     NOT NULL,
  end_at      DATETIME     NOT NULL,
  reason      VARCHAR(200) NOT NULL DEFAULT '',
  memo        TEXT         NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY availability_blocks_start_idx (start_at),
  KEY availability_blocks_date_idx  (block_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Copy every legacy admin_blocked booking into availability_blocks.
--    reason ← customer_name (the admin label), memo ← notes. Skips rows without a
--    real interval and rows already copied (idempotent via NOT EXISTS on id).
INSERT INTO availability_blocks (id, block_date, start_at, end_at, reason, memo, created_at)
SELECT b.id,
       DATE(b.start_at),
       b.start_at,
       b.end_at,
       COALESCE(NULLIF(b.customer_name, ''), '（ブロック）'),
       b.notes,
       COALESCE(b.created_at, NOW())
  FROM bookings b
 WHERE b.status = 'admin_blocked'
   AND b.start_at IS NOT NULL
   AND b.end_at   IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM availability_blocks x WHERE x.id = b.id);

-- 3) Remove the legacy blocks from bookings so they stop polluting every list.
--    Only rows that were successfully copied above are deleted.
DELETE FROM bookings
 WHERE status = 'admin_blocked'
   AND id IN (SELECT id FROM availability_blocks);

-- 4) Sanity report (run manually if you like; no-op otherwise):
-- SELECT COUNT(*) AS blocks FROM availability_blocks;
-- SELECT COUNT(*) AS leftover_admin_blocked FROM bookings WHERE status = 'admin_blocked';
