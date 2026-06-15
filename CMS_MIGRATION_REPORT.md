# CMS Migration Report — Phase 4

**Date:** 2026-06-15  
**Scope:** admin.html → websiteManagement.html module migration  
**Status:** Complete

---

## 1. Completed Moves

### 1A. JavaScript modules — removed from admin.html, added to websiteManagement.html

| Module | File | admin.html | websiteManagement.html |
|--------|------|-----------|----------------------|
| Hero Editor | js/modules/hero/hero.js | Removed | Added |
| Services Editor | js/modules/services/servicesEditor.js | Removed | Added |
| Reviews Editor | js/modules/reviews/reviewsEditor.js | Removed | Added |
| FAQ Editor | js/modules/faq/faq.js | Removed | Added |
| Footer Editor | js/modules/footer/footer.js | Removed | Added |
| Company Info | js/modules/company/company.js | Removed | Added |
| Media Library | js/modules/media/media.js | Removed | Added |
| SEO Center | js/modules/seo/seoCenter.js | Removed | Added |
| Blog Manager | js/modules/blog/blogManager.js | Removed | Added |
| Site Settings | js/modules/settings/siteSettings.js | Removed | Added |
| Backup | js/modules/backup/backup.js | Kept* | Added |
| CSV Report | js/modules/backup/csvReport.js | Kept* | Added |
| PDF Utils | js/utils/pdf.js | Kept | Added |
| html2canvas CDN | (CDN) | Kept | Added |
| jsPDF CDN | (CDN) | Kept | Added |

> **\* backup.js / csvReport.js** kept in admin.html because `view-actions` (Quick Actions) calls `generateReport()`, `downloadPDFReport()`, `printReport()`, `clearAllData()` — removing them would break those handlers. Both files now load in both pages.

### 1B. HTML view containers — moved from admin.html to websiteManagement.html

Each view uses a two-layer wrapper to preserve original IDs while plugging into the WMC navigation system:

```
<div class="wmc-view" id="wmc-view-{name}">   ← wmcGo() show/hide
  <div id="view-{name}">                        ← original ID (module renders here)
    …original HTML structure…
  </div>
</div>
```

| View | Original ID preserved | Admin source | CMS target |
|------|----------------------|-------------|-----------|
| Hero Section | `view-hero` | view-hero | wmc-view-hero |
| Services | `view-services` | view-services | wmc-view-services |
| Reviews | `view-reviews` | view-reviews | wmc-view-reviews |
| FAQ | `view-faq` | view-faq | wmc-view-faq |
| Footer | `view-footer` | view-footer | wmc-view-footer |
| Company Info | `view-company` | view-company | wmc-view-company |
| Media Library | `view-media` | view-media | wmc-view-media |
| Backup | `view-backup` | view-backup | wmc-view-backup |
| SEO Center | `view-seo` / `seoContent` | view-seo | wmc-view-seo |
| Blog Manager | `view-blog` / `blogContent` | view-blog | wmc-view-blog |
| Site Settings | `view-site-settings` / `siteSettingsContent` | view-site-settings | wmc-view-settings |

### 1C. HTML modals — moved from admin.html to websiteManagement.html

| Modal ID | Used by | Status |
|----------|---------|--------|
| `heroMediaPick` | hero.js (background image picker) | Moved |
| `svcModal` | servicesEditor.js (add/edit service) | Moved |
| `revModal` | reviewsEditor.js (add/edit review) | Moved |
| `companyModal` | company.js (add/edit row) | Moved |
| `faqModal` | faq.js (add/edit FAQ item) | Moved |
| `mediaPreviewOverlay` | media.js (full-screen preview) | Moved |
| `mediaFolderModal` | media.js (create/rename folder) | Moved |

**Modals remaining in admin.html** (operations-only):  
`editModal`, `detailModal`, `replyModal`, `reportModal`, `custModal`, `disposalCatModal`, `disposalItemModal`, `staffModal`, `staffResetModal`, `cameraModal`

