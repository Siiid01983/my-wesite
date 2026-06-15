# Hello Moving Admin System — Full Audit Report

**Date:** 2026-06-15  
**Scope:** admin.html · wmcDashboard.html · all linked JS modules  
**Rule:** Read-only analysis. No files modified.

---

## 1. Complete Module Inventory

### 1A. admin.html — Script load sequence (103 scripts)

| # | File | Layer | Phase | Status |
|---|------|-------|-------|--------|
| 1 | js/lib/supabase.js | Infrastructure | 1 | ✓ |
| 2 | js/config/appConfig.js | Infrastructure | 1 | ✓ |
| 3 | js/config/env.js | Infrastructure | 1 | ✓ |
| 4 | js/services/supabaseClient.js | Infrastructure | 1 | ✓ |
| 5 | js/services/supabaseAdapter.js | Infrastructure | 1 | ✓ |
| 6 | js/services/statisticsService.js | Infrastructure | 1 | ✓ |
| 7 | js/services/fallbackLogger.js | Infrastructure | 1 | ✓ |
| 8 | js/services/dataProvider.js | Infrastructure | 1 | ✓ |
| 9 | js/services/healthCheck.js | Infrastructure | 1 | ✓ |
| 10 | js/core/auth.js | Core | 3 | ✓ |
| 11 | js/core/eventBus.js | Core | 14 | ✓ |
| 12 | js/core/stateManager.js | Core | 14 | ✓ |
| 13 | js/utils/formatters.js | Utils | 14 | ✓ |
| 14 | js/utils/dom.js | Utils | 14 | ✓ |
| 15 | js/utils/storage.js | Utils | 14 | ✓ |
| 16 | js/utils/validators.js | Utils | 14 | ✓ |
| 17 | js/utils/i18n.js | Utils | — | ✓ undocumented in CLAUDE.md |
| 18 | js/utils/pdf.js | Utils | 12 | ✓ |
| 19 | html2canvas@1.4.1 (CDN) | CDN | 12 | ✓ |
| 20 | jspdf@2.5.1 (CDN) | CDN | 12 | ✓ |
| 21 | admin-bookings.js | Data | 14 | ✓ |
| 22 | admin-analytics.js | Data | 14 | ✓ |
| 23 | js/core/navigation.js | Core | 14 | ✓ |
| 24 | js/modules/dashboard/dashboardLayout.js | Dashboard | 21 | ✓ |
| 25 | js/modules/dashboard/dashboard.js | Dashboard | 21 | ✓ |
| 26 | js/modules/dashboard/dashboardCustomizer.js | Dashboard | 21 | ✓ |
| 27 | js/modules/dashboard/dashboardReorder.js | Dashboard | 21 | ✓ |
| 28 | js/modules/dashboard/kpiManager.js | Dashboard | 21 | ✓ |
| 29 | js/modules/dashboard/dashboardProfiles.js | Dashboard | 21 | ✓ |
| 30 | js/modules/analytics/analyticsEngine.js | Analytics | 23 | ✓ |
| 31 | js/modules/analytics/revenueForecast.js | Analytics | 23 | ✓ |
| 32 | js/modules/analytics/servicePerformance.js | Analytics | 23 | ✓ |
| 33 | js/modules/analytics/customerInsights.js | Analytics | 23 | ✓ |
| 34 | js/modules/analytics/conversionAnalytics.js | Analytics | 23 | ✓ |
| 35 | js/modules/analytics/analyticsWidgets.js | Analytics | 23 | ✓ |
| 36 | js/modules/analytics/analyticsUI.js | Analytics | 23 | ✓ |
| 37 | js/modules/analytics/analyticsCache.js | Analytics | 23 | ✓ |
| 38 | js/modules/analytics/bookingTrends.js | Analytics | 23 | ✓ |
| 39 | js/modules/analytics/analyticsExport.js | Analytics | 23 | ✓ |
| 40 | js/modules/analytics/analyticsDashboard.js | Analytics | 23 | ✓ |
| 41 | js/modules/calendar/calendar.js | Feature | 14 | ✓ |
| 42 | js/modules/calendar/gcalSync.js | Feature | — | ✓ undocumented |
| 43 | js/modules/capacity/capacity.js | Feature | 14 | ✓ |
| 44 | js/modules/pricing/pricing.js | Feature | 14 | ✓ |
| 45 | js/modules/disposal/disposal.js | Feature | 14 | ✓ |
| 46 | js/modules/quotes/quotes.js | Feature | 14 | ✓ |
| 47 | js/modules/services/servicesEditor.js | Feature | 14 | ✓ |
| 48 | js/modules/hero/hero.js | Feature | 14 | ✓ |
| 49 | js/modules/reviews/reviewsEditor.js | Feature | 14 | ✓ |
| 50 | js/modules/footer/footer.js | Feature | 14 | ✓ |
| 51 | js/modules/company/company.js | Feature | 14 | ✓ |
| 52 | js/modules/faq/faq.js | Feature | 14 | ✓ |
| 53 | js/modules/backup/backup.js | Feature | 14 | ✓ |
| 54 | js/modules/backup/csvReport.js | Feature | 14 | ✓ |
| 55 | js/modules/notifications/email.js | Feature | 14 | ✓ |
| 56 | js/modules/notifications/line.js | Feature | 14 | ✓ |
| 57 | js/modules/notifications/followUp.js | Feature | — | ✓ undocumented |
| 58 | js/modules/changelog/changelog.js | Feature | 14 | ✓ |
| 59 | js/modules/customers/customers.js | Feature | 14 | ✓ |
| 60 | js/modules/media/media.js | Feature | 14 | ✓ |
| 61 | js/modules/security/security.js | Feature | 14 | ✓ |
| 62 | js/modules/security/staff.js | Feature | — | ✓ undocumented |
| 63 | js/modules/invoices/invoices.js | Feature | 22 | ✓ |
| 64 | js/modules/search/globalSearch.js | Feature | 22 | ✓ |
| 65 | js/modules/audit/auditLog.js | Feature | 22 | ✓ |
| 66 | js/modules/automation/automationAudit.js | Automation | 24 | ✓ undocumented |
| 67 | js/modules/automation/automationRules.js | Automation | 24 | ✓ undocumented |
| 68 | js/modules/automation/automationActions.js | Automation | 24 | ✓ undocumented |
| 69 | js/modules/automation/automationTriggers.js | Automation | 24 | ✓ undocumented |
| 70 | js/modules/automation/automationScheduler.js | Automation | 24 | ✓ undocumented |
| 71 | js/modules/automation/automationEngine.js | Automation | 24 | ✓ undocumented |
| 72 | js/modules/automation/automationUI.js | Automation | 24 | ✓ undocumented |
| 73 | js/modules/automation/reviewRequestAction.js | Automation | 24 | ✓ undocumented |
| 74 | js/modules/automation/bookingReminderAction.js | Automation | 24 | ✓ undocumented |
| 75 | js/modules/automation/quoteFollowUpAction.js | Automation | 24 | ✓ undocumented |
| 76 | js/modules/automation/occupancyMonitor.js | Automation | 24 | ✓ undocumented |
| 77 | js/modules/automation/autoStatusRules.js | Automation | 24 | ✓ undocumented |
| 78 | js/modules/crm/crmCore.js | CRM | 25 | ✓ undocumented |
| 79 | js/modules/crm/crmTags.js | CRM | 25 | ✓ undocumented |
| 80 | js/modules/crm/crmNotes.js | CRM | 25 | ✓ undocumented |
| 81 | js/modules/crm/crmProfiles.js | CRM | 25 | ✓ undocumented |
| 82 | js/modules/crm/crmTimeline.js | CRM | 25 | ✓ undocumented |
| 83 | js/modules/crm/crmInsights.js | CRM | 25 | ✓ undocumented |
| 84 | js/modules/crm/crmUI.js | CRM | 25 | ✓ undocumented |
| 85 | js/modules/crm/crmAnalytics.js | CRM | 25 | ✓ undocumented |
| 86 | js/modules/crm/crmExport.js | CRM | 25 | ✓ undocumented |
| 87 | js/modules/crm/crmAutomation.js | CRM | 25 | ✓ undocumented |
| 88 | js/modules/mobile/mobileNav.js | Mobile | 27 | ✓ |
| 89 | js/modules/mobile/mobileDash.js | Mobile | 27 | ✓ undocumented |
| 90 | js/modules/notifications/pushNotifications.js | Mobile | 27 | ✓ undocumented |
| 91 | js/modules/offline/offlineDB.js | Mobile | 27 | ✓ |
| 92 | js/modules/offline/offlineQueue.js | Mobile | 27 | ✓ |
| 93 | js/modules/camera/cameraCapture.js | Mobile | 27 | ✓ |
| 94 | js/modules/seo/seoCenter.js | Content | — | ✓ undocumented |
| 95 | js/modules/blog/blogManager.js | Content | — | ✓ undocumented |
| 96 | js/modules/settings/siteSettings.js | Content | — | ✓ undocumented |
| 97 | js/modules/overlay-bookings/overlayBookings.js | Feature | — | ✓ undocumented |
| 98 | js/modules/communications/communications.js | Comms | 29 | ✓ undocumented |
| 99 | js/modules/inbox/inbox.js | Inbox | 31 | ✓ undocumented |
| 100 | js/services/serviceRegistry.js | Infrastructure | 1 | ✓ |
| 101 | js/core/appBootstrap.js | Core | 14 | ✓ |
| 102 | js/utils/swRegister.js | Utils | 27 | ✓ undocumented |
| 103 | Inline ESM `<script type="module">` | Inbox | 31 | ✓ defines `window.renderInbox` |

