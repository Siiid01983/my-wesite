# Hello Moving — Codebase Guide

## Project overview

Hello Moving is a premium Japanese minimalist moving company website.
It has two distinct surfaces:

| Surface | Files | Purpose |
|---|---|---|
| **Public site** | `index.html`, `styles.css`, `script.js`, `bookingService.js`, `calendarService.js` | Customer-facing marketing + booking form |
| **Admin panel** | `admin.html` + `js/` modules | Single-page admin for bookings, calendar, pricing, reviews, content editing |

The stack is deliberately no-build: plain `<script>` tags, no bundler, no framework.
All JavaScript runs as browser globals.

---

## Repository layout

```
my-website/
├── index.html              # Public site
├── admin.html              # Admin panel — HTML structure + CSS only (no inline JS)
├── admin-bookings.js       # CalendarService, BookingService, bookings UI
├── admin-analytics.js      # Analytics view, chart drawing, _DOW_JP global
├── styles.css              # Public site styles
├── script.js               # Public site JS (calendar, quote form, etc.)
├── bookingService.js       # Booking form submission + Supabase write
├── calendarService.js      # Public calendar availability reader
├── review.html             # Public review submission page
├── admin-reviews.html      # Admin reviews print page
│
├── js/
│   ├── config/
│   │   ├── appConfig.js        # window.HM_CONFIG — runtime config object
│   │   ├── env.js              # Supabase credentials (gitignored)
│   │   └── env.example.js      # Credentials template
│   │
│   ├── lib/
│   │   └── supabase.js         # Supabase UMD bundle (local copy)
│   │
│   ├── services/               # Infrastructure layer (Phases 1–8)
│   │   ├── supabaseClient.js   # window.SupabaseClient singleton
│   │   ├── supabaseAdapter.js  # window.Adapter — domain CRUD layer
│   │   ├── statisticsService.js# window.StatisticsService — BI dashboard stats
│   │   ├── fallbackLogger.js   # window.FallbackLogger — localStorage event log
│   │   ├── dataProvider.js     # window.DataProvider — generic CRUD + cache + retry
│   │   ├── serviceRegistry.js  # window.Services — central service locator
│   │   └── healthCheck.js      # window.HealthCheck — Supabase connectivity probe
│   │
│   ├── core/                   # Phase 14 — Core layer
│   │   ├── auth.js             # window.Auth — salted hash, session, lockout
│   │   ├── navigation.js       # go(), VIEW_TITLES, _dpSync, toggleDark, calcStats
│   │   ├── appBootstrap.js     # init(), showLogin/App/ForceChange, event listeners, startup IIFE
│   │   ├── eventBus.js         # window.EventBus — typed CustomEvent wrapper
│   │   └── stateManager.js     # window.AdminState — reactive key/value state container
│   │
│   ├── utils/                  # Phase 14 — Reusable utilities
│   │   ├── formatters.js       # MN, DN, pad, fmtD, fmtDT, genId, esc, badge, toast
│   │   ├── dom.js              # $id, $html, $show, $hide, $delegate DOM helpers
│   │   ├── pdf.js              # _capturePrintHtml, _pdfDownload, all downloadPDF* fns
│   │   ├── storage.js          # window.Storage — type-safe localStorage helpers
│   │   └── validators.js       # window.Validators — required, email, bookingId, url, etc.
│   │
│   └── modules/                # Phase 14 — Feature modules (one domain per folder)
│       ├── dashboard/
│       │   ├── dashboard.js         # renderDash, renderStatGrid, BI panels, renderQA
│       │   ├── dashboardLayout.js   # window.DashboardLayout — widget order/visibility (hm_dashboard_layout)
│       │   ├── dashboardCustomizer.js # window.DashboardCustomizer — settings modal, applyLayout()
│       │   ├── dashboardReorder.js  # window.DashboardReorder — HTML5 DnD, #dashOrderContainer slots
│       │   ├── kpiManager.js        # window.KPIManager — stat-card visibility (hm_dashboard_kpis)
│       │   └── dashboardProfiles.js # window.DashboardProfiles — Owner/Ops/Marketing presets (hm_dashboard_profiles)
│       ├── calendar/
│       │   └── calendar.js     # renderCalendar, calClick, bulk select, printCalendar
│       ├── capacity/
│       │   └── capacity.js     # loadCapacity, saveCapacity, printCapacity
│       ├── pricing/
│       │   └── pricing.js      # renderPricing, savePricing, printPricing
│       ├── disposal/
│       │   └── disposal.js     # renderDisposal, category/item CRUD, printDisposal
│       ├── quotes/
│       │   └── quotes.js       # renderQuotes, deleteQuote, convertToBooking, printQuote
│       ├── services/
│       │   └── servicesEditor.js # renderServices, service CRUD, live preview, history
│       ├── hero/
│       │   └── hero.js         # renderHero, saveHero, badge editor, media picker
│       ├── reviews/
│       │   └── reviewsEditor.js# renderReviews, approve/reject, public review form fns
│       ├── footer/
│       │   └── footer.js       # renderFooter, saveFooterAll, live preview, history
│       ├── company/
│       │   └── company.js      # renderCompany, row CRUD, live preview, history
│       ├── faq/
│       │   └── faq.js          # renderFaq, item CRUD, live preview, public review form
│       ├── backup/
│       │   ├── backup.js       # exportBookingsJSON, exportFullBackup, handleImport
│       │   └── csvReport.js    # exportCSV, importCSV, generateReport, printReport
│       ├── notifications/
│       │   ├── email.js        # sendEmailNotif, renderEmail, saveEmailSettings
│       │   └── line.js         # sendLineNotif, renderLine, saveLineSettings
│       ├── changelog/
│       │   └── changelog.js    # CHANGELOG array, renderChangelog
│       ├── customers/
│       │   └── customers.js    # renderCustomers, openCustModal, printCustomer
│       ├── media/
│       │   └── media.js        # MediaLib, renderMedia, upload, preview
│       ├── security/
│       │   └── security.js     # renderSecurity, renderHealth, _applyAppHealthBanner
│       ├── invoices/
│       │   └── invoices.js     # window.InvoiceManager — generate, preview modal, PDF download (hm_invoices)
│       ├── search/
│       │   └── globalSearch.js # window.GlobalSearch — Ctrl+K overlay, multi-type search, keyboard nav
│       ├── audit/
│       │   └── auditLog.js     # window.AuditLog — ring buffer, Adapter patches, 監査ログ view (hm_audit_log)
│       ├── mobile/
│       │   ├── mobileNav.js      # window.MobileNav — drawer, bottom-nav (5 items), swipe gestures, quick-bar, setBadge()
│       │   └── mobileDash.js     # window.MobileDash — 5 mobile stat cards injected into dashboard; push-permission banner
│       ├── offline/
│       │   ├── offlineDB.js      # window.OfflineDB — IndexedDB hm_offline_db wrapper (bookings/calendar/quotes/action_queue)
│       │   └── offlineQueue.js   # window.OfflineQueue — localStorage write queue; drain on reconnect; offline banner
│       ├── camera/
│       │   └── cameraCapture.js  # window.CameraCapture — Canvas compress (1200px/0.82q); camera+gallery capture; MediaLib upload; hm_camera_photos fallback
│       └── analytics/
│           ├── analyticsEngine.js    # window.AnalyticsEngine — linearRegression, movingAverage, detectAnomalies, forecastNext, aggregateMonthly
│           ├── revenueForecast.js    # window.RevenueForecast — 3-month revenue projection via linear regression
│           ├── servicePerformance.js # window.ServicePerformance — composite score (volume 40% + revenue 40% + growth 20%)
│           ├── customerInsights.js   # window.CustomerInsights — CLV, churn risk, cohort, repeat rate
│           ├── conversionAnalytics.js# window.ConversionAnalytics — quote→booking funnel, time-to-convert, per-service rates
│           ├── analyticsWidgets.js   # window.AnalyticsWidgets — demand forecast chart, DOW heatmap, insight cards
│           ├── analyticsUI.js        # window.AnalyticsUI — wraps renderAnalytics(), injects #analyticsAdvanced section
│           ├── analyticsCache.js     # window.AnalyticsCache — 5-min TTL localStorage cache (hm_analytics_cache)
│           ├── bookingTrends.js      # window.BookingTrends — daily/weekly/monthly trends, growth%, peak detection
│           ├── analyticsExport.js    # window.AnalyticsExport — CSV exports: revenueForecast/serviceRankings/customerMetrics + AuditLog
│           └── analyticsDashboard.js # window.AnalyticsDashboard — 高度分析 page, widget registry init, go() wrap, tab routing
│
├── wmc/wmcDashboard.html  # Phase 28 — WMC: HTML + CSS only (no inline JS beyond lean navigation/auth/startup)
│
├── js/modules/website/     # Phase 28 — WMC modules
│   ├── wmcCore.js          # window.WMCPermissions — 3-tier RBAC (admin/staff/readonly); _padZ, _wmcFmtRelative shared utils
│   ├── wmcPermissions.js   # Section 10: permission matrix, role simulation, WMC user management
│   ├── wmcOverview.js      # Dashboard overview, SEO score, health cards, refresh, adapter timestamp patch
│   ├── wmcPages.js         # Pages view with permission-aware delete/publish controls
│   ├── wmcBlog.js          # Blog post create/edit/delete with role checks
│   ├── wmcSeo.js           # SEO settings view
│   ├── wmcTheme.js         # Section 8: theme customizer, live preview, CSS generation, apply to site
│   └── wmcDeploy.js        # Section 9: deployment info cards, export/import/backup, version tracking, deploy log
│
├── mobile.css              # Phase 27A — mobile-first enhancements (bottom-nav, drawer, 44px targets, camera modal, offline banner)
│
├── tests/
│   └── dataProvider.test.js    # 20-case unit test suite (node:test + Playwright)
│
├── package.json            # Dependencies: playwright, @supabase/supabase-js
└── serve.js                # Local dev server on :5050
```

