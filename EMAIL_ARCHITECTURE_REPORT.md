# Email Architecture Report

**Date:** 2026-06-16
**Task:** Retire the obsolete PHP reply-mailer and document email delivery.
**Constraint observed:** No working email functionality was modified; no Supabase
Edge Function was touched. Only the obsolete `send_reply.php` was removed.

---

## 1. `send_reply.php` reference check — ✅ no code references it

A full-tree search (all file types) for `send_reply.php` / `send_reply` found
**no references in any executable code** (`.js`, `.html`, `.ts`). The only
matches are in historical markdown reports:

| File | Context |
|---|---|
| `PHASE4_FIX_REPORT.md` | Notes it was left untracked at the time |
| `PHASE4_VALIDATION_REPORT.md` | Marked "KEEP — commit separately" (now superseded) |
| `READY_FOR_PUSH.md` | Same historical note |

The PHP file's own header comment *claimed* it was "Called by
`EmailService._deliver()` in communications.js" — but that is **stale**. The
current `EmailService._deliver()` (`js/modules/communications/communications.js:636`)
calls the Supabase **`send-email` Edge Function**, not the PHP endpoint. The file
was therefore fully orphaned.

---

## 2. Email-delivery verification — current channels

The admin-reply channel that `send_reply.php` used to serve is now **Edge-Function
only**. For full transparency, here is every email path in the codebase:

| # | Trigger | Caller (file) | Delivery mechanism | Status |
|---|---|---|---|---|
| 1 | Admin → customer reply | `js/modules/communications/communications.js:636` (`EmailService._deliver`) | **Supabase Edge Function** `/functions/v1/send-email` (Resend) | ✅ Edge Function — replaces `send_reply.php` |
| 2 | Booking status email (admin) | `admin-bookings.js:455` | **Supabase Edge Function** `/functions/v1/send-email` (Resend) | ✅ Edge Function |
| 3 | Public-site booking confirmation | `script.js:181` | `send_email.php` (cPanel `mail()`) | ⚠️ Still active PHP — **left untouched** (working functionality, out of scope) |
| 4 | Automated follow-ups / reminders / review requests | `js/modules/notifications/email.js`, `notifications/followUp.js`, `automation/quoteFollowUpAction.js`, `automation/bookingReminderAction.js`, `automation/reviewRequestAction.js` | EmailJS (`api.emailjs.com`) | ⚠️ Third-party — **left untouched** (working functionality, out of scope) |

> **Accuracy note:** The task framing was "all email delivery uses Supabase Edge
> Functions only." That is true **for the admin-reply path** (`send_reply.php`'s
> former job). It is **not** true for the whole system: `send_email.php` (public
> booking confirmations) and EmailJS (automated notifications) remain in use.
> Both are functioning email features, so — per the "do not modify working email
> functionality" instruction — they were **not** changed. If consolidating *all*
> email onto Edge Functions is desired, that is separate, follow-up work.

### Supabase Edge Functions (not modified)
- `supabase/functions/send-email/index.ts` — admin→customer HTML email via Resend;
  returns `{ ok, from, messageId }`. Requires the `RESEND_API_KEY` secret.
- `supabase/functions/receive-email/index.ts` — inbound mail handling.

---

## 3. `send_reply.php` deletion — ✅ done

`send_reply.php` was deleted from the working tree. It was never committed
(untracked), so no Git history rewrite was required; the file simply no longer
exists in the repository.

---

## 4. `verify_deploy.mjs` — ✅ added to `.gitignore`

`verify_deploy.mjs` is a **local-only helper**: a Playwright script that loads the
**live production site** (`https://hello-moving.com/` — the BA overlay booking
system; the legacy `#quote` page has been removed), checks a few DOM
markers to confirm the latest deploy is live, and writes a local screenshot
(`verify_live.png`). It is not imported by any app code and is not part of the
test suite. It was added to `.gitignore`:

```
# Local deploy-verification helper (hits the live site, writes verify_live.png)
verify_deploy.mjs
```

(`*.png` is already ignored, so `verify_live.png` was already excluded.)

---

## Summary of changes

| Action | Result |
|---|---|
| Verify no code references `send_reply.php` | ✅ Confirmed (only historical markdown) |
| Verify admin-reply email uses Edge Function | ✅ `send-email` Edge Function (Resend) |
| Delete `send_reply.php` | ✅ Removed from working tree |
| Ignore `verify_deploy.mjs` | ✅ Added to `.gitignore` |
| Generate this report | ✅ `EMAIL_ARCHITECTURE_REPORT.md` |

**Not modified (intentionally):** `send_email.php`, EmailJS notification/automation
modules, and all Supabase Edge Functions.
