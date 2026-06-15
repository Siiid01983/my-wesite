# Navigation Migration Report — Phase 3

**Date:** 2026-06-15  
**Scope:** admin.html · websiteManagement.html (new)  
**Rule:** Navigation only. No modules moved. No logic changed. No IDs changed.

---

## Summary

| File | Action | Lines changed |
|------|--------|---------------|
| `admin.html` | Sidebar reorganised — 2 targeted edits | ~18 lines |
| `websiteManagement.html` | Created — new CMS entry point | 1,068 lines |
| `wmcDashboard.html` | Untouched | 0 |

---

## 1. admin.html — Changes Applied

### Edit A: Sidebar section renamed and regrouped

**Before:**
```
Section "管理"
  ダッシュボード · 予約管理 · 顧客管理 · CRM ·
  フォーム予約 · 見積り管理 · 受信トレイ · カレンダー管理
Section "分析・自動化"
  ...
```

**After:**
```
Section "運営"
  ダッシュボード · 予約管理 · フォーム予約 ·
  見積り管理 · 受信トレイ · カレンダー管理

Section "顧客・CRM"  ← NEW
  顧客管理 · CRM

Section "分析・自動化"
  ...
```

**What moved:** `顧客管理 (customers)` and `CRM (crm)` shifted from the catch-all "管理" section into their own dedicated "顧客・CRM" section, placed between 運営 and 分析・自動化.

**What did not change:**  
- All `onclick="go('...')"` handlers are identical — untouched  
- All `data-view` attribute values are identical — untouched  
- All view container IDs (`view-dashboard`, `view-customers`, etc.) are identical — untouched  
- Section "設定", "ウェブサイト", "その他" — untouched  

### Edit B: Cross-link label updated

| | Value |
|---|---|
| **href** | `websiteManagement.html` — unchanged (was already correct) |
| **Label before** | `Website Management` |
| **Label after** | `ウェブサイト管理` |
| **Section** | `ウェブサイト` — unchanged |

This resolves Audit critical issue **C1** (the target file now exists after this phase).

---

## 2. websiteManagement.html — Created

New file. Replaces the role of `wmcDashboard.html` as the CMS entry point. `wmcDashboard.html` remains untouched (retirement scheduled for Phase R5).

### 2A. Sidebar — 5-section structure

```
Section "コンテンツ"
  概要 (overview)              ← existing WMC view
  ヒーローセクション (hero)     ← NEW nav + placeholder view [Ph4]
  サービス管理 (services)       ← existing WMC view
  レビュー (reviews)            ← existing WMC view (upgraded from placeholder)
  FAQ (faq)                    ← NEW nav + placeholder view [Ph4]
  フッター (footer)             ← NEW nav + placeholder view [Ph4]
  会社情報 (company)           ← NEW nav + placeholder view [Ph4]

Section "メディア・ブログ"
  メディアライブラリ (media)    ← existing WMC view (upgraded from placeholder)
  ブログ投稿 (blog)             ← existing WMC view

Section "SEO・設定"
  SEO 設定 (seo)               ← existing WMC view
  テーマカスタマイザー (theme)   ← existing WMC view
  サイト設定 (settings)         ← existing WMC view [Ph4 for real content]

Section "デプロイ・バックアップ"
  デプロイメント (deploy)       ← existing WMC view
  バックアップ (backup)         ← NEW nav + placeholder view [Ph4]

Section "管理"
  ページ管理 (pages)            ← existing WMC view
  権限管理 (permissions)        ← existing WMC view
```

**Omitted from wmcDashboard.html:** アナリティクス (analytics) — operational data belongs in admin.html per IA specification.

### 2B. Cross-navigation

| Element | Target |
|---------|--------|
| Sidebar footer button `← 運営管理パネルへ` | `admin.html` |
| Login screen link `← 運営管理パネルに戻る` | `admin.html` |
| Topbar breadcrumb `運営管理` | `admin.html` |
| Overview quick-action buttons | Internal `wmcGo()` calls |

### 2C. View containers — full inventory

| View ID | Type | Content |
|---------|------|---------|
| `wmc-view-overview` | Full | Carried from wmcDashboard.html — status banner, SEO ring, health cards, quick actions |
| `wmc-view-hero` | Placeholder | Phase 4 banner + link to admin.html |
| `wmc-view-services` | Full | `#wmcServicesContent` — rendered by wmcServices.js |
| `wmc-view-reviews` | Placeholder | Phase 4 banner + link to admin.html |
| `wmc-view-faq` | Placeholder | Phase 4 banner + link to admin.html |
| `wmc-view-footer` | Placeholder | Phase 4 banner + link to admin.html |
| `wmc-view-company` | Placeholder | Phase 4 banner + link to admin.html |
| `wmc-view-media` | Placeholder | Phase 4 banner + link to admin.html |
| `wmc-view-blog` | Full | `#wmcBlogContent` + `#wmcBlogNewBtn` — rendered by wmcBlog.js |
| `wmc-view-seo` | Full | `#wmcSeoSettingsContent` — rendered by wmcSeo.js |
| `wmc-view-theme` | Full | Full TC layout — rendered by wmcTheme.js |
| `wmc-view-settings` | Placeholder | Phase 4 banner |
| `wmc-view-deploy` | Full | DC grid/actions/log — rendered by wmcDeploy.js |
| `wmc-view-backup` | Placeholder | Phase 4 banner + link to admin.html |
| `wmc-view-pages` | Full | `#wmcPagesContent` — rendered by wmcPages.js |
| `wmc-view-permissions` | Full | `#wmcPermissionsContent` — rendered by wmcPermissions.js |