---

### 1B. wmcDashboard.html — Script load sequence (33 scripts)

| # | File | Notes |
|---|------|-------|
| 1 | js/lib/supabase.js | Shared with admin.html |
| 2 | js/config/appConfig.js | Shared |
| 3 | js/config/env.js | Shared |
| 4 | js/services/supabaseClient.js | Shared |
| 5 | js/services/supabaseAdapter.js | Shared |
| 6 | js/services/fallbackLogger.js | Shared — statisticsService.js NOT loaded here |
| 7 | js/services/dataProvider.js | Shared |
| 8 | js/services/healthCheck.js | Shared |
| 9 | js/core/auth.js | Shared |
| 10 | js/core/eventBus.js | Shared |
| 11 | js/core/stateManager.js | Shared |
| 12 | js/utils/formatters.js | Shared |
| 13 | js/utils/dom.js | Shared |
| 14 | js/utils/storage.js | Shared |
| 15 | js/utils/validators.js | Shared |
| 16 | js/utils/i18n.js | Shared |
| 17 | js/modules/audit/auditLog.js | Shared |
| 18 | js/services/serviceRegistry.js | Shared |
| 19 | js/modules/website/wmcCore.js | WMC-only |
| 20 | js/modules/website/wmcPermissions.js | WMC-only |
| 21 | js/modules/wmc/pageManager.js | WMC-only |
| 22 | js/modules/wmc/wmcMedia.js | WMC-only |
| 23 | js/modules/wmc/blockEditor.js | WMC-only |
| 24 | js/modules/website/wmcOverview.js | WMC-only |
| 25 | js/modules/website/wmcPages.js | WMC-only |
| 26 | js/modules/website/wmcBlog.js | WMC-only |
| 27 | js/modules/website/wmcSeo.js | WMC-only |
| 28 | js/modules/website/wmcTheme.js | WMC-only |
| 29 | js/modules/website/wmcDeploy.js | WMC-only |
| 30 | js/modules/website/wmcServices.js | WMC-only |
| 31 | js/modules/website/wmcAnalytics.js | WMC-only |
| 32 | js/modules/website/wmcBootstrap.js | WMC-only |
| 33 | js/utils/swRegister.js | Shared |

