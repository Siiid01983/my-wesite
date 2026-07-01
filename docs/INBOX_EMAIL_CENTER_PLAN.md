# Inbox → Internal Email Center — Architecture & Plan

**Goal:** turn the read-only admin Inbox into a helpdesk-style email client — every
customer email to `booking@` / `support@` / `contact@ hello-moving.com` lands in
**Admin → Inbox**, and staff reply without leaving the panel; the customer receives the
reply from the correct company mailbox.

**Inbound architecture:** **IMAP polling** (self-hosted, no third party).
**SMTP host:** `mail.hello-moving.com`. **Mailboxes:** booking@, support@, contact@.

**Principle:** reuse the existing SMTP gateway (`send-email.php` → `EmailService.php` →
`_smtp.php`), `communications` logging, and `storage.php`. Do not break booking/communication modules.

---

## Phased delivery

| Phase | Scope | Status |
|-------|-------|--------|
| **P1** | Schema migration (additive) + **reply from admin** via the gateway, threaded + logged | ✅ **BUILT (this change)** |
| **P2** | **IMAP polling ingestion** (design below) — import mail → `inbox_messages` | 🔵 Design only |
| P3 | Conversation / thread view (group by `thread_id`) | ⬜ |
| P4 | Attachments (outbound multipart/mixed + inbound storage + validation) | ⬜ |
| P5 | Status / assignment / labels / internal notes | ⬜ |
| P6 | Search + filters | ⬜ |
| P7 | Notifications (badge / sound / browser / polling) | ⬜ |
| P8 | Rich editor + helpdesk UI polish (touches locked `admin.html`/`styles.css`) | ⬜ |

---

## Phase 1 — Reply from admin (BUILT)

**1. Database migration (additive, backward compatible).**
`inbox_messages` gains: `mailbox`, `body_html`, `body_text`, `message_id`, `in_reply_to`,
`thread_id`, `is_read`, `starred`, `archived`, `status` (default `open`), `assignee`, `labels` (JSON),
plus indexes. The legacy `body`, `sender`, `email` columns are retained. New columns are nullable /
defaulted, so existing rows and `receive-email.php` keep working.
- Fresh installs: `hm-api/schema.mysql.sql` (updated `CREATE TABLE`).
- Existing DB: **`hm-api/inbox-migrate.php`** — idempotent runner (checks `SHOW COLUMNS`/`SHOW INDEX`,
  adds only what's missing). Run once: `php hm-api/inbox-migrate.php` (CLI) or
  `…/inbox-migrate.php?token=<admin_setup_token>` over HTTP.
- `rest.php` allowlist for `inbox_messages` expanded (with `labels`→json, `is_read`/`starred`/`archived`→bool).

**2. Inbox UI (`js/modules/inbox/inbox.js`).**
Each message card gets a **返信 (Reply)** button → a reply modal (送信元 mailbox selector, 宛先,
件名 prefilled `Re:`, 本文 textarea, 送信 button). The list `select('*')` so it renders whether or
not the migration has run yet. Modal is injected into `<body>` — **no `admin.html` edit**.

**3. SMTP integration (reused).**
Reply POSTs to `send-email.php` with `from_account` derived from the message's `mailbox`
(booking→booking@, support→support@, contact→contact@; default support@ for pre-IMAP rows),
`to` = customer, `log_comm:true`.

**4. Reply headers (threading).**
`send-email.php` now accepts `in_reply_to` + `references`; `EmailService::deliver` passes them to
`_smtp.php`, which emits `In-Reply-To:` and `References:` (CR/LF-guarded) alongside the reply's own
`Message-ID`. The inbox sends the parent's `message_id` as both (once IMAP populates it).

**5. Logging.**
`log_comm:true` → exactly one `communications` row per reply (`direction=outbound`,
`email_status=sent`, `sender_email` = routed mailbox). Dedupe-safe: unrelated to the admin-reply
`communications.js` path, which self-logs and omits `log_comm`.

**Not in P1:** IMAP ingestion, attachments, thread view, status/assign/labels editing, rich editor.

---

## Phase 2 — IMAP polling ingestion (DESIGN ONLY — not implemented)

### 2.1 Overview
A scheduled PHP job connects to each mailbox over IMAP, fetches new (UNSEEN) messages, parses them,
and inserts normalized rows into `inbox_messages`. No inbound third party; everything stays on the
self-hosted mail server.

```
cron (every 2–5 min)
  → hm-api/inbox-poll.php  (CLI or token-guarded HTTP)
      for each mailbox in [booking@, support@, contact@]:
        IMAP connect (mail.hello-moving.com:993, SSL, per-mailbox creds from _config.php)
        SEARCH UNSEEN (or UID > last_seen_uid, persisted per mailbox)
        for each message:
          parse MIME → { sender_name, sender_email, subject, body_text, body_html,
                         message_id, in_reply_to, references, received_at, attachments[] }
          thread_id = resolve (see 2.4)
          INSERT into inbox_messages (idempotent on message_id)
          store attachments (see 2.5)
          mark message \Seen (or advance last_seen_uid)
```

### 2.2 Mailbox sync
- **Connection:** `imap_open('{mail.hello-moving.com:993/imap/ssl}INBOX', user, pass)` — requires the
  PHP `imap` extension. Per-mailbox credentials added to `_config.php`
  (`imap_accounts` = [{mailbox, user, pass}], `imap_host`, `imap_port=993`, `imap_secure=ssl`).
- **Incrementality:** persist the highest processed **UID** per mailbox (e.g. a small `hm_data`
  key `imap_state:<mailbox>` or a dedicated table). Fetch `UID SEARCH UID <last+1>:*`. Falling back
  to `SEARCH UNSEEN` + mark `\Seen` is simpler but couples read-state to polling — UID watermark is
  preferred so staff read-state stays independent.
- **Idempotency:** unique guard on `message_id` (skip if a row with that `message_id` exists), so a
  re-poll or overlap never duplicates.
- **Safety:** never delete server-side mail; only read + set `\Seen`/advance watermark.

### 2.3 MIME parsing
- Use `imap_fetchstructure` + `imap_fetchbody` to walk parts.
- Extract `text/plain` → `body_text`; `text/html` → `body_html` (sanitized on render).
- Decode transfer-encoding (base64/quoted-printable) and charset → UTF-8 (`mb_convert_encoding`).
- Headers: `From` (display name + address), `Subject` (mime-decode), `Message-ID`, `In-Reply-To`,
  `References`, `Date` → `received_at`.
- `mailbox` = the account being polled.

### 2.4 Threading
- `thread_id` resolution order:
  1. If `In-Reply-To`/`References` matches an existing row's `message_id` (or an outbound reply's
     `messageId` recorded in `communications`) → reuse that row's `thread_id`.
  2. Else, fall back to a normalized-subject + customer-email match (strip `Re:`/`Fwd:`).
  3. Else, start a new thread: `thread_id = message_id` (or a fresh UUID).
