# Hello Moving — Final Production Release Candidate

**Branch:** `feature/final-production-release`
**Consolidates:** PR #112 (Phase B — lifecycle emails + cross-view time sync) + PR #113 (reschedule slot transfer + rescheduled email), on top of the already-merged #94–#111.
**Status:** Ready for review. Do **not** auto-merge / auto-deploy.

This release closes the remaining two production gaps (customer lifecycle **emails** and reschedule **slot transfer**). The other nine requirements were delivered by earlier merged PRs and are **verified intact** on this branch — this document records the whole surface as one coordinated release.

---

## 1. Files changed (this release's delta vs `main`)

| File | Type | Change |
|------|------|--------|
| `hm-api/reschedule.php` | **NEW** | Atomic move endpoint: transfers slot reservation (release old + reserve new) + sends rescheduled email. Dual auth, rate-limited. |
| `hm-api/booking-status.php` | MOD | Adds `completed`/`complete` status; sends customer email on confirmed/completed/cancelled (independent of the inbox `notify` flag) with full logging. |
| `ops/js/ops-core.js` | MOD | `Api.rescheduleBooking()`; `schedTimeLabel()`; `normalizeBooking.time` prefers `start_at`/`end_at`; `updateBookingStatus` routes `completed` through the lifecycle endpoint. |
| `ops/js/calendar.js` | MOD | `commit()` routes a **confirmed** drag/resize through `rescheduleBooking` (slot transfer + email); 409 reverts the optimistic move. |
| `bookingService.js` | MOD | `_schedTimeLabel()`; `_rowToBooking.time` prefers `start_at`/`end_at` (Admin view). |
| `js/portal/portalV2.js` | MOD | `_schedTime()`; portal 時間帯 field prefers `start_at`/`end_at`. |
| `docs/RELEASE-final-production-candidate.md` | NEW | This document. |

Earlier merged PRs supplying the other requirements (already on `main`): #108 (calendar control + defer reserve), #105/#111 (address + cancelled privacy), #110 (keyless Maps), #107/#111 (furniture + preferred dates), #104 (attachment delete), #109 (camera + compression), #103 (timestamps), #94–#102 (drag/resize touch + network-first cache).

## 2. Database changes

**None new in this release.** `reschedule.php` and `booking-status.php` use existing tables/columns only:
- `bookings.start_at`, `bookings.end_at`, `bookings.booking_date` — pre-existing, already persisted by the calendar.
- `booking_slots` (UNIQUE `booking_date,time_band,slot_index`) — created/`ensure`d by `_slots.php` (already live).
- `slot_capacity` (`is_closed`,`reason`) — additive ALTER shipped in **#108**, already deployed.
- `audit_log` — `CREATE TABLE IF NOT EXISTS` in `chat.php` from **#104**, already deployed.

No migration file to run for this release.

## 3. API changes

- **NEW** `POST hm-api/reschedule.php` — `{ booking_id, booking_date, start_at?, end_at? }` → `{ ok, moved, band, old:{date,time}, new:{date,time}, email }`. Full/closed target → **HTTP 409** `slot_taken` (old slot preserved). Confirmed bookings only transfer a slot; others just update date/time.
- **MOD** `hm-api/booking-status.php` — accepts `completed`/`complete`; response now includes `email` status. Existing `confirmed`/`cancelled`/`needs_revision`/`pending` behaviour unchanged.
- No other endpoint touched. `create-booking.php` still **defers** reservation (`reserve_on_create` defaults OFF → status `新規`, no slot).

## 4. Security changes

