---
name: admin-changelog
description: "Admin changelog page — source file, data structures (CHANGELOG + CHANGELOG_NEXT), badge types, version history, and What's Next items"
metadata: 
  node_type: memory
  type: project
  originSessionId: c2e2b131-943a-4529-9b93-587d19591065
---

## Location

- **Source file:** `js/modules/changelog/changelog.js` (Phase 14, 2026-06-07)
- **View:** `id="view-changelog"` — contains `<div id="changelogContent"></div>`
- **Sidebar:** between バックアップ and the その他 section; `data-view="changelog"`
- **Render function:** `renderChangelog()` — called by `go('changelog')`

## Page layout (top → bottom)

1. Header panel — "変更履歴" + version/entry counts
2. **次のバージョン予定** panel (purple-accented) — reads `CHANGELOG_NEXT`
3. "リリース済み" section label
4. One panel per version — reads `CHANGELOG` (newest-first)

## CHANGELOG data structure

```js
// const CHANGELOG = [ ... ] — newest entry first
{
  version: 'v3.0',
  date: '2026-06-04',
  label: '最新',          // optional — only on the newest entry
  entries: [
    { type: 'feat'|'improve'|'fix', text: '...' }
  ]
}
```

To add a new version: prepend to the array, move `label:'最新'` to the new entry.

## CHANGELOG_NEXT data structure

```js
// const CHANGELOG_NEXT = [ ... ] — unordered planned items
{ priority: 'high'|'medium'|'low', text: '...' }
```

To update planned items: edit `CHANGELOG_NEXT` directly. When a planned item ships, remove it from `CHANGELOG_NEXT` and add it to the new `CHANGELOG` entry.

## Badge types

### Release history (`CL_TYPE`)
| `type` | Label | Colour |
|---|---|---|
| `feat` | 新機能 | Blue |
| `improve` | 改善 | Green |
| `fix` | バグ修正 | Red |

### What's Next (`CL_PRIORITY`)
| `priority` | Label | Colour |
|---|---|---|
| `high` | 優先度：高 | Red |
| `medium` | 優先度：中 | Amber |
| `low` | 優先度：低 | Gray |

## Version history (as of 2026-06-07)

| Version | Date | Highlights |
|---|---|---|
| v4.0 | 2026-06-07 | Phase 14 modular architecture: admin-ui.js (5,543 lines) split into 30 files across js/core/, js/utils/, js/modules/; EventBus, AdminState, Validators, Storage, DOM utils added |
| v3.6 | 2026-06-07 | PDF direct download for all 11 print functions (Phase 12) |
| v3.5 | 2026-06-07 | Removed ウェブサイト管理 (Phase 11) — all WC code + contentService.js deleted |
| v3.4 | 2026-06-06 | StatisticsService query reduction (22→9 Supabase requests); bug fixes for KPI cache, cancel listener, Realtime dedup |
| v3.3 | 2026-06-05 | Force-password-change gate; login pre-flight banner; HealthCheck system; システム健全性 page |
| v3.2 | 2026-06-04 | Email notification integration (EmailJS, settings page, triggers) |
| v3.1 | 2026-06-04 | LINE Notify integration (settings page, triggers, log); changelog What's Next section |
| v3.0 | 2026-06-04 | 11 print functions; analytics upgrade (KPI/filter/charts/CSV/print); disposal CRUD; bug fixes |
| v2.5 | 2026-06-03 | Customer management; media library; review management redesign; backup center |
| v2.0 | 2026-06-02 | Hero editor; services/FAQ/company/footer editors; quote-to-booking conversion |
| v1.5 | 2026-06-01 | Calendar management; pricing; capacity settings; quick actions; initial analytics |
| v1.0 | 2026-05-30 | Initial release: login, dashboard, bookings, quotes, CSV, dark mode |

## What's Next items (as of 2026-06-04, 9 items)

| Priority | Item |
|---|---|
| 高 | メール通知（新規予約・見積り） |
| 中 | PDF直接出力 |
| 中 | Google カレンダー同期 |
| 中 | 一括操作（複数選択・ステータス変更） |
| 中 | ダッシュボードカスタマイズ |
| 中 | 英語管理画面対応 |
| 低 | 自動フォローアップメール |
| 低 | スタッフ管理・権限レベル |
| 低 | PWA対応 |

Note: LINE通知連携 shipped in v3.1 — removed from What's Next. See [[admin-line-notify]].
