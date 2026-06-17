# Phase Hotfix — Service Worker Recovery Report

**Goal:** Eliminate the `appConfig.js` startup timeout (see
`APP_CONFIG_FAILURE_REPORT.md`) by hardening the Service Worker + bootstrap path —
**without changing any business logic or application workflow.**

**Status:** ✅ Applied. Three files modified, all syntax-checked. No new phase
started, no workflow/feature code touched.

**Date:** 2026-06-17

---

## 1. Files inspected & modified

| File | Role | Changed |
|---|---|---|
| `sw.js` | Service worker (caching strategy, versioning) | ✅ A + E |
| `js/utils/swRegister.js` | SW registration + update/reload handling | ✅ B |
| `js/core/bootstrap.js` | Public-site sequential script loader (the watchdog that reported the timeout) | ✅ C + D |

No other files were touched. `js/config/appConfig.js` (the victim, verified
correct in the prior investigation) is **unchanged**.

---

## 2. Changes applied

### A) Network-first for bootstrap-critical scripts (`sw.js`)

A stale cache-first copy of a startup script must never be able to stall or break
boot. Added a dedicated routing branch **before** the generic same-origin
cache-first rule, covering `/js/config/*`, `/js/services/*`, and `/js/core/*`:

```js
/* Bootstrap-critical scripts (config / services / core) — network-first with
   cache fallback. These drive startup; a stale cached copy must never be able
   to stall or break the boot sequence. Cache is still updated for offline use. */
if (url.origin === self.location.origin &&
    (url.pathname.startsWith('/js/config/')  ||
     url.pathname.startsWith('/js/services/') ||
     url.pathname.startsWith('/js/core/'))) {
  event.respondWith(_networkFirst(event.request, STATIC_CACHE));
  return;
}
```

- Uses the **existing** `_networkFirst(request, STATIC_CACHE)` helper (network →
  on success cache+return → on failure serve cached copy, else a 503). Offline
  support is preserved via the cache fallback.
- Everything else (HTML navigation already network-first; fonts; CDN; other
  same-origin static assets cache-first) is **unchanged**.

### B) One-shot reload guard (`js/utils/swRegister.js`)

The `controllerchange` handler previously called `window.location.reload()`
unconditionally — an activating worker that calls `clients.claim()` can fire that
event repeatedly and loop. Guarded with a one-time flag:

```js
let _refreshing = false;
navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (_refreshing) return;
  _refreshing = true;
  window.location.reload();
});
```

The page now reloads **at most once** after a new worker takes control — no loop.

### C) Bootstrap script timeout 15s → 30s (`js/core/bootstrap.js`)

```js
var LOAD_TIMEOUT_MS = 30000;   // was 15000
```

Doubles the watchdog window for every stage, giving slow networks/cold caches room
before declaring a fatal failure.

### D) One retry on the appConfig.js load (`js/core/bootstrap.js`)

Added a small retry wrapper around `_load` (first attempt → wait 1s → retry once →
then fail) and applied it to Stage 2:

```js
function _loadWithRetry(src, retries, gapMs) {
  return _load(src).catch(function (err) {
    if (retries <= 0) throw err;
    console.warn('[Bootstrap] ' + src + ' failed (' + err.message +
      ') — retrying once in ' + gapMs + 'ms');
    return new Promise(function (r) { setTimeout(r, gapMs); })
      .then(function () { return _loadWithRetry(src, retries - 1, gapMs); });
  });
}
...
/* Stage 2 — App config (one retry: attempt → 1s → retry → fail) */
window.__BOOTSTRAP__.stage = 'app-config';
await _loadWithRetry('js/config/appConfig.js', 1, 1000);
```

A transient stall now self-heals on the second attempt instead of showing the
fatal banner. All other stages keep the original single-attempt `_load`.

### E) Cache version bump v6 → v7 (`sw.js`)

```js
const CACHE_VERSION = 'v7';   // was 'v6'
```

On activate, `sw.js` deletes every cache not in `ALL_CACHES`
(`hm-static-v6` / `hm-fonts-v6` are purged), forcing the stale worker’s cached
assets — the prime suspect for the hang — to be replaced.

---

## 3. How this fixes the timeout

| Root-cause factor (from investigation) | Mitigation |
|---|---|
| Stale/zombie SW serving a bad cached `appConfig.js` cache-first | **E** purges old caches; **A** makes the new SW fetch config/services/core from network first |
| A single transient stall killing startup | **D** retries once; **C** allows 30s before failing |
| `controllerchange` reload loop during SW activation | **B** reloads at most once |

The combination removes both the *cause* (stale cache-first interception) and the
*blast radius* (no retry, short timeout, reload loop).

---

## 4. Validation

### Static checks (done)

| Check | Result |
|---|---|
| `node --check sw.js` | ✅ pass |
| `node --check js/utils/swRegister.js` | ✅ pass |
| `node --check js/core/bootstrap.js` | ✅ pass |
| Business/workflow code touched | ✅ none — only caching strategy, reload guard, loader timeout/retry, cache version |
| `appConfig.js` modified | ✅ no |

### Runtime checks (to confirm after deploy / reload)

1. **Old caches purged:** DevTools → Application → Cache Storage shows
   `hm-static-v7` / `hm-fonts-v7`; the `v6` caches are gone.
2. **No startup timeout / appConfig loads:** reload `index.html`; bootstrap
   reaches `window.__BOOTSTRAP__.stage === 'complete'`, `…ready === true`,
   `typeof window.HM_CONFIG === 'object'`, and no `#hm-boot-error` banner.
3. **Network-first verified:** DevTools → Network shows `appConfig.js` (and other
   `/js/config|services|core/*`) fetched from network (or `200 (ServiceWorker)`
   after a fresh network hit), not served stale.
4. **SW updates correctly:** with the page open, the new worker installs/activates;
   the “新しいバージョンが利用可能です” banner behaves normally on the next deploy.
5. **No infinite reload loop:** after the new SW takes control the page reloads
   **once** and settles (the `_refreshing` guard prevents repeats).
6. **Retry path:** (optional, simulate by throttling/offline-then-online during
   stage 2) the console logs one “retrying once in 1000ms” line and then succeeds.

### Recommended quick recovery for an already-broken client

If a user is still stuck on the old worker: DevTools → Application → Service
Workers → **Unregister** + **Clear site data**, then hard reload. The v7 bump makes
this automatic for most clients on the next visit.

---

## 5. Scope / safety

- **No application workflow changed.** Edits are confined to: SW caching strategy
  (A), SW cache version (E), SW-registration reload behavior (B), and the
  bootstrap loader’s timeout (C) + appConfig retry (D).
- **Reversible.** Each change is a small, isolated diff; reverting any one does not
  affect the others.
- **No new phase started.**

*Hotfix applied. Workflows untouched.*
