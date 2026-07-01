# EmailJS → send-email.php Migration Report

**Date:** 2026-07-01
**Scope (as requested):** Migrate all **admin booking notification** emails from EmailJS to
the `hm-api/send-email.php` gateway; remove the EmailJS dependency completely; add opt-in
`communications` logging; clean up EmailJS config. **LINE notifications unchanged.**

---

## 1. What changed

### Admin notifications now route through the gateway
`js/modules/notifications/email.js` → `sendEmailNotif()` **no longer calls EmailJS**. It POSTs
to `<API_BASE>/send-email.php` (`Content-Type` + `X-API-KEY`) with `log_comm:true`. Routing:

| Trigger | `from_account` | Recipient (admin) |
|---|---|---|
| New booking (`newBooking`) | `booking` | **booking@hello-moving.com** |
| Confirmed (`statusConfirmed`) | `booking` | **booking@hello-moving.com** |
| Completed (`statusComplete`) | `support` | **support@hello-moving.com** |
| New quote (`newQuote`) | `booking` | booking@hello-moving.com |

Callers in `admin-bookings.js` (`saveBooking`) are **unchanged** — same `sendEmailNotif(...)`
signature and trigger keys; only the transport underneath changed.

### `log_comm` logging (opt-in, no duplicates)
`hm-api/send-email.php` accepts `log_comm` (default **false**). On a successful send it inserts
one `communications` row (`sender_email`, `customer_email`=recipient, `subject`, `message`,
`direction='outbound'`, `created_by='system'`, `email_status='sent'`, `sent_at=NOW()`).
- Admin notifications set `log_comm:true` → logged once.
- `communications.js` **omits** `log_comm` (it already self-logs before calling `_deliver`) →
  **no duplicate rows**; existing communications history behavior preserved.
- A logging failure never fails the send (email already delivered; the error is logged).

### EmailJS config removed from admin settings
- `js/services/apiAdapter.js` — `getEmailSettings()` default reduced to `{ enabled, triggers }`
  (removed `adminEmail`, `serviceId`, `templateId`, `publicKey`).
- `js/modules/notifications/email.js` — the settings page (`renderEmail`) no longer renders the
  EmailJS credentials panel, the "EmailJS template variables" panel, or the EmailJS setup
  instructions. It now shows the enable toggle, a gateway explainer, a **Test send** button, the
  trigger toggles, and the send log. `saveEmailSettings()` / `testEmailNotif()` updated accordingly.

### LINE — unchanged
`sendLineNotif()` and all LINE push paths are untouched.

---

## 2. Every EmailJS email source removed

| # | File | Function | Before | After |
|---|------|----------|--------|-------|
| 1 | `js/modules/notifications/email.js` | `sendEmailNotif` | `fetch api.emailjs.com` (admin notify) | POST `send-email.php` → booking@/support@ |
| 2 | `js/modules/notifications/email.js` | `testEmailNotif` | required EmailJS creds | routes through gateway |
| 3 | `js/modules/notifications/email.js` | `renderEmail`/`saveEmailSettings` | EmailJS credential UI | removed |
| 4 | `js/services/apiAdapter.js` | `getEmailSettings` default | held EmailJS creds | `{enabled,triggers}` only |
| 5 | `js/modules/notifications/followUp.js` | `_send` / `checkAndSend` | `fetch api.emailjs.com` (customer) | **disabled** (no send) |
| 6 | `js/modules/automation/quoteFollowUpAction.js` | `_sendEmail` | `fetch api.emailjs.com` (customer) | **disabled** (no send) |
| 7 | `js/modules/automation/bookingReminderAction.js` | `_sendEmail` | `fetch api.emailjs.com` (customer) | **disabled** (no send) |
| 8 | `js/modules/automation/reviewRequestAction.js` | `_sendEmail` | `fetch api.emailjs.com` (customer) | **disabled** (no send) |

**No EmailJS files were deleted** — EmailJS was never a file/SDK, only inline `fetch()` calls to
`api.emailjs.com` (no `<script>` include existed in any HTML). All such calls were removed.

### ⚠️ Consequence to note (items 5–8)
Removing the shared EmailJS credentials (`serviceId`/`publicKey`) **inherently disables** the four
**customer-facing** flows that reused them: post-move follow-up, quote follow-up, booking reminder,
and review request. They were **not rebuilt** on the gateway (that is a separate, customer-email
product decision) — their `_sendEmail`/`_send` now return a clear "disabled — gateway migration
pending" result and dispatch nothing. **Recommend a follow-up** to rebuild them on `send-email.php`
(booking@ for reminder/follow-up, support@ for review request) if those automations are still wanted.

---

## 3. Verification checklist — no remaining EmailJS email paths

| Check | Result |
|---|---|
| `grep -rn "api.emailjs.com" js/` | **0 matches** ✓ |
| `grep -rn "emailCfg.serviceId / .publicKey / cfg.serviceId / .publicKey" js/` (code reads) | **0 matches** ✓ |
| `getEmailSettings` default contains no EmailJS creds | ✓ |
| `sendEmailNotif` posts to `send-email.php` (not EmailJS) | ✓ |
| PHP lint `send-email.php` | ✓ no errors |
| `node --check` on all 6 edited JS files | ✓ all pass |
| `npm run test:arch` | ✓ 20/20 pass |
| LINE notifications untouched | ✓ |

**Residual textual references (non-functional — not send paths):**
- Comments in the disabled `_sendEmail`/`_send` functions ("EmailJS has been removed…").
- UI hint text for the disabled automation flows' own `templateId` fields (label them "EmailJS
  template ID"). Harmless; will be removed when/if those flows are rebuilt.
- `js/modules/changelog/changelog.js` — historical changelog entries (intentionally **not** edited;
  they are a dated record).
- `js/utils/i18n.js` — one now-unused translation key (`EmailJSテンプレート変数`). Harmless.

---

## 4. Files changed

| File | Change |
|---|---|
| `hm-api/send-email.php` | Added opt-in `log_comm` → `communications` insert (dedupe-safe) |
| `js/modules/notifications/email.js` | Admin notify via gateway; EmailJS UI removed |
| `js/services/apiAdapter.js` | `getEmailSettings` default trimmed to `{enabled,triggers}` |
| `js/modules/notifications/followUp.js` | EmailJS send disabled |
| `js/modules/automation/quoteFollowUpAction.js` | EmailJS send disabled |
| `js/modules/automation/bookingReminderAction.js` | EmailJS send disabled |
| `js/modules/automation/reviewRequestAction.js` | EmailJS send disabled |

## 5. Server-side verification still recommended
Trigger one admin notification (create a booking / change status) on the live site and confirm:
(a) it arrives at booking@ / support@, (b) a `communications` row is written with
`email_status='sent'`, and (c) no duplicate row for the customer-reply path.
