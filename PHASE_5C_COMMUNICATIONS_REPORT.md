# Phase 5C — Customer Communication Center — Report

**Status:** ✅ Complete and validated
**Date:** 2026-06-15
**Scope:** Read-only Communication Center inside `portal.html`, backed by the
existing `communications` table. No changes to the admin communication system or
the database.

---

## Goal

Give customers a **メッセージ** section in the portal where they can view their
communication history — company messages and replies — connected to the
existing `communications` table, scoped strictly to their own booking.

---

## What was built

| File | Change |
|---|---|
| `js/portal/portalComms.js` | **New.** `window.PortalComms` — read-only (`SELECT` only) loader for the `communications` table, scoped + email-guarded. |
| `portal.html` | New **メッセージ** sidebar item + `messages` view, comm-item CSS, async `loadMessages()` + `renderComm()`, `portalComms.js` include. |
| `comms_test.mjs` | **New.** 14-check Playwright validation (security + UI + mobile). |
| `PHASE_5C_COMMUNICATIONS_REPORT.md` | This report. |

### Features delivered
- **View communication history** — full timeline for the booking, newest first.
- **Read company messages** — `direction = 'outbound'` rows, labelled「会社からのメッセージ」.
- **View sent replies** — `direction = 'inbound'` rows, labelled「お客様からの返信」.

---

## Data source

Connects to the existing `public.communications` table (Phase 29):
`id, booking_id (text), customer_email, sender_email, subject, message,
direction ('outbound'|'inbound'), created_at`.

- **Read-only.** The module performs `SELECT` only — it never inserts, updates,
  or deletes, and does not import or call `js/modules/communications/communications.js`.
  The existing communication/admin system is untouched.

---

## Security — booking-scoped filtering

> Requirement: customer must only see communications where
> `booking_id = current customer booking`.

Implemented as a two-layer filter in `PortalComms.fetchForBooking(bookingIds, customerEmail)`:

1. **Primary (server-side):** `.in('booking_id', ids)` where `ids` are the
   identifiers of **the single authenticated booking** — its HM-reference and its
   numeric DB id. Both name the same booking, so scope stays one-booking. Without
   a booking id the function returns `[]` — it **never** runs an unfiltered SELECT
   from the customer surface.
2. **Defense-in-depth (client-side):** any row whose `customer_email` is set but
   does not match the session email is dropped — so even a `booking_id` collision
   could not leak another customer's correspondence.

Rows with a **null** `booking_id` (7 exist in the table) are never surfaced to any
customer, because they match no booking id.

> **Note on the data:** the existing `communications` table stores `booking_id`
> as a mix of HM-references (`HM-20260614-17D9`) and numeric DB ids (`"15"`),
> because the admin reply flow filed messages under whichever id was active at
> the time. Passing both identifiers of the one booking ensures the customer sees
> *all* of their own messages while never widening scope beyond that booking. No
> data was migrated or modified.

---

## Validation results

`node comms_test.mjs` — **14 passed, 0 failed** (live Supabase, 29 real comm rows):

**Security / filtering**
- ✅ History loads for own booking (>0 rows)
- ✅ Every row scoped to the booking_id
- ✅ Every row belongs to the customer email
- ✅ Cross-customer (correct booking id, wrong email) sees nothing
- ✅ Array of ids stays single-booking scoped
- ✅ No booking id → empty (no unfiltered read)
- ✅ Null `booking_id` rows not exposed
- ✅ Booking with no history → empty

**UI**
- ✅ Reached portal after login
- ✅ Messages view renders comm items
- ✅ Each item shows direction + body
- ✅ Count label populated
- ✅ Every rendered message involves the logged-in customer
- ✅ Mobile: drawer burger visible + content fits 375px width

**Regression** — Phase 5A (`portal_test.mjs`) and Phase 5B (`dashboard_test.mjs`)
suites both still pass; access control and dashboard unchanged.

---

## Rules honoured

- ✅ Did **not** expose admin communications (booking-scoped + email-guarded; null-scoped rows hidden)
- ✅ Did **not** modify the existing communication system (`communications.js` untouched; read-only new module)
- ✅ Preserved communication history (no writes/deletes/migrations)
- ❌ Did **not** modify `admin.html` or `websiteManagement.html`
- ✅ Preserved Supabase structure and the existing communication schema