---

## Script loading order

**Order matters — do not reorder.** Dependencies are resolved at call-time (lazy), but
top-level initialisation code in each file must see its dependencies already defined.

### admin.html

```
Infrastructure (Supabase → config → services)
  js/lib/supabase.js
  js/config/appConfig.js
  js/config/env.js
  js/services/supabaseClient.js
  js/services/supabaseAdapter.js      ← sets window.Adapter
  js/services/statisticsService.js    ← sets window.StatisticsService
  js/services/fallbackLogger.js       ← sets window.FallbackLogger
  js/services/dataProvider.js         ← sets window.DataProvider
  js/services/healthCheck.js          ← sets window.HealthCheck

Core layer
  js/core/auth.js                     ← sets window.Auth
  js/core/eventBus.js                 ← sets window.EventBus
  js/core/stateManager.js             ← sets window.AdminState

Utilities
  js/utils/formatters.js              ← globals: MN, DN, pad, fmtD, esc, badge, toast, …
  js/utils/dom.js                     ← globals: $id, $html, $show, …
  js/utils/storage.js                 ← sets window.Storage
  js/utils/validators.js              ← sets window.Validators
  js/utils/pdf.js                     ← globals: _pdfDownload, downloadPDF*, …

CDN (html2canvas, jsPDF)

Data modules (define _DOW_JP and buildTable used by later modules)
  admin-bookings.js                   ← CalendarService, BookingService, buildTable, emptyHTML
  admin-analytics.js                  ← renderAnalytics, drawBarChart, _DOW_JP

Core navigation (lazy — all render fns resolved at call-time)
  js/core/navigation.js               ← go(), _dpSync, VIEW_TITLES

Feature modules — dashboard customisation chain (MUST load in this order)
  js/modules/dashboard/dashboardLayout.js    ← storage API; no DOM dependency
  js/modules/dashboard/dashboard.js          ← defines renderDash, renderStatGrid
  js/modules/dashboard/dashboardCustomizer.js← patches renderDash (1st wrapper)
  js/modules/dashboard/dashboardReorder.js   ← patches renderDash (2nd wrapper)
  js/modules/dashboard/kpiManager.js         ← patches renderDash + renderStatGrid (3rd wrapper)
  js/modules/dashboard/dashboardProfiles.js  ← patches renderDash (outermost wrapper)

Analytics BI modules (Phase 23 — must load after admin-analytics.js)
  js/modules/analytics/analyticsEngine.js    ← pure math, no dependencies
  js/modules/analytics/revenueForecast.js    ← depends on AnalyticsEngine
  js/modules/analytics/servicePerformance.js ← depends on AnalyticsEngine
  js/modules/analytics/customerInsights.js   ← depends on AnalyticsEngine
  js/modules/analytics/conversionAnalytics.js← depends on AnalyticsEngine
  js/modules/analytics/analyticsWidgets.js   ← depends on AnalyticsEngine + drawBarChart
  js/modules/analytics/analyticsUI.js        ← wraps renderAnalytics (outermost)
  js/modules/analytics/analyticsCache.js     ← 5-min browser cache; no deps
  js/modules/analytics/bookingTrends.js      ← depends on AnalyticsEngine + AnalyticsCache
  js/modules/analytics/analyticsExport.js    ← depends on all compute modules + AuditLog
  js/modules/analytics/analyticsDashboard.js ← wraps go(); registers widgets; must load last

Feature modules — remaining (any order relative to each other)
  js/modules/calendar/calendar.js
  js/modules/capacity/capacity.js
  js/modules/pricing/pricing.js
  js/modules/disposal/disposal.js
  js/modules/quotes/quotes.js
  js/modules/services/servicesEditor.js
  js/modules/hero/hero.js
  js/modules/reviews/reviewsEditor.js
  js/modules/footer/footer.js
  js/modules/company/company.js
  js/modules/faq/faq.js
  js/modules/backup/backup.js
  js/modules/backup/csvReport.js
  js/modules/notifications/email.js
  js/modules/notifications/line.js
  js/modules/changelog/changelog.js
  js/modules/customers/customers.js
  js/modules/media/media.js
  js/modules/security/security.js

Service registry (after all services + core + utils are loaded)
  js/services/serviceRegistry.js      ← populates window.Services

App bootstrap (must be last — contains the startup IIFE)
  js/core/appBootstrap.js
```

