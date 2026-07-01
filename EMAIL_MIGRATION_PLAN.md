# Email Migration Plan — Server-Side Consolidation (Option 1)

**Date:** 2026-07-01
**Approved scope:** Server-side only. Centralize the PHP mailer behind `EmailService.php`,
remove the orphaned root `send_email.php`, add server-side contact handling, and
standardize/verify From · Reply-To · Return-Path · Sender across the three company
mailboxes.
**Explicitly out of scope (not touched):** Formspree (`index.html`), EmailJS
(`notifications/*`, `automation/*`), and all other locked files (`index.html`,
`styles.css`, `script.js`, `admin.html`, `_config.php`).

> Companion audit: `EMAIL_MIGRATION_AUDIT.md`.

---

## ✅ EXECUTED — 2026-07-01

| File | Action | Result |
|------|--------|--------|
| `hm-api/EmailService.php` | **NEW** | Centralized routing + headers (From/Reply-To/Return-Path/Sender) + templates + transport. `php -l` clean. |
| `hm-api/send-email.php` | **REFACTORED** | Now a thin controller over `EmailService`; envelope + self-test preserved; **B1/B2 unchanged**. `php -l` clean. |
| `hm-api/contact.php` | **NEW** | Server-side contact intake → From/To `contact@`, Reply-To submitter. `php -l` clean. |
| `hm-api/_smtp.php` | **ADDITIVE** | `hm_smtp_send()`/`hm_smtp_build_message()` gained optional `replyTo` + `Sender:` passthrough (CR/LF-guarded). `php -l` clean. |
| `send_email.php` (root) | **DELETED** | Orphaned duplicate removed from working tree. |

**Verification done here:** `php -l` clean on all four PHP files; `npm run test:arch`
green (20/20 — no locked-file/Formspree changes); no dangling refs to the removed
`send_via_phpmailer`/`esc_html`.

**Still to run on the server** (needs live SMTP — see §6): `?action=selftest[&send=1]`,
one real send per account with raw-header inspection, and a `POST contact.php` check.

**Frontend NOT touched** (per scope): `index.html` contact links remain `mailto:`; wiring
a real form to `contact.php` is a separate sign-off-gated step.

---

## 1. Confirmations from the audit

- **`send_email.php` (repo root) is orphaned** — a full repo search finds **no caller**
  (`.php`/`.js`/`.html`/`.htaccess`/`.json`); the only match is the file's own header
  comment. It duplicates SMTP/mail logic and uses `noreply@` + `hellomoving1@gmail.com`.
  → **Safe to delete** after confirming no server cron/direct URL hits it (not visible from repo).
- **`hm-api/create-booking.php` sends no email** — this is why the admin new-booking
  alert currently rides Formspree/EmailJS. (Left as-is in this scope.)
- **`hm-api/send-email.php` + `_smtp.php`** already route `booking/support/contact` to the
  three mailboxes over the self-hosted server. Migration = **extract + standardize**, not rebuild.
- Existing helpers available to new endpoints: `hm_cors`, `hm_require_api_key`, `hm_config`,
  `hm_json`, `hm_body`, `hm_log_error`, `hm_rate_limit`, `hm_debug`.

---

## 2. Target design

```
                        ┌─────────────────────────────┐
  admin-bookings.js ───▶│  hm-api/send-email.php       │
  communications.js ───▶│  (thin endpoint, unchanged   │──┐
                        │   {ok,data,error} envelope)  │  │
                        └─────────────────────────────┘  │
                        ┌─────────────────────────────┐  │   ┌────────────────────┐
  (future) contact  ───▶│  hm-api/contact.php (NEW)    │──┼──▶│ EmailService.php    │
  form / mailto         │  server-side contact intake  │  │   │ (NEW)               │
                        └─────────────────────────────┘  │   │ • routing table     │
                                                          │   │ • header standard.  │
                                                          │   │ • HTML template     │
                                                          │   │ • Sender/Return-Path│
                                                          │   └─────────┬──────────┘
                                                          │             │ delegates transport
                                                          │             ▼
                                                          │      hm-api/_smtp.php  (unchanged)
                                                          │      mail_mode='smtp' | 'mail'
```

### 2.1 `hm-api/EmailService.php` (NEW — the centralized abstraction)
A single class/functions file that owns everything sender-related. **No transport rewrite** —
it delegates to the existing `_smtp.php` (`hm_smtp_send`) and the `mail()` path.

- **Routing table** (single source of truth), fed by `_config.php`:
  | account | From | From name | Admin recipient |
  |---------|------|-----------|-----------------|
  | `booking` | `mail_from_booking` → booking@ | Hello Moving 予約センター | booking@ |
  | `support` | `mail_from_support` → support@ | Hello Moving アフターサービス | support@ |
  | `contact` | `mail_from_contact` → contact@ | Hello Moving カスタマーサポート | contact@ |
- **Header standardization** (see §3).
- **Shared HTML template** (moved out of `send-email.php`, behavior-preserving).
- Public API (draft): `EmailService::sendToCustomer($account, $to, $subject, $message, $opts)`
  and `EmailService::notifyAdmin($account, $subject, $message, $opts)` — both return the
  same `{ok,data,error}`-shaped result the endpoint already emits.

### 2.2 `hm-api/send-email.php` (REFACTOR — behavior-preserving)
Becomes a thin controller: parse/validate body → call `EmailService` → emit the **existing
additive envelope** (`{ok, data:{from,messageId,transport}, error, error_detail}` + legacy
top-level `from`/`messageId`/`transport`). **B1 (`admin-bookings.js`) and B2
(`communications.js`) need zero changes.** Self-test branch preserved.

