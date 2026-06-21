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
