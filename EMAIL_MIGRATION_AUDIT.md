# Email Migration Audit & Plan — Company Mailboxes

**Date:** 2026-07-01
**Goal:** Route all email through the three company mailboxes
(`booking@`, `support@`, `contact@ hello-moving.com`) via a centralized service on the
existing self-hosted SMTP server. **This document is an audit + plan only — no email
code has been changed.**

> ⚠️ The older `EMAIL_ARCHITECTURE_REPORT.md` is **stale**: it describes Supabase Edge
> Functions and claims `script.js:181` calls `send_email.php`. Neither is true in the
> current tree (site migrated off Supabase; `script.js` has no such call). This audit
> supersedes it.

---

## 1. Every location that sends email

### A. Server-side PHP (the real SMTP senders)

| ID | File | Sends | Current sender (From) | Admin recipient | Transport |
|----|------|-------|----------------------|-----------------|-----------|
| **A1** | `hm-api/send-email.php` | Admin→customer: booking confirmations, status updates, manual replies | `mail_from_booking` / `mail_from_support` / `mail_from_contact` from `_config.php` → **booking@ / support@ / contact@** | — (customer-facing) | `_smtp.php` (`mail_mode='smtp'`) **or** `mail()` |
| **A2** | `hm-api/_smtp.php` | *Transport engine, not a sender* — native fsockopen SMTP, STARTTLS, AUTH LOGIN | uses caller's From | — | raw SMTP |
| **A3** | `send_email.php` **(repo root)** | LEGACY: customer confirmation + admin alert | **`noreply@hello-moving.com`** | **`hellomoving1@gmail.com`** | `mail()` + commented-out PHPMailer/Gmail block |

### B. Client JS that POSTs to the PHP mailer (already centralized ✅)

| ID | File / function | `from_account` | Routes to |
|----|-----------------|----------------|-----------|
| **B1** | `admin-bookings.js` → `_sendBookingEmail()` (lines 452–493) | `'booking'` (new/confirmed), `'support'` (complete) | `hm-api/send-email.php` |
| **B2** | `communications.js` → `EmailService._deliver()` / `_emailToAccount()` (lines 366–676) | derived from sender local-part: `support`/`contact`/`booking`; default `FROM_EMAIL='booking@hello-moving.com'` | `hm-api/send-email.php` |

### C. Third-party relays that BYPASS the company mailboxes ⚠️

| ID | File | Purpose | Service | From / recipient today |
|----|------|---------|---------|------------------------|
| **C1** | `index.html:3312` (BA overlay) | Booking notification on submit | **Formspree** (`/f/xdajqzlo`) | Formspree-managed inbox; From not controllable |
| **C2** | `js/modules/notifications/email.js` → `sendEmailNotif()` | Admin notify: new booking / confirmed / complete / quote | **EmailJS** | `to = cfg.adminEmail`; From set in EmailJS template |
| **C3** | `js/modules/notifications/followUp.js` | Follow-ups | **EmailJS** | shared EmailJS creds |
| **C4** | `js/modules/automation/quoteFollowUpAction.js` | Quote follow-up → customer | **EmailJS** | `companyEmail` default `hellomoving1@gmail.com` |
| **C5** | `js/modules/automation/bookingReminderAction.js` | Booking reminder → customer | **EmailJS** | default `hellomoving1@gmail.com` |
| **C6** | `js/modules/automation/reviewRequestAction.js` | Review request → customer | **EmailJS** | shared EmailJS creds |

### D. Contact surfaces (`mailto:` — opens user's own mail client, not server mail)

| ID | File | Target |
|----|------|--------|
| **D1** | `index.html` header/mobile/footer (1189/1216/1846), `script.js:416` | `mailto:hellomoving1@gmail.com` (CMS-overridable via `contentLoader.js:200`) |
| **D2** | `js/core/appBootstrap.js:110` | text mention of `hellomoving1@gmail.com` |

---

## 2. Current sender → new sender (per goal)

| Flow | Current sender | Current admin recipient | **Target From** | **Target admin recipient** | Gap |
|------|---------------|-------------------------|-----------------|----------------------------|-----|
| Booking **request** (new-booking notify) | Formspree (C1) + EmailJS `adminEmail` (C2) | Formspree inbox / `adminEmail` | **booking@** | **booking@** | Not sent from a company mailbox server-side today |
| Booking **confirmation** (to customer) | booking@ (B1/A1) ✅ | — | **booking@** | — | Already correct. (Note: `statusComplete` currently uses `support@`) |
| **Contact** form | `mailto:` gmail (D1) | gmail | **contact@** | **contact@** | No server-side contact submission exists |
| **Support** notifications | mixed / EmailJS | `adminEmail` | **support@** | **support@** | Not routed through a company mailbox server-side |
| Legacy confirmation (A3) | noreply@ / gmail | gmail | remove | remove | Orphaned duplicate — delete |

---

## 3. Key finding: the "centralized EmailService" mostly already exists

`hm-api/send-email.php` + `hm-api/_smtp.php` **already are** a config-driven SMTP mailer
that maps `booking / support / contact` → the three mailboxes and sends over the
self-hosted server (`smtp_host = mail.dzsecurity.com`, AUTH as `booking@hello-moving.com`).
The migration is therefore mostly **consolidation onto this existing path**, not a
green-field build. What's missing to meet the goals:

