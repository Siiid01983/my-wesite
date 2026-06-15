# Hello Moving — Information Architecture
## Phase 2: Target Separation Design

**Date:** 2026-06-15  
**Based on:** AUDIT_REPORT.md (Phase 1)  
**Rule:** Design only. No code changes. No file moves. No deletions.

---

## Overview

The system is split into two distinct browser applications that share an infrastructure layer but serve completely separate purposes.

```
┌──────────────────────────────┐     ┌──────────────────────────────┐
│      admin.html              │     │   websiteManagement.html     │
│   Operations Platform        │     │       Website CMS            │
│                              │     │                              │
│  • Dashboard                 │     │  • Hero Section              │
│  • Reservations              │     │  • Services                  │
│  • Quotes                    │     │  • Reviews                   │
│  • Inbox / Communications    │     │  • FAQ                       │
│  • Calendar                  │     │  • Footer / Company Info     │
│  • Customers / CRM           │     │  • Blog Management           │
│  • Analytics / Automation    │     │  • Media Library             │
│  • Staff / Security          │     │  • SEO Center                │
│  • Audit Log                 │     │  • Theme Customizer          │
│                              │     │  • Website Settings          │
│                              │     │  • Deployment / Backup       │
└──────────────────────────────┘     └──────────────────────────────┘
           │                                       │
           └──────────────┬────────────────────────┘
                          │
              Shared Infrastructure Layer
          (auth · adapter · dataProvider · utils)
```

---

## 1. New Menu Structure

### 1A. admin.html — Operations Platform

The sidebar is reorganised into four semantic sections. All 25 current links are preserved; 7 previously hidden views (hero, services, reviews, faq, footer, company, media) are removed since they move to the CMS. The broken `websiteManagement.html` link is replaced with a working cross-link.

```
┌─ HELLO MOVING — Admin Panel ──────────────────────────────────────┐
│                                                                    │
│  ── 運営 ─────────────────────────────────────────────────────── │
│  [●] ダッシュボード        dashboard                               │
│  [ ] 予約管理              bookings                                │
│  [ ] フォーム予約           overlay-bookings                       │
│  [ ] 見積り管理             quotes                                  │
│  [ ] 受信トレイ             inbox                                   │
│  [ ] コミュニケーション      communications                         │
│  [ ] カレンダー管理          calendar                               │
│                                                                    │
│  ── 顧客・CRM ──────────────────────────────────────────────── │
│  [ ] 顧客管理              customers                               │
│  [ ] CRM                   crm                                     │
│                                                                    │
│  ── 分析・自動化 ──────────────────────────────────────────── │
│  [ ] 分析                  analytics                               │
│  [ ] 高度分析               analytics-advanced                     │
│  [ ] 自動化エンジン          automation                             │
│  [ ] 監査ログ               audit-log                              │
│                                                                    │
│  ── 設定 ──────────────────────────────────────────────────── │
│  [ ] スタッフ管理            staff                                  │
│  [ ] 容量設定               capacity                               │
│  [ ] 料金管理               pricing                                 │
│  [ ] 不用品管理              disposal                               │
│  [ ] カメラ・写真            camera                                 │
│  [ ] プッシュ通知設定        mobile-notifications                   │
│  [ ] LINE 通知設定           line                                   │
│  [ ] メール通知設定          email                                  │
│  [ ] セキュリティ            security                               │
│  [ ] システム健全性          health                                 │
│  [ ] 変更履歴               changelog                              │
│                                                                    │
│  ── ウェブサイト ─────────────────────────────────────────── │
│  [↗] ウェブサイト管理        → websiteManagement.html  ← FIXED    │
│                                                                    │
│  ── その他 ───────────────────────────────────────────────── │
│  [ ] ダークモード切替                                               │
│  [ ] EN / JA                                                       │
│  [↗] サイトを表示           → index.html                           │
│                                                                    │
│  ─────────────────────────────────────────────────────────────── │
│  セッション残り時間: --分                                            │
│  [ログアウト]                                                       │
└────────────────────────────────────────────────────────────────────┘
```

**Delta from current admin.html sidebar:**

