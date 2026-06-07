---
name: MASTER_ROADMAP
description: "Complete project roadmap — all phases, architecture, services, deployment and integration status, remaining work"
metadata:
  type: project
---

# Hello Moving — Master Roadmap

> **Update rule:** After every completed phase, prepend it to the Phase History table, move it from Remaining to Completed, and update any status tables that changed.
> Last updated: 2026-06-07 (Phase 16)

---

## Project identity

| Field | Value |
|---|---|
| Name | Hello Moving (ハローム―ビング) |
| Type | Premium Japanese minimalist moving company |
| Market | Tokyo metro area |
| Language | Japanese primary; English secondary |
| License | 第 431320058126 号 (国土交通省 認可) |
| Stack | No-build: plain HTML/CSS/JS, Supabase backend |
| Repo | github.com/Siiid01983/my-wesite |
| Dev server | `node serve.js` → http://localhost:5050 |

---

## Surfaces

| Surface | Entry point | Purpose |
|---|---|---|
| Public site | `index.html` + `styles.css` | Customer-facing marketing + booking quote form |
| Admin panel | `admin.html` + `js/**` modules | Internal management: bookings, calendar, pricing, content |
| Public review form | `admin.html#review` | Customer-submitted reviews after move completion |
| Print/PDF pages | Popup windows from admin | Booking confirmations, reports, price sheets |

---

## Architecture (current — Phase 14)

Four-layer JS stack. All code is browser globals. No bundler, no ES modules.

```
admin.html          HTML + CSS only (no inline JS since Phase 14)
│
├── js/services/    Infrastructure (loads first)
│   ├── supabaseClient.js     window.SupabaseClient
│   ├── supabaseAdapter.js    window.Adapter  ← ALL domain writes go here
│   ├── statisticsService.js  window.StatisticsService
│   ├── fallbackLogger.js     window.FallbackLogger
│   ├── dataProvider.js       window.DataProvider
│   ├── healthCheck.js        window.HealthCheck
│   └── serviceRegistry.js    window.Services  ← loads last (after all layers)
│
├── js/core/        Core layer
│   ├── auth.js          window.Auth — login, session, lockout
│   ├── navigation.js    go(), _dpSync(), VIEW_TITLES, calcStats, toggleDark
│   ├── appBootstrap.js  init(), showLogin/App/ForceChange, event listeners, startup IIFE
│   ├── eventBus.js      window.EventBus — typed CustomEvent wrapper
│   └── stateManager.js  window.AdminState — reactive ephemeral UI state
│
├── js/utils/       Shared utilities
│   ├── formatters.js  MN, DN, pad, fmtD, fmtDT, genId, esc, badge, toast
│   ├── dom.js         $id, $html, $show, $hide, $delegate
│   ├── pdf.js         _capturePrintHtml, _pdfDownload, all downloadPDF* fns
│   ├── storage.js     window.Storage — type-safe localStorage helpers
│   └── validators.js  window.Validators — required, email, bookingId, starRating, url
│
├── admin-bookings.js   CalendarService, BookingService, buildTable, emptyHTML
├── admin-analytics.js  renderAnalytics, drawBarChart, _DOW_JP
│
└── js/modules/     Feature modules (20 domain folders)
    ├── dashboard/      renderDash, renderStatGrid, BI panels
    ├── calendar/       renderCalendar, calClick, bulk select, printCalendar
    ├── capacity/       loadCapacity, saveCapacity, printCapacity
    ├── pricing/        renderPricing, savePricing, printPricing
    ├── disposal/       renderDisposal, category/item CRUD, printDisposal
    ├── quotes/         renderQuotes, convertToBooking, printQuote
    ├── services/       renderServices, saveServicesAll, live preview
    ├── hero/           renderHero, saveHero, media picker, version history
    ├── reviews/        renderReviews, approve/reject/publish, printReview
    ├── footer/         renderFooter, saveFooterAll, live preview
    ├── company/        renderCompany, saveCompanyAll, live preview
    ├── faq/            renderFaq, saveFaqAll, public review form fns
    ├── backup/         export JSON/CSV, import, printBackup
    │   └── csvReport/  exportCSV, generateReport, printReport
    ├── notifications/
    │   ├── email.js    sendEmailNotif, renderEmail, saveEmailSettings
    │   └── line.js     sendLineNotif, renderLine, saveLineSettings
    ├── changelog/      CHANGELOG + CHANGELOG_NEXT arrays, renderChangelog
    ├── customers/      renderCustomers, openCustModal, printCustomer
    ├── media/          MediaLib, upload, preview, delete
    └── security/       renderSecurity, renderHealth, _applyAppHealthBanner
```

