# EmailJS → send-email.php Migration Report

**Date:** 2026-07-01
**Scope:** Remove EmailJS completely and route **all** former EmailJS email — admin
notifications **and** the four customer flows — through the `hm-api/send-email.php`
gateway (authenticated SMTP via `EmailService.php`). Every outbound email is logged in
`communications`. **LINE notifications unchanged.**

---

## 1. Account routing (all via send-email.php)

| Flow | Trigger / schedule (preserved) | `from_account` | Recipient |
|------|-------------------------------|----------------|-----------|
| Admin: new booking | on create | `booking` | booking@hello-moving.com |
| Admin: confirmed | status → 確定 | `booking` | booking@hello-moving.com |
| Admin: completed | status → 完了 | `support` | support@hello-moving.com |
| **Booking Reminder** (customer) | 1 day before move date, status 確定 | **`booking`** | customer |
| **Quote Follow-up** (customer) | 3 days after quote, not converted | **`support`** | customer |
| **Review Request** (customer) | 7 days after completion | **`support`** | customer |
| **Customer Follow-up** (customer) | X days after move (完了) | **`support`** | customer |

**Mapping rule applied:** booking-lifecycle sends → `booking@`; support/after-sales/**follow-up**
sends → `support@`. (If you'd prefer Quote Follow-up from `booking@` since quotes are part of the
booking funnel, it's a one-line change in `quoteFollowUpAction.js`.)

All customer sends include `log_comm:true`; the master switch `getEmailSettings().enabled`
gates every flow (preserves the prior `emailCfg.enabled` behavior). Per-flow schedules,
dedup (`isSent`/`markSent`), and delay settings are unchanged — only the transport + message
construction changed (message bodies are now built in-code and wrapped by the gateway's branded
HTML template, since EmailJS server-side templates are gone).

---

## 2. `log_comm` logging (opt-in, dedupe-safe)
`hm-api/send-email.php` accepts `log_comm` (default **false**). On a successful send it inserts one
`communications` row (`sender_email`, `customer_email`=recipient, `subject`, `message`,
`direction='outbound'`, `created_by='system'`, `email_status='sent'`, `sent_at=NOW()`).
- Admin notifications + all four customer flows set `log_comm:true` → **every outbound email logged**.
- `communications.js` **omits** `log_comm` (it self-logs before calling `_deliver`) → **no duplicates**;
  existing communications history behavior preserved.
- A logging failure never fails the send (email already delivered; the error is logged).

---

## 3. Every EmailJS source removed / rebuilt

| # | File | Before | After |
|---|------|--------|-------|
| 1 | `js/modules/notifications/email.js` `sendEmailNotif` | `fetch api.emailjs.com` (admin) | POST `send-email.php` → booking@/support@ |
| 2 | `js/modules/notifications/email.js` UI/`testEmailNotif`/`saveEmailSettings` | EmailJS creds UI + template-vars + setup steps | removed; gateway explainer + test button |
| 3 | `js/services/apiAdapter.js` `getEmailSettings` | `adminEmail/serviceId/templateId/publicKey` | `{ enabled, triggers }` |
| 4 | `js/services/apiAdapter.js` `getFollowUpSettings` | included `templateId` | `{ enabled, delayDays }` |
| 5 | `js/modules/notifications/followUp.js` `_send` | `fetch api.emailjs.com` (customer) | **rebuilt** → `send-email.php` (support@) |
| 6 | `js/modules/automation/quoteFollowUpAction.js` `_sendEmail` | `fetch api.emailjs.com` (customer) | **rebuilt** → `send-email.php` (support@) |
| 7 | `js/modules/automation/bookingReminderAction.js` `_sendEmail` | `fetch api.emailjs.com` (customer) | **rebuilt** → `send-email.php` (booking@) |
| 8 | `js/modules/automation/reviewRequestAction.js` `_sendEmail` | `fetch api.emailjs.com` (customer) | **rebuilt** → `send-email.php` (support@) |
| 9 | `js/utils/i18n.js` | `EmailJSテンプレート変数` key | removed (dead) |

**EmailJS UI cleanup:** removed the `templateId` inputs and the EmailJS "template variables"
reference panels from all four customer-flow settings UIs (they configured EmailJS templates,
now unnecessary). Kept each flow's schedule/enable/company-contact settings.

**No EmailJS files/SDK existed to delete** — it was inline `fetch()` calls to `api.emailjs.com`
(no `<script>` include in any HTML). All such calls removed.

---

## 4. Verification checklist — no remaining EmailJS email paths

| Check | Result |
|---|---|
| `grep -rin "api.emailjs.com" js/` | **0 matches** ✓ |
| `grep -rn "serviceId / publicKey / templateId"` (code reads) | **0 matches** ✓ |
| All 4 customer flows POST to `send-email.php` | ✓ |
| `sendEmailNotif` (admin) posts to `send-email.php` | ✓ |
| Every outbound sets `log_comm:true` (admin + 4 customer flows) | ✓ |
| PHP lint `send-email.php` | ✓ |
| `node --check` on all edited JS (7 files) | ✓ |
| `npm run test:arch` | ✓ 20/20 |
| LINE notifications untouched | ✓ |

**Residual "EmailJS" strings (non-functional):** doc comments noting the removal; two historical
entries in `js/modules/changelog/changelog.js` (a dated record — intentionally not rewritten).

---

## 5. Files changed
`hm-api/send-email.php` · `js/modules/notifications/email.js` ·
`js/modules/notifications/followUp.js` · `js/modules/automation/quoteFollowUpAction.js` ·
`js/modules/automation/bookingReminderAction.js` · `js/modules/automation/reviewRequestAction.js` ·
`js/services/apiAdapter.js` · `js/utils/i18n.js`

## 6. Server-side verification recommended
Enable email notifications, then exercise each path (create booking / confirm / complete /
run each automation "今すぐ確認 & 送信"): confirm delivery from the right mailbox, and that each
send writes exactly one `communications` row (`email_status='sent'`) with no duplicates.
