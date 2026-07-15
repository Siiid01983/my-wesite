# 🚀 Capacity-Based Scheduling — Deploy, Rollback & Smoke Test

Per-band configurable capacity (Morning/Afternoon/Evening/Night) replacing the
hard-block "1 booking per band" model. Gated behind `capacity_enabled`; **inert
until both the migration is applied and the flag is flipped**.

Branch: `feature/capacity-system`.

---

## What ships
| File | Role |
|---|---|
| `hm-api/_capacity.php` | Engine: effective capacity, capacity-aware reserve, per-band status, `hm_capacity_enabled()` |
| `hm-api/slot-capacity.php` | Admin endpoint: get / set / close / reopen (dual-auth) |
| `hm-api/migrations/capacity/001_slot_capacity.sql` | `slot_capacity` table |
| `hm-api/create-booking.php` | Reserve gate — uses `hm_cap_reserve()` when `capacity_enabled` |
| `hm-api/availability.php` | Additive `capacity` block per band |
| `hm-api/_config.php` / `_config.example.php` | `capacity_enabled` flag (default **false**) |

---

## Deploy order (safe in any order — stays inert until BOTH done)
1. **Back up** the `hello_moving` DB (phpMyAdmin → Export).
2. Upload the files above to the server (same paths).
   - ⚠️ **Do NOT overwrite the server's real `hm-api/_config.php`** with the repo copy (placeholder DB password). Edit the flag **in place** on the server in step 4.
3. Run the migration (phpMyAdmin → SQL):
   ```sql
   CREATE TABLE IF NOT EXISTS slot_capacity (
     booking_date VARCHAR(40) NOT NULL,
     time_band    VARCHAR(20) NOT NULL,
     capacity     INT         NOT NULL DEFAULT 1,
     is_closed    TINYINT(1)  NOT NULL DEFAULT 0,
     updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (booking_date, time_band)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
   ```
   (Optional) seed per-band defaults:
   ```sql
   INSERT INTO slot_capacity (booking_date, time_band, capacity, is_closed) VALUES
     ('*','am',5,0), ('*','pm',5,0), ('*','ev',5,0), ('*','nt',3,0)
   ON DUPLICATE KEY UPDATE capacity=VALUES(capacity), is_closed=VALUES(is_closed);
   ```
4. Flip `'capacity_enabled' => true` in the **server's** `hm-api/_config.php`.

> With NO `slot_capacity` rows, every band resolves to **capacity 1 / open** —
> identical to today's behavior even with the flag ON. Capacity only changes once
> you seed defaults or set overrides.

---

## Rollback plan (fast → full)
1. **Instant (no redeploy):** set `'capacity_enabled' => false` in `_config.php`.
   create-booking immediately reverts to the capacity-1 slot lock. This is the
   primary rollback — do this first if anything looks wrong.
2. **Neutralize config without touching bookings:** `DELETE FROM slot_capacity;`
   (or set every band back to capacity 1) → all bands revert to default 1/open.
   Existing `booking_slots` rows are untouched.
3. **Full schema rollback (only if required):** `DROP TABLE slot_capacity;`
   The engine falls back to capacity 1 automatically when the table is absent, so
   the code stays safe even after the drop. `booking_slots` / `bookings` untouched.

> No customer data lives in `slot_capacity` (config only), so rollback is
> non-destructive to bookings at every level.

---

## Smoke-test checklist (run BEFORE relying on it in production)

**A. Flag OFF (regression — nothing should change)**
- [ ] `capacity_enabled=false`: create a normal booking → succeeds as before.
- [ ] A second booking on the same date+band → still `409 slot_taken` (capacity-1 lock intact).
- [ ] `availability.php?date=…` returns the usual `bands`; new `capacity` block present but harmless.

**B. Migration applied, flag ON, unconfigured (still capacity 1)**
- [ ] `GET slot-capacity.php?action=get&date=YYYY-MM-DD` (admin token) → each band `capacity:1, status:"available"`.
- [ ] Booking + a second same-band booking → 2nd still `409` (default capacity 1).

**C. Configure capacity (the actual feature)**
- [ ] `POST slot-capacity.php {action:"set", date:"*", band:"am", capacity:3}` → default am capacity = 3.
- [ ] Book `am` 3× on one date → all 3 succeed (`slot_index` 0,1,2).
- [ ] 4th `am` booking → `409 slot_taken` with `reason:"full"`.
- [ ] `availability.php` for that date → `capacity.am.used:3, remaining:0, status:"full"`.

**D. Per-date override + close/reopen**
- [ ] `set {date:"2026-08-01", band:"pm", capacity:1}` → that date's pm capped at 1 (override beats default).
- [ ] `close {date:"2026-08-01", band:"pm"}` → booking pm on that date → `409` `reason:"closed"`; `availability` shows `status:"closed"`.
- [ ] `reopen {…}` → booking succeeds again.

**E. Concurrency / integrity**
- [ ] Two near-simultaneous bookings into a capacity-1 band → exactly one succeeds, other `409` (UNIQUE backstop).
- [ ] Auth: `slot-capacity.php` without admin token / setup token → `403`.

**F. Rollback drill**
- [ ] Set `capacity_enabled=false` → confirm behavior returns to the capacity-1 lock.
