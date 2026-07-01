# Email Verification Report — Post-Deployment

## Summary

| | |
|---|---|
| **Verification date** | 2026-07-01 |
| **Deployment commit** | `main` `ac0e497` (Merge PR #40 — "remove EmailJS; route all email through send-email.php"); cPanel deploy workflow run `28519827667` — **success** |

**SMTP architecture** — Self-hosted authenticated SMTP: `mail.hello-moving.com:587`, STARTTLS,
AUTH LOGIN as `booking@hello-moving.com`, implemented dependency-free in `hm-api/_smtp.php`
(raw `fsockopen`, cert/hostname verified). All outbound email is centralized in
`hm-api/EmailService.php` (routing, headers, templates) behind the single gateway
`hm-api/send-email.php`. No third-party services in the outbound path (EmailJS, Formspree,
and legacy Gmail relays all removed).

**Mailbox routing** — Booking-funnel / lifecycle → **booking@hello-moving.com** (admin new &
confirmed notifications, Booking Reminder, Quote Follow-up); after-sales / support →
**support@hello-moving.com** (admin completion notification, Review Request, Customer Follow-up);
website contact form → **contact@hello-moving.com**. Headers: `From` / `Reply-To` = routed
mailbox (contact form Reply-To = submitter); `Return-Path` = envelope `From`; `Sender:` = the
authenticated mailbox, emitted only when it differs from `From`.

**Logging behavior** — Opt-in `log_comm:true` makes `send-email.php` insert exactly one
`communications` row per successful send (`direction=outbound`, `email_status=sent`,
`created_by=system`, `sender_email` = routed mailbox). The admin-reply path (`communications.js`)
self-logs and **omits** `log_comm`, so it is never double-logged. Failed sends are **not** logged
(the endpoint fails loudly with a structured error).

---

**Method:** gateway-level verification — each flow's exact `send-email.php` request (`from_account`
+ `log_comm:true`) sent to the **company mailbox** (booking@/support@, never a real customer),
then `communications` inspected via `rest.php`. Batch tag `HMV-1782911544`, comms ids 6–11.

> Scope note: this verifies the **gateway** every flow calls (routing, SMTP, logging, dedup,
> Japanese encoding/template). The browser-side JS **trigger conditions / schedules / isSent
> dedup** of the four automation flows run in the admin panel and are a separate manual check
> (see §4). Inbox visual rendering was not inspected (no mailbox access); Japanese round-trip
> through the server was confirmed instead.

---

## PASS / FAIL — per flow (7 checks)

| Flow | Sent OK | 1 comms row | No duplicate | Correct mailbox | JP template¹ | SMTP success | No EmailJS² |
|------|:------:|:-----------:|:------------:|:---------------:|:------------:|:------------:|:----------:|
| **Admin booking notification** | ✅ | ✅ id 6 | ✅ | ✅ booking@ | ✅ | ✅ | ✅ |
| **Booking Reminder** | ✅ | ✅ id 7 | ✅ | ✅ booking@ | ✅ | ✅ | ✅ |
| **Quote Follow-up** | ✅ | ✅ id 8 | ✅ | ✅ booking@ | ✅ | ✅ | ✅ |
| **Review Request** | ✅ | ✅ id 9 | ✅ | ✅ support@ | ✅ | ✅ | ✅ |
| **Customer Follow-up** | ✅ | ✅ id 10 | ✅ | ✅ support@ | ✅ | ✅ | ✅ |

**All flows: PASS.** Every send returned `{ok:true, transport:"smtp", messageId:<…@hello-moving.com>}`
and created exactly one `communications` row (`direction=outbound`, `email_status=sent`,
`created_by=system`, `sender_email` = the routed mailbox).

¹ **JP template:** server-side confirmed. A dedicated UTF-8 round-trip test (comms id 11) stored
`件名:[検証テスト] 日本語エンコード確認` and the full Japanese body intact — the gateway
(`mb_encode_mimeheader` + base64) handles Japanese correctly. (An earlier `[?????]` artifact was
the Windows test shell mangling multibyte literals, not the email system.)
² **No EmailJS:** `grep -rin "api.emailjs.com" js/` → 0; `serviceId`/`publicKey` code reads → 0, in
the deployed tree.

---

## PASS / FAIL — cross-cutting checks

| Check | Method | Result |
|-------|--------|--------|
| **communications logging** | 5 sends with `log_comm:true` → 5 distinct rows (ids 6–10) | ✅ PASS |
| **Duplicate-prevention** | send **without** `log_comm` (the communications.js path) → `ok:true`, **0** gateway rows | ✅ PASS |
| **SMTP failure handling** | invalid recipient → `ok:false` `{code:"bad_recipient"}`, **0** comms rows | ✅ PASS (fails loudly; failed sends not logged) |
| **Mailbox routing** | booking-funnel (admin new/confirmed, reminder, quote follow-up) → **booking@**; after-sales (admin completed, review, customer follow-up) → **support@** | ✅ PASS |
| **Japanese encoding** | UTF-8 round-trip via `communications` (id 11) | ✅ PASS |
| **No EmailJS paths** | static grep on deployed tree | ✅ PASS |
| **Gateway SMTP health** | `?action=selftest` → connect/STARTTLS/auth OK | ✅ PASS |

---

## Evidence (message IDs)
`<43d3a74e…>` (admin), `<fb3a8aede…>` (reminder), `<b426b157…>` (quote), `<6f08c4ca…>` (review),
`<31437014…>` (customer follow-up), `<951bde0e…>` (JP round-trip), `<4367b875…>` (no-log dedup test).

---

## 4. Residual manual checks (browser — not runnable from shell)
The **JS trigger/schedule/dedup** layer of the four automation flows still warrants a quick
admin-panel pass (the underlying gateway is proven above):
- Booking Reminder: create a 確定 booking dated tomorrow → `今すぐ確認 & 送信` sends once; re-run skips (isSent).
- Quote Follow-up: a quote >3 days old, unconverted → sends once.
- Review Request: a 完了 booking >7 days → sends once.
- Customer Follow-up: 完了 booking past delay → sends once; toggle honors `enabled`.
- Admin notification: create / confirm / complete a booking in the panel → email + one comms row.

## 5. Cleanup note
Test rows **communications ids 6–11** were created in the production DB during this verification
(subjects tagged `HMV-…`). Delete them if you don't want test artifacts in the comms history.
