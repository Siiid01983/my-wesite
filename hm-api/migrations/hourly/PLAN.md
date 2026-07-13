# Band → Hourly Scheduling Migration (REVIEW — nothing here runs automatically)

Everything in `hm-api/migrations/hourly/` is a **draft for your review**. No live
file is modified and no SQL runs until *you* deploy it deliberately. Deploy in the
order below; each step is independently reversible until the last.

## Why this is bigger than `booking-slot.php`
The `bookings` table + 4-band system are shared by the **live website**:
`create-booking.php` (customer bookings), `availability.php` (what customers see),
`block-slot.php`, `_slots.php`, the admin Inbox, the customer portal, and this app.
"Band → hourly" means moving **all** of them to time intervals in lockstep, plus a
production DB migration. Doing only one endpoint would create two incompatible
schedulers on one calendar (→ double-bookings). This plan sequences the whole thing.

## The model
- New columns `bookings.start_at` / `end_at` (`DATETIME`, nullable).
- A booking is scheduled iff both are non-NULL. NULL = flexible/unscheduled.
- **Collision rule** (half-open intervals): two bookings conflict when
  `existing.start_at < new.end_at AND existing.end_at > new.start_at`.
  Because these are full timestamps, the date is inherent (no separate date filter).
- **Atomicity** (the critical part the naive `count()` gets wrong): the reserve path
  runs in a transaction and takes `SELECT … FOR UPDATE` over the target day's rows
  BEFORE the overlap check, so two concurrent reservations serialize instead of both
  seeing "0 conflicts" and double-booking. Excludes cancelled rows and the booking's
  own row (reschedule).

## Deploy order (each reviewed + deployed by you)
1. **`001_bookings_hourly.sql`** — `ALTER TABLE` adds the columns + indexes, then
   backfills `start_at`/`end_at` from existing band data (`booking_slots`).
   Backfill is best-effort: bookings with no band row stay NULL (unscheduled).
   Fully reversible (`002_rollback.sql`).
2. **`_intervals.php`** — new helper (overlap + atomic `hm_iv_reserve`/`hm_iv_release`).
   Additive; nothing calls it yet.
3. **`booking-slot.hourly.php`** — the rewritten admin reserve/release endpoint,
   interval-based. Review the diff vs the deployed `booking-slot.php`; when happy,
   replace the live file (or route the app to the new name first).
4. **`create-booking.hourly.patch.md`** — spec + code for switching the customer
   booking path to interval collision (still writing bands for back-compat during
   transition). *[next batch]*
5. **`availability.hourly.patch.md`** — return busy intervals for a date instead of
   4 band states. *[next batch]*
6. **`block-slot.hourly.patch.md`** — block by interval. *[next batch]*
7. **Website JS** — BA overlay time picker + availability rendering. *[next batch —
   touches index.html core surface, needs your explicit sign-off]*
8. **Mobile** — `DayGrid` range-select, a Create-Booking modal, and `api/slots.ts`
   sending `start_time`/`end_time`. *[next batch — app repo, safe until #3 is live]*

## Cutover strategy (avoid a hard flip)
Run **dual-write** during transition: keep writing band slots AND the new interval
columns, so the website (still band-based) and the app (interval-based) stay
consistent while you migrate each surface. Flip reads to intervals last. This lets
you roll back any single step without data loss.

## Rollback
- Schema: `002_rollback.sql` drops the two columns (data in them is discarded).
- Endpoints: they're new files — revert by pointing back at the originals.
- No step is destructive to existing band data (`booking_slots` is untouched).

## Open questions for you
- Slot granularity: 30-min? 60-min? (affects the grid picker + validation)
- Business hours to enforce (e.g. 08:00–21:00)?
- Min/max booking duration?
- Keep the 4 bands as *presets* in the UI on top of free intervals?
