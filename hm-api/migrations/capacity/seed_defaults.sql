-- ════════════════════════════════════════════════════════════════════════════
--  seed_defaults.sql — per-band default capacity for the capacity system.
--  Run AFTER 001_slot_capacity.sql. Idempotent (ON DUPLICATE KEY UPDATE), so
--  re-running just re-applies these values. booking_date '*' = the per-band default
--  (applies to every date unless a per-date override row exists).
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO slot_capacity (booking_date, time_band, capacity, is_closed) VALUES
('*','am',5,0), ('*','pm',5,0), ('*','ev',5,0), ('*','nt',3,0)
ON DUPLICATE KEY UPDATE capacity=VALUES(capacity), is_closed=VALUES(is_closed);