| Change | Detail |
|--------|--------|
| REMOVE | `websiteManagement.html` broken link (was href to non-existent file) |
| ADD | `ウェブサイト管理 → websiteManagement.html` (fixed target) |
| REMOVE | Hidden views (hero, services, reviews, faq, footer, company, media, backup) — migrated to CMS |
| REGROUP | Quick Actions view (`view-actions`) absorbed into dashboard quick-action buttons; no dedicated sidebar item needed |

---

### 1B. websiteManagement.html — Website CMS

New file. Replaces and absorbs `wmcDashboard.html` entirely. The WMC sidebar is rebuilt with 5 semantic sections covering all 13 target features.

```
┌─ HELLO MOVING — Website Management ──────────────────────────────┐
│                                                                   │
│  ── コンテンツ ──────────────────────────────────────────────  │
│  [●] 概要                  overview   (WMC dashboard)            │
│  [ ] ヒーロー               hero       ← migrated from admin     │
│  [ ] サービス管理            services   ← migrated from admin     │
│  [ ] レビュー               reviews    ← migrated from admin     │
│  [ ] FAQ                   faq        ← migrated from admin     │
│  [ ] フッター               footer     ← migrated from admin     │
│  [ ] 会社情報               company    ← migrated from admin     │
│                                                                   │
│  ── メディア・ブログ ────────────────────────────────────────  │
│  [ ] メディアライブラリ       media      ← migrated from admin    │
│  [ ] ブログ投稿              blog       (was wmcDashboard)        │
│                                                                   │
│  ── SEO・設定 ─────────────────────────────────────────────  │
│  [ ] SEO 設定               seo        ← migrated from admin     │
│  [ ] テーマカスタマイザー     theme      (was wmcDashboard)        │
│  [ ] サイト設定              settings   (was "Coming soon")       │
│                                                                   │
│  ── デプロイ・バックアップ ─────────────────────────────────  │
│  [ ] デプロイメント           deploy     (was wmcDashboard)        │
│  [ ] バックアップ            backup     ← migrated from admin     │
│                                                                   │
│  ── 管理 ──────────────────────────────────────────────────  │
│  [ ] ページ管理              pages      (block editor, WMC)       │
│  [ ] 権限管理               permissions (was wmcDashboard)        │
│                                                                   │
│  ─────────────────────────────────────────────────────────────  │
│  [← 運営管理パネルへ]  → admin.html                               │
│  [ログアウト]                                                      │
└───────────────────────────────────────────────────────────────────┘
```

**wmcDashboard.html → websiteManagement.html delta:**

| Status | WMC item | Target item |
|--------|---------|-------------|
| KEEP | overview | overview — unchanged |
| KEEP | pages | pages — unchanged |
| KEEP | blog | blog — powered by blogManager.js (see §5) |
| ADD | hero | hero — new, powered by hero.js |
| UPGRADE | services | services — WMC image-only → full content edit via servicesEditor.js + wmcServices.js |
| UPGRADE | reviews | reviews — placeholder → real via reviewsEditor.js |
| ADD | faq | faq — new, powered by faq.js |
| UPGRADE | media | media — placeholder → real via media.js |
| ADD | footer | footer — new, powered by footer.js |
| ADD | company | company — new, powered by company.js |
| KEEP | seo | seo — powered by seoCenter.js (see §5) |
| KEEP | theme | theme — unchanged |
| UPGRADE | settings | settings — "Coming soon" → real via siteSettings.js |
| KEEP | deploy | deploy — unchanged |
| ADD | backup | backup — new, powered by backup.js + csvReport.js |
| KEEP | permissions | permissions — unchanged |
| REMOVE | analytics | analytics (wmcAnalytics.js) — removed from CMS; operational analytics stays in admin.html |

> **Rationale for removing WMC analytics:** The user's spec does not include analytics in the CMS. Traffic/conversion analytics is operational data, already fully covered by the admin.html analytics suite (Phases 23 + AnalyticsDashboard). Removing from CMS keeps the two surfaces cleanly separated.

---

## 2. New Navigation Structure

### 2A. admin.html navigation (view IDs → render functions)

