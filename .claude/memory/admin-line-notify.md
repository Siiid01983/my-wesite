---
name: admin-line-notify
description: "LINE notifications — server-side LINE Messaging API (hm-api/line-push.php); token in _config.php; sendLineNotif, trigger points, settings UI, Adapter keys"
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

## Trigger points (admin-bookings.js)

| Trigger key | Line | When fired |
|---|---|---|
| `newBooking` | `admin-bookings.js:532` | New booking added |
| `statusConfirmed` | `admin-bookings.js:518` | Status → 確定 |
| `statusComplete` | `admin-bookings.js:523` | Status → 完了 |
| `newQuote` | *(not wired — toggle exists, off by default)* | — |

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

Enable + valid `line_channel_token` + `line_push_to` in `_config.php`, then the admin
**テスト送信** button (or POST `{action:"selftest"}` to `line-push.php` from a logged-in admin session).

## Changelog

- **v3.1** (2026-06-04): original client-side LINE Notify integration
- **v4.7** (2026-07-01): migrated to server-side LINE Messaging API — see [[admin-changelog]]
