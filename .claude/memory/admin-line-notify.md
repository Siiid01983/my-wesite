---
name: admin-line-notify
description: "LINE Notify integration — source file, settings page, sendLineNotif function, trigger points, Adapter keys, and CORS note"
metadata: 
  node_type: memory
  type: project
  originSessionId: c2e2b131-943a-4529-9b93-587d19591065
---

## Location

- **Source file:** `js/modules/notifications/line.js` (Phase 14, 2026-06-07)
- **View:** `id="view-line"` → `<div id="lineContent"></div>`
- **Sidebar:** under 設定, between バックアップ and 変更履歴; `data-view="line"`
- **Render function:** `renderLine()` — called by `go('line')`; builds the full settings UI
- **Committed:** `73849e4` (2026-06-04)

## Adapter keys

| Key constant | localStorage key | Default |
|---|---|---|
| `K.line` | `hm_line` | `{ token:'', enabled:false, proxyUrl:'', triggers:{newBooking:true, statusConfirmed:true, statusComplete:true, newQuote:false} }` |
| `K.linelog` | `hm_linelog` | `[]` |

**Adapter methods:** `getLineSettings()`, `saveLineSettings(v)`, `getLineLog()`, `pushLineLog(entry)`, `clearLineLog()`

Log entries: `{ ts, ok, preview, status }` — last 20 kept.

## Core function

```js
async function sendLineNotif(message, triggerKey)
```

- Reads `Adapter.getLineSettings()` — returns early if `!enabled` or `!token`
- If `triggerKey` provided, checks `cfg.triggers[triggerKey]` — returns early if off
- If `cfg.proxyUrl` set, prepends it to `https://notify-api.line.me/api/notify`
- POST with `Authorization: Bearer {token}` + URLSearchParams body `{ message }`
- On success: logs entry, shows toast "LINE通知を送信しました"
- On CORS/network error: logs failure, shows toast with error hint
- Refreshes log panel if LINE view is currently active

## Trigger points (in saveBooking)

| Trigger key | When fired | Message format |
|---|---|---|
| `newBooking` | New booking added | `📅 新規予約\n{name}様\nサービス: {service}\n日程: {date}\nID: {id}` |
| `statusConfirmed` | Status changed → 確定 | `✅ 予約確定\n{name}様 ({id})\nサービス: {service}\n日程: {date}` |
| `statusComplete` | Status changed → 完了 | `🎉 引越し完了\n{name}様 ({id})\nサービス: {service}` |
| `newQuote` | *(not yet wired — toggle exists, off by default)* | — |

## Settings page UI sections

1. **LINE Notify 設定** panel — token field (password/text toggle), enabled switch in header, save + test + "トークンを取得 ↗" buttons, CORS proxy URL field
2. **通知トリガー** panel — 4 toggle rows, one per trigger key
3. **設定手順** panel — 4-step numbered guide (LINE green circles) linking to notify-bot.line.me
4. **送信ログ** panel — last 20 entries with ✓成功/✗失敗 badge, preview, timestamp, HTTP status; clear button

## Helper functions

- `saveLineSettings()` — reads all inputs/toggles, calls `Adapter.saveLineSettings()`
- `testLineNotif()` — sends a fixed test message with `triggerKey=null` (bypasses trigger filter)
- `renderLineLog()` — re-renders `#lineLogBody` from `Adapter.getLineLog()`

## CORS note

LINE Notify API (`notify-api.line.me`) does not send CORS headers for browser requests. Direct fetch will likely fail unless:
- A CORS proxy URL is configured (e.g. `https://corsproxy.io/?`)
- The admin is served from a server that proxies the request

The UI documents this and provides a proxy field. Failures are caught gracefully and logged.

## Changelog

- **v3.1** (2026-06-04): LINE通知連携 listed as released
- Removed from `CHANGELOG_NEXT` — 9 What's Next items remain