### Script loading order (admin.html)

```
1. js/lib/supabase.js → js/config/appConfig.js → js/config/env.js
2. js/services/supabaseClient → supabaseAdapter → statisticsService
   → fallbackLogger → dataProvider → healthCheck
3. js/core/auth → eventBus → stateManager
4. js/utils/formatters → dom → storage → validators → pdf
5. CDN: html2canvas, jsPDF
6. admin-bookings.js → admin-analytics.js
7. js/core/navigation.js
8. js/modules/** (20 files, any order relative to each other)
9. js/services/serviceRegistry.js
10. js/core/appBootstrap.js  ← MUST be last
```

---

## Supabase integration status

| Feature | Status | Notes |
|---|---|---|
| Connection | ✅ Live | Via `window.SupabaseClient` singleton |
| Bookings table | ✅ Live | Read + write via `Adapter` |
| Calendar availability | ✅ Live | Read + write via `Adapter` |
| Reviews table | ✅ Live | Read + write via `Adapter` |
| Services table | ✅ Live | Read + write via `Adapter` |
| hm_data key-value store | ✅ Live | Prices, hero, FAQ, footer, company, capacity, disposal |
| Realtime subscriptions | ✅ Live | Bookings + calendar channels; auto-reconnect |
| Offline fallback | ✅ Live | DataProvider → localStorage cache when Supabase unreachable |
| TTL cache | ✅ Live | Per-table TTLs (2–10 min); invalidated on write |
| Retry + backoff | ✅ Live | Exponential backoff, jitter, 4 attempts max |
| HealthCheck probe | ✅ Live | Runs at startup; drives login banner + in-app banner |
| StatisticsService (BI) | ✅ Live | Supabase COUNT queries for dashboard KPIs |

---

## Admin dashboard status

| Section | Sidebar label | Status | Module file |
|---|---|---|---|
| Dashboard | ダッシュボード | ✅ Complete | `modules/dashboard/dashboard.js` |
| Bookings | 予約管理 | ✅ Complete | `admin-bookings.js` |
| Customers | 顧客管理 | ✅ Complete | `modules/customers/customers.js` |
| Quotes | 見積り管理 | ✅ Complete | `modules/quotes/quotes.js` |
| Reviews | レビュー管理 | ✅ Complete | `modules/reviews/reviewsEditor.js` |
| Services editor | サービス管理 | ✅ Complete | `modules/services/servicesEditor.js` |
| FAQ editor | FAQ編集 | ✅ Complete | `modules/faq/faq.js` |
| Company editor | 会社情報編集 | ✅ Complete | `modules/company/company.js` |
| Footer editor | フッター編集 | ✅ Complete | `modules/footer/footer.js` |
| Hero editor | ヒーロー編集 | ✅ Complete | `modules/hero/hero.js` |
| Calendar | カレンダー管理 | ✅ Complete | `modules/calendar/calendar.js` |
| Analytics | 分析 | ✅ Complete | `admin-analytics.js` |
| BI Dashboard | (within Dashboard) | ✅ Complete | `modules/dashboard/dashboard.js` |
| Media library | メディアライブラリ | ✅ Complete | `modules/media/media.js` |
| Capacity settings | 容量設定 | ✅ Complete | `modules/capacity/capacity.js` |
| Pricing | 料金管理 | ✅ Complete | `modules/pricing/pricing.js` |
| Disposal | 不用品管理 | ✅ Complete | `modules/disposal/disposal.js` |
| Quick actions | クイック操作 | ✅ Complete | `admin.html` (static HTML) |
| Backup center | バックアップ | ✅ Complete | `modules/backup/backup.js` + `csvReport.js` |
| Email notifications | メール通知設定 | ✅ Complete | `modules/notifications/email.js` |
| LINE notifications | LINE通知設定 | ✅ Complete | `modules/notifications/line.js` |
| Changelog | 変更履歴 | ✅ Complete | `modules/changelog/changelog.js` |
| Security | セキュリティ | ✅ Complete | `modules/security/security.js` |
| System health | システム健全性 | ✅ Complete | `modules/security/security.js` |