| View ID | Render Function | Module | Notes |
|---------|----------------|--------|-------|
| `view-dashboard` | `renderDash()` | dashboard.js (wrapped ×4) | Unchanged |
| `view-bookings` | `_renderBookingsUI()` | admin-bookings.js | Unchanged |
| `view-overlay-bookings` | `renderOverlayBookings()` | overlayBookings.js | Unchanged |
| `view-quotes` | `_renderQuotesUI()` | quotes.js | Unchanged |
| `view-inbox` | `renderInbox()` → `loadMessages()` | Inline ESM | Unchanged; inbox.js dead code resolved in Phase R6 |
| `view-communications` | `renderCommunications()` | communications.js | Unchanged |
| `view-calendar` | `renderCalendar()` | calendar.js | Unchanged |
| `view-customers` | `_renderCustomersUI()` | customers.js | Unchanged |
| `view-crm` | `CRMCore.render()` / `renderCRM()` | crmUI.js | Unchanged |
| `view-analytics` | `renderAnalytics()` | analyticsUI.js (wrapped) | Unchanged |
| `view-analytics-advanced` | `AnalyticsDashboard.render()` | analyticsDashboard.js | Unchanged |
| `view-automation` | `renderAutomation()` | automationUI.js | Unchanged |
| `view-audit-log` | `AuditLog.renderView()` | auditLog.js | Unchanged |
| `view-staff` | `renderStaff()` | staff.js | Unchanged |
| `view-capacity` | `_loadCapacityUI()` | capacity.js | Unchanged |
| `view-pricing` | `_renderPricingUI()` | pricing.js | Unchanged |
| `view-disposal` | `renderDisposal()` | disposal.js | Unchanged |
| `view-camera` | `CameraCapture.render()` | cameraCapture.js | Unchanged |
| `view-mobile-notifications` | `renderPushNotifs()` | pushNotifications.js | Unchanged |
| `view-line` | `renderLine()` | line.js | Unchanged |
| `view-email` | `renderEmail()` | email.js | Unchanged |
| `view-security` | `renderSecurity()` | security.js | Unchanged |
| `view-health` | `renderHealth()` | security.js | Unchanged |
| `view-changelog` | `renderChangelog()` | changelog.js | Unchanged |

**Views REMOVED from admin.html:**

| Current View ID | Moving to | Module |
|----------------|-----------|--------|
| `view-hero` | websiteManagement.html | hero.js |
| `view-services` | websiteManagement.html | servicesEditor.js |
| `view-reviews` | websiteManagement.html | reviewsEditor.js |
| `view-faq` | websiteManagement.html | faq.js |
| `view-footer` | websiteManagement.html | footer.js |
| `view-company` | websiteManagement.html | company.js |
| `view-media` | websiteManagement.html | media.js |
| `view-backup` | websiteManagement.html | backup.js + csvReport.js |
| `view-actions` | — | Absorbed into dashboard quick-action buttons |

---

### 2B. websiteManagement.html navigation (view IDs → render functions)

A new lightweight `navigation.js` (or inline equivalent) handles routing within this page. The pattern mirrors admin.html's `go()` function but is scoped to WMC views only.

| View ID | Render Function | Module | Source |
|---------|----------------|--------|--------|
| `wmc-view-overview` | `wmcRenderOverview()` | wmcOverview.js | From wmcDashboard.html |
| `wmc-view-hero` | `renderHero()` | hero.js | Migrated from admin.html |
| `wmc-view-services` | `renderServices()` + `wmcRenderServices()` | servicesEditor.js + wmcServices.js | Merged view (see §5.2) |
| `wmc-view-reviews` | `renderReviews()` | reviewsEditor.js | Migrated from admin.html |
| `wmc-view-faq` | `renderFaq()` | faq.js | Migrated from admin.html |
| `wmc-view-footer` | `renderFooter()` | footer.js | Migrated from admin.html |
| `wmc-view-company` | `renderCompany()` | company.js | Migrated from admin.html |
| `wmc-view-media` | `MediaLib.render()` | media.js | Migrated from admin.html |
| `wmc-view-blog` | `renderBlog()` | blogManager.js | Upgraded (see §5.1) |
| `wmc-view-seo` | `renderSeoCenter()` | seoCenter.js | Migrated from admin.html (see §5.3) |
| `wmc-view-theme` | `_tcReset()` / `_tcApply()` | wmcTheme.js | From wmcDashboard.html |
| `wmc-view-settings` | `renderSiteSettings()` | siteSettings.js | Was "Coming soon" |
| `wmc-view-deploy` | `_dcRefresh()` | wmcDeploy.js | From wmcDashboard.html |
| `wmc-view-backup` | `renderBackup()` | backup.js + csvReport.js | Migrated from admin.html |
| `wmc-view-pages` | `WMCPageManager.render()` | pageManager.js + wmcPages.js | From wmcDashboard.html |
| `wmc-view-permissions` | `wmcRenderPermissions()` | wmcPermissions.js | From wmcDashboard.html |