### index.html

```html
<script src="script.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<script src="js/config/appConfig.js"></script>
<script src="js/config/env.js"></script>
<script src="js/services/supabaseClient.js"></script>
<script src="js/services/fallbackLogger.js"></script>
<script src="js/services/dataProvider.js"></script>
<script src="js/services/serviceRegistry.js"></script>
<script src="bookingService.js"></script>
```

---

## Architecture layers (Phase 14)

The admin JS is split into four layers. All code is browser globals — no ES modules,
no bundler. Functions declared at the top level of any script file are accessible from all
subsequent scripts.

```
┌─────────────────────────────────────────────┐
│  admin.html  (HTML structure + CSS only)    │
├─────────────────────────────────────────────┤
│  js/core/    Auth · Navigation · Bootstrap  │  ← session, routing, startup
│              EventBus · StateManager        │  ← scaffolding for new code
├─────────────────────────────────────────────┤
│  js/utils/   formatters · dom · pdf         │  ← shared helpers, no domain logic
│              storage · validators           │
├─────────────────────────────────────────────┤
│  js/modules/ 20 domain folders              │  ← one file per admin section
├─────────────────────────────────────────────┤
│  js/services/ Adapter · DataProvider · …   │  ← Supabase, cache, fallback
└─────────────────────────────────────────────┘
```

