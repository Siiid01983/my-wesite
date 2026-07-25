# Band System Removal — Plan & Status

The Morning/Afternoon/Evening/Night (band) model is superseded by the hourly
**timeline** (start_at/end_at/duration, allow-list `availability_windows`,
`hm_iv_reserve` as the single conflict authority). The timeline is LIVE in
production (`timeline_enabled=true`; `availability.php` returns `timeline:true`).

This document tracks the safe, staged removal of the band system. **Do not
big-bang delete** — the band engine is still `require`d by the live booking
endpoints as the flags-off fallback and it still powers day-closure.

---

## Phase 1 — Decouple live consumers (THIS PR) ✅

The last non-fallback band reads are made band-optional so the engine can be
deleted later without breaking Ops surfaces:

- **`js/modules/mobile/mobileCalendar.js`** — `_availOf()` returns `'available'`
  when `CalendarService` is absent (per-slot rules are enforced server-side).
- **`js/modules/calendar/gcalSync.js`** — the day-level `updateAvailability`
  write is guarded; an imported all-day Google block will be recorded via the
  timeline block path once the band service is gone.

Everything still reads the band service while it exists → **zero behavior change
now**, but nothing HARD-depends on it anymore.

## Phase 2 — Delete the band engine + fallback UIs (STAGING-FIRST)

Prerequisites: (1) let Phase 1 + the hourly flow bake in prod; (2) a staging DB
to verify the DDL/behavior (local env has no pdo_mysql/pdo_sqlite).

**Step 2a — migrate day-closure to the timeline.** Today "close a day" =
slot_capacity all-bands-closed. Replace with: a closed day = a full-day timeline
BLOCK (`block-interval.php`) or "no windows". Move `create-booking.php`'s
`hm_cap_day_closed` guard onto a timeline block check.

**Step 2b — remove band branches from the live endpoints** (each already
timeline-first; delete the `else`/fallback band arms):
- `hm-api/create-booking.php` — drop `$lockBand`/`hm_cap_reserve`/`hm_slot_reserve` arm + `_capacity` include.
- `hm-api/availability.php` — drop `bands` + `capacity` blocks; keep `windows`/`slots`/`intervals`.
- `hm-api/booking-status.php` — drop the band confirm/reserve arm (already skipped for timeline bookings).
- `hm-api/reschedule.php` — drop the band transfer arm.

**Step 2c — delete band-only files:**
- Engine: `hm-api/_capacity.php`, `hm-api/slot-capacity.php`, `hm-api/booking-slot.php`, `hm-api/block-slot.php`, `hm-api/backfill-slots.php`, `hm-api/migrate-calendar-to-slotcap.php`. Keep `hm-api/_slots.php` only if `hm_slot_uuid()` is still used (it is — by `_windows.php`/`_blocks.php`); otherwise inline the uuid helper.
- Admin UIs: `js/modules/calendar/slotCalendar.js`, `js/modules/capacity/slotCapacity.js`, `js/modules/calendar/calendar.js` (+ `CalendarService` in `calendarService.js` once mobile/gcal no longer reference it), `js/modules/capacity/capacity.js`.
- Customer overlay: remove the `baHourly`/band `baRenderTimeSlots` + `baConfirmTime` band arms in `index.html` (keep `baTimeline`).
- Config: retire `hourly_enabled`, `capacity_enabled`, `reserve_on_create`, `slot_lock_enabled` scaffolding once nothing reads them.

**Step 2d — DB:** after a bake, `DROP TABLE slot_capacity, booking_slots, calendar_availability` (back up first). Keep `bookings.start_at/end_at/duration_min` + `availability_windows` + `blocks`.

**Step 2e — arch-lock:** retire the band-engine guards in `tests/architecture-lock.test.js` (the ones asserting `_capacity.php` primitives / `availability.php` reads `hm_cap_day` / band confirm) IN THE SAME PR as the deletion — never relax them while the code exists. Keep + extend the timeline guards.

**Step 2f — precache/nav:** remove deleted files from `sw.js` PRECACHE and `navigation.js`/`admin.html` script includes.

## Rollback
Phase 1: revert the two guards (pure additive). Phase 2: `git revert` the PR +
restore tables from backup + flip `timeline_enabled=false` (band engine still
present → instant fallback) — which is why Phase 2 must NOT delete the engine
until the flag-off fallback is formally retired.

## Remaining band dependencies (audit snapshot)
| Layer | Files | Disposition |
|---|---|---|
| Live engine (fallback + day-closure) | `_capacity`, `slot-capacity`, `_slots`, `booking-slot`, `block-slot` | Phase 2c |
| Live endpoint band arms | `create-booking`, `availability`, `booking-status`, `reschedule` | Phase 2b |
| Fallback admin UIs | `slotCalendar`, `slotCapacity`, `calendar.js`, `capacity.js` | Phase 2c |
| Consumers (decoupled in P1) | `mobileCalendar`, `gcalSync` | ✅ band-optional |
| Ops read | `ops/js/calendar.js`, `closedDayCalendar.js`, `ops-core.js` | Phase 2 (repoint to intervals) |
| Customer overlay band picker | `index.html` (`baHourly`/band arms) | Phase 2c (gated by `baTimeline`) |
