# IMAP Inbound Sync — Deployment Guide (Email Center Phase 2)

Self-hosted IMAP polling. No external inbound provider. Imports mail from
`booking@`, `support@`, `contact@ hello-moving.com` into `inbox_messages`.

**Components (this change):**
- `hm-api/_imap.php` — IMAP connect + MIME parse/decode helpers (DB-free).
- `hm-api/inbox-poll.php` — cron-safe sync script (dedup, threading, UID watermark).
- `hm-api/inbox-migrate.php` — extended with `sender_name`, `received_at` (idempotent).
- `hm-api/schema.mysql.sql`, `hm-api/rest.php` — schema + allowlist updated.
- `hm-api/_config.example.php` — IMAP config block (documentation).
- `js/modules/inbox/inbox.js` — shows parsed sender name + mail Date when present.

---

## 1. Prerequisites
- PHP `imap` extension on the host (confirmed PASS). Verify: `php -m | grep -i imap`.
- IMAPS reachable: `mail.hello-moving.com:993` SSL (confirmed — Dovecot, valid cert).
- Mailbox passwords for the three accounts.
- Cron access (or the HTTP-token fallback).

## 2. Run the migration (adds sender_name, received_at)
The P1 columns are already applied; re-run the idempotent migrator to add the two
Phase-2 columns (it adds only what's missing):
```bash
php hm-api/inbox-migrate.php
# → {"ok":true,"status":"migrated","added":["sender_name","received_at","idx_inbox_received_at"]}
```
(Or over HTTP with `admin_setup_token`: `.../inbox-migrate.php?token=<token>`.)

## 3. Configure `_config.php` (server only — NEVER commit)
Add/enable (values live in `_config.php`, which is gitignored; the shape is documented
in `_config.example.php`):
```php
'imap_enabled' => true,
'imap_host'    => 'mail.hello-moving.com',
'imap_port'    => 993,
'imap_secure'  => 'ssl',
'imap_accounts' => [
  ['mailbox' => 'booking@hello-moving.com', 'user' => 'booking@hello-moving.com', 'pass' => '••••'],
  ['mailbox' => 'support@hello-moving.com', 'user' => 'support@hello-moving.com', 'pass' => '••••'],
  ['mailbox' => 'contact@hello-moving.com', 'user' => 'contact@hello-moving.com', 'pass' => '••••'],
],
// Optional, only if triggering over HTTP instead of cron:
'imap_poll_token' => '<long-random>',
```
Leave `imap_enabled=false` until passwords are in — the poller no-ops while disabled.

## 4. First run (manual, watch output)
```bash
php hm-api/inbox-poll.php
```
Expected JSON: `{"ok":true,"status":"polled","imported":N,"skipped":M,"mailboxes":[…]}`.
- First run imports the current backlog (UID watermark starts at 0).
- Re-running immediately → `imported:0, skipped:…` (dedup + watermark working).

## 5. Schedule cron (every 5 minutes)
cPanel → Cron Jobs (or `crontab -e`):
```
*/5 * * * * /usr/bin/php /home/<cpaneluser>/public_html/hm-api/inbox-poll.php >/dev/null 2>&1
```
Tighten to `*/2` if faster delivery is needed. The script self-locks
(`_cache/imap-poll.lock`), so overlapping runs are safe (a second run exits with
`status:"skipped"`).

### HTTP fallback (no cron)
Point an uptime pinger at:
`https://hello-moving.com/hm-api/inbox-poll.php?token=<imap_poll_token>` (rate-limited 6/min).

## 6. How it works (summary)
- **Incremental:** per-mailbox `{uidvalidity,last_uid}` stored in `hm_data` key
  `imap_state:<mailbox>`; only UIDs `> last_uid` are fetched. If UIDVALIDITY changes,
  the watermark resets (re-scan) but Message-ID dedup prevents re-import.
- **Read-only:** `OP_READONLY` + `FT_PEEK` — server `\Seen` flags are never changed
  (staff read-state is `inbox_messages.is_read`).
- **Dedup:** skip if a row with the same `message_id` exists (synthetic id when the
  mail has none).
- **Threading:** parent ids from In-Reply-To + References → existing row's `thread_id`;
  else same sender + normalized subject; else new thread (`thread_id = message_id`).
- **Populated columns:** `mailbox, sender(+sender_name), email, subject, body_text,
  body_html, message_id, in_reply_to, thread_id, received_at` (+ `is_read=0, status='open'`).
- **Charset:** MIME-encoded headers + part charsets converted to UTF-8 (Japanese safe).

## 7. Security
- Passwords only in `_config.php` (gitignored); never logged (`imap_last_error()` text
  is captured but not the password).
- HTTP trigger requires `imap_poll_token` (constant-time) + rate limit; CLI is trusted.
- Bodies are stored raw and **escaped on render** (inbox UI escapes text; HTML bodies
  are not injected as markup in P1/P2 — sanitized rendering is a later phase).

## 8. Rollback
- Set `imap_enabled=false` (or remove the cron) → ingestion stops immediately; nothing else affected.
- `_imap.php` / `inbox-poll.php` are new files; deleting them removes the feature.
- Migration is additive (columns can remain unused). No existing data is modified.

## 9. Troubleshooting
| Symptom | Likely cause / fix |
|---------|--------------------|
| `php-imap extension not installed` | enable `imap` in cPanel → Select PHP Version → Extensions |
| `IMAP open failed: … AUTHENTICATIONFAILED` | wrong mailbox password in `_config.php` |
| `IMAP open failed: … certificate` | set `'imap_novalidate_cert' => true` only if unavoidable |
| `imported:0` always | check `imap_enabled=true`, passwords set, and that new mail exists |
| duplicates | shouldn't occur (Message-ID unique guard); check migration ran (message_id column exists) |
