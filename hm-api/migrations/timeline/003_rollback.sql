-- ════════════════════════════════════════════════════════════════════════════
--  003_rollback.sql — undo 003_availability_blocks.sql
--  Restores blocks as legacy admin_blocked `bookings` rows and drops the table.
--  Idempotent. Run manually only if you must revert the block/booking split.
--
--  NOTE: this reverts to the OLD (blocks-as-bookings) model. The application code
--  after this change reads blocks from availability_blocks, so only roll back in
--  tandem with reverting the code (git revert of the refactor commit).
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Put the blocks back into bookings as admin_blocked rows (reason→customer_name,
--    memo→notes). Skips any id that already exists in bookings (idempotent).
INSERT INTO bookings (id, customer_name, status, booking_date, notes, start_at, end_at, created_at)
SELECT x.id,
       x.reason,
       'admin_blocked',
       x.block_date,
       x.memo,
       x.start_at,
       x.end_at,
       x.created_at
  FROM availability_blocks x
 WHERE NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = x.id);

-- 2) Drop the blocks table.
DROP TABLE IF EXISTS availability_blocks;