---

## 3. Module Ownership Map

### Legend
- **SHARED** — loaded by both pages (infrastructure / core / utils)
- **OPS** — loaded only by admin.html
- **CMS** — loaded only by websiteManagement.html
- **MIGRATE** — currently in admin.html; moves to websiteManagement.html
- **RECONCILE** — two competing implementations; one wins (see §5)

### 3A. Infrastructure (SHARED)

| File | admin.html | websiteManagement.html |
|------|-----------|----------------------|
| js/lib/supabase.js | ✓ | ✓ |
| js/config/appConfig.js | ✓ | ✓ |
| js/config/env.js | ✓ | ✓ |
| js/services/supabaseClient.js | ✓ | ✓ |
| js/services/supabaseAdapter.js | ✓ | ✓ |
| js/services/fallbackLogger.js | ✓ | ✓ |
| js/services/dataProvider.js | ✓ | ✓ |
| js/services/healthCheck.js | ✓ | ✓ |
| js/services/serviceRegistry.js | ✓ | ✓ |
| js/services/statisticsService.js | ✓ | ✓ ADD — currently missing from WMC |

> `statisticsService.js` must be added to `websiteManagement.html` to avoid undefined-function risk in any CMS module that calls StatisticsService (Audit risk M3).

### 3B. Core (SHARED)

| File | admin.html | websiteManagement.html |
|------|-----------|----------------------|
| js/core/auth.js | ✓ | ✓ |
| js/core/eventBus.js | ✓ | ✓ |
| js/core/stateManager.js | ✓ | ✓ |
| js/modules/audit/auditLog.js | ✓ | ✓ |

### 3C. Utilities (SHARED)

| File | admin.html | websiteManagement.html |
|------|-----------|----------------------|
| js/utils/formatters.js | ✓ | ✓ |
| js/utils/dom.js | ✓ | ✓ |
| js/utils/storage.js | ✓ | ✓ |
| js/utils/validators.js | ✓ | ✓ |
| js/utils/i18n.js | ✓ | ✓ |
| js/utils/swRegister.js | ✓ | ✓ |
| js/utils/pdf.js | ✓ OPS | ✓ ADD — needed for backup PDF export |
| html2canvas (CDN) | ✓ OPS | ✓ ADD — needed for backup PDF export |
| jspdf (CDN) | ✓ OPS | ✓ ADD — needed for backup PDF export |

### 3D. Core Navigation (page-specific)

| File | admin.html | websiteManagement.html |
|------|-----------|----------------------|
| js/core/navigation.js | ✓ OPS | ✗ — new lightweight go() inline or separate file |
| js/core/appBootstrap.js | ✓ OPS | ✗ — wmcBootstrap.js serves this role |
| js/modules/website/wmcBootstrap.js | ✗ | ✓ CMS |
| js/modules/website/wmcCore.js | ✗ | ✓ CMS |

### 3E. Operations-only modules (OPS — stay in admin.html)