- Conversation view (P3) groups by `thread_id`, ordered by `received_at`.

### 2.5 Attachment handling (parsed in P2, stored/sent in P4)
- Parse attachment parts → save bytes via `storage.php` (outside web root; signed URLs).
- Persist metadata in `inbox_messages.attachments` (JSON: `[{name, mime, size, storage_key}]`).
- **Validation:** enforce `upload_allowed_mime` + `upload_max_bytes` (already in `_config.php`);
  reject/flag otherwise. **Virus-scan hook:** a `hm_scan_file($path)` seam (no-op by default; wire
  to ClamAV `clamdscan` if available) called before a file is marked deliverable.

### 2.6 Cron schedule
- cPanel cron: `*/5 * * * * php /home/<user>/public_html/hm-api/inbox-poll.php >/dev/null 2>&1`
  (every 5 min; tighten to `*/2` if needed).
- HTTP fallback (no cron): token-guarded `inbox-poll.php?token=…` hit by an external uptime pinger.
- Concurrency guard: a lock file / `GET_LOCK()` so overlapping runs don't double-process.

### 2.7 Config additions (P2)
```php
'imap_host'   => 'mail.hello-moving.com',
'imap_port'   => 993,
'imap_secure' => 'ssl',
'imap_accounts' => [
  ['mailbox' => 'booking@hello-moving.com', 'user' => 'booking@hello-moving.com', 'pass' => ''],
  ['mailbox' => 'support@hello-moving.com', 'user' => 'support@hello-moving.com', 'pass' => ''],
  ['mailbox' => 'contact@hello-moving.com', 'user' => 'contact@hello-moving.com', 'pass' => ''],
],
'imap_poll_token' => '',   // optional, for HTTP-triggered polling
```

### 2.8 P2 prerequisites (to confirm before implementing)
- PHP `imap` extension available on the cPanel host (`php -m | grep imap`).
- IMAP enabled + per-mailbox passwords for the three accounts.
- Cron access (or an external pinger for the HTTP fallback).

---

## Rollback (P1)
- Front-end/API: revert the changed files; the migration is additive (new columns can remain
  unused, or be dropped manually if desired). No existing data is modified.
- Gateway: `in_reply_to`/`references` are optional params — omitting them restores prior behavior.