---

### 1C. Orphaned root-level files (not loaded by any HTML)

| File | Purpose | Risk |
|------|---------|------|
| `_test_booking.js` | Booking API test utility | Dev artifact — not gitignored |
| `_verify_zip.js` | Zip verification script | Dev artifact — not gitignored |
| `deploy.js` | Deployment helper | Dev artifact — not gitignored |
| `screenshot.js` | Dev screenshot utility | Dev artifact |
| `screenshot2.js` | Dev screenshot utility | Dev artifact |

### 1D. Public site modules (loaded by index.html, NOT admin.html)

| File | Purpose |
|------|---------|
| `script.js` | Public site JS (calendar, quote form) |
| `bookingService.js` | Booking form submission |
| `calendarService.js` | Public calendar reader |
| `js/core/bootstrap.js` | Public site boot orchestrator |
| `js/services/contentLoader.js` | Live content fetcher (hm_data → DOM) |
| `js/config/env.public.js` | Committed anon credentials for deployment |

---

## 2. Navigation Inventory

### 2A. admin.html sidebar

| Section | Label (JA) | View ID | Type |
|---------|-----------|---------|------|
| 管理 | ダッシュボード | view-dashboard | Internal |
| 管理 | 予約管理 | view-bookings | Internal |
| 管理 | 顧客管理 | view-customers | Internal |
| 管理 | CRM | view-crm | Internal |
| 管理 | フォーム予約 | view-overlay-bookings | Internal |
| 管理 | 見積り管理 | view-quotes | Internal |
| 管理 | 受信トレイ | view-inbox | Internal |
| 管理 | カレンダー管理 | view-calendar | Internal |
| 分析・自動化 | 分析 | view-analytics | Internal |
| 分析・自動化 | 高度分析 | view-analytics-advanced | Internal |
| 分析・自動化 | 自動化エンジン | view-automation | Internal |
| 分析・自動化 | 監査ログ | view-audit-log | Internal |
| 設定 | スタッフ管理 | view-staff | Internal |
| 設定 | 容量設定 | view-capacity | Internal |
| 設定 | 料金管理 | view-pricing | Internal |
| 設定 | 不用品管理 | view-disposal | Internal |
| 設定 | クイック操作 | view-actions | Internal |
| 設定 | バックアップ | view-backup | Internal |
| 設定 | LINE通知設定 | view-line | Internal |
| 設定 | メール通知設定 | view-email | Internal |
| 設定 | カメラ・写真 | view-camera | Internal |
| 設定 | プッシュ通知設定 | view-mobile-notifications | Internal |
| 設定 | 変更履歴 | view-changelog | Internal |
| 設定 | セキュリティ | view-security | Internal |
| 設定 | システム健全性 | view-health | Internal |
| ウェブサイト | Website Management | **websiteManagement.html** | **🔴 BROKEN LINK** |
| その他 | ダークモード | — | Toggle |
| その他 | EN/JA | — | Toggle |
| その他 | サイトを表示 | index.html | External |

