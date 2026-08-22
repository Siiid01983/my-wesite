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
- Formspree: REMOVED (2026-07-03). Booking notifications are fully server-side in
  `hm-api/create-booking.php`: LINE push + an `inbox_messages` row (admin Inbox,
  linked via booking_id). No third-party form dependency remains; the arch-lock
  test fails the build if formspree.io reappears.
- `deploy.js` — gated deployment (reads `API_BASE` secret)

> Note: the site was migrated OFF Supabase. Do not assume Supabase exists; config global
> is `window.API_BASE` (not `SUPABASE_URL`/`SUPABASE_ANON_KEY`).

## Booking Architecture — SINGLE PRODUCTION BOOKING SYSTEM (LOCKED) 🔒
- **BA overlay (`#booking-app` / `openBookingApp()`) is the ONLY booking system.**
  Flow: User action → `openBookingApp()` → BA overlay collects data →
  `BookingService.createBooking()` (single source of truth) → success screen.
- All booking CTAs route to `openBookingApp()`; `#booking` is only a no-JS fallback anchor.
- The hero is a single-column marketing block (H1/badges/trust/license) with one prominent
  `今すぐ無料見積り` CTA → `openBookingApp()`. Service cards deep-link via `[data-service]` → `openBookingApp(service)`.
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
  - **Conditional rendering / `HM_HIDDEN` sentinel** — three distinct states for a
    `data-content-key` element, so an admin can intentionally REMOVE content (not
    just edit it) without leaving an empty layout gap:
      - key ABSENT from `hm_content` (never edited, or blank) → keep the built-in
        default text in index.html. (The `blank = default` invariant is preserved —
        clearing a field is NOT the same as hiding it.)
      - value `= '__HM_HIDDEN__'` (the `HM_HIDDEN` sentinel) → `_applyGlobalContent`
        sets the element to `display:none` and the layout reflows.
      - value = non-empty text → override the `textContent` (and un-hide if it was
        previously hidden).
    The sentinel is written by the editor's per-row **「非表示にする」** toggle
    (`_contentToggleHide` → `saveContentAll` stores `HM_HIDDEN`); it is a plain
    string literal duplicated in BOTH `contentRegistry.js` (admin) and
    `contentLoader.js` (public) — if you change it, change both.
  - **Hide target (avoid stranded icons)** — by default the tagged element itself
    is hidden. If it shares a wrapper with an icon (e.g. the trust-badge pills),
    add `data-content-hide="closest:<selector>"` so the WRAPPER hides instead
    (`_hideTargetFor` resolves it). The 4 trust badges use
    `data-content-hide="closest:.trust-badge-pill"`. Never hide a generic parent.
  - **Empty-container collapse** — the list/grid appliers (`_applyRevCards`,
    `_applyFaqItems`, `_applyCompanyRows`, footer columns) distinguish `null`
    (no CMS data → keep static fallback) from an explicitly EMPTY array (→ clear
    innerHTML + `display:none` on the container), and un-collapse when repopulated.
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

## Public inquiry flow — Contact Chat ONLY (legacy email form REMOVED)
The public お問い合わせ on index.html is the **Contact Chat** flow only
(`js/contact-chat.js` → `hm-api/contact-chat.php`; the 新しくお問い合わせ /
お問い合わせを再開 launchers in the `#contact` section). The legacy inline email form
("メールでお問い合わせ", `#hmContactForm`) and `js/contact-form.js` were REMOVED
(2026-08-22). Do NOT re-add a public form — route inquiries through Contact Chat.
- `hm-api/contact.php` is RETAINED (not orphaned): it is now the server-side intake
  for the customer PORTAL messaging (`js/portal/message.js` → `contact@` channel) and
  is asserted by `tests/telegram.test.php`. It still INSERTs an `inbox_messages` row
  (mailbox `contact@`), fires a Telegram alert, and emails a best-effort confirmation.
- The footer "Email Contact ・ メールでのお問い合わせ" band (direct `mailto:` to
  booking@/support@/contact@) is a SEPARATE contact method and intentionally remains.
