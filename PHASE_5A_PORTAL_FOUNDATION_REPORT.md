# Phase 5A — Customer Portal Foundation — Report

**Status:** ✅ Complete and validated
**Date:** 2026-06-15
**Scope:** Foundation only. No changes to admin, CRM, WMC, or database schema.

---

## Goal

Create a secure Customer Portal foundation so customers can access their own
booking information using the email + booking reference on record.

---

## Files created

| File | Purpose |
|---|---|
| `login.html` | Customer login page — Hello Moving design, mobile-first, Japanese. Email + booking reference fields + login button. |
| `portal.html` | Customer portal shell — fixed header, sidebar navigation, main content area. Route-guarded; renders the authenticated customer's booking. |
| `js/portal/portalAuth.js` | `window.PortalAuth` — session management, identity verification, booking lookup. Reuses existing infrastructure only. |
| `PHASE_5A_PORTAL_FOUNDATION_REPORT.md` | This report. |
| `portal_test.mjs` | Playwright validation script for the four required checks (left in repo for re-verification). |

No existing files were modified.

---

## Authentication design

**Identity model.** A customer proves ownership of a booking by supplying **both**:
1. the **email address** on record, and
2. the **booking reference** (`HM-…`).

Neither value alone grants access. Verification resolves the booking through the
existing `BookingService.getBookingById()` (which looks the reference up against
the `bookings` table) and then requires an **exact, case-insensitive email match**
on the same row.

**Session management.**
- Stored in `sessionStorage` under key `hm_portal_sess` — survives page refresh
  within the tab, cleared when the tab closes.
- 60-minute sliding idle TTL; each valid access pushes the expiry forward.
- Random 16-byte session token via `crypto.getRandomValues`.
- `requireSession()` guards `portal.html`; missing/expired session → redirect to `login.html`.

**Security properties.**
- Generic failure message for both "not found" and "email mismatch" — never
  discloses whether a given reference exists.
- `getCurrentBooking()` **re-verifies** the email match on every fetch, so a
  tampered `sessionStorage` entry cannot read another customer's booking; a
  mismatch revokes the session.
- Reuses the public anon Supabase client already used by the booking form — no
  new credentials, no schema or RLS changes.

---

## Infrastructure reuse (no new systems)

`login.html` and `portal.html` load only the existing, unmodified scripts:

```
@supabase/supabase-js (CDN UMD)
js/config/env.js
js/services/supabaseClient.js
bookingService.js          ← BookingService.getBookingById()
js/portal/portalAuth.js    ← new: thin session + verification layer
```

---

## Validation results

Automated end-to-end run (`node portal_test.mjs`, Playwright headless Chromium,
live Supabase, 22 real bookings):

| # | Check | Result |
|---|---|---|
| 1 | Login page loads (form present, Supabase client ready) | ✅ |
| 2 | Login redirects to portal on valid credentials | ✅ |
| 3 | Session persists after refresh | ✅ |
| 4 | Invalid booking reference is blocked | ✅ |
| 4b | Valid reference + wrong email is blocked | ✅ |
| — | Portal renders the authenticated booking | ✅ |
| — | Portal access blocked after logout (redirect to login) | ✅ |
| — | Portal guard redirects when no session | ✅ |

All HTTP routes return `200` (`/login.html`, `/portal.html`, `/js/portal/portalAuth.js`).

---

## Notes for the next phase

- Some legacy booking rows store their `HM-` reference in plain `notes` rather
  than the canonical `[HM_EXTRAS]` block, so `_rowToBooking` falls back to the
  numeric DB id. The portal preserves the reference the customer typed for
  display (login still resolves either form). No data was migrated — that is out
  of scope for a foundation phase.
- `portal.html` currently renders three read-only views (概要 / 予約内容 /
  お問い合わせ). Future phases can add actions (reschedule request, document
  download, messaging) on top of the same guarded shell.

---

## Rules honoured

- ❌ Did **not** modify `admin.html`
- ❌ Did **not** modify `websiteManagement.html` / WMC
- ❌ Did **not** modify CRM
- ❌ Did **not** modify database structure (no schema / RLS / migration changes)
- ❌ Did **not** redesign existing systems