**Views in admin.html with NO sidebar link (hash-only access):**

| View ID | Module | Access method |
|---------|--------|--------------|
| view-services | servicesEditor.js | `go('services')` / hash `#services` |
| view-footer | footer.js | `go('footer')` / hash `#footer` |
| view-company | company.js | `go('company')` / hash `#company` |
| view-faq | faq.js | `go('faq')` / hash `#faq` |
| view-hero | hero.js | `go('hero')` / hash `#hero` |
| view-reviews | reviewsEditor.js | `go('reviews')` / hash `#reviews` |
| view-media | media.js | `go('media')` / hash `#media` |

These 7 views are active and fully functional but invisible in the sidebar. They were likely deprioritised when the WMC was introduced. They are still linked from WMC quick actions (e.g. `admin.html#hero`).

---

### 2B. wmcDashboard.html sidebar

| Section | Label (JA) | View ID | Status |
|---------|-----------|---------|--------|
| メイン | ダッシュボード | wmc-view-overview | ✓ Full |
| メイン | ページ管理 | wmc-view-pages | ✓ Full |
| メイン | ブログ投稿 | wmc-view-blog | ✓ Full |
| コンテンツ | サービス管理 | wmc-view-services | ✓ Full |
| コンテンツ | レビュー | wmc-view-reviews | ⚠ Placeholder (links to admin.html) |
| コンテンツ | メディア | wmc-view-media | ⚠ Placeholder (links to admin.html) |
| 分析 | アナリティクス | wmc-view-analytics | ✓ Full |
| SEO・設定 | SEO設定 | wmc-view-seo | ✓ Full |
| SEO・設定 | テーマカスタマイザー | wmc-view-theme | ✓ Full |
| SEO・設定 | デプロイメント | wmc-view-deploy | ✓ Full |
| SEO・設定 | 権限管理 | wmc-view-permissions | ✓ Full |
| SEO・設定 | サイト設定 | wmc-view-settings | ⚠ "Coming soon" placeholder |

---

## 3. Dependency Map