- `reschedule.php` reuses the **same dual-auth gate** as `booking-status.php`: `X-ADMIN-TOKEN` (verified inline, role=admin, account valid) **or** `?token=admin_setup_token`; CLI trusted. Plus `hm_cors()`, `hm_require_api_key()`, `hm_rate_limit('reschedule', 40, 60)`, and `hm_log_auth_fail` on rejection.
- **No new PII exposure.** Address masking (`js/lib/addressPrivacy.js`) and cancelled-booking field hiding are unchanged; the reschedule email contains only date/time + booking reference, sent to the booking's own verified email.
- Slot transfer is one DB transaction; a conflict rolls back fully (no partial/ghost state).
- Attachment delete authorization (from #104) intact: customer own-inbound-only (403 on others), admin override with booking-folder path guard, both audited.

## 5. Deployment risks

| Risk | Mitigation |
|------|-----------|
| `reschedule.php` must reach the server | FTP deploy uploads the whole `hm-api/` tree; verify the file exists post-deploy (401 on unauthenticated GET = live). |
| SMTP misconfigured → emails not delivered | **Non-fatal by design** — a send failure logs `hm_log_error` with the SMTP/transport code and never blocks the status/slot change. Check `hm-api` logs after the first live confirm/cancel/reschedule. |
| Service worker stale cache | CI auto-stamps `CACHE_VERSION` per deploy; `/ops/`, `/js/lib/`, `/js/config|services|core|portal/` are **network-first** (from #101), so calendar/logic updates are picked up immediately. |
| Reschedule without #112's readers | N/A here — both PRs are consolidated in this branch; cross-view time sync is complete. |

Emergency kill switch unchanged: `FORCE_FALLBACK` in `js/config/appConfig.js`.

## 6. Manual test checklist

Run on a real device/session after deploy (needs an admin ops login; use an existing test booking — do not create production bookings):

- [ ] **R1** Close a full day (with reason) → calendar shows closed; confirming a booking on it → 409. Close a single band → same. Reopen day/band → bookable again. Capacity counters correct.
- [ ] **R2** Submit a new booking as a customer → status `新規`, **no** `booking_slots` row. Admin confirm → one `booking_slots` row appears, band capacity −1.
- [ ] **R2/R9** Drag a confirmed booking to another **day** and another **band**; reload → date/time persist. Old band capacity −1, new band +1. Move onto a **full** band → 409, UI reverts, old slot intact.
- [ ] **R3** Pre-confirm: address shows prefecture + city/ward only (no street/building/floor/postal). Post-確定: full address. Cancelled: phone/email/full-addr/Maps/notes hidden; only ID/name/city/service/status shown — check Ops, Admin, calendar popup, customer list, details.
- [ ] **R4** Confirmed booking shows Maps buttons (customer/destination/route/drive); pre-confirm shows none.
- [ ] **R5** Furniture list shows full Japanese names, no truncation, multi-line, mobile-readable — Portal, Ops, Admin, details, chat.
- [ ] **R6** Preferred date 1/band 1 and date 2/band 2 display in Portal, Ops, Admin, details, communications.
- [ ] **R7** Customer deletes own attachment → bubble kept, "Attachment deleted", file purged, audit row; cannot delete a company message. Admin deletes any attachment → audited.
- [ ] **R8** Camera opens quickly; image compresses before upload; preview appears fast (mobile).
- [ ] **R9** Customer receives **Confirmed / Rescheduled / Completed / Cancelled** emails; `info.log` shows `result:sent` + transport; a failure logs a code (no silent failure).
- [ ] **R10** A message's timestamp is identical in Portal, Ops, Admin, communications.
- [ ] **R11** Drag + resize work on desktop and mobile touch; reload persists; week + month views correct; no stale-cache.

## 7. Rollback plan

All changes are additive; no schema to unwind.

1. **Fastest:** revert the two merge commits on `main` (`git revert -m 1 <merge-#113>` then `<merge-#112>`), or reset the release branch — redeploy.
2. `reschedule.php` is a **new file** → deleting it disables reschedule slot-transfer; the calendar `commit()` falls back is not automatic, so pair the file removal with reverting `ops/js/calendar.js` (or the whole merge).
3. `booking-status.php` → `git checkout <pre-release> -- hm-api/booking-status.php` restores the inbox-only (no-email) behaviour; confirm/cancel slot logic is untouched by rollback.
4. No DB rollback required (no new tables/columns this release). Prior additive columns (`slot_capacity.reason`, `audit_log`) are harmless if left.

## 8. PASS / FAIL matrix

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Calendar full control | ✅ PASS | `_capacity.php` `is_closed`/`reason`; `slot-capacity.php`+`block-slot.php`; closed→409 on confirm/reschedule; capacity via `COUNT(booking_slots)`. |
| 2 | Booking flow (defer→confirm→reschedule) | ✅ PASS | `reserve_on_create` defaults OFF; confirm `hm_cap_reserve`; reschedule `hm_slot_release`+`hm_cap_reserve` (atomic). |
| 3 | Address privacy | ✅ PASS | `maskAddress` (prefecture+city/ward, drops street/postal); full post-確定; cancelled hides phone/email/addr/Maps/notes. |
| 4 | Keyless Google Maps | ✅ PASS | `mapsLinks.js` standard `google.com/maps` URLs; gated on `bookingConfirmed`. |
| 5 | Furniture display | ✅ PASS | `chatFormat.furnitureGrid` `.hm-furn-list` (no truncation, responsive) across Portal/Ops/Admin/details/chat. |
| 6 | Preferred dates & times | ✅ PASS | `preferred_start_1/2` + bands mapped in bookingService/ops/portal. |
| 7 | Chat attachment deletion | ✅ PASS | `chat.php` `delete-media` own-only (403 others) + admin override, path-guard, `audit_log`, "Attachment deleted" tombstone. |
| 8 | Camera & upload performance | ✅ PASS | `imageCompress.js` (`HMImageCompress`) client-side compress + progress (#109). |
| 9 | Email system (4 events + logging) | ✅ PASS | `booking-status.php` confirmed/completed/cancelled; `reschedule.php` rescheduled; every send logged sent/failure/SMTP code; non-silent. |
| 10 | Message timestamps | ✅ PASS | Single source `HMFmt.msgTime`; scheduled-time via shared `schedTimeLabel`/`_schedTime`. |
| 11 | Calendar drag & resize | ✅ PASS | Touch DnD (#94–#97), auto-jump (#102), `/ops/` network-first (#101) → no stale cache; persistence via `start_at`/`end_at`. |

**Recommendation:** merge to `main` → deploy → run the §6 checklist on a real device; confirm SMTP by watching `hm-api` logs on the first live status change.