1. **A3 `send_email.php` (root) is duplicate SMTP/mail code** using `noreply@` + a Gmail
   admin address. It is **orphaned** (no JS/HTML references it — confirmed by tree search).
   → Delete (this is "remove duplicate SMTP code", goal #4).
2. **No admin-notification routing** in the PHP service (booking→booking@, contact→contact@,
   support→support@). Admin alerts currently ride Formspree/EmailJS (C1–C2).
3. **No server-side contact endpoint** — contact is a `mailto:` to Gmail (D1).
4. **Third-party relays (C1–C6)** never touch the company mailboxes.

---

## 4. Header verification (Reply-To / Return-Path / From / Sender)

| Header | `hm-api/_smtp.php` (SMTP mode) | `send-email.php` `mail()` mode | Legacy `send_email.php` | Verdict |
|--------|-------------------------------|-------------------------------|-------------------------|---------|
| **From** | `From: <name> <fromEmail>` (MIME-encoded) ✅ | `From: <name> <acc.email>` ✅ | `noreply@` ⚠️ | OK except legacy |
| **Reply-To** | `Reply-To: <name> <fromEmail>` ✅ | `Reply-To: acc.email` ✅ | customer / admin (inconsistent) ⚠️ | OK except legacy |
| **Return-Path** | envelope `MAIL FROM:<fromEmail>` ✅ (correct lever) | `-f{acc.email}` ✅ | none ⚠️ | OK except legacy |
| **Sender** | **not set** | **not set** | not set | ⚠️ see risk below |

### ⚠️ From ≠ AUTH-mailbox mismatch (main deliverability risk)
SMTP authenticates as `smtp_user = booking@hello-moving.com`, but the `From`/envelope can
be `support@` or `contact@`. Same domain, so **DKIM/SPF align at the domain level**, but
some MTAs reject or rewrite "send-as" when the authenticated mailbox ≠ From mailbox.
Options to resolve during migration:
- (a) authenticate per-mailbox (three credential sets), **or**
- (b) confirm the mail server permits send-as for these three mailboxes, **or**
- (c) add a `Sender: booking@hello-moving.com` header when `From` ≠ auth mailbox (RFC-clean).

---

## 5. Risks & conflicts

| Risk | Detail | Mitigation |
|------|--------|-----------|
| **Stable-surface edits** | `index.html`, `script.js`, `admin.html`, `_config.php` are LOCKED per `CLAUDE.md` — Formspree (C1) and mailto (D1) live in `index.html`/`script.js` | Get sign-off before touching; prefer new files (`EmailService.php`, new contact endpoint) |
| **Architecture lock test** | `tests/architecture-lock.test.js` allows **≤1** Formspree call in `index.html` and **0** in `script.js`. Removing/replacing C1 must keep the test green | Don't relax the test; adjust code + test together with sign-off |
| From ≠ AUTH mailbox | §4 above | send-as / per-mailbox auth / `Sender:` header |
| EmailJS/Formspree removal | Client-side sends work even if PHP API/CORS misbehaves; moving them server-side adds an API dependency + CORS surface | Keep `mail_mode` fallback; stage behind self-test |
| `statusComplete` uses `support@` | May be intended (after-sales) or a bug vs "confirmations from booking@" | Confirm desired From for completion emails |
| No PHP runtime in dev env | Can't run `php -l` or live SMTP handshake locally | Run self-test (`send-email.php?action=selftest`) on server before trusting sends |
| Secrets | `smtp_pass`, EmailJS keys, Formspree ID | Keep in `_config.php` (gitignored) / env; never commit |

---

## 6. Proposed migration plan (for approval — not yet executed)

**Phase 0 — Decisions needed (see questions below).**

**Phase 1 — Centralize (low risk, new file):**
1. Create `hm-api/EmailService.php` — a class that owns:
   - the routing table `{ booking|support|contact → {from, fromName, adminRecipient} }`,
   - header assembly (From, Reply-To, Return-Path via envelope, optional `Sender:`),
   - the shared HTML template,
   - transport delegation to `_smtp.php`.
2. Refactor `hm-api/send-email.php` to a thin endpoint calling `EmailService` (behavior-preserving; keeps the additive `{ok,data,error}` envelope so B1/B2 need no changes).

**Phase 2 — Remove duplicate SMTP code:**
3. Delete orphaned `send_email.php` (root). Confirm no server cron/URL references it first.

**Phase 3 — Add admin routing + contact endpoint:**
4. Add admin-notification sends via `EmailService` (booking→booking@, contact→contact@, support→support@).
5. Add a server-side contact submission → `contact@` (new endpoint), replacing/augmenting the `mailto:` (requires `index.html` sign-off).

**Phase 4 — (Optional, needs decision) migrate third-party relays** C1 (Formspree) and
C2–C6 (EmailJS) onto `EmailService.php`, respecting the architecture-lock test.

**Phase 5 — Verify:** `?action=selftest[&send=1]`, header inspection on a real send
(From/Reply-To/Return-Path/Sender), confirm receipt at each mailbox, check `logs/error.log`.

---

## 7. Open questions before implementing

1. **Scope:** consolidate only server-side PHP (A1–A3, remove A3) + add contact/admin routing,
   **or** also migrate Formspree (C1) + EmailJS (C2–C6) off third-parties onto the mailboxes?
2. **Completion email From:** keep `statusComplete` as `support@`, or switch to `booking@`?
3. **From ≠ AUTH mailbox:** does `mail.dzsecurity.com` allow send-as for all three, or should
   we hold three credential sets / add a `Sender:` header?
4. **Contact form:** replace the `mailto:` with a real server-side form (touches locked
   `index.html`), or leave `mailto:` and only fix its address to `contact@`?
</content>
</invoke>