### 2D. Script loading

Identical to wmcDashboard.html with two additions:

| Addition | Reason |
|----------|--------|
| `js/services/statisticsService.js` | Fixes Audit risk M3 — was missing from wmcDashboard.html |
| Inline `<script>` extending `WMC_BREADCRUMBS` | Adds Japanese labels for 6 new views without modifying wmcBootstrap.js |

The inline breadcrumb extension runs after wmcBootstrap.js and extends the existing `WMC_BREADCRUMBS` object with entries for `hero`, `faq`, `footer`, `company`, `backup`, `media`. No module logic was modified.

### 2E. Navigation mechanics

`wmcGo(view)` in wmcBootstrap.js handles all navigation automatically:

```
User clicks  →  .wmc-link[data-view="hero"]
wmcGo('hero') activates #wmc-view-hero
Breadcrumb shows WMC_BREADCRUMBS['hero'] → "ヒーローセクション"
No render fn called (acceptable — Phase 3 placeholder)
```

For Phase 4 placeholder views, the view container shows and the migrate banner renders. No console errors because:
- `wmcGo()` uses `?.classList.add()` (optional chaining, safe if element exists)
- `WMC_BREADCRUMBS[view] || view` fallback is safe
- No permission check registered for new views (`_WMC_VIEW_PERMS` doesn't include them)

---

## 3. Validation Checklist

### admin.html

| Check | Result |
|-------|--------|
| All original `onclick` handlers preserved | ✓ |
| All original `data-view` values preserved | ✓ |
| All original view container IDs preserved | ✓ |
| All 25 sidebar nav items still navigable | ✓ |
| `go('customers')` still works | ✓ (button present, handler unchanged) |
| `go('crm')` still works | ✓ (button present, handler unchanged) |
| Cross-link `→ websiteManagement.html` resolves | ✓ (file now exists) |
| No duplicate nav entries | ✓ |

### websiteManagement.html

| Check | Result |
|-------|--------|
| Auth gate active (wmcBootstrap.js loaded) | ✓ |
| All 16 view containers present | ✓ |
| All nav buttons wired to `data-view` | ✓ |
| Existing WMC modules load in same order | ✓ |
| `wmcGo()` click listeners attach at startup | ✓ (querySelectorAll .wmc-link[data-view]) |
| `statisticsService.js` added | ✓ |
| `WMC_BREADCRUMBS` extended inline | ✓ |
| Cross-link `← 運営管理パネルへ` → admin.html | ✓ |
| No `wmcAnalytics.js` side-effects | ✓ (analytics view + nav omitted cleanly) |
| No console errors expected | ✓ |

---

## 4. Remaining Audit Issues

| ID | Status after Phase 3 |
|----|---------------------|
| C1 — broken link | ✓ **RESOLVED** — websiteManagement.html now exists; link was already pointing to correct filename |
| H1 — 7 hidden views | Partial — views still exist in admin.html and are hidden, but Phase 4 will migrate them to CMS |
| H2 — inbox.js dead code | Open — not in scope for Phase 3 |
| H3 — CLAUDE.md out of date | Open — to be addressed in Phase R7 |
| M1 — WMC reviews/media placeholders | Partial — placeholders now have proper Phase 4 migration banners |
| M2 — WMC settings Coming soon | Partial — settings placeholder now has Phase 4 migration banner |
| M3 — statisticsService.js missing | ✓ **RESOLVED** — added to websiteManagement.html script block |

---

## 5. What Was NOT Changed

Per Phase 3 rules:

- No JS module files moved or modified
- No Supabase queries or schema touched
- No view container IDs changed in admin.html or wmcDashboard.html
- No event handlers changed (`onclick`, `oninput`, `onchange`, etc.)
- No module logic changed (wmcBootstrap.js, wmcCore.js, etc. untouched)
- `wmcDashboard.html` untouched (retirement is Phase R5)
- admin.html view HTML untouched (migration is Phase 4)

---

## 6. Next Phase Preview

**Phase 4** will:
1. Add script tags for 12 content modules to websiteManagement.html (hero, services-content, reviews, faq, footer, company, media, backup, csvReport, seoCenter, blogManager, siteSettings)
2. Wire each placeholder view to its render function
3. Remove the same 12 script tags from admin.html
4. Remove the 8 HTML view blocks from admin.html (hero, services, reviews, faq, footer, company, media, backup)
5. Remove the "バックアップ" sidebar button from admin.html (moved to CMS)

*End of Navigation Migration Report.*