| Module Group | Files |
|-------------|-------|
| Data | admin-bookings.js, admin-analytics.js |
| Dashboard | dashboardLayout.js, dashboard.js, dashboardCustomizer.js, dashboardReorder.js, kpiManager.js, dashboardProfiles.js |
| Analytics | analyticsEngine.js, revenueForecast.js, servicePerformance.js, customerInsights.js, conversionAnalytics.js, analyticsWidgets.js, analyticsUI.js, analyticsCache.js, bookingTrends.js, analyticsExport.js, analyticsDashboard.js |
| Calendar | calendar.js, gcalSync.js |
| Operations settings | capacity.js, pricing.js, disposal.js |
| Quotes | quotes.js |
| Customers | customers.js |
| CRM | crmCore.js, crmTags.js, crmNotes.js, crmProfiles.js, crmTimeline.js, crmInsights.js, crmUI.js, crmAnalytics.js, crmExport.js, crmAutomation.js |
| Notifications | email.js, line.js, followUp.js, pushNotifications.js |
| Communications | communications.js |
| Inbox | inbox.js (+ inline ESM) |
| Automation | automationAudit.js, automationRules.js, automationActions.js, automationTriggers.js, automationScheduler.js, automationEngine.js, automationUI.js, reviewRequestAction.js, bookingReminderAction.js, quoteFollowUpAction.js, occupancyMonitor.js, autoStatusRules.js |
| Invoices | invoices.js |
| Search | globalSearch.js |
| Security | security.js, staff.js |
| Mobile | mobileNav.js, mobileDash.js |
| Offline | offlineDB.js, offlineQueue.js |
| Camera | cameraCapture.js |
| Misc | changelog.js, overlayBookings.js |

### 3F. CMS-only modules — MIGRATE from admin.html

These modules currently load in admin.html but belong in websiteManagement.html. They are **removed** from admin.html's `<script>` list and **added** to websiteManagement.html.

| Module | Current file | Current admin view | Target CMS view |
|--------|-------------|-------------------|-----------------|
| Hero Editor | js/modules/hero/hero.js | view-hero (hidden) | wmc-view-hero |
| Services Editor | js/modules/services/servicesEditor.js | view-services (hidden) | wmc-view-services |
| Reviews Editor | js/modules/reviews/reviewsEditor.js | view-reviews (hidden) | wmc-view-reviews |
| FAQ Editor | js/modules/faq/faq.js | view-faq (hidden) | wmc-view-faq |
| Footer Editor | js/modules/footer/footer.js | view-footer (hidden) | wmc-view-footer |
| Company Editor | js/modules/company/company.js | view-company (hidden) | wmc-view-company |
| Media Library | js/modules/media/media.js | view-media (hidden) | wmc-view-media |
| Backup | js/modules/backup/backup.js | view-backup (sidebar) | wmc-view-backup |
| CSV Report | js/modules/backup/csvReport.js | (part of backup) | wmc-view-backup |
| SEO Center | js/modules/seo/seoCenter.js | (no view, loaded) | wmc-view-seo |
| Blog Manager | js/modules/blog/blogManager.js | (no view, loaded) | wmc-view-blog |
| Site Settings | js/modules/settings/siteSettings.js | (no view, loaded) | wmc-view-settings |

### 3G. CMS-only modules — staying in websiteManagement.html (from wmcDashboard.html)

| Module | File | CMS view |
|--------|------|---------|
| WMC Permissions | js/modules/website/wmcPermissions.js | wmc-view-permissions |
| WMC Overview | js/modules/website/wmcOverview.js | wmc-view-overview |
| WMC Pages | js/modules/website/wmcPages.js | wmc-view-pages |
| WMC Blog | js/modules/website/wmcBlog.js | wmc-view-blog (RECONCILE — see §5.1) |
| WMC SEO | js/modules/website/wmcSeo.js | wmc-view-seo (RECONCILE — see §5.3) |
| WMC Theme | js/modules/website/wmcTheme.js | wmc-view-theme |
| WMC Deploy | js/modules/website/wmcDeploy.js | wmc-view-deploy |
| WMC Services (images) | js/modules/website/wmcServices.js | wmc-view-services (merged) |
| WMC Bootstrap | js/modules/website/wmcBootstrap.js | startup |
| Page Manager | js/modules/wmc/pageManager.js | wmc-view-pages |
| WMC Media picker | js/modules/wmc/wmcMedia.js | embedded in block editor |
| Block Editor | js/modules/wmc/blockEditor.js | wmc-view-pages |

---

## 4. Refactor Plan

Eight sequential phases. Each phase is independently deployable. No phase requires moving files — all changes are within HTML files and `<script>` tags.

---

### Phase R0 — Fix the broken link (1 line, zero risk)
**Goal:** Eliminate Audit critical issue C1 immediately.  
**Scope:** admin.html line 920 only.

```
CHANGE: href="websiteManagement.html"
TO:     href="websiteManagement.html"   (correct — target file will exist after R1)

INTERIM (before R1): href="wmcDashboard.html"  ← temporary correct target
FINAL   (after R1):  href="websiteManagement.html"
```