### Key globals

| Global | File | Purpose |
|---|---|---|
| `Auth` | `js/core/auth.js` | Login, session, lockout |
| `go(view)` | `js/core/navigation.js` | Navigate between admin views |
| `_dpSync(...)` | `js/core/navigation.js` | Route page syncs through DataProvider |
| `toast(msg)` | `js/utils/formatters.js` | Show notification toast |
| `esc(s)` | `js/utils/formatters.js` | HTML-escape a string |
| `fmtD(ds)` | `js/utils/formatters.js` | Format ISO date to Japanese string |
| `EventBus` | `js/core/eventBus.js` | Typed CustomEvent wrapper |
| `AdminState` | `js/core/stateManager.js` | Reactive ephemeral UI state |
| `Validators` | `js/utils/validators.js` | Input validation helpers |
| `Adapter` | `js/services/supabaseAdapter.js` | Domain CRUD (all data writes go here) |
| `DataProvider` | `js/services/dataProvider.js` | Generic CRUD + TTL cache + retry |
| `Services` | `js/services/serviceRegistry.js` | Central service locator |
| `DashboardLayout` | `js/modules/dashboard/dashboardLayout.js` | Widget order + visibility storage (`hm_dashboard_layout`) |
| `DashboardCustomizer` | `js/modules/dashboard/dashboardCustomizer.js` | Widget visibility modal; `applyLayout()` |
| `DashboardReorder` | `js/modules/dashboard/dashboardReorder.js` | Drag-and-drop slot reordering; `applyOrder()` |
| `KPIManager` | `js/modules/dashboard/kpiManager.js` | Stat-card visibility by label matching (`hm_dashboard_kpis`) |
| `DashboardProfiles` | `js/modules/dashboard/dashboardProfiles.js` | Owner/Operations/Marketing presets (`hm_dashboard_profiles`) |
| `InvoiceManager` | `js/modules/invoices/invoices.js` | Invoice generate/preview/PDF; `hm_invoices` stores number per booking |
| `GlobalSearch` | `js/modules/search/globalSearch.js` | Ctrl+K search overlay across all local Adapter data |
| `AuditLog` | `js/modules/audit/auditLog.js` | Ring-buffer action log; patches Adapter writes; `hm_audit_log` |
| `AnalyticsEngine` | `js/modules/analytics/analyticsEngine.js` | Pure math: linearRegression, movingAverage, detectAnomalies, forecastNext, aggregateMonthly |
| `RevenueForecast` | `js/modules/analytics/revenueForecast.js` | 3-month revenue projection; `compute(bk)` → `{monthly, forecast, isGrowing, growthPct, confidence, anomalyMonths}` |
| `ServicePerformance` | `js/modules/analytics/servicePerformance.js` | Composite service score; `compute(bk)` → ranked array with score, growth, label |
| `CustomerInsights` | `js/modules/analytics/customerInsights.js` | CLV, churn risk, cohort; `compute(bk)` → `{avgCLV, atRiskCount, cohortList, repeatRate, topByClv}` |
| `ConversionAnalytics` | `js/modules/analytics/conversionAnalytics.js` | Quote→booking funnel; `compute(bk, qt)` → `{funnel, convRate, avgConvertH, svcRates, trend}` |
| `AnalyticsWidgets` | `js/modules/analytics/analyticsWidgets.js` | `renderDemandForecast`, `renderDowHeatmap`, `renderInsightCards` |
| `AnalyticsUI` | `js/modules/analytics/analyticsUI.js` | Wraps `renderAnalytics()`; injects `#analyticsAdvanced` div after `#analyticsExtra` |
| `AnalyticsCache` | `js/modules/analytics/analyticsCache.js` | 5-min TTL cache (`hm_analytics_cache`); auto-invalidates on booking events |
| `BookingTrends` | `js/modules/analytics/bookingTrends.js` | Daily/weekly/monthly series; `compute(bk)` → `{daily, weekly, monthly, dailyGrowth, weeklyGrowth, monthlyGrowth, peaks}` |
| `AnalyticsExport` | `js/modules/analytics/analyticsExport.js` | `revenueForecast()`, `serviceRankings()`, `customerMetrics()` CSV downloads + AuditLog |
| `AnalyticsDashboard` | `js/modules/analytics/analyticsDashboard.js` | 高度分析 page; registers all 5 widgets; wraps `go()`; `setTab(id)`, `refresh()` |

