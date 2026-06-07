---
name: admin-print-functions
description: "All 11 print functions in admin — source file locations after Phase 14, which page/modal each covers, button location, content, page orientation"
metadata: 
  node_type: memory
  type: project
  originSessionId: c2e2b131-943a-4529-9b93-587d19591065
---

## Source files (Phase 14 — 2026-06-07)

Print functions moved out of `admin-ui.js` into domain modules. `_capturePrintHtml` and `_pdfDownload` are in `js/utils/pdf.js`.

| Function | Source file |
|---|---|
| `printBooking(id)` | `admin-bookings.js` |
| `printQuote(id)` | `js/modules/quotes/quotes.js` |
| `printReview(id)` | `js/modules/reviews/reviewsEditor.js` |
| `printCustomer(id)` | `js/modules/customers/customers.js` |
| `printReport()` | `js/modules/backup/csvReport.js` |
| `printAnalytics()` | `admin-analytics.js` |
| `printBackup()` | `js/modules/backup/csvReport.js` |
| `printPricing()` | `js/modules/pricing/pricing.js` |
| `printDisposal()` | `js/modules/disposal/disposal.js` |
| `printCapacity()` | `js/modules/capacity/capacity.js` |
| `printCalendar()` | `js/modules/calendar/calendar.js` |

Every print function opens a standalone HTML window (`window.open`), auto-triggers `window.print()` after 350 ms, and self-closes via `onafterprint`. All share the same Hello Moving brand header (green H mark, navy brand name) and identical footer (studio name left, email right). Popup-blocked case shows a toast.

## Print functions

| Function | Button location | Print document title | Page size |
|---|---|---|---|
| `printBooking(id)` | Detail modal footer (between 閉じる and 編集) | 予約確認書 | A4 portrait |
| `printQuote(id)` | Quotes table row actions (between 予約化 and delete) | 見積り確認書 | A4 portrait |
| `printReview(id)` | Reviews table row actions (before delete, all 3 tabs) | レビュー確認 | A4 portrait |
| `printCustomer(id)` | Customer profile modal footer (between 閉じる and 顧客を削除) | 顧客プロフィール | A4 portrait |
| `printReport()` | Report modal footer + Quick Actions tile (売上レポートを印刷) | 売上レポート | A4 portrait |
| `printAnalytics()` | Analytics filter bar (beside CSV出力) | 分析レポート | A4 portrait |
| `printBackup()` | Backup page エクスポート panel header (状況を印刷) | システム状況レポート | A4 portrait |
| `printPricing()` | Pricing page panel header (beside 保存するとサイトに即時反映されます) | 料金表 | A4 **landscape** |
| `printDisposal()` | Disposal page header panel (beside カテゴリを追加) | 不用品処分料金表 | A4 portrait |
| `printCapacity()` | Capacity page panel header | 容量設定レポート | A4 portrait |
| `printCalendar()` | Calendar controls toolbar (before 全リセット) | 空き状況カレンダー | A4 **landscape** |

## Content per function

- **printBooking** — status pill (colour-coded), details table (service/date/time/name/email/from/to/notes/received), ご確認事項 notice box
- **printQuote** — amber "受付済み" badge, details table (name/email/service/moveDate/time/from/to/notes/received), お見積りについて green notice box
- **printReview** — status pill (pending/approved/rejected), star rating row (★☆), headline, quoted body text, metadata table (service/date_label/source/published/bookingId/createdAt); empty fields skipped
- **printCustomer** — avatar initial tile, 4 stat cards (総/完了/対応中/キャンセル), contact details table, full booking history table
- **printReport** — 4 KPI cards, status-breakdown table, 予約概況 table, service-by-service table; reuses same data as `generateReport()`
- **printAnalytics** — uses `_analyticsData()` helper (shared with `exportAnalyticsCSV`); KPI cards with period label, time-series table (daily/weekly/monthly adaptive), service bar chart (CSS div bars), booking list on page-break sheet; respects active period filter
- **printBackup** — 4 top KPI cards, status-by-status grid, review breakdown, price snapshot table, disposal summary; reads all Adapter stores
- **printPricing** — matrix table: rows = 5 fee fields, columns = 4 services; disclaimer box; reads live from `Adapter.getPrices()` + `PRICING_SERVICES`/`PRICING_FIELDS`
- **printDisposal** — 3 KPI cards, per-category section with item tables (name/fee/有効|無効 pill), total bar at bottom; reads `Adapter.getDisposal()` + `calcDisposalTotal()`
- **printCapacity** — 3 settings cards, 60-day availability summary (○/△/× counts), 60-row day-by-day table with status pills; reads `Adapter.getCapacity()` + `Adapter.getAvail()`
- **printCalendar** — 5 summary cards, full month grid (7-col, day cells with status label + booking count, today border, past fades, weekend colours); reads `_calV` for current month, `Adapter.getAvail()`, `Adapter.getBookings()`

## Shared helper

`_analyticsData()` — shared by `exportAnalyticsCSV` and `printAnalytics`; computes period-filtered KPIs, time-series rows, service rows from `getAnalyticsRange()`.

## Why: design notes

- All print windows use system fonts (`-apple-system,'Hiragino Sans','Meiryo'`) for reliable Japanese rendering without web-font load delay
- `printPricing` and `printCalendar` use landscape because their tables are wider than portrait
- `printAnalytics` uses CSS div bars (not canvas) for service chart — canvas doesn't print reliably across all browsers