### 3A. admin.html — loading dependency chain

```
Infrastructure (must load first, strict order)
  supabase.js
    └─ supabaseClient.js
         └─ supabaseAdapter.js ─── sets window.Adapter
              └─ statisticsService.js
  appConfig.js ─── window.HM_CONFIG
  env.js ────────── window.SUPABASE_URL / SUPABASE_ANON_KEY
  fallbackLogger.js ── window.FallbackLogger
  dataProvider.js ──── window.DataProvider (needs HM_CONFIG + FallbackLogger)
  healthCheck.js ───── window.HealthCheck

Core
  auth.js ────────── window.Auth (needs Storage, which isn't loaded yet → deferred to call-time)
  eventBus.js ────── window.EventBus
  stateManager.js ── window.AdminState

Utils (no cross-util deps)
  formatters.js ── MN, DN, pad, fmtD, esc, badge, toast
  dom.js ─────────── $id, $html, $show, $hide
  storage.js ─────── window.Storage
  validators.js ──── window.Validators
  i18n.js ────────── window.I18n (undocumented)
  pdf.js ─────────── downloadPDF*, _pdfDownload (needs html2canvas + jsPDF — CDN before this)

Data modules (need Adapter + DataProvider)
  admin-bookings.js ─── CalendarService, BookingService, buildTable, _renderBookingsUI
  admin-analytics.js ── renderAnalytics, drawBarChart, _DOW_JP

Navigation (lazy — all render fns must exist before first user click)
  navigation.js ─── go(), _dpSync(), VIEW_TITLES

Dashboard chain (strict order — each wraps the previous renderDash)
  dashboardLayout.js ──── DashboardLayout
  dashboard.js ────────── renderDash, renderStatGrid (original)
  dashboardCustomizer.js ─ wraps renderDash (1st)
  dashboardReorder.js ──── wraps renderDash (2nd)
  kpiManager.js ─────────── wraps renderDash + renderStatGrid (3rd)
  dashboardProfiles.js ──── wraps renderDash (outermost)

Analytics (each depends on AnalyticsEngine)
  analyticsEngine.js ─── AnalyticsEngine (pure math, no deps)
  revenueForecast.js ─── RevenueForecast ← AnalyticsEngine
  servicePerformance.js ─ ServicePerformance ← AnalyticsEngine
  customerInsights.js ─── CustomerInsights ← AnalyticsEngine
  conversionAnalytics.js ─ ConversionAnalytics ← AnalyticsEngine
  analyticsWidgets.js ──── AnalyticsWidgets ← AnalyticsEngine + drawBarChart
  analyticsUI.js ────────── wraps renderAnalytics
  analyticsCache.js ──────── AnalyticsCache (no deps)
  bookingTrends.js ────────── BookingTrends ← AnalyticsEngine + AnalyticsCache
  analyticsExport.js ─────── AnalyticsExport ← all compute modules + AuditLog
  analyticsDashboard.js ──── AnalyticsDashboard ← wraps go()

Automation chain (strict order within group)
  automationAudit.js → automationRules.js → automationActions.js
  → automationTriggers.js → automationScheduler.js → automationEngine.js
  → automationUI.js + action modules + autoStatusRules.js

CRM chain (strict order within group)
  crmCore.js → crmTags.js → crmNotes.js → crmProfiles.js
  → crmTimeline.js → crmInsights.js → crmUI.js
  → crmAnalytics.js → crmExport.js → crmAutomation.js

Service registry + bootstrap (must be last)
  serviceRegistry.js ─── window.Services (collects all globals above)
  appBootstrap.js ─────── startup IIFE (must be final script)
  swRegister.js
```

### 3B. wmcDashboard.html — loading dependency chain