---

## Infrastructure layer (Phases 1–8)

### `js/config/appConfig.js` → `window.HM_CONFIG`

Global configuration object. Edit this file to change runtime behaviour.

```js
window.HM_CONFIG = {
  FORCE_FALLBACK: false,   // true → DataProvider always uses localStorage (useful for testing)
  LOG_FALLBACK:   true,    // false → FallbackLogger.log() is a no-op

  // Per-table cache TTL overrides in milliseconds.
  // Defaults: bookings/calendar_availability=2min, reviews=5min, services/hm_data=10min
  CACHE_TTL: {
    // bookings: 60000,   // example: override to 1 minute
  },

  // Retry config for transient Supabase failures (network blips, 429, 5xx).
  RETRY: {
    maxAttempts: 3,       // retries after the first attempt (total attempts = 4)
    baseDelayMs: 500,     // initial backoff delay
    maxDelayMs:  10000,   // backoff cap
    factor:      2,       // exponential multiplier per attempt
  },
};
```

---

### `js/services/fallbackLogger.js` → `window.FallbackLogger`

Persists fallback events to `localStorage` key `hm_fallback_log`. Max 50 entries (ring buffer).
Only writes when `HM_CONFIG.LOG_FALLBACK` is `true`.

```js
FallbackLogger.log(operation, table, error, success)
// operation: 'read' | 'write' | 'update' | 'delete' | 'sync'
// table: table name string
// error: Error object or null
// success: boolean

FallbackLogger.getAll()   // → [{ts, operation, table, error, success}, ...]
FallbackLogger.clear()    // → empties the log
```

---

### `js/services/dataProvider.js` → `window.DataProvider`

Generic Supabase-first CRUD layer with TTL cache, exponential-backoff retry, and metrics.

#### Read

```js
const { data, source, error } = await DataProvider.read(table, filters)
// filters: optional object of column:value equality filters
// source: 'supabase' | 'cache' | 'localStorage'
```

Cache behaviour:
- Fresh cache (within TTL) → returns immediately, **no Supabase call**
- Stale or missing cache → fetches Supabase with retry, caches result on success
- Supabase unreachable after retries → serves stale cache data as `source:'localStorage'`

#### Write / Update / Delete

```js
const { success, source, error } = await DataProvider.write(table, data)
const { success, source, error } = await DataProvider.update(table, id, patch)
const { success, source, error } = await DataProvider.delete(table, id)
// On Supabase success: cache is invalidated (ts=0), next read forces a fresh fetch
// On fallback: optimistic in-memory update applied to cached data
```

#### Cache management

```js
DataProvider.invalidate(table)    // mark one table's cache stale
DataProvider.clearAllCache()      // remove all hm_dp_* keys from localStorage
DataProvider.cacheStatus()
// → [{table, age_s, ttl_s, valid, rows}, ...]
```

