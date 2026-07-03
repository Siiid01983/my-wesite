# Hello Moving — Project Memory

## Project Overview
- Business: Hello Moving (hello-moving.com)
- Licensed moving company in Japan, Tokyo/Kanto market
- Bilingual: English + Japanese
- 14-year business history, ministry license (第 431320058126 号)
- Listed on Curama (くらしのマーケット) with strong ratings

## Core Rule ⚠️
Treat these as the stable public/admin surface — prefer new files over edits, and
get sign-off before changing them:
- index.html
- styles.css
- script.js
- admin.html
- Any config files (js/config/*, hm-api/_config.php)

Prefer adding new files over modifying core files.

## Stack
- Static HTML + CSS + JS (frontend, no build step — plain `<script>` tags, browser globals)
- Self-hosted PHP + MySQL backend on cPanel (dzsecurity.com), under `hm-api/`
- localStorage (fallback only)
- `js/lib/apiClient.js` is the data seam: `window.ApiClient.createClient(API_BASE)`
  presents a query-builder/Realtime/Storage interface over `fetch()` to `hm-api/*.php`
- Formspree endpoint: xdajqzlo (`https://formspree.io/f/xdajqzlo`)
- `deploy.js` — gated deployment (reads `API_BASE` secret)

> Note: the site was migrated OFF Supabase. Do not assume Supabase exists; config global
> is `window.API_BASE` (not `SUPABASE_URL`/`SUPABASE_ANON_KEY`).

## Booking Architecture — SINGLE PRODUCTION BOOKING SYSTEM (LOCKED) 🔒
- **BA overlay (`#booking-app` / `openBookingApp()`) is the ONLY booking system.**
  Flow: User action → `openBookingApp()` → BA overlay collects data →
  `BookingService.createBooking()` (single source of truth) → success screen.
- All booking CTAs route to `openBookingApp()`; `#booking` is only a no-JS fallback anchor.
- The hero is a single-column marketing block (H1/badges/trust/license) with one prominent
  `今すぐ予約する` CTA → `openBookingApp()`. Service cards deep-link via `[data-service]` → `openBookingApp(service)`.
- DEPRECATED / REMOVED FROM PRODUCTION:
  - Hero `quoteForm` (multi-step hero form) — **removed entirely** (markup + CSS + JS). The hero
    no longer renders any form; the BA overlay is the sole booking entry.
  - `booking-app.html` — deleted (was an orphan standalone booking page).
  - `#quote` fully removed — the hero section id was renamed `quote`→`home-hero`; no `#quote` remains anywhere.
  - `bk*` inline multi-step form + `doSubmit()` in `index.html` — dead code (DOM removed),
    neutralized to a no-op; do NOT revive.
  - quoteForm's old Formspree + `BookingService.createBooking` dual pipeline — removed.
- Regression guard: `tests/architecture-lock.test.js` (`npm run test:arch`) FAILS THE BUILD
  if any legacy booking pattern reappears. Do NOT relax it — fix the code instead.

## Brand
- Colors: #2C3626 (dark green), #9AB57A (sage), #F9F9F6 (off-white)
- Fonts: DM Serif Display + DM Sans
- Style: Mobile-first, Curama-inspired UX

## Architecture
- Service layer pattern: UI → Service Layer → DataProvider → API (hm-api) / localStorage
- `window.Services` registry for all services
- `Adapter` compatibility/domain layer (all domain writes go through it)
- Error Boundary: read/write return `{ data, source, error }` (`source: 'api' | 'cache' | 'localStorage'`)
- Emergency rollback flag: `FORCE_FALLBACK` (in `js/config/appConfig.js`)

## Key Files
- index.html — public marketing site (includes the BA overlay booking flow: #booking-app / openBookingApp — the single production booking entry point)
- login.html / portal.html — customer portal (email + booking-reference login via hm-api/auth.php)
- admin.html — admin panel shell (HTML + CSS only)
- wmcDashboard.html / websiteManagement.html — Website Management Center
- admin-bookings.js — bookings management (CalendarService, BookingService)
- admin-analytics.js — analytics
- bookingService.js / calendarService.js — public booking + calendar
- js/services/healthCheck.js — connectivity/health probe
- deploy.js — gated deployment
- hm-api/rest.php — generic PostgREST-style endpoint (table/column allowlist)

## CMS Content Modules (Website Management Center)
CMS editors live in `js/modules/*` and persist through `Adapter` to `hm_data` KV
(localStorage + MySQL). They do NOT rewrite HTML files — `index.html` holds the
static fallback, and `js/services/contentLoader.js` `_applyX()` re-applies the
saved KV onto the DOM (by element id) on every public page load. Each editor is
registered in `websiteManagement.html` (nav button + `#wmc-view-*` container +
`<script>` include + `wmcGo` render dispatch + `WMC_BREADCRUMBS` label).
- **Header nav** — `js/modules/header/header.js` (view `header`, KV key `hm_header`).
  Edits the DESKTOP header nav links only (add/remove/reorder); the mobile menu
  (`#mobileNav`) is intentionally NOT managed (keeps its own list + close-on-tap
  listeners). Applied by `_applyHeader` → `<ul id="headerNavEl">`; a per-link
  `booking:true` flag re-emits the `openBookingApp()` handler. Logo / brand name /
  brand color are NOT here — they live in Site Settings → Brand (`hm_settings`),
  applied via `_applySiteSettings`. Do not duplicate them into the Header module.
- **Global Content Manager** — `js/modules/content/contentRegistry.js` (view
  `content`, tab "コンテンツ & アイコン", KV key `hm_content`). A searchable
  key/value editor for static site copy NOT owned by a dedicated module. Unlike
  the id-based `_applyX` editors, this one is ATTRIBUTE-based: elements in
  `index.html` carry `data-content-key="<key>"`, and `_applyGlobalContent`
  (contentLoader.js) sets their `textContent` from the `{key:text}` map on public
  load. `CONTENT_REGISTRY` in the module lists every key (group + label + code
  default); it MUST stay 1:1 with the `data-content-key` attributes in index.html.
  Rules that keep it non-destructive / conflict-free:
    - `textContent` only (never innerHTML) — can't inject markup or disturb child
      SVGs. For an element that contains an icon, wrap just the text in a
      `<span data-content-key>` (see the trust-badge pills).
    - Blank field = keep the built-in default (only non-empty overrides are stored).
    - Tag ONLY pure-text elements that no other module owns. Never tag an element
      that already has an `_applyX`-managed id (e.g. hero H1/sub-text/CTA are owned
      by the Hero tab and must stay untagged).
    - To add a key: tag the element in index.html + add a matching CONTENT_REGISTRY
      row. Current coverage (~65 keys): hero extras, trust strip/badges, disposal,
      commitments, process, booking band.
- Sibling editors follow the same pattern: hero (`hm_hero`), footer (`hm_footer`),
  faq (`hm_faq`), company, services, reviews, seo (`hm_seo`), settings (`hm_settings`).

## Services Model
6 services (order matters — Emergency is first, full-width featured card):
1. 当日・お急ぎ引越しプラン — FEATURED
2. 単身引越し
3. カップル・ご夫婦引越し
4. 学生・新生活引越し
5. 不用品回収・処分サービス
6. 家具組立・分解

## Dev Rules
- Mobile-first always
- Prefer new files over modifying core files; confirm before touching the stable surface
- Use brand palette strictly
- New components as standalone HTML files where practical
- Generate Claude Code prompts for complex changes when asked, don't execute directly
