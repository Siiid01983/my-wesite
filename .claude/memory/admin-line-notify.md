---
name: admin-line-notify
description: "LINE notifications — server-side Messaging API; TWO paths: admin manual-add (client sendLineNotif→line-push.php) + public customer booking (create-booking.php→_line.php, server-side); token in _config.php"
metadata: 
  node_type: memory
  type: project
  originSessionId: c2e2b131-943a-4529-9b93-587d19591065
---

## ⚠️ Migrated to server-side LINE Messaging API (2026-07-01, v4.7, PR #32/#33)

The old **client-side LINE Notify** path is GONE. LINE Notify (`notify-api.line.me`)
was shut down March 2025. Notifications now go through the **LINE Messaging API push**
endpoint, called SERVER-SIDE so the Channel Access Token is never in the browser.

- **Client:** `js/modules/notifications/line.js` → `sendLineNotif()` POSTs to `<API_BASE>/line-push.php`
- **Server:** `hm-api/line-push.php` → `POST https://api.line.me/v2/bot/message/push`
- **Token:** `hm-api/_config.php` (server secret) — see [[cms-sync-baseline]]/[[hm-api-production-hardening]] for the config/envelope conventions

## Server endpoint — hm-api/line-push.php

- Guards (in order): `hm_cors()` → `hm_require_api_key()` → `hm_rate_limit('line',60,60)` → `hm_require_staff_write()` (admin/manager only). Anonymous public-key callers are 401'd.
- Config keys in `_config.php`: `line_enabled` (master switch), `line_channel_token` (secret), `line_push_to` (default recipient userId/group/room), `line_channel_id` (reference only). Documented in `_config.example.php`.
- Body (JSON): `{ message, to?, action? }`. `action:"selftest"` auto-fills a JP test message. Truncates >5000 chars.
- Fails cleanly: `503 line_disabled`, `503 line_no_token`, `400 no_recipient`, `502 line_http_<code>` / `line_transport`.
- Returns `{ok,data,error}` envelope; on success `data:{sent:true,status,to:"Uxxxx…"}`. Never echoes token or full recipient.
- Transport helper `hm_line_post()` — curl with a stream-context fallback.

## Client function — sendLineNotif(message, triggerKey)

- Reads `Adapter.getLineSettings()` — returns early if `!cfg.enabled` (NO token check anymore).
- If `triggerKey` set, returns early when `cfg.triggers[triggerKey]` is off.
- POSTs JSON `{ message, trigger }` to `base + '/line-push.php'` with headers `X-API-KEY` (if `window.API_KEY`) and `X-ADMIN-TOKEN` (if `window.__HM_ADMIN_TOKEN`).
- Success = `res.ok && (body.ok===true || body.data.sent)`; logs `{ts,ok,preview,status}`, toasts result; refreshes log if LINE view active.
- `cfg.token` / `cfg.proxyUrl` are DEAD for sending (vestigial in storage default only).

## ⚠️ TWO notification paths — don't confuse them