**Why first:** This is a live 404 every time an admin clicks the sidebar. Safe to fix independently of everything else.

---

### Phase R1 — Create websiteManagement.html skeleton
**Goal:** A working, auth-gated page with full navigation and empty views.  
**Input:** wmcDashboard.html (use as structural base)  
**Output:** websiteManagement.html

Tasks:
1. Clone wmcDashboard.html → websiteManagement.html
2. Rename all WMC-prefixed IDs to match new view ID scheme (§2B table)
3. Rebuild sidebar to match the 5-section structure (§1B)
4. Add empty view containers for all 16 target views
5. Keep the shared infrastructure script block intact
6. Keep wmcCore.js, wmcPermissions.js, wmcBootstrap.js
7. Keep wmcOverview.js, wmcTheme.js, wmcDeploy.js, wmcAnalytics.js, wmcPages.js, wmcBlog.js, wmcSeo.js, wmcServices.js, pageManager.js, wmcMedia.js, blockEditor.js
8. Add `js/services/statisticsService.js` to fix Audit risk M3
9. Verify auth gate works; all views show "loading..." placeholder

**Result:** websiteManagement.html is live and navigable. All views are empty.

---

### Phase R2 — Add CMS modules to websiteManagement.html
**Goal:** Load all migrating modules into the new page.  
**Scope:** websiteManagement.html `<script>` block only.

Add in this order (after wmcCore.js, before wmcBootstrap.js):

```html
<!-- PDF support (needed for backup export) -->
<script src="js/utils/pdf.js"></script>
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"></script>

<!-- Content editors — migrated from admin.html -->
<script src="js/modules/hero/hero.js"></script>
<script src="js/modules/services/servicesEditor.js"></script>
<script src="js/modules/reviews/reviewsEditor.js"></script>
<script src="js/modules/faq/faq.js"></script>
<script src="js/modules/footer/footer.js"></script>
<script src="js/modules/company/company.js"></script>
<script src="js/modules/media/media.js"></script>
<script src="js/modules/backup/backup.js"></script>
<script src="js/modules/backup/csvReport.js"></script>
<script src="js/modules/seo/seoCenter.js"></script>
<script src="js/modules/blog/blogManager.js"></script>
<script src="js/modules/settings/siteSettings.js"></script>
```

**Result:** All render functions exist in the page. Views still render nothing because nav isn't wired up yet.

---

### Phase R3 — Wire CMS navigation
**Goal:** Each sidebar link renders its view correctly.  
**Scope:** websiteManagement.html navigation code + wmcBootstrap.js