### 1D. Admin sidebar cleanup

| Change | Detail |
|--------|--------|
| Section "管理" → "運営" | Renamed to reflect Operations-only purpose |
| New section "顧客・CRM" | customers + crm buttons moved here from 運営 |
| CMS sidebar buttons removed | reviews, services, faq, company, footer, hero buttons removed |
| Backup sidebar button removed | `data-view="backup"` removed (backup now in CMS) |
| Cross-link fixed | href now points to `websiteManagement.html` (valid), label updated to "ウェブサイト管理" |

### 1E. CSS added to websiteManagement.html

All admin-compatible CSS classes needed by migrated modules were added to websiteManagement.html's `<style>` block:

- Panel system (`.panel`, `.panel-head`, `.panel-body`, `.panel-title`)
- Badge system (`.badge`, `.badge-*`)
- Table styles (`table`, `thead`, `tbody`, `td`, `.td-*`)
- Extended button variants (`.btn-danger`, `.btn-green`, `.btn-icon`)
- Form/input system (`.input`, `.sel`, `.m-field`, `.m-label`, `.m-input`, `.m-ta`, `.m-row`, `.m-actions`)
- Modal/overlay system (`.overlay`, `.modal`, `.modal-title`)
- Toggle switch (`.toggle`, `.toggle-track`, `.toggle-thumb`)
- Empty state (`.empty`), search bar (`.search-bar`, `.search-input`)
- Settings grid (`.settings-grid`, `.settings-row`, `.settings-label`)
- Hero editor (`.hero-layout`, `.hero-prev-card`, `.hbadge-*`, `.hhist-*`, `.hmpick-*`)
- Services editor (`.svc-prev-*`, `.svc-save-ind`)
- Reviews editor (`.star-row`, `.star-btn`, `.rev-*`, `.media-tab`)
- FAQ editor (`.faq-prev-*`, `.faq-save-ind`)
- Footer editor (`.footer-prev-*`, `.footer-link-*`, `.footer-save-ind`)
- Company editor (`.comp-prev-*`, `.company-save-ind`)
- Media library (`.media-upload-zone`, `.media-grid`, `.media-card`, `.media-*`, `.media-preview-overlay`)
- Backup (`.import-msg`, `.import-ok`, `.import-err`)
- SEO Center (`.seo-*`)
- Blog Manager (`.blog-card`, `.blog-grid`, `.blog-editor-*`)

### 1F. Navigation wiring (websiteManagement.html)

Two inline scripts added after wmcBootstrap.js:

**Script 1 — Extend WMC_BREADCRUMBS**: adds Japanese labels for all new CMS views (hero, faq, footer, company, backup, media, settings).

**Script 2 — Navigation glue**: wraps `wmcGo()` to call each CMS module's render function when the view is navigated to:

```js
if (view === 'hero')     renderHero();
if (view === 'services') renderServices();
if (view === 'reviews')  renderReviews();
if (view === 'faq')      renderFaq();
if (view === 'footer')   renderFooter();
if (view === 'company')  renderCompany();
if (view === 'media')    renderMedia();
if (view === 'backup')   renderBackup();
if (view === 'seo')      renderSEO();
if (view === 'blog')     renderBlog();
if (view === 'settings') renderSiteSettings();
```

All calls are guarded with `typeof fn === 'function'` checks to prevent errors if a module fails to load.

### 1G. Dual-module reconciliation

Two CMS domains had competing implementations:

| Domain | CMS module (canonical) | WMC module (hidden) | Approach |
|--------|----------------------|--------------------|---------| 
| Blog | blogManager.js | wmcBlog.js | `wmcBlogContent` container hidden via `display:none`; blogManager.js renders into `blogContent` |
| SEO | seoCenter.js | wmcSeo.js | `wmcSeoSettingsContent` container hidden via `display:none`; seoCenter.js renders into `seoContent` |
| Services | servicesEditor.js (content) + wmcServices.js (images) | — | Both active in merged view; servicesEditor renders content, wmcServices renders image manager below |

