# CMS Synchronization Baseline

**Status:** FROZEN — stable baseline as of 2026-06-30
**Merge commit:** `7b4712a` (PR #28)
**Principle:** Website Management (the CMS) is the **single source of truth** for the public site.

---

## Data flow (the contract)

```
CMS module  →  Adapter (apiAdapter.js)  →  hm_data KV  ┐
  (save)        wt(key,value): localStorage + API upsert │
                                                          ▼
                              hm_data / services / reviews / calendar_availability
                                                          │
public page  ←  ContentLoader (js/services/contentLoader.js)  ←┘
   (render)       fetches on load, applies to index.html DOM targets
```

A field is **synchronized** only when all three align:
1. **Save key** the CMS writes == 2. **Load key** ContentLoader reads == 3. a **real public DOM target** exists.

The Site Settings brand/identity layer is applied by `ContentLoader._applySiteSettings`
(logo, favicon, color, logo size, wordmark, LINE, email, phone). Theme CSS and SEO
`<head>` tags are applied without editing `index.html` markup (DOM-injected).

---

## ✅ Synchronized sections (CMS → public, verified end-to-end)

| Section | CMS module | Storage key(s) | Public target / renderer |
|---|---|---|---|
| **Site Settings — company** | `siteSettings.js` | `hm_settings` | `.brand-name` wordmark |
| **Site Settings — contact** | `siteSettings.js` | `hm_settings` | `a[href^=mailto:]`, `a[href^=tel:]` |
| **Site Settings — brand** | `siteSettings.js` | `hm_settings` | `img.brand-mark` (logo), `link[rel=icon]` (favicon), `--navy` + `theme-color` (color), `HM_applyLogoSize` (logo size) |
| **Social — LINE** | `siteSettings.js` | `hm_settings` | `a[href*=line.me]` |
| **Hero** | `hero.js` | `hm_hero` | `heroTitleJa/En`, `heroSubPrimary/Secondary`, `heroCtaBookSup/Lbl`, `heroCtaLine` |
| **Services — cards** | `servicesEditor.js` | `services` table / `hm_services` | `serviceCardsGrid` via `HM_renderServiceCards` (slug-keyed) |
| **Services — section meta** | `servicesEditor.js` | `hm_services_section` | `svcEyebrowEl`, `svcTitleEl`, `svcLeadEl` *(wired in this baseline)* |
| **Service Images** | `wmcServices.js` | `hm_service_images` | service card images |
| **Company** | `company.js` | `hm_company_rows`, `hm_company_section` | `companyTableEl`, `compEyebrowEl`, `compTitleEl` |
| **FAQ** | `faq.js` | `hm_faq`, `hm_faq_section` | `faqListEl`, `faqEyebrowEl`, `faqTitleEl`, `faqLeadEl` |
| **Reviews** | `reviewsEditor.js` | `reviews` table, `hm_reviews_section` | `revGridEl`, `revEyebrowEl/TitleEl/LeadEl`, `revGmbScore/Count` |
| **Footer** | `footer.js` | `hm_footer` | `footerDescEl`, `footerCopyrightEl`, `footerLicenseEl` *(license wired in this baseline)*, `footerCol{n}El`/`LinksEl` |
| **Theme** | `wmcTheme.js` | `hm_custom_theme_css` | injected `<style id="hm-theme-override">` |
| **SEO (home)** | `seoCenter.js` | `hm_seo` | `<head>`: title, description, canonical, OG, Twitter, JSON-LD *(save + render wired in this baseline)* |

---

## ⏸️ / ⚠️ Intentionally NOT synchronized (with reasons)

| Item | Storage | Reason it is not wired |
|---|---|---|
| **Blog posts** | `hm_blog_posts` | **Deferred.** Saved and API-synced, but no public blog page exists yet. Wiring requires a new public page — intentionally postponed to freeze the CMS architecture first. |
| **Site Settings — company.description / industry** | `hm_settings` | No public element displays them. They feed the admin header and SEO schema context only. No obvious public slot to bind to. |
| **Site Settings — contact.address / city / prefecture / postal** | `hm_settings` | Deliberately not rendered to avoid a **second source of truth** for the address. The **Company** section table is the canonical owner of the public address row. |
| **Social — Twitter / Facebook / Instagram / YouTube** | `hm_settings` | The public site has no markup/icons for these networks. Fields are retained for future use; they have no public footprint today. |
| **SEO — services / booking / reviews / about pages** | `hm_seo` | These are virtual SEO entries; only `index.html` is a real page. Only the **home** entry is consumed. The others are future-proofing for when standalone pages exist. |

---

## 🧹 Removed in this baseline (no longer editable — were orphaned)

These hero fields were retired by the booking-architecture lock (single-CTA hero +
static trust strip) and had **no public destination**, so they were removed from the
editor, reader, Adapter defaults, and public renderer to prevent editable-but-dead fields:

- Hero **quote CTA** (`cta_quote_sup`, `cta_quote_lbl`)
- Hero **trust badges** (`trust_badges`)
- Hero **background image** (`bg_image`)

---

## Regression guard

- `tests/architecture-lock.test.js` (`npm run test:arch`) — booking architecture lock (20 checks).
- **Invariant to preserve:** for every CMS field with a public destination,
  *save key == load key == existing DOM target*. Adding a new editable field
  REQUIRES adding both a ContentLoader applier and a public target, or it must be
  documented above as intentionally unsynchronized.

---

## Verification performed (2026-06-30)

- `npm run test:arch` → 20/20 pass.
- `node --check` clean on all touched JS.
- Production (`https://hello-moving.com`) static assets confirmed post-deploy:
  - `index.html` carries `svcEyebrowEl/svcTitleEl/svcLeadEl` + `footerLicenseEl`.
  - `contentLoader.js` carries `_applySeo()` + `_applySeo(kv.hm_seo)` + `footerLicenseEl` + full Site Settings appliers.
  - `seoCenter.js` carries `Adapter.saveData('hm_seo', …)`.
  - `websiteManagement.html` carries 0 dead hero fields.