### 2.3 `hm-api/contact.php` (NEW — server-side contact intake)
- `POST {name, email, message, subject?}`; `hm_cors` + `hm_require_api_key` + `hm_rate_limit`.
- Sends via `EmailService`, `account='contact'`: **From contact@**, **To contact@ (admin)**,
  **Reply-To = submitter's email** so replies go straight to the customer.
- **Frontend wiring is NOT done here** (would touch locked `index.html`/`script.js`). The
  endpoint is delivered ready; wiring the form/mailto is a separate, sign-off-gated step.

### 2.4 Delete `send_email.php` (repo root)
Remove the duplicate after the pre-delete check in §5.

---

## 3. Header standardization spec (From · Reply-To · Return-Path · Sender)

| Header | Rule | Mechanism |
|--------|------|-----------|
| **From** | `"<display name>" <account mailbox>` (booking@/support@/contact@), MIME-encoded | build in EmailService |
| **Reply-To** | Customer emails: the account mailbox. **Contact/admin notifications: the submitter/customer address** (so staff reply to the person) | build in EmailService |
| **Return-Path** | Envelope sender = the **From mailbox** (bounces to the owning mailbox) | SMTP `MAIL FROM:<from>` / `mail()` `-f<from>` (already correct) |
| **Sender** | Set **`Sender: <smtp_user>`** (the authenticated mailbox) **only when From ≠ smtp_user**; omit when they match | **NEW** — added in EmailService |

**Rationale for `Sender:`** — SMTP authenticates as `smtp_user` (booking@). When an email is
sent `From: support@`/`contact@`, RFC 5322 says the authenticated agent should be disclosed
via `Sender:`. This is the RFC-clean fix for the "From ≠ AUTH mailbox" risk, needs no server
config, and keeps single-credential auth. (Per-mailbox auth remains a future option if the
host rejects send-as even with `Sender:`.)

> `_smtp.php` change for `Sender:` is **additive** (one header line in `hm_smtp_build_message`,
> or passed through from EmailService). No transport-logic change.

---

## 4. Mailbox routing verification matrix (target)

| Flow | Endpoint | From | Reply-To | Return-Path | Admin recipient |
|------|----------|------|----------|-------------|-----------------|
| Booking confirmation / new-booking to customer | send-email.php `booking` | booking@ | booking@ | booking@ | — |
| Booking completion to customer | send-email.php `support` *(current behavior preserved — see open item)* | support@ | support@ | support@ | — |
| Admin reply (communications) | send-email.php (`_emailToAccount`) | booking@/support@/contact@ | that mailbox | same | — |
| Contact submission | **contact.php** (NEW) | contact@ | **submitter** | contact@ | contact@ |
| Support notification | via `support` account | support@ | support@ | support@ | support@ |

Verified at runtime with the self-test + a real send per account (§6).

---

## 5. Pre-delete / pre-refactor safety checks

1. `send_email.php`: confirm no cPanel cron job or external URL invokes
   `https://hello-moving.com/send_email.php` (repo already confirmed clean). If unsure, keep a
   one-commit revert window.
2. `_config.php` on the server must have `mail_from_booking/support/contact` set (defaults already
   point to the three mailboxes) and `smtp_pass` populated for `mail_mode='smtp'`.
3. Deploy `EmailService.php` + refactored `send-email.php` **together** (endpoint depends on the
   class); guarded load so a half-deploy degrades to a structured error, never a fatal.

---

## 6. Verification steps (run on server after implementation)

1. `php -l` on `EmailService.php`, `send-email.php`, `contact.php`, `_smtp.php`.
2. `GET <API_BASE>/send-email.php?action=selftest` → `{ok:true, data:{dns,smtp:"connected",starttls:"ok",auth:"success"}}`.
3. `?action=selftest&send=1` → test mail lands in booking@.
4. One real send per account; **inspect raw headers** and confirm:
   - `From` = correct mailbox, `Reply-To` per §3, `Return-Path`/envelope = From mailbox,
     `Sender` present only when From ≠ smtp_user.
5. `POST contact.php` → arrives at contact@ with Reply-To = submitter.
6. Regression: admin booking (new/confirmed/complete) + a communications reply still send OK
   (B1/B2 unchanged); `logs/error.log` clean; no credentials logged.
7. `npm run test:arch` still green (no locked-file/Formspree changes).

---

## 7. Rollback

- **Fastest:** `_config.php` `mail_mode => 'mail'` (bypasses SMTP path).
- **Endpoint revert:** `git checkout origin/main -- hm-api/send-email.php`; remove
  `EmailService.php`/`contact.php`. No DB/schema/auth changes are made, so nothing else to undo.
- Restoring `send_email.php` is a single `git revert` if the deletion ever needs undoing.

---

## 8. File-change manifest (for the implementation step — NOT yet done)

| File | Action | Locked? |
|------|--------|---------|
| `hm-api/EmailService.php` | **NEW** — centralized sender abstraction | no |
| `hm-api/send-email.php` | **REFACTOR** — thin controller over EmailService; envelope preserved | no |
| `hm-api/contact.php` | **NEW** — server-side contact intake → contact@ | no |
| `hm-api/_smtp.php` | **MINIMAL ADD** — optional `Sender:` header passthrough | no |
| `send_email.php` (root) | **DELETE** — orphaned duplicate | no |
| `_config.php` / `_config.example.php` | **NO CODE CHANGE** — verify values only | ⚠ locked |
| `index.html` / `script.js` | **NOT TOUCHED** — contact form wiring deferred to a sign-off step | ⚠ locked |

---

## 9. Open item needing a one-word answer (does not block starting)

- **Completion email From:** the plan **preserves current behavior** (`statusComplete` →
  `support@`). If you'd rather all booking-lifecycle mail come from `booking@`, say so and
  I'll change the one mapping. Everything else is unaffected.
</content>