---

## 2. Validation Results

### admin.html (Operations Platform) — 39/39 checks pass

| Category | Checks | Result |
|----------|--------|--------|
| CMS scripts absent | 10 modules removed | ✓ All 10 absent |
| CMS view HTML absent | 11 views removed | ✓ All 11 absent |
| CMS modals absent | 7 modals removed | ✓ All 7 absent |
| Operations views preserved | calendar, bookings, email, security, health | ✓ All present |
| Operations modals preserved | editModal, custModal | ✓ All present |
| Backup scripts preserved | backup.js, csvReport.js | ✓ Both present |
| Backup sidebar button removed | data-view="backup" | ✓ Absent |
| Nav sections correct | 運営, 顧客・CRM, ウェブサイト管理 | ✓ All present |

**admin.html line count:** 1,846 (reduced from original ~2,764 by 918 lines)

### websiteManagement.html (Website CMS) — 49/49 checks pass

| Category | Checks | Result |
|----------|--------|--------|
| CMS scripts present | 14 scripts (including pdf + CDN) | ✓ All 14 present |
| CMS view containers present | 11 wmc-view + 11 inner view IDs | ✓ All 22 IDs present |
| CMS modals present | 7 modals | ✓ All 7 present |
| Navigation glue | wmcGo wrapper, render calls | ✓ Present |
| CSS classes | panel, media-grid, hero-layout | ✓ Present |

**websiteManagement.html line count:** 1,774

---

## 3. Preserved Invariants

| Requirement | Status |
|-------------|--------|
| All original element IDs preserved (`view-hero`, `view-services`, etc.) | ✓ Inner div IDs match exactly |
| All CSS classes preserved (no renaming) | ✓ Classes carried verbatim |
| All Supabase integrations preserved (Adapter, DataProvider) | ✓ Both pages load full infrastructure stack |
| All localStorage keys preserved (hm_data, hm_admin_*, etc.) | ✓ No key names changed |
| All event handlers preserved (onclick, oninput, onchange) | ✓ Copied verbatim; no handler modified |
| Permissions preserved (Auth gate on both pages) | ✓ wmcBootstrap.js auth unchanged |
| navigation.js `go()` function unchanged | ✓ navigation.js not touched |
| wmcBootstrap.js `wmcGo()` function unchanged | ✓ Wrapped, not modified |
| No JS module files deleted or renamed | ✓ All 12 files remain in js/modules/ |
| No database schema changes | ✓ No schema touched |

---

## 4. Blockers Encountered & Resolutions

| Blocker | Resolution |
|---------|-----------|
| PowerShell `-NoNewline` collapsed file to 1 line | Rebuilt from `git show HEAD:admin.html` with correct line-by-line filtering |
| Original HEAD line numbers differed from expected | Used PowerShell pattern search to find correct line numbers before applying ranges |
| Phase 3 sidebar string replacement failed (Japanese encoding) | Replaced entire `<nav class="sb-nav">` block with known-correct HTML using positional string splicing |
| wmcBlog.js and wmcSeo.js conflict with canonical modules | Existing WMC render containers (`wmcBlogContent`, `wmcSeoSettingsContent`) hidden via `display:none` |
| backup.js removal would break Quick Actions | Kept backup.js and csvReport.js in both pages |

---

## 5. Remaining Work (Future Phases)

| Phase | Task |
|-------|------|
| Phase R5 | Retire wmcDashboard.html (replace with redirect to websiteManagement.html) |
| Phase R6 | Resolve wmcBlog.js / wmcSeo.js wrappers (make them proper delegates) |
| Phase R7 | Update CLAUDE.md script loading documentation for both pages |
| Post-Phase | Update any WMC quick-action links that still point to admin.html for hero/faq/etc. |

---

*End of CMS Migration Report. No module files were deleted. No database was touched.*
