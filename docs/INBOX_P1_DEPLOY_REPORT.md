# Inbox Email Center — Phase 1 Deployment Report

**Date:** 2026-07-01
**PR:** #41 merged → `main` `a046ddd`
**Deploy:** cPanel workflow run `28522089170` — **success**
**Target:** production `https://hello-moving.com`

**Legend:** ✅ PASS · ⚠️ PARTIAL (verified as far as remotely possible) · ⛔ BLOCKED

---

## 1. Pre-merge gate (all passed)

| Check | Result |
|-------|--------|
| No locked-file edits (`index.html`/`styles.css`/`script.js`/`admin.html`/config) | ✅ |
| `php -l` — inbox-migrate, rest, _smtp, EmailService, send-email | ✅ |
| `node --check js/modules/inbox/inbox.js` | ✅ |
| `npm run test:arch` | ✅ 20/20 |
| Migration idempotent (`SHOW COLUMNS`/`SHOW INDEX` guards) | ✅ |
| Backward compatible (additive nullable/defaulted cols; `body` retained) | ✅ |

## 2. Deployment

| Item | Result |
|------|--------|
| PR #41 merged | ✅ 13:43 UTC |
| cPanel deploy run `28522089170` | ✅ success |
| Reply UI present in deployed `inbox.js` | ✅ (`inboxOpenReply`, `inboxSendReply`, `返信`, `in_reply_to`, `log_comm` all found in `https://hello-moving.com/js/modules/inbox/inbox.js`) |

## 3. Database migration — ⛔ BLOCKED (needs server action)

| Check | Result |
|-------|--------|
| New columns present? (`select mailbox,message_id,status`) | ⛔ **absent** — HTTP 500 `{code:"query"}` (columns don't exist yet) |
| Run `inbox-migrate.php` over HTTP | ⛔ **403** — `admin_setup_token` not set / not available to me |
| Run via CLI | ⛔ no server shell from here |

**Action required:** run the migration **once** on the server, either:
- CLI: `php hm-api/inbox-migrate.php`, **or**
- set `admin_setup_token` in `_config.php` → `https://hello-moving.com/hm-api/inbox-migrate.php?token=<token>` (remove token after).

Expected: `{"ok":true,"status":"migrated","added":[…]}`. Re-running is safe (idempotent).
**Note:** reply already works without the migration — `mailbox`/`message_id` are simply null until it runs (and until IMAP/P2 populates them). Threading headers only attach when a parent `message_id` exists.

## 4. Step-5 verification (PASS/FAIL)

| # | Check | Method | Result |
|---|-------|--------|--------|
| 5.1 | Reply button visible | deployed `inbox.js` contains 返信 button + `inboxOpenReply` | ✅ deployed (browser render spot-check recommended in admin) |
| 5.2 | Reply modal opens | deployed `inbox.js` contains modal + `inboxSendReply` | ✅ deployed (browser spot-check recommended) |
| 5.3 | SMTP send succeeds | `POST send-email.php` (support@) | ✅ `{ok:true, transport:"smtp", messageId:<32292b9c…@hello-moving.com>}` |
| 5.4 | Exactly one communications row | `rest.php` select by booking_id `HMV-REPLY-1782913647` | ✅ 1 row (id **12**, `direction=outbound`, `email_status=sent`, `created_by=system`) |
| 5.5 | Correct mailbox routing | response `from` | ✅ `support@hello-moving.com` (from_account=support) |
| 5.6 | In-Reply-To header present | gateway accepted `in_reply_to` + sent ok; `_smtp.php` emits `In-Reply-To:` | ⚠️ code-verified + gateway-accepted; on-wire confirmation needs a received-mail spot-check (no mailbox access here) |
| 5.7 | References header present | gateway accepted `references` + sent ok; `_smtp.php` emits `References:` | ⚠️ code-verified + gateway-accepted; on-wire confirmation pending |

## 5. Deployment evidence
- Merge commit: `a046ddd` (PR #41).
- Deploy workflow: run `28522089170`, conclusion **success**.
- Threading send messageId: `<32292b9c8937090c2eb63dfa45b32d80@hello-moving.com>`.
- Logged communications row: **id 12**, `sender_email=support@hello-moving.com`.
- Deployed asset check: reply tokens present in live `inbox.js`.

## 6. Outstanding
1. **Run `inbox-migrate.php`** (§3) — the only blocker to full column availability.
2. **Browser spot-check** (5.1/5.2) — open Admin → Inbox, confirm 返信 opens the modal and a send lands.
3. **On-wire header spot-check** (5.6/5.7) — open a received reply's source and confirm `In-Reply-To:`/`References:` are present.
4. **Test-row cleanup** — `communications` id **12** (this report) joins ids **6–11** from earlier verification as test artifacts (blocked on admin token; see prior cleanup request).

## 7. Rollback
`in_reply_to`/`references` are optional gateway params (omitting = prior behavior). The migration is additive (no data changed); columns may remain unused or be dropped manually. Reverting the branch restores the prior read-only inbox. No booking/communications-module or locked-surface changes.
