# Inbox Email Center — Phase 1 Verification Checklist

**Phase 1 goal:** reply to customer emails directly from `admin.html` → Inbox, sent from the
correct company mailbox via the existing SMTP gateway, threaded, and logged once in `communications`.

**Legend:** ✅ PASS · ⬜ TODO (run after deploy + migration) · ⛔ FAIL

---

## A. Static / build checks (verified in this change)

| # | Check | Result |
|---|-------|--------|
| A1 | `php -l` — `_smtp.php`, `EmailService.php`, `send-email.php`, `inbox-migrate.php`, `rest.php` | ✅ PASS (no errors) |
| A2 | `node --check js/modules/inbox/inbox.js` | ✅ PASS |
| A3 | `npm run test:arch` | ✅ PASS (20/20) |
| A4 | Migration is additive (new nullable/defaulted columns; `body`/`sender`/`email` retained) | ✅ PASS |
| A5 | No `admin.html` / `styles.css` edits (modal injected via JS; existing classes reused) | ✅ PASS |
| A6 | Gateway threading params optional (`in_reply_to`/`references` omitted ⇒ prior behavior) | ✅ PASS |

## B. Deployment steps (run in order)

| # | Step |
|---|------|
| B1 | Merge + deploy the branch (cPanel deploy workflow). |
| B2 | **Run the migration once:** `php hm-api/inbox-migrate.php` (or `?token=<admin_setup_token>`). Expect `{"ok":true,"status":"migrated"|"already_current"}`. |
| B3 | Confirm columns exist: `SHOW COLUMNS FROM inbox_messages` includes mailbox, body_html, body_text, message_id, in_reply_to, thread_id, is_read, starred, archived, status, assignee, labels. |

## C. Functional checks (run after B, in the admin panel)

| # | Check | How | Expected |
|---|-------|-----|----------|
| C1 | Inbox still renders | Admin → Inbox | list loads (works pre- and post-migration) |
| C2 | Reply button present | each message card | 返信 button shows |
| C3 | Reply modal opens | click 返信 | modal with 送信元/宛先/件名(Re:)/本文/送信 |
| C4 | Mailbox routing | reply to a message whose `mailbox`=support@ | 送信元 defaults to support@; sent `from` = support@ |
| C5 | Email sent | click 送信 | `{ok:true, transport:"smtp", messageId}` → success toast |
| C6 | **Exactly one** communications row | after C5, query communications by recipient/time | 1 new row, `direction=outbound`, `email_status=sent`, `sender_email` = routed mailbox |
| C7 | No duplicate | re-query | still 1 row for that send |
| C8 | Threading headers | inspect received reply source (mailbox) | `In-Reply-To:` + `References:` = parent `message_id` (once inbound rows carry a Message-ID) |
| C9 | Japanese body renders | reply with 日本語 body | received mail shows correct Japanese (gateway mb-encodes + base64) |
| C10 | Failure handling | reply with an empty body | client blocks; invalid recipient → `ok:false`, no comms row |

## D. Gateway-level pre-check (optional, runnable via curl once deployed)
Reply path reuses `send-email.php`, already verified end-to-end in
`docs/EMAIL_VERIFICATION_REPORT.md`. To re-confirm threading specifically:
```
POST /hm-api/send-email.php
{ "from_account":"support", "to":"support@hello-moving.com",
  "subject":"Re: test", "message":"日本語の返信テスト",
  "in_reply_to":"<parent@hello-moving.com>", "references":"<parent@hello-moving.com>",
  "log_comm":true }
→ expect ok:true; one communications row; received mail carries In-Reply-To/References.
```

## E. Sign-off
- [ ] B1–B3 complete (deployed + migrated)
- [ ] C1–C10 pass in the admin panel
- [ ] No regressions in bookings / communications modules