There are two separate "new booking" flows. The admin one is client-side; the
public customer one is server-side (added 2026-07-01, v4.8, PR #36).

| Path | How booking is created | LINE fires from | Auth |
|---|---|---|---|
| **Admin manual add** | `admin-bookings.js saveBooking()` → `Adapter.addBooking` / `BookingService.recordBooking` | **client** `sendLineNotif('…','newBooking')` → `line-push.php` | admin `X-ADMIN-TOKEN` |
| **Public customer** | BA overlay → `BookingService.createBooking()` → `POST create-booking.php` → `INSERT bookings` | **server** `create-booking.php` → `hm_line_push()` | none (server-to-server) |

Why the public path CAN'T reuse the client `sendLineNotif`: `line-push.php` is
`hm_require_staff_write()`-gated (public page has no admin token → 401), and the
admin JS bundle (`sendLineNotif`/`Adapter`) isn't loaded on the marketing site.

## Public-path server notification — create-booking.php + _line.php

- **`hm-api/_line.php`** (shared helper): `hm_line_enabled()` (true when `line_enabled` + token + `line_push_to` all set) and `hm_line_push($message, $to=null)` (LINE Messaging API push, reuses `_config.php` token; fire-and-forget, never throws, 8s timeout, curl + stream fallback; logs failures via `hm_log_error`).
- **`create-booking.php`**: after a confirmed `INSERT`, echoes the `{ok,id,data,error}` success response, calls `fastcgi_finish_request()` to flush to the client, THEN `if (hm_line_enabled()) hm_line_push($msg)` — so the LINE round-trip adds ZERO latency to the customer's confirmation. Client envelope unchanged; `bookingService.js` untouched.
- **Gating:** public path is gated ONLY by `line_enabled` (PHP can't see the admin's localStorage per-trigger toggles). No per-trigger toggle server-side (open item — would need a `_config.php` key).
- **Host note:** `fastcgi_finish_request` needs PHP-FPM; on non-FPM SAPI it falls back to push-inline (up to ~8s worst case). Confirm host SAPI.
- Message: `📅 新規予約（ウェブ）` + name / date / phone / email / 受付ID + first 500 chars of `notes` (notes packs service + from/to via `bookingService._packNotes`).

## Trigger points — ADMIN manual-add path only (admin-bookings.js, client-side)

| Trigger key | Line | When fired |
|---|---|---|
| `newBooking` | `admin-bookings.js:532` | Admin adds a booking manually |
| `statusConfirmed` | `admin-bookings.js:518` | Status → 確定 |
| `statusComplete` | `admin-bookings.js:523` | Status → 完了 |
| `newQuote` | *(not wired — toggle exists, off by default)* | — |

(Public customer bookings do NOT flow through here — see the two-paths table above.)

## Settings UI (renderLine)

- Panel relabeled **「LINE Messaging API 設定」** (was "LINE Notify 設定").
- Token input + CORS-proxy field + "トークンを取得" link REMOVED. Replaced by a 🔒 notice (token is server-side) + save/test buttons + "LINE Developers ↗" link.
- `設定手順` rewritten for the Messaging API flow (create channel → set `line_channel_token`/`line_push_to` in `_config.php` → flip `line_enabled` + toggle → test).
- `saveLineSettings()` now persists ONLY the enable flag + per-trigger prefs (no longer reads deleted `lineToken`/`lineProxy` inputs).
- `testLineNotif()` — client token guard REMOVED; just calls `sendLineNotif(...)`; server reports config errors.
- 通知トリガー (4 toggles) + 送信ログ (last 20, ✓成功/✗失敗) panels unchanged.

## Adapter keys (unchanged storage shape)

| Key | localStorage | Default |
|---|---|---|
| `K.line` | `hm_line` | `{ token:'', enabled:false, proxyUrl:'', triggers:{newBooking:true, statusConfirmed:true, statusComplete:true, newQuote:false} }` |
| `K.linelog` | `hm_linelog` | `[]` |

Methods: `getLineSettings()`, `saveLineSettings(v)`, `getLineLog()`, `pushLineLog(e)`, `clearLineLog()`. `token`/`proxyUrl` remain in the default object but are no longer used.

## Final test

- **Admin/config check:** admin **テスト送信** button (or POST `{action:"selftest"}` to `line-push.php` from a logged-in admin session).
- **Public path:** the test button does NOT exercise it — submit a REAL booking from the public site with `line_enabled=true` + token + `line_push_to` set; the `📅 新規予約（ウェブ）` alert confirms `create-booking.php` → `_line.php`.

## Changelog

- **v3.1** (2026-06-04): original client-side LINE Notify integration
- **v4.7** (2026-07-01): migrated to server-side LINE Messaging API — see [[admin-changelog]]
- **v4.8** (2026-07-01, PR #36): public customer bookings now notify server-side (create-booking.php + _line.php) — see [[admin-changelog]]