#### Metrics

```js
DataProvider.getMetrics()
// → {reads, cacheHits, supabaseReads, fallbacks, retries, hitRate,
//    lastLatencyMs, lastSyncTs, lastRetryTs}

DataProvider.resetMetrics()       // zero all counters
```

#### Retry policy

| HTTP status | Retried? |
|---|---|
| No status (network error) | Yes |
| 429 rate limit | Yes |
| 500–599 server error | Yes |
| 400 bad request | No |
| 401 / 403 auth | No |
| 404 not found | No |

Backoff: `delay = min(baseDelayMs × factor^attempt, maxDelayMs) × jitter(±25%)`

#### Default TTLs

| Table | TTL |
|---|---|
| `bookings` | 2 min |
| `calendar_availability` | 2 min |
| `reviews` | 5 min |
| `services` | 10 min |
| `hm_data` | 10 min |
| (any other) | 5 min |

Override via `HM_CONFIG.CACHE_TTL = { bookings: 60000 }`.

---

### `js/services/serviceRegistry.js` → `window.Services`

Central service locator. Populated after all services, core, and utils are loaded.

```js
window.Services.Adapter           // → window.Adapter (domain CRUD)
window.Services.DataProvider      // → window.DataProvider (generic CRUD)
window.Services.StatisticsService // → window.StatisticsService (BI stats)
window.Services.Auth              // → window.Auth (session management)
window.Services.EventBus          // → window.EventBus (typed events)
window.Services.AdminState        // → window.AdminState (UI state)
window.Services.Validators        // → window.Validators (input validation)
window.Services.Storage           // → window.Storage (localStorage helpers)
```

---

### `js/services/supabaseAdapter.js` → `window.Adapter`

Domain-aware CRUD layer. Owns all localStorage keys and Supabase schema mappings.
**Do not bypass Adapter for domain writes** — it handles Japanese↔English status mapping,
data mappers (`sbToBooking`, `sbToReview`, etc.), and Realtime subscriptions.

Key methods (partial list):

```js
// Bookings
Adapter.getBookings()              // reads hm_admin_bookings
Adapter.addBooking(b)              // write-through: localStorage + Supabase
Adapter.updateBooking(id, patch)
Adapter.deleteBooking(id)
Adapter.syncBookings()             // pull fresh from Supabase → localStorage

// Availability
Adapter.getAvail()                 // reads hm_admin_avail
Adapter.setDate(date, status)      // 'booked' | 'available' | etc.
Adapter.syncAvailability()

// Prices, Disposal, Capacity, Hero, FAQ, Footer, Company, Services, Reviews
// Each follows: get*() / save*() / sync*() pattern

// Realtime
Adapter.initializeRealtime()       // subscribe to bookings + calendar channels
Adapter.destroyRealtime()          // unsubscribe (call on logout)

// One-time full sync (called on login)
Adapter.syncFromSupabase()
```

---

## Admin page sync pattern

Every admin view that pulls from Supabase uses `_dpSync()` (defined in `js/core/navigation.js`):

```js
async function _dpSync(table, filters, adapterFn, viewId, rerenderFn) {
  const { source } = await window.DataProvider.read(table, filters);
  // 'cache'        → data is fresh, skip Adapter sync
  // 'supabase'     → Supabase reachable, run Adapter sync for domain mapping
  // 'localStorage' → Supabase unreachable, FallbackLogger already logged it
  if (source !== 'supabase') return;
  const ok = await adapterFn();
  if (ok && document.getElementById(viewId)?.classList.contains('active')) rerenderFn();
}
```

Usage example (one of 20 sync functions across the modules):
```js
// js/modules/pricing/pricing.js
function _syncPricingFromSupabase() {
  if (!Adapter.supabaseReady) return;
  _dpSync('hm_data', {key:'hm_prices'}, () => Adapter.syncPrices(), 'view-pricing', _renderPricingUI);
}
```

---

## Admin authentication (Phase 3 hardening)

The `Auth` object lives in `js/core/auth.js`.

| Feature | Implementation |
|---|---|
| Password hashing | SHA-256 with random 16-byte salt: `SHA-256(salt + ':' + password)` |
| Legacy migration | Unsalted credentials auto-upgraded to salted on first successful login |
| Comparison | `_safeEqual()` — XOR accumulation across padded full length (constant-time) |
| Session token | 16-byte `crypto.getRandomValues` hex, rotated on every page navigation |
| Session storage | `sessionStorage` key `hm_admin_sess`, 30-minute TTL |
| Lockout | 5 failed attempts → lockout with exponential backoff: 15 min → 30 → 60 → ≤24 h |
| Lockout storage | `localStorage` key `hm_admin_lock`; `times` counter survives reset for backoff |
| Remember me | `{user, exp}` with 30-day expiry, cleaned up on `showLogin()` |
| Route guard | `go(view)` calls `Auth.isLoggedIn()` before rendering any view |

