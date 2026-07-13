# Hourly Scheduling — Consolidated Deploy Checklist

One ordered runbook for taking the band → hourly migration live. **Dual-write /
dual-read**: the band system keeps working at every step, so you can stop or roll
back between any two boxes. Do it on a low-traffic window anyway.

> ⚠️ Not yet tested against your live MySQL. Verified only via PHP `-l`, `node
> --check`, web bundles, and a logic simulation. **Back up first, and test on a
> staging copy if you have one.**

---

## 0. Pre-flight
- [ ] **Back up the database.** cPanel → phpMyAdmin → `bookings` (+ `booking_slots`) → Export, or `mysqldump`.
- [ ] Pull the latest `hm-api/migrations/hourly/` from GitHub to your working copy.
- [ ] Confirm which `booking-slot` the app calls today (the mobile app posts to `/hm-api/booking-slot.php`).

## 1. Schema  (reversible)
- [ ] In phpMyAdmin, run **`001_bookings_hourly.sql`** (adds `start_at`/`end_at` + indexes, backfills from bands).
- [ ] Verify coverage:
  ```sql
  SELECT SUM(start_at IS NOT NULL) AS scheduled, SUM(start_at IS NULL) AS unscheduled FROM bookings;
  ```
- [ ] Rollback if needed: **`002_rollback.sql`**.

## 2. Deploy the interval engine + endpoint
- [ ] Upload **`_intervals.php`** to **`hm-api/_intervals.php`** (NOT the migrations subfolder — it must sit beside the other `hm-api/*.php`).
- [ ] Upload **`booking-slot.hourly.php`** to **`hm-api/booking-slot.php`** (replaces the band version).
  - [ ] 🔧 **Fix the include paths** in it after moving: change the three
        `require_once __DIR__ . '/../../_lib.php'` / `'/../../_db.php'` / `'/../../_ratelimit.php'`
        to `__DIR__ . '/_lib.php'` etc., and `'/_intervals.php'` stays `__DIR__ . '/_intervals.php'`.
        (They were written relative to `migrations/hourly/`.)
- [ ] Smoke test (admin token):
  ```
  POST /hm-api/booking-slot.php  { "action":"reserve","booking_id":"<id>","start_time":"2026-07-20T09:30","end_time":"2026-07-20T11:30" }
  → { ok:true, action:"reserved", ... }   (repeat overlapping → 409 slot_taken, with_name)
  ```

## 3. Backend patches (apply per the `.patch.md` files)
- [ ] **`create-booking.php`** — insert the dual-write block after line 103 (see `create-booking.hourly.patch.md`). New bookings now populate `start_at`/`end_at`.
- [ ] **`availability.php`** — add `require_once __DIR__ . '/_intervals.php';` + return `intervals` (see `availability.hourly.patch.md`).
- [ ] Verify: `GET /hm-api/availability.php?date=2026-07-20` → response now includes an `intervals` array.

## 4. Frontend passthrough + publish
- [ ] **`js/services/apiAdapter.js`** — add the **READ** lines to `rowToBooking` (`start_at`/`end_at` passthrough) per `apiAdapter.hourly.patch.md`. (Leave the WRITE side for §6.)
- [ ] Publish the website (already-committed `mobileCalendar.js` + `mobile.css` + this `apiAdapter.js`) via your normal site deploy.
- [ ] Verify on a phone: Calendar tab → daily timeline blocks now size to real `start_at`/`end_at` (not fixed band height).

## 5. Verify end-to-end
- [ ] Create a booking → it gets `start_at`/`end_at`.
- [ ] Two overlapping reservations → second returns **409 “時間が重複… [name]”**.
- [ ] Non-overlapping same-day booking (e.g. 09:00–11:00 then 13:00–15:00) → both succeed.
- [ ] Timeline renders both blocks at correct top/height; tap block → detail; tap empty → quick-book.

## 6. Optional / deferred (do together, after §1–5 are stable)
- [ ] **`rest.php`** — add `'start_at','end_at'` to the `bookings` column allowlist. *(Only needed for writing them via rest.php — READ/`select *` already returns them.)*
- [ ] **`apiAdapter.js` WRITE side** — add `start_at`/`end_at` to `bookingToRow` (needs the allowlist above).
- [ ] **`block-slot.php`** — interval blocking (Option A in `block-slot.hourly.patch.md`) — only if you need arbitrary-range admin blocks; band blocks still work otherwise.
- [ ] Once confident, drop the band lock in `create-booking.php` and read purely from intervals.

## Rollback summary
| Undo | How |
|---|---|
| Schema | `002_rollback.sql` |
| Endpoint | restore the previous `hm-api/booking-slot.php` |
| Code patches | `git revert` / restore the file |
| Frontend | redeploy the previous `mobileCalendar.js` / `apiAdapter.js` |

`booking_slots` (band data) is never modified, so band scheduling remains intact throughout.