- The `#contact` section id is unchanged, so header/footer/sticky "お問い合わせ" anchors
  still resolve (they now land on the Contact Chat launcher).

### `hm-api/rest.php` — authenticated data API (select/delete reference)
Generic PostgREST-style endpoint. **JSON POST body, not query-string.** Every
request needs `X-API-KEY` (page-served `window.API_KEY`, not sensitive) AND, for
sensitive tables, `X-ADMIN-TOKEN` (admin HMAC session token — mint ONLY via
`admin-login.php`; **never forge it from the signing secret** — that's an auth
bypass). Admin token is required for: any `delete` (any table), writes on
content tables (`hm_data, services, inbox_messages, blog_posts`), and `select`
on sensitive tables (`bookings, communications, inbox_messages, audit_log`).
- Body: `{ table, action:select|insert|upsert|update|delete, columns:"a,b",
  filters:[{col,op,val,negate?}], order:[{col,ascending}], limit, single,
  values, onConflict, returning }`
- `op` ∈ `eq neq gt gte lt lte like ilike in is`; cols/tables are allowlisted.
- **Deletes require a non-empty filter** (unfiltered → 400 `no_filter`); filter
  by the uuid `id` for a guaranteed single-row delete. Use `returning:true` to
  echo the deleted row back for confirmation.
- Example delete: `{ "table":"inbox_messages","action":"delete",
  "filters":[{"col":"id","op":"eq","val":"<uuid>"}],"returning":true }`

### Ops / diagnostic CLI scripts (server-side, CLI-only)
Two dependency-light tools live in `hm-api/`. Both are **CLI-only** (return HTTP
403 if hit over the web) and load `_config.php` directly, so they need NO API key
and NO admin token. Run from the cPanel shell (paths shown from the account home;
drop `public_html/` if already inside the web root).
- **`smtp-selftest-cli.php`** — direct SMTP connect/AUTH test via the app's own
  `hm_smtp_selftest()` (DNS → connect → STARTTLS/implicit-TLS → AUTH → optional
  send). Prints the EXACT SMTP error + code; NEVER prints `smtp_pass`. Exit 0/1.
    - `php hm-api/smtp-selftest-cli.php`                  (connect + auth only)
    - `php hm-api/smtp-selftest-cli.php you@example.com`  (+ real test send)
    - Code → fix: `smtp_auth` = wrong user/pass · `smtp_config` = blank
      `smtp_pass` · `smtp_connect`/`smtp_tls` = port/encryption mismatch (587=tls,
      465=ssl).
- **`cleanup-test-data.php`** — removes E2E test rows directly via the DB (no
  admin token, no HTTP). For a match TOKEN it deletes matching `inbox_messages`
  rows + whole Contact Chat threads, and HARD-deletes matching
  `contact_conversations` (which rest.php CANNOT — not in its allowlist). Safety:
  DRY-RUN by default, `--apply` to execute; requires a token >= 4 chars; escapes
  LIKE wildcards (literal match); all deletes in one transaction.
    - `php hm-api/cleanup-test-data.php "<token>"`          (preview)
    - `php hm-api/cleanup-test-data.php "<token>" --apply`  (delete)

### Email transport (EmailService.php + _smtp.php) — multi-mailbox / cPanel
Outbound mail routes through `EmailService::deliver()` (accounts `booking` /
`support` / `contact`). On shared cPanel there is ONE authenticating SMTP login
(`smtp_user`, e.g. `booking@`); Exim rejects/drops a message whose SMTP envelope
sender isn't that mailbox. So the **envelope sender (MAIL FROM / Return-Path /
`-f`) is ALWAYS forced to `smtp_user`** across native SMTP, PHPMailer, and
`mail()`. `mail_from_mode` in `_config.php` controls only the VISIBLE From:
`'align'` (default) = From address is `smtp_user` shown with the department
display name + Reply-To = department mailbox; `'routed'` = keep the department
address in From with a `Sender:` disclosure. Both keep the envelope aligned.