**Default credentials (change immediately on first deploy):**
- Email: `admin@hello-moving.com`
- Password: `hello2026`

Change via the **セキュリティ** page in the admin panel.

---

## Supabase schema

Tables used by `Adapter`:

| Table | Key columns | Used for |
|---|---|---|
| `bookings` | `reference_id`, `customer_name`, `email`, `move_date`, `status` | Booking management |
| `calendar_availability` | `date`, `status` | Calendar overrides |
| `reviews` | `reference_id`, `customer_name`, `rating`, `approved` | Review management |
| `services` | `reference_id`, `title`, `display_order`, `active` | Service listings |
| `hm_data` | `key`, `value`, `updated_at` | Key-value store for all config (prices, hero, FAQ, footer, etc.) |

---

## Running locally

```bash
# Start dev server on http://localhost:5050
node serve.js

# Public site:  http://localhost:5050/
# Admin panel:  http://localhost:5050/admin.html
```

The server must be running for the test suite.

---

## Running tests

```bash
npm test
# or: node --test tests/dataProvider.test.js
```

Requires the dev server to be running on `:5050`.
Tests use Playwright headless Chromium + `node:test`.
All 20 tests are deterministic (fake Supabase via `window.__withFakeSb`).

Expected output: `pass 20 / fail 0`

---

## Credentials setup

1. Copy `js/config/env.example.js` → `js/config/env.js`
2. Fill in your Supabase project URL and anon key:
   ```js
   window.SUPABASE_URL      = 'https://<project-ref>.supabase.co';
   window.SUPABASE_ANON_KEY = '<anon-public-key>';
   ```
3. `env.js` is gitignored — never commit real credentials.

---

## Observability

The admin dashboard (**ダッシュボード**) shows a **システム監視** panel with:

- Supabase online/offline indicator
- Cache hit rate % (green ≥70 / yellow ≥40 / red <40)
- Last Supabase response latency
- Time since last sync
- FallbackLogger entry count
- Retry count (yellow if >0)
- Per-table cache age and TTL status

Debug from the browser console:

```js
DataProvider.getMetrics()     // runtime stats since page load
DataProvider.cacheStatus()    // per-table cache state
FallbackLogger.getAll()       // all fallback events
window.Services               // {Adapter, DataProvider, Auth, EventBus, …}
AdminState.snapshot()         // current ephemeral UI state
```

---

## Dashboard customisation layer (Phase 21)

Five modules that add widget reordering, visibility control, KPI selection, and profiles
**on top of** the existing dashboard without modifying any render function.

### renderDash patch chain

Each module wraps `window.renderDash` at load time. Execution order (outermost → innermost):

```
DashboardProfiles
  → KPIManager
    → DashboardReorder
      → DashboardCustomizer
        → original renderDash()   ← renders all content to element IDs
      ← DashboardCustomizer: _injectSettingsBtn(), applyLayout()
    ← DashboardReorder: applyOrder() → _sortSlots() + applyLayout()
  ← KPIManager: _injectKPIButton(), applyVisibility()
← DashboardProfiles: _injectProfileBar(), _updateTabState()
```

`KPIManager` also wraps `window.renderStatGrid` independently so KPI visibility
applies on every grid render including Realtime-triggered updates.

### DOM structure after first renderDash

```
#view-dashboard
├── #dashCustomizerBar          (injected by DashboardCustomizer)
│   ├── #dashProfileBar         (injected by DashboardProfiles — margin-right:auto → left)
│   ├── #kpiSettingsBtn         (injected by KPIManager)
│   └── [settings button]       (original dashCustomizerBar content)
├── #dashOrderContainer         (created by DashboardReorder)
│   ├── .dash-slot[data-slot="stats"]          → #statGrid
│   ├── .dash-slot[data-slot="quick-actions"]  → #qaGrid
│   ├── .dash-slot[data-slot="observability"]  → #obsPanel
│   ├── .dash-slot[data-slot="bi-revenue"]     → #biRevenuePanel
│   ├── .dash-slot[data-slot="bi-trend"]       → #biTrendPanel
│   ├── .dash-slot[data-slot="bi-service"]     → #biServicePanel
│   ├── .dash-slot[data-slot="bi-customer"]    → #biCustomerPanel
│   ├── .dash-slot[data-slot="bi-operational"] → #biOperationalPanel
│   ├── .dash-slot[data-slot="bi-export"]      → #biExportPanel
│   ├── .dash-slot[data-slot="recent-bookings"]→ .panel (parent of #recentWrap)
│   └── .dash-slot[data-slot="activity"]       → .panel.activity-panel
├── #biRow1    (empty, display:none — children extracted into slots)
├── #biRow2    (empty, display:none)
└── .dash-panels (empty, display:none)
```

