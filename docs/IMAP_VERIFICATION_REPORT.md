# IMAP Inbound Sync — Verification Report (Email Center Phase 2)

**Date:** 2026-07-02
**Scope:** IMAP polling ingestion — `_imap.php`, `inbox-poll.php`, migration extension,
schema/allowlist/config, inbox UI display.

**Method note:** static + build verification is complete here. **Live IMAP verification
(actual mailbox login + import) cannot run from this environment** — it needs the PHP
`imap` extension on the server, the three mailbox passwords, and `imap_enabled=true` in
`_config.php`, none of which are available here. Those rows are marked ⬜ RUN-ON-SERVER
with the exact commands to complete them.

**Legend:** ✅ PASS · ⬜ RUN-ON-SERVER (post-deploy)

---

## A. Static / build verification (done)

| # | Check | Result |
|---|-------|--------|
| A1 | `php -l` — `_imap.php`, `inbox-poll.php`, `inbox-migrate.php`, `rest.php`, `_config.example.php` | ✅ PASS (no errors) |
| A2 | `node --check js/modules/inbox/inbox.js` | ✅ PASS |
| A3 | `npm run test:arch` | ✅ PASS (20/20) |
| A4 | No locked-file edits (`index.html`/`styles.css`/`script.js`/`admin.html`/config/`_config.php`) | ✅ PASS |
| A5 | Migration additive + idempotent (adds `sender_name`,`received_at` only if missing) | ✅ PASS |
| A6 | `_config.php` untouched; IMAP config documented in `_config.example.php` only | ✅ PASS |
| A7 | Read-only IMAP (`OP_READONLY` + `FT_PEEK`) — server `\Seen` not modified | ✅ PASS (code) |
| A8 | Credentials never logged (only `imap_last_error()` text captured) | ✅ PASS (code) |

## B. Requirement coverage (code-level)

| Requirement | Where | Status |
|-------------|-------|--------|
| Poll booking@ / support@ / contact@ | `imap_accounts` loop in `inbox-poll.php` | ✅ |
| Import into `inbox_messages` | `poll_mailbox()` INSERT | ✅ |
| Deduplicate by Message-ID | `inbox_has_message_id()` (skip if exists; synthetic id when absent) | ✅ |
| Populate mailbox, sender_name, email, subject, body_html, body_text, message_id, in_reply_to, thread_id, received_at | INSERT column list | ✅ |
| Threading via Message-ID / In-Reply-To / References | `inbox_resolve_thread()` (parent-id → subject+sender → new) | ✅ |
| Cron-safe sync script | `inbox-poll.php` (CLI/HTTP, single-flight `flock`) | ✅ |
| Store last processed UID per mailbox | `hm_data` key `imap_state:<mailbox>` (`poll_state_get/set`), + UIDVALIDITY reset guard | ✅ |
| Ignore already imported | UID watermark (`> last_uid`) + Message-ID dedup | ✅ |
| Self-hosted only (no provider) | pure `imap_*` to `mail.hello-moving.com`; no HTTP to any third party | ✅ |

## C. Live verification (RUN-ON-SERVER, post-deploy)

Prereq: deploy; run `php hm-api/inbox-migrate.php`; set `imap_enabled=true` + the three
`imap_accounts` passwords in `_config.php`.

| # | Check | Command / how | Expected |
|---|-------|---------------|----------|
| C1 | Migration adds P2 columns | `php hm-api/inbox-migrate.php` | `added` includes `sender_name`,`received_at` |
| C2 | Poll runs, imports backlog | `php hm-api/inbox-poll.php` | `{ok:true,status:"polled",imported:N,…}` |
| C3 | Re-run ignores imported | run C2 again immediately | `imported:0, skipped:≥N` |
| C4 | Dedup by Message-ID | send a test mail, poll twice | one `inbox_messages` row for that Message-ID |
| C5 | Fields populated | inspect the new row | mailbox/sender_name/email/subject/body_text/body_html/message_id/received_at set |
| C6 | Threading | reply to an imported mail (a customer replies to your reply, or send a threaded pair) | same `thread_id` across the conversation |
| C7 | UID watermark stored | `SELECT value FROM hm_data WHERE key='imap_state:booking@hello-moving.com'` | `{"uidvalidity":…, "last_uid":…}` advances |
| C8 | Read-only (server unread state) | check the mailbox in webmail after polling | messages remain **Unseen** on the server |
| C9 | Japanese renders | import a Japanese email | subject/body correct UTF-8 in the inbox |
| C10 | Appears in admin Inbox | Admin → Inbox | imported mail listed with sender name + received time; 返信 works |
| C11 | Cron cadence | add the `*/5` cron; wait | new mail appears within ~5 min; `logs/error.log` clean |
| C12 | Single-flight lock | trigger two polls at once | second returns `status:"skipped"` |

## D. Evidence to attach after C
- Output of C2/C3 (imported/skipped counts).
- One imported row (columns populated).
- `hm_data` UID-state row (C7).
- A threaded pair sharing `thread_id` (C6).

## E. Verdict
- **Build/static:** ✅ complete — lints clean, arch green, additive & idempotent, no
  locked files, self-hosted only.
- **Live import:** ⬜ pending the three server prerequisites (php-imap already PASS;
  needs deploy + migration + mailbox passwords + `imap_enabled=true`), then run C1–C12.
