-- ════════════════════════════════════════════════════════════════════════════
--  001_slot_capacity.sql — per-band configurable capacity (Morning/Afternoon/
--  Evening/Night). REVIEW / operator-run in cPanel → phpMyAdmin. Back up first.
--
--  Additive + inert by default: with NO rows, _capacity.php resolves every band to
--  capacity 1 / open — identical to the current "1 booking per band" behavior. The
--  engine only changes anything once an admin configures capacity via
--  slot-capacity.php. Reservations still live in booking_slots (slot_index 0..cap-1).
--
--  Row semantics:
--    booking_date = '*'          → the per-band DEFAULT (applies to every date)
--    booking_date = 'YYYY-MM-DD' → an override for that specific date (wins)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS slot_capacity (
  booking_date VARCHAR(40) NOT NULL,
  time_band    VARCHAR(20) NOT NULL,
  capacity     INT         NOT NULL DEFAULT 1,
  is_closed    TINYINT(1)  NOT NULL DEFAULT 0,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (booking_date, time_band)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional starting defaults (uncomment + adjust to seed per-band capacity):
-- INSERT INTO slot_capacity (booking_date, time_band, capacity, is_closed) VALUES
--   ('*','am',5,0), ('*','pm',5,0), ('*','ev',5,0), ('*','nt',3,0)
-- ON DUPLICATE KEY UPDATE capacity=VALUES(capacity), is_closed=VALUES(is_closed);