```
Shared infrastructure (identical to admin.html, minus statisticsService)
  supabase.js → supabaseClient.js → supabaseAdapter.js
  appConfig.js · env.js · fallbackLogger.js · dataProvider.js · healthCheck.js
  auth.js · eventBus.js · stateManager.js
  formatters.js · dom.js · storage.js · validators.js · i18n.js

WMC-specific (strict order)
  auditLog.js ──── AuditLog
  serviceRegistry.js ── window.Services
  wmcCore.js ──── WMCPermissions + shared utils (_padZ, _wmcFmtRelative)
  wmcPermissions.js ─── depends on wmcCore
  pageManager.js ────── WMCPageManager, _wmcCloseModal
  wmcMedia.js ────────── WMCMedia ← WMCPageManager
  blockEditor.js ─────── WMCBlockEditor ← WMCPageManager + WMCMedia
  wmcOverview.js · wmcPages.js · wmcBlog.js · wmcSeo.js
  wmcTheme.js · wmcDeploy.js · wmcServices.js · wmcAnalytics.js
  wmcBootstrap.js ─── calls wmcInit() entry point (must be last)
  swRegister.js
```

---

## 4. Duplicate Modules Report

### 4A. True duplicates (same file loaded twice)

**None found.** Each script file appears once per HTML page.

### 4B. Functional duplicates (two modules serving the same purpose)

| Domain | Module A | Module B | Notes |
|--------|---------|---------|-------|
| Inbox | `js/modules/inbox/inbox.js` | Inline ESM `<script type="module">` in admin.html | Both define `window.renderInbox`. The inline ESM runs after inbox.js and overwrites it. Inbox.js is effectively dead code. |
| Auth | `js/core/auth.js` in admin.html | `js/core/auth.js` in wmcDashboard.html | Not a bug — separate page contexts, same module. Intentional sharing. |
| WMC SEO | `js/modules/seo/seoCenter.js` (in admin.html) | `js/modules/website/wmcSeo.js` (in wmcDashboard.html) | Different feature surfaces, not duplicates — seoCenter.js targets a future admin SEO view, wmcSeo.js powers the WMC SEO section. No functional overlap visible. |
| Analytics | `admin-analytics.js` | `js/modules/analytics/analyticsUI.js` | analyticsUI wraps the renderAnalytics from admin-analytics — by design (Phase 23 wrapper pattern). |

---

## 5. Shared Modules Report

### 5A. Modules shared between admin.html and wmcDashboard.html

| File | Shared? | Notes |
|------|---------|-------|
| js/lib/supabase.js | ✓ Both | |
| js/config/appConfig.js | ✓ Both | |
| js/config/env.js | ✓ Both | |
| js/services/supabaseClient.js | ✓ Both | |
| js/services/supabaseAdapter.js | ✓ Both | |
| js/services/statisticsService.js | ✗ admin only | wmcDashboard lacks this |
| js/services/fallbackLogger.js | ✓ Both | |
| js/services/dataProvider.js | ✓ Both | |
| js/services/healthCheck.js | ✓ Both | |
| js/services/serviceRegistry.js | ✓ Both | |
| js/core/auth.js | ✓ Both | |
| js/core/eventBus.js | ✓ Both | |
| js/core/stateManager.js | ✓ Both | |
| js/utils/formatters.js | ✓ Both | |
| js/utils/dom.js | ✓ Both | |
| js/utils/storage.js | ✓ Both | |
| js/utils/validators.js | ✓ Both | |
| js/utils/i18n.js | ✓ Both | |
| js/utils/pdf.js | ✗ admin only | |
| js/utils/swRegister.js | ✓ Both | |
| js/modules/audit/auditLog.js | ✓ Both | Note: load position differs |

**auditLog.js load position difference:**  
- In admin.html → position 65 (after invoices, globalSearch)  
- In wmcDashboard.html → position 17 (before serviceRegistry)  
This is safe because both load before their respective bootstrap files.

### 5B. Globals available in both pages (via shared modules)

`Auth` · `EventBus` · `AdminState` · `Adapter` · `DataProvider` · `FallbackLogger` · `HealthCheck` · `Services` · `Storage` · `Validators` · `AuditLog` · `toast()` · `esc()` · `fmtD()` · `$id()` · `$html()` · `I18n`

---

## 6. Risk Assessment

### 🔴 CRITICAL

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| C1 | **Broken internal link** — sidebar links to `websiteManagement.html` which does not exist. The WMC is at `wmcDashboard.html`. | admin.html line 920 | Users clicking "Website Management" get a 404. Admin cannot navigate to WMC from admin sidebar. |

---

