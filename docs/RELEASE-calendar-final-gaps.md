# Calendar & Scheduling — Final Gap Audit + Fix

Branch: `fix/calendar-final-gaps` · Base: `main`

## Summary

A full end-to-end trace of the booking/calendar architecture confirmed the engine
is **already unified on `slot_capacity`** as the single source of truth. The 14-part
"final refactor" spec is, in the main, **already implemented** across prior PRs
(#99, #114, #120, #122). Per the agreed scope (keep the working engine, close only
real gaps, keep backward compatibility, keep API contracts), this branch makes **one
additive backend change** and documents the verified state of every other item.

### Change in this PR
- `hm-api/reschedule.php` — the reschedule email now includes the **old → new
  time-band (slot) label** (午前/午後/夕方/夜間), in addition to the date/time it
  already carried. Additive, text-only; a 時間指定なし booking omits the label.
  No change to reschedule logic, slot transfer, rollback, or the API contract.

## Dependency map (verified)

**Write paths — all funnel through the capacity engine (`_capacity.php`):**
- `create-booking.php` → `hm_cap_day_closed()` hard guard + deferred reserve
- `booking-status.php` → confirm `hm_cap_reserve()` / cancel `hm_slot_release()`, gated by `hm_cap_confirm_check()`
- `reschedule.php` → atomic release-old + reserve-new, 409 rollback, arbitrary date **and** time
- `slot-capacity.php` → admin `set / close / reopen / close-day / reopen-day` (+ multi-day range, per-band defaults)

**Read paths:**
- `availability.php` → `booking_slots` + `slot_capacity` ONLY; folds closed bands into unavailability
- `calendar_availability` → **display-only** marketing/stats cache (decoupled from the engine; kept per scope decision)

## PASS / FAIL verification matrix

| # | Spec item | Status | Evidence |
|---|---|---|---|
| 1 | Booking engine on `slot_capacity` only; ○△× not authoritative | ✅ PASS (pre-existing) | `availability.php:58-99`; `admin-bookings.js:57-62` (calendar_availability = display cache) |
| 2 | Slot close/reopen/capacity/bulk/multi-day; customer sees only available | ✅ PASS (pre-existing) | `slot-capacity.php:144-159` (close-day/reopen-day + `to` range); `availability.php:95-99` |
| 3 | Admin/ops move booking day/week/month/slot via drag&drop; atomic; rollback | ✅ PASS (pre-existing) | `ops/js/calendar.js:360-512` DnD → `reschedule.php`; confirmed = slot transfer, 409 revert |
| 4 | Calendar opens on booking_date not today (all entry points) | ✅ PASS (pre-existing) | `ops/js/calendar.js:637-660` `?date=` deep-link; `ops/js/bookings.js:152`, `notifications.js:228` link with `?date=` |
| 5 | Portal shows current date/slot/status after admin change; no stale race | ✅ PASS (pre-existing) | live poll `ops/js/calendar.js:617-635`; `hm_cache_invalidate_table('bookings')` on every write |
| 6 | Lifecycle emails incl. reschedule old/new **slot** + Portal Chat button | ✅ PASS (**this PR** adds slot band) | `reschedule.php` email block; chat button `EmailService.php:85,227` (`chatUrl` → `customerHtml`) |
| 7 | Asia/Tokyo timestamps, epoch sort everywhere | ✅ PASS (pre-existing) | verified by `tests/calendar-timestamp-fixes.verify.js` (18/18) |
| 8 | Image upload/preview/compression everywhere | ✅ PASS (pre-existing) | `js/modules/camera/cameraCapture.js`, `storage.php`, portal/ops/inbox composers |
| 9 | Address itself is the Google Maps link; no icons | ✅ PASS (pre-existing) | `addressPrivacy.js:44-60` `addrHtml()` = icon-less `<a>` link; map buttons removed (Ops.addrHtml) |
| 10 | Privacy gating pre-confirm; terminal states restricted | ✅ PASS (pre-existing) | `addressPrivacy.js:20-36` confirmed()/restricted(); `admin-bookings.js:785-812`; server mask `create-booking.php:25-47` |
| 11 | Remove dead code no longer used by the engine | ✅ N/A | engine already decoupled; no dead engine references introduced/removed |
| 12 | Migrations idempotent, dry-run, rollback | ✅ PASS (pre-existing) | `migrate-calendar-to-slotcap.php` (dry-run + apply; operator runs once) |

## Tests run

| Suite | Result |
|---|---|
| `npm run test:arch` (architecture-lock) | ✅ 20/20 pass |
| `tests/calendar-timestamp-fixes.verify.js` | ✅ 18/18 pass |
| `php -l hm-api/reschedule.php` | ✅ no syntax errors |
| `tests/dataProvider.test.js` (Playwright) | ⚠️ needs live server (localhost:5050) — not run offline; unrelated to this change |

## Risks
- **Very low.** The only code change is additive email text using an existing helper
  (`hm_slot_band_label`). No schema, API-contract, engine, or UI change. Backward
  compatible; a band-less booking simply omits the new label.

## Operator note (unchanged from prior release)
- `migrate-calendar-to-slotcap.php` must be run **once** to fold any legacy
  `calendar_availability` full/closed days into `slot_capacity` (accepts `X-ADMIN-TOKEN`).

## Not deployed / not merged
Per instruction: one branch, one PR, no auto-deploy, no auto-merge.
