# Consolidated fix — booking email · address privacy · maps · chat images/buttons

Branch: `fix/booking-email-privacy-maps-chat-images` · one PR · **no deploy, no merge**.

Six issues, root cause → fix, in one PR. All changes are view-layer or additive server
logic; no DB schema change; existing business logic preserved.

---

## Issue 1 — New-booking email not sent

**Root cause.** `create-booking.php` fired a LINE push and inserted an internal
admin `inbox_messages` row, but **never called `EmailService`** — so the customer
got no "request received" email. (Confirmed/rescheduled/cancelled go through
`booking-status.php` / `reschedule.php`, which do call EmailService; the create
path was simply never wired.)

**Fix.** After the response is flushed, `create-booking.php` now sends the customer
a "ご予約リクエストを受け付けました（確認中）" email through the **same
EmailService/SMTP transport**, containing: booking id (HM- ref), name, service,
requested date + time band, preferred date/time 1 & 2, and an under-review message.
Fire-and-forget but **always logged** — `info.log` (`new_booking_email/sent/transport`)
on success, `hm_log_error` with the SMTP `code` on failure. No silent failure.

## Issue 2 — Address privacy not enforced everywhere (incl. Admin Chat, Completed)

**Root causes.** (a) The reveal predicate treated **completed** the same as
confirmed, so completed bookings showed the full address + contact. (b) The
**Admin Chat/Inbox leak**: `create-booking.php` packed the *raw* `from:`/`to:`
full addresses into the `inbox_messages` body, which the admin thread renders
verbatim — exposing the exact address on a brand-new (unconfirmed) booking.

**Fix.**
- `js/lib/addressPrivacy.js` + `ops/js/ops-core.js`: reveal is now **CONFIRMED (確定)
  only**. New predicate `restricted()` / `Ops.bookingRestricted` = **cancelled OR
  completed** → hides phone/email/full-address/maps/notes/furniture, keeping only
  id/name/city/service/status. Applied on Admin (`admin-bookings.js` `_cx` now
  includes 完了) and all Ops surfaces (`bookings/customers/calendar/messages` — the
  `bookingCancelled` guard now also covers 完了).
- Server-side chat leak fixed: `create-booking.php` masks the `from:`/`to:` lines
  in the **notification body** to locality (`hm_mask_address`, mirrors the JS
  algorithm). The authoritative full address stays in `bookings.notes` and is
  revealed in Booking Details once 確定.

## Issue 3 — Remove all map buttons

**Fix.** Removed every `HMMaps.buttons(...)` call site: `Ops.addrExtraHtml`
(now returns the "reveals after confirmation" hint only), `js/modules/inbox/inbox.js`
context panel, and `admin-bookings.js` (`mapsBtns` deleted). No map buttons render
anywhere. (`js/lib/mapsLinks.js` remains on disk but is no longer referenced.)

## Issue 4 — Address itself opens the map (Confirmed only)

**Fix.** New `HMAddrPrivacy.addrHtml(addr,status)` / `Ops.addrHtml(b,which)`: once
**確定**, the address text becomes a link to
`https://www.google.com/maps/search/?api=1&query=<addr>` (keyless, mobile+desktop,
`target=_blank rel=noopener`); before confirmation it stays masked plain text.
Wired into both the from and destination address cells on Admin + all Ops detail
views via new raw (non-escaping) `kvRaw`/`rRaw` cell helpers.

## Issue 5 — Admin/Ops cannot see chat images

**Investigation.** Traced the full path end-to-end and **live**: the customer
portal renders images from a server-signed `url` embedded by `chat.php`; Admin
Inbox and Ops read `inbox_messages` via `rest.php` (attachments carry `path`, no
`url`) and resolve a **client-side** HMAC-signed URL (`createSignedUrl` /
`signChatFile` → `storage.php?action=sign` → `?action=get`). Verified: `labels`
is cast to an object by rest.php, placeholders render, hydration runs, the API key
is sent (else text would 401 too), the sign envelope parses correctly, and the
signed URL scheme/host match the working portal. **The code path is correct and
equivalent to the working portal path** — no static defect was found.