---

## Deployment status

| Item | Status | Notes |
|---|---|---|
| GitHub repo | ✅ Live | github.com/Siiid01983/my-wesite (main branch) |
| Netlify deploy | ❓ Unknown | .netlify folder gitignored; assumed connected but unverified |
| Supabase project | ✅ Live | Credentials in `js/config/env.js` (gitignored) |
| Formspree | ✅ Live | Endpoint: `https://formspree.io/f/xdajqzlo` |
| LINE Notify | ✅ Integrated | Token + CORS proxy configured by admin user |
| EmailJS | ✅ Integrated | Service/template/key configured by admin user |
| Custom domain | ❓ Unknown | Not confirmed in codebase |

---

## Public site integrations

| Integration | Detail |
|---|---|
| Quote form submission | Formspree `https://formspree.io/f/xdajqzlo` |
| LINE CTA | `https://line.me/R/ti/p/~hellomoving` |
| License number | 第 431320058126 号 (in trust strip, company table, footer) |
| Fonts | Noto Sans JP + Inter (Google Fonts) |
| Calendar (public) | `calendarService.js` reads `hm_booked` from localStorage |

---

## Services (current lineup — June 2026)

Order matters. Emergency card is first and full-width featured.

| # | Service name | Notes |
|---|---|---|
| 1 | 当日・お急ぎ引越しプラン | Featured card (full-width, amber, embedded CTAs) |
| 2 | 単身引越し | — |
| 3 | カップル・ご夫婦引越し | — |
| 4 | 学生・新生活引越し | — |
| 5 | 不用品回収・処分サービス | — |
| 6 | 家具組立・分解 | — |

Removed (June 2026): オフィス・法人移転, 外国人向け引越し.

---

## Phase history