### 🟠 HIGH

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| H1 | **7 views have no sidebar navigation** — `services`, `footer`, `company`, `faq`, `hero`, `reviews`, `media` exist in admin.html and are fully functional but cannot be reached from the sidebar. Only accessible via URL hash (e.g., `admin.html#hero`) or WMC quick-action links. | admin.html | Content editors who rely on the sidebar will not discover these features. |
| H2 | **inbox.js is dead code** — `js/modules/inbox/inbox.js` is loaded at line 2639 but the inline ESM `<script type="module">` at line 2657 then overwrites `window.renderInbox` and `window.loadMessages`. Whatever inbox.js defines is silently replaced. | admin.html lines 2639 + 2657 | inbox.js may define handlers or behaviour that is never reached. Risk of confusion when modifying inbox logic. |
| H3 | **CLAUDE.md loading order is significantly out of date** — Phases 24 (Automation, 12 modules), 25 (CRM, 10 modules), 27 extensions (mobileDash, pushNotifications), 29 (Communications), 31 (Inbox), plus seoCenter, blogManager, siteSettings, overlayBookings, followUp, staff, gcalSync, i18n are all loaded in admin.html but absent from CLAUDE.md's script loading documentation. | CLAUDE.md | Any developer following CLAUDE.md for load-order guidance gets an incomplete and misleading picture. |

---

### 🟡 MEDIUM

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| M1 | **wmcDashboard Reviews + Media are placeholders** — Both sidebar items link to placeholder divs that redirect operators back to admin.html. | wmcDashboard.html lines 824–841 | WMC does not yet offer full content management for reviews or media — only within admin.html. Creates a context-switch for editors working in WMC. |
| M2 | **wmcDashboard Settings is "Coming soon"** — The サイト設定 view shows only a placeholder. | wmcDashboard.html line 895 | Users expect settings management here, but it is not implemented. |
| M3 | **statisticsService.js missing from wmcDashboard.html** — admin.html loads it, wmcDashboard.html does not. wmcAnalytics.js may call StatisticsService functions that are undefined in the WMC context. | wmcDashboard.html | Potential runtime error if wmcAnalytics.js depends on StatisticsService. Needs verification. |
| M4 | **automation view not mapped in sidebar** — `view-automation` has a sidebar button, but there is no explicit `id="view-automation"` in the HTML. The automation module likely renders into a container via `go('automation')`. If the automation view container is missing, the click fails silently. | admin.html | Requires verification against navigation.js + automationUI.js render target. |

---

### 🟢 LOW

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| L1 | **Dev artifacts not gitignored** — `_test_booking.js`, `_verify_zip.js`, `deploy.js`, `screenshot.js`, `screenshot2.js` are in the repo root and would be served by the local dev server. | Root | Minor — not loaded by any HTML, but pollute the repository. |
| L2 | **js/core/bootstrap.js and js/services/contentLoader.js undocumented** — These public-site modules are actively used by index.html but absent from CLAUDE.md's documentation. | CLAUDE.md | A developer maintaining the public site bootstrap chain will not find it in the reference document. |
| L3 | **env.public.js commits real credentials** — The anon key is intentionally committed (it is the public/anon key, not the service role key). This is acceptable for Supabase but should be noted: if RLS policies are misconfigured, the anon key can allow unintended read access. | js/config/env.public.js | Low security risk if RLS is correct; no action needed unless Supabase RLS is audited. |
| L4 | **auditLog.js loads in different positions** across pages — earlier in wmcDashboard.html than in admin.html. While this is currently safe, future code that depends on AuditLog being available at a specific point in admin.html could be confused by the inconsistency. | Both pages | Cosmetic ordering inconsistency, no current breakage. |

---

## 7. Summary Counts

| Metric | Count |
|--------|-------|
| Total scripts loaded by admin.html | 103 |
| Total scripts loaded by wmcDashboard.html | 33 |
| Scripts shared between both pages | 21 |
| Module directories under js/modules/ | 34 |
| Views in admin.html | 30 |
| Views with no sidebar navigation (hidden) | 7 |
| Views in wmcDashboard.html | 12 |
| Views that are placeholders in wmcDashboard | 3 |
| CLAUDE.md-undocumented modules loaded by admin.html | 30+ |
| Broken navigation links | 1 (C1) |
| True duplicate script loads | 0 |
| Functional duplicates (same window.* overwritten) | 1 (H2) |

---

*End of audit. No files were modified.*