**Fix (hardening / self-healing).** The one real gap is resilience: the signed URL
had a 300 s TTL and no error recovery, so an expired/transient failure left a
permanently broken thumbnail. Both `inbox.js` `_hydrateAttachments` and
`ops/js/messages.js` `hydrateAtts` now sign with a **1-hour TTL** and **re-sign
once on `img.onerror`**, so a stale URL self-heals instead of showing a broken
image. If images still fail after deploy, the cause is environmental (storage
bucket permissions / `storage_dir`), not the client — see the manual checklist.

## Issue 6 — Camera / gallery buttons on mobile chat

**Investigation.** All three composers already contain a **📷 camera** button
(`capture="environment"`, opens the camera) and a **gallery/file** button (no
`capture`, opens the photo library / file picker), with defined SVG icons, sizes
(`flex-shrink:0`, 40 px), and **no CSS hiding them** — verified in the repo AND on
the live site (portal `chat.js`, ops `messages.js`, admin inbox `inbox.js`). There
is no code defect; both affordances are present on mobile and desktop.

**Action.** No structural change needed. Merging + deploying this PR bumps the
service-worker `CACHE_VERSION` (CI stamps the commit SHA), which forces every
client to re-fetch the composers — resolving any device that was showing a
**stale-cached** older composer (the project's documented recurring root cause).

---

## Security impact review

- **No weakening.** Address privacy is *strengthened*: completed bookings now
  mask (previously exposed), and the raw address is stripped from the admin
  notification body server-side.
- New booking email: sent only to the booking's own validated
  `FILTER_VALIDATE_EMAIL` address; contains date/time + reference, no third-party.
- Maps: keyless standard URLs, `rel="noopener"`; the clickable address is only a
  link once confirmed, and all address HTML is escaped (`addrHtml` escapes its own
  text; raw cell helpers receive only that trusted, pre-escaped HTML — no XSS vector).
- Chat image signing unchanged in mechanism (HMAC, private bucket); only TTL and an
  onerror re-sign were added. No new endpoint, no new auth surface.

## Manual test checklist

- [ ] Submit a new booking → customer receives the "リクエスト受付（確認中）" email;
      `info.log` shows `new_booking_email result:sent`; SMTP failure logs a code.
- [ ] Admin Inbox on a **new** booking → address shows locality only (東京都新宿区),
      no street/building/floor/postal; full address hidden in the chat body.
- [ ] Confirm the booking → Booking Details shows the **full address as a clickable
      Google Maps link**; no map buttons anywhere.
- [ ] Complete the booking → phone/email/full-address/maps/notes hidden; only
      id/name/city/service/status remain (Admin + Ops + calendar popup + customer list).
- [ ] Cancel → same restricted view as completed.
- [ ] Customer uploads image (camera + gallery) → visible in Portal, Ops chat,
      Admin Inbox and message thread; leave the thread open > 5 min then scroll →
      thumbnail still loads (self-heal).
- [ ] Mobile composer (portal + ops) shows 📷 camera and gallery buttons; camera
      opens the camera, gallery opens the picker.
- [ ] Regression: attachment delete, chat timestamps, furniture grid, preferred
      dates, booking flow, reschedule slot transfer all unchanged. `npm run test:arch` green.

## Files changed
`hm-api/create-booking.php` · `js/lib/addressPrivacy.js` · `ops/js/ops-core.js` ·
`ops/js/messages.js` · `ops/js/calendar.js` · `ops/js/bookings.js` ·
`ops/js/customers.js` · `admin-bookings.js` · `js/modules/inbox/inbox.js`

## Rollback
All changes additive/view-layer; revert the merge commit. No DB or endpoint-contract
change to unwind.