Tasks:
1. Add a `wmcGo(viewId)` function (mirrors admin.html's `go()`) to websiteManagement.html or a new `js/core/cmsNavigation.js`
2. Connect each `<button class="wmc-link" data-view="...">` to `wmcGo()`
3. In wmcBootstrap.js (or startup block), call the render function for the initial view after auth
4. For each migrated view, call its existing render function:
   - `wmc-view-hero` → `renderHero()` (hero.js — already renders into any given container)
   - `wmc-view-reviews` → `renderReviews()` (reviewsEditor.js)
   - etc.
5. Test every view renders its content

**Result:** Full navigation works. websiteManagement.html is feature-complete.

---

### Phase R4 — Remove migrated content from admin.html
**Goal:** admin.html no longer contains CMS views or modules.  
**Scope:** admin.html — HTML view blocks + `<script>` tags

**Remove these view HTML blocks:**
```
#view-hero
#view-services
#view-reviews
#view-faq
#view-footer
#view-company
#view-media
#view-backup
#view-actions   (quick actions consolidated into dashboard buttons)
```

**Remove these `<script>` tags from admin.html:**
```
js/modules/hero/hero.js
js/modules/services/servicesEditor.js
js/modules/reviews/reviewsEditor.js
js/modules/faq/faq.js
js/modules/footer/footer.js
js/modules/company/company.js
js/modules/media/media.js
js/modules/backup/backup.js
js/modules/backup/csvReport.js
js/modules/seo/seoCenter.js
js/modules/blog/blogManager.js
js/modules/settings/siteSettings.js
```

**Remove modal HTML** that serves only the removed views:
- Hero media picker overlay (`#hmpick`)
- Folder create/rename modal (`#mediaFolderModal`)
- Media preview overlay (`#mediaPreviewOverlay`)
- Disposal category modal (`#disposalCatModal`) ← KEEP — disposal stays in admin
- Review add/edit modal (`#revModal`) ← REMOVE — moves to CMS

**Update sidebar:** Replace broken WMC link with `href="websiteManagement.html"`.

**Result:** admin.html is lean. Payload reduced by ~12 modules and all hidden HTML views.

---

### Phase R5 — Retire wmcDashboard.html
**Goal:** Eliminate the redundant entry point.  
**Scope:** wmcDashboard.html

Options (choose one):
- **Option A (redirect):** Replace wmcDashboard.html body with `<meta http-equiv="refresh" content="0;url=websiteManagement.html">`. Safe — preserves any bookmarks.
- **Option B (tombstone):** Replace with a one-line HTML file that redirects and logs deprecation in the console.

Any remaining links to `wmcDashboard.html` (in admin.html, index.html, CLAUDE.md) must be updated to `websiteManagement.html`.

---

### Phase R6 — Resolve duplicate module conflicts
**Goal:** Each functional area has exactly one canonical module.  
**Scope:** Decision + code changes in the winning/losing modules.

The four conflicts to resolve (see §5 for detail):

| # | Conflict | Winning module | Losing module | Action |
|---|---------|---------------|--------------|--------|
| R6-A | Blog rendering | blogManager.js | wmcBlog.js | wmcBlog.js becomes a thin wrapper that calls blogManager.js render functions |
| R6-B | SEO rendering | seoCenter.js | wmcSeo.js | wmcSeo.js becomes a thin wrapper that calls seoCenter.js render functions |
| R6-C | Dead inbox.js | Inline ESM | inbox.js | inbox.js removed from admin.html script block |
| R6-D | Services images | wmcServices.js | n/a | servicesEditor.js (content) + wmcServices.js (images) coexist in merged panel |

---

### Phase R7 — Update CLAUDE.md
**Goal:** CLAUDE.md accurately reflects the post-refactor system.

Tasks:
1. Add `websiteManagement.html` section with full script loading order
2. Update `admin.html` script loading order (remove migrated modules, document automation/CRM/mobile phases 24–31)
3. Update repository layout table
4. Update phase history table (add this refactor as a new phase)
5. Update key globals table (add CMS globals: `renderHero`, `renderReviews`, etc.)
6. Remove wmcDashboard.html from documentation

---

## 5. Duplicate Module Reconciliation Detail

### 5.1 Blog: blogManager.js vs wmcBlog.js

| Attribute | blogManager.js | wmcBlog.js |
|-----------|---------------|-----------|
| Location | js/modules/blog/ | js/modules/website/ |
| Loaded by | admin.html (current) | wmcDashboard.html |
| Feature scope | Full blog admin (grid, editor, markdown preview, tags, categories, sidebar, publish state) | WMC blog view (likely a render wrapper) |
| Window global | `window.BlogManager` (assumed) | — |

**Decision:** `blogManager.js` is the canonical implementation. It has the full feature surface and matches the admin.html pattern of complete domain modules.

**Outcome:** `wmcBlog.js` becomes a 10-line wrapper:
```js
// wmcBlog.js — thin WMC adapter
window.wmcRenderBlog = function() {
  BlogManager.render(document.getElementById('wmc-view-blog'));
};
```

---

### 5.2 Services: servicesEditor.js vs wmcServices.js

| Attribute | servicesEditor.js | wmcServices.js |
|-----------|------------------|--------------:|
| Location | js/modules/services/ | js/modules/website/ |
| Feature scope | Content: title, description, ordering, CTA, display toggle | Images only: maps service IDs to image URLs via `hm_service_images` key in `hm_data` |

**Decision:** These two modules are **complementary, not competing.** They serve different data domains.

**Outcome:** The `wmc-view-services` view renders **both panels** in a single page:
```
┌── wmc-view-services ──────────────────────────────────────────────┐
│  Panel 1: コンテンツ (servicesEditor.js)                            │
│    Section header · Service list CRUD · Live preview              │
│  Panel 2: サービス画像 (wmcServices.js)                             │
│    Per-service image URL / Media Library picker                   │
└───────────────────────────────────────────────────────────────────┘
```

---

### 5.3 SEO: seoCenter.js vs wmcSeo.js

| Attribute | seoCenter.js | wmcSeo.js |
|-----------|-------------|---------|
| Location | js/modules/seo/ | js/modules/website/ |
| Loaded by | admin.html (current, no view container) | wmcDashboard.html |
| Feature scope | Full SEO center (title, meta, OG tags, schema, per-page score bars) | WMC SEO view |

**Decision:** `seoCenter.js` is the canonical implementation (larger scope, dedicated module folder).

**Outcome:** `wmcSeo.js` becomes a wrapper that calls `seoCenter.js` render into the CMS view container. Same pattern as blog.

---

### 5.4 Inbox: inbox.js vs inline ESM

**Decision:** The inline ESM `<script type="module">` is the working implementation (it runs last and overwrites `window.renderInbox`). `inbox.js` is dead code.

**Outcome (Phase R6-C):** Remove `<script src="js/modules/inbox/inbox.js">` from admin.html. Inline ESM is the sole inbox implementation. If inbox.js contains shared helpers, those are extracted into the ESM module first.

---

## 6. Post-Refactor Architecture Summary

### admin.html — final script count estimate

| Layer | Count |
|-------|-------|
| Infrastructure | 9 |
| Core | 5 (auth, eventBus, stateManager, navigation, appBootstrap) |
| Utils | 6 (formatters, dom, storage, validators, i18n, pdf) |
| CDN | 2 (html2canvas, jsPDF) |
| Data | 2 (admin-bookings, admin-analytics) |
| Dashboard suite | 6 |
| Analytics suite | 11 |
| Calendar | 2 |
| Operations settings | 3 (capacity, pricing, disposal) |
| Quotes | 1 |
| Customers | 1 |
| CRM | 10 |
| Notifications | 4 |
| Communications + Inbox | 2 |
| Automation | 12 |
| Invoices | 1 |
| Search | 1 |
| Security | 2 |
| Mobile / Offline / Camera | 6 |
| Misc | 3 (changelog, overlayBookings, swRegister) |
| **Total** | **~89** (down from 103) |

Modules removed: hero, servicesEditor, reviewsEditor, faq, footer, company, media, backup, csvReport, seoCenter, blogManager, siteSettings = **−14 modules**

---

### websiteManagement.html — final script count estimate

| Layer | Count |
|-------|-------|
| Infrastructure (shared) | 10 (adds statisticsService) |
| Core (shared) | 4 (auth, eventBus, stateManager, auditLog) |
| Utils (shared) | 7 (formatters, dom, storage, validators, i18n, pdf, swRegister) |
| CDN | 2 (html2canvas, jsPDF) |
| Service registry | 1 |
| WMC core + permissions | 2 |
| WMC page editor | 3 (pageManager, wmcMedia, blockEditor) |
| WMC feature modules | 8 (overview, pages, blog, seo, theme, deploy, services-images, bootstrap) |
| Migrated content modules | 12 (hero, servicesEditor, reviewsEditor, faq, footer, company, media, backup, csvReport, seoCenter, blogManager, siteSettings) |
| **Total** | **~49** |

---

### Dependency graph — post-refactor shared layer

```
                    ┌─── admin.html ────────────────────┐
                    │  Operations-only modules (89 total) │
                    │  navigation.js · appBootstrap.js   │
                    └──────────────┬────────────────────┘
                                   │
          ┌────────────────────────▼──────────────────────────┐
          │              SHARED INFRASTRUCTURE                 │
          │  supabase · appConfig · env · supabaseClient       │
          │  supabaseAdapter · statisticsService               │
          │  fallbackLogger · dataProvider · healthCheck       │
          │  serviceRegistry · auditLog                        │
          │  auth · eventBus · stateManager                    │
          │  formatters · dom · storage · validators · i18n    │
          │  swRegister                                        │
          └────────────────────────┬──────────────────────────┘
                                   │
                    ┌──────────────▼────────────────────────────┐
                    │  websiteManagement.html                    │
                    │  CMS-only modules (49 total)               │
                    │  wmcBootstrap.js (entry point)             │
                    └───────────────────────────────────────────┘
```

---

*End of Information Architecture. No code was changed.*