| Phase | Commit | Date | What was built |
|---|---|---|---|
| 16 | `fcae0a9` | 2026-06-07 | Google Calendar sync: GCalSync module; OAuth 2.0 via GIS; push (date status → GCal event); pull (all-day GCal events → block admin dates); sync panel in calendar view with connection status, log, settings |
| 15 | `7ceb33c` | 2026-06-07 | Bulk operations: multi-select checkboxes on bookings table; batch status change; select-all / deselect-all; bulk delete with confirmation |
| 14 | `0b73573` | 2026-06-07 | Modular architecture: admin-ui.js (5,543 lines) split into 30 files; js/core/, js/utils/, js/modules/ created; EventBus, AdminState, Validators, Storage, DOM utils added |
| 13 | — | 2026-06-06 | BI Dashboard: Phase 13 revenue/trend/service/customer/operational panels; StatisticsService query reduction (22→9 Supabase requests) |
| 12 | `8c3eac9` | 2026-06-07 | PDF direct download: all 11 print functions get downloadPDF* button via html2canvas + jsPDF |
| 11 | `1ebdbe8` | 2026-06-07 | Removed ウェブサイト管理 feature: all WC code + contentService.js deleted |
| 10 | — | 2026-06-05 | Security hardening: force-password-change gate; HealthCheck system; login pre-flight banner; システム健全性 page; in-app health banner |
| 9 | — | 2026-06-04 | Email notifications: EmailJS REST API integration; settings page; 4 trigger types; send log |
| 8 | — | 2026-06-04 | CLAUDE.md — codebase guide (this file's ancestor) |
| 7 | `0a9c11d` | — | 20-case DataProvider unit test suite (node:test + Playwright headless) |
| 6 | `84ecfdf` | — | DataProvider retry: exponential backoff, jitter, 4 attempts, per-status retry policy |
| 5 | `0f644c8` | — | Admin dashboard observability: システム監視 panel with cache hit rate, latency, sync age, fallback log count, per-table cache status |
| 4 | `7a96f1c` | — | DataProvider TTL cache: per-table TTLs, cache invalidation on writes, HM_CONFIG.CACHE_TTL overrides |
| 3 | `57b4748` | — | Auth hardening: salted SHA-256, constant-time comparison, session token rotation, exponential lockout backoff |
| 2 | `675da50` | — | Admin syncs connected to DataProvider via _dpSync pattern |
| 1 | `14af5d5` | — | Infrastructure: appConfig, fallbackLogger, dataProvider, serviceRegistry |
| 0 | — | 2026-05-30 | Initial release: login, dashboard, bookings, quotes, CSV export, dark mode |

---

## Remaining work & priorities

### High priority

| Item | Notes |
|---|---|
| PWA support | Offline admin access; service worker |


### Medium priority

| Item | Notes |
|---|---|
| Dashboard customisation | Drag-and-drop panel layout; user-defined KPI selection |
| Auto follow-up emails | Triggered X days after 完了 status |
| English admin UI | i18n toggle for non-Japanese admin users |
| Staff management | Role-based access levels (admin / staff / read-only) |

### Low priority / nice to have

| Item | Notes |
|---|---|
| Netlify deploy verification | Confirm deployment pipeline; add status badge to README |
| Custom domain confirmation | Verify domain configuration |
| `window.Storage` rename | Currently collides with browser's native Storage interface; rename to `HMStorage` |
| Test coverage expansion | Cover auth module, module render functions (currently DataProvider only) |

---

## Key constraints (never violate)

- **No build step** — plain `<script>` tags only; no bundler, no transpiler
- **All functions are globals** — HTML onclick= handlers require this; no IIFE wrapping that hides functions
- **Adapter is the only write path** — never write domain data directly to localStorage or Supabase; always go through `Adapter.*`
- **appBootstrap.js loads last** — the startup IIFE is there; moving it breaks init
- **_DOW_JP lives in admin-analytics.js** — used by `printCapacity` in capacity.js; analytics must load first
- **buildTable / emptyHTML live in admin-bookings.js** — used by dashboard.js; bookings must load first
- **No redesign** — preserve Japanese minimalist aesthetic; no new color families or font families
- **env.js is gitignored** — never commit Supabase credentials

---

## Memory file index

| File | What it covers |
|---|---|
| `MASTER_ROADMAP.md` | This file — complete project status |
| `MEMORY.md` | Index of all memory files |
| `project-overview.md` | Stack, design system, Phase 14 architecture summary |
| `admin-architecture.md` | Full module → function map; loading constraints |
| `admin-changelog.md` | Changelog page data structures, version history, What's Next |
| `admin-line-notify.md` | LINE Notify integration: source file, Adapter keys, trigger points |
| `admin-print-functions.md` | 11 print functions: source files, button locations, content |
| `admin-phase11-webcontent.md` | Phase 11 removal record |
| `project-services.md` | Current 6-service lineup |
| `project-integrations.md` | Formspree, LINE link, license number, compact-calendar class |
| `project-optimization-2026-06.md` | June 2026 CRO/UX/SEO/CSS pass — all changes applied |
