# Hello Moving — Codebase Guide

## Project overview

Hello Moving is a premium Japanese minimalist moving company website.
It has two distinct surfaces:

| Surface | Files | Purpose |
|---|---|---|
| **Public site** | `index.html`, `styles.css`, `script.js`, `bookingService.js`, `calendarService.js` | Customer-facing marketing + booking form |
| **Admin panel** | `admin.html` | Single-page admin for bookings, calendar, pricing, reviews, content editing |

The stack is deliberately no-build: plain `<script>` tags, no bundler, no framework.
All JavaScript runs as browser globals.

---

## Repository layout

```
my-website/
├── index.html              # Public site
├── admin.html              # Admin panel (~7000 lines, single HTML file)
├── styles.css              # Public site styles
├── script.js               # Public site JS (calendar, quote form, etc.)
├── bookingService.js       # Booking form submission + Supabase write
├── calendarService.js      # Public calendar availability reader
├── review.html             # Public review submission page
├── admin-reviews.html      # Admin reviews print page
│
├── js/
│   ├── config/
│   │   ├── appConfig.js        # Global HM_CONFIG object
│   │   └── env.js              # Supabase credentials (gitignored)
│   │   └── env.example.js      # Credentials template
│   └── services/
│       ├── supabaseClient.js   # window.SupabaseClient singleton
│       ├── supabaseAdapter.js  # window.Adapter — domain CRUD layer
│       ├── statisticsService.js# window.StatisticsService — dashboard stats
│       ├── fallbackLogger.js   # window.FallbackLogger — localStorage event log
│       ├── dataProvider.js     # window.DataProvider — generic CRUD + cache + retry
│       └── serviceRegistry.js  # window.Services — service locator
│
├── tests/
│   └── dataProvider.test.js    # 20-case unit test suite (node:test + Playwright)
│
├── package.json            # Dependencies: playwright, @supabase/supabase-js
└── serve.js                # Local dev server on :5050
```

---

## Script loading order

Both HTML files load scripts in this order. **Order matters — do not reorder.**

### admin.html

```html
<!-- 1. Supabase UMD (CDN) -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<!-- 2. Global config -->
<script src="js/config/appConfig.js"></script>
<!-- 3. Credentials (gitignored) -->
<script src="js/config/env.js"></script>
<!-- 4. Supabase client singleton -->
<script src="js/services/supabaseClient.js"></script>
<!-- 5. Domain adapter (Adapter.*) -->
<script src="js/services/supabaseAdapter.js"></script>
<!-- 6. Dashboard statistics -->
<script src="js/services/statisticsService.js"></script>
<!-- 7. Fallback event logger -->
<script src="js/services/fallbackLogger.js"></script>
<!-- 8. Generic data provider -->
<script src="js/services/dataProvider.js"></script>
<!-- 9. Service locator -->
<script src="js/services/serviceRegistry.js"></script>
<!-- 10. Admin application (inline <script> block) -->
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

Service locator populated at load time.

```js
window.Services.Adapter      // → window.Adapter (domain CRUD)
window.Services.DataProvider // → window.DataProvider (generic CRUD)
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

Every admin page that loads data from Supabase uses `_dpSync()` (defined in admin.html):

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

Usage example (one of 13 sync functions in admin.html):
```js
function _syncPricingFromSupabase() {
  if (!Adapter.supabaseReady) return;
  _dpSync('hm_data', {key:'hm_prices'}, () => Adapter.syncPrices(), 'view-pricing', _renderPricingUI);
}
```

---

## Admin authentication (Phase 3 hardening)

The `Auth` object in `admin.html` handles all login/session logic.

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
window.Services               // {Adapter, DataProvider}
```

---

## Phase history

| Phase | Commit | What was built |
|---|---|---|
| 1 | `14af5d5` | Infrastructure: appConfig, fallbackLogger, dataProvider, serviceRegistry |
| 2 | `675da50` | Connected admin page syncs to DataProvider via `_dpSync` |
| 3 | `57b4748` | Auth hardening: salted hash, constant-time compare, session rotation, exponential lockout |
| 4 | `7a96f1c` | DataProvider TTL cache with per-table config and cache invalidation on writes |
| 5 | `0f644c8` | Admin dashboard observability panel with live metrics |
| 6 | `84ecfdf` | DataProvider retry with exponential backoff and jitter |
| 7 | `0a9c11d` | 20-case DataProvider unit test suite |
| 8 | `—` | This file |