### localStorage keys

| Key | Owner | Contents |
|---|---|---|
| `hm_dashboard_layout` | `DashboardLayout` | `{version, widgets:[{id, elementId, visible, order}]}` |
| `hm_dashboard_kpis` | `KPIManager` | `{version, kpis:[{id, visible}]}` |
| `hm_dashboard_profiles` | `DashboardProfiles` | `{version, active, overrides:{[profileId]:{layout,kpis}}}` |
| `hm_invoices` | `InvoiceManager` | `{version, counter, records:{[bookingId]:{number, issuedAt}}}` |
| `hm_audit_log` | `AuditLog` | `{version, entries:[{id, ts, actor, action, entity, entityId, detail}]}` (max 500) |

### Key rules for future work

- **Never modify `renderDash` or `renderStatGrid` directly.** Wrap them the same way the existing modules do.
- **`DashboardCustomizer._container(widget)`** prefers `.dash-slot[data-slot]` over raw element IDs — always call `applyLayout()` after DOM changes that affect slots.
- **`_syncWrappers()`** is a no-op when `#dashOrderContainer` exists — the empty `biRow`/`dash-panels` divs are intentionally inert.
- **Profile load does NOT call `renderDash()`** — it calls `DashboardReorder.applyOrder()` + `KPIManager.applyVisibility()` directly to avoid a full data re-fetch.
- **Built-in profile presets are code-only** — only user overrides are written to `hm_dashboard_profiles`.

---

## Phase history

| Phase | Commit | What was built |
|---|---|---|
| 28 | `—` | Website Management Center (WMC): `wmc/wmcDashboard.html` + 8 modules in `js/modules/website/`. Sections 8 (Theme Customizer — live preview, CSS override for index.html), 9 (Deployment Center — export/import/backup, version tracking, deploy log), 10 (Permissions — 3-tier RBAC: admin/staff/readonly, permission matrix, WMC user management, role simulation, view-level access gates). `WMCPermissions` global, `_padZ`/`_wmcFmtRelative` shared utils. Navigation integration: WMC link added to admin.html sidebar. localStorage schema: `hm_wmc_users`, `hm_dc_log`, `hm_dc_backups`, `hm_theme_config`, `hm_custom_theme_css`. |
| 23 | `—` | Advanced Analytics & BI: AnalyticsEngine (regression/forecasting), RevenueForecast (3-month projection), ServicePerformance (composite score), CustomerInsights (CLV/churn), ConversionAnalytics (funnel), AnalyticsWidgets (demand chart/DOW heatmap/insight cards), AnalyticsUI (orchestrator wrapper) |
| 22 | `e9505ac` | Invoice generator (InvoiceManager, hm_invoices, 請求書 button in booking detail); global search (GlobalSearch, Ctrl+K, searches all local data); audit log (AuditLog, hm_audit_log ring buffer, Adapter auto-patches, 監査ログ view) |
| 21 | `e33a779` | Dashboard customisation suite (A–E): layout storage, widget visibility modal, HTML5 DnD reordering, KPI card manager, Owner/Operations/Marketing profiles |
| 1 | `14af5d5` | Infrastructure: appConfig, fallbackLogger, dataProvider, serviceRegistry |
| 2 | `675da50` | Connected admin page syncs to DataProvider via `_dpSync` |
| 3 | `57b4748` | Auth hardening: salted hash, constant-time compare, session rotation, exponential lockout |
| 4 | `7a96f1c` | DataProvider TTL cache with per-table config and cache invalidation on writes |
| 5 | `0f644c8` | Admin dashboard observability panel with live metrics |
| 6 | `84ecfdf` | DataProvider retry with exponential backoff and jitter |
| 7 | `0a9c11d` | 20-case DataProvider unit test suite |
| 8 | `—` | CLAUDE.md (this file) |
| 12 | `8c3eac9` | PDF direct download for all 11 print functions |
| 14 | `0b73573` | Modular architecture: split admin-ui.js (5543 lines) into 30 domain files across js/core/, js/utils/, js/modules/ |
