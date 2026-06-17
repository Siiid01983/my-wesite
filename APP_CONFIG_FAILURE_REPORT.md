# App-Config Startup Failure — Investigation Report

**Symptom**
```
Hello Moving — Initialization Error
Stage: app-config
Script load timed out after 15s: js/config/appConfig.js
```

**Verdict (TL;DR):** This is **not** a source-tree defect. `js/config/appConfig.js`
exists, has the exact casing all references use, sits at the correct path, contains
valid JavaScript, and has no broken dependencies. The message is the
`bootstrap.js` per-script **watchdog** firing because the dynamically-injected
`<script src="js/config/appConfig.js">` request settled **neither `onload` nor
`onerror`** within 15 s — i.e. the HTTP request *stalled* with no response and no
error. The only component in this stack that can swallow a request that way
(instead of returning a 404/error) is the **Service Worker layer**. The decisive
test (§5) is whether the failure reproduces in a fresh incognito window.

**Analysis only — no code modified.**

---

## 1. Every reference to `js/config/appConfig.js`

| # | File | Line | Kind | Relevant to this error? |
|---|---|---|---|---|
| 1 | `index.html` | (via) `js/core/bootstrap.js:112` | **Dynamic loader** — `await _load('js/config/appConfig.js')` | ✅ **This is the failing path.** `bootstrap.js` is the only loader with a 15 s timeout + this exact message. |
| 2 | `admin.html` | 1606 | Static `<script src=…>` | No (plain tag, no timeout watchdog) |
| 3 | `booking-app.html` | 668 | Static `<script src=…>` | No |
| 4 | `websiteManagement.html` | 1671 | Static `<script src=…>` | No |
| 5 | `wmcDashboard.html` | 1011 | Static `<script src=…>` | No |
| 6 | `sw.js` | 43 | Service-worker **precache** entry (`/js/config/appConfig.js`) | ⚠️ Indirect — SW caches/serves it |
| 7 | `js/services/fallbackLogger.js` | 1 | Load-order comment | No |
| 8 | `js/services/dataProvider.js` | 1 | Load-order comment | No |
| 9 | Docs/audit | `CLAUDE.md`, `AUDIT_REPORT.md`, `INFORMATION_ARCHITECTURE.md`, `.claude/memory/MASTER_ROADMAP.md` | Documentation | No |

> Only **index.html → bootstrap.js** produces the “Script load timed out … :
> js/config/appConfig.js” message (`bootstrap.js:82-86`). The four static-tag
> pages would simply have `window.HM_CONFIG` defined or not — they cannot emit
> this error. **The failing surface is `index.html`.**

---

## 2. File verification

| Check | Result | Evidence |
|---|---|---|
| File exists | ✅ | `js/config/appConfig.js`, 569 bytes |
| Filename casing matches references | ✅ | On-disk `appConfig.js`; all refs use `appConfig.js`; `git ls-files` shows a single tracked `js/config/appConfig.js`, no case-variant |
| Path matches project structure | ✅ | `index.html` is at repo root; relative `js/config/appConfig.js` → `/js/config/appConfig.js` ✓ |
| Encoding / no BOM | ✅ | `file` reports “ASCII text”; first bytes are `(function () {` — no UTF-8 BOM that could corrupt parsing |
| Valid syntax / self-contained | ✅ | Single IIFE that sets `window.HM_CONFIG`; **no imports, no external dependency** — nothing in the file can “block” on another script |
| Bootstrap dependencies present | ✅ | `js/lib/supabase.js` (203 KB), `js/config/env.public.js`, `js/services/serviceRegistry.js`, `js/services/contentLoader.js` all exist |

**Conclusion:** appConfig.js is **not missing, not renamed, not moved**, casing is
correct, and it has **no broken import/export dependencies** (it has none to break).

---

## 3. Is it “blocked by another script error”? — No

`bootstrap.js` loads scripts **sequentially** (`await _load(...)` per stage). The
error names `app-config` (Stage 2), which means **Stage 1 succeeded**:

- `Stage 1 — supabase-lib`: `await _load('js/lib/supabase.js')` resolved **and**
  the guard `typeof window.supabase === 'undefined'` did **not** throw
  (`bootstrap.js:106-108`). So supabase.js loaded and executed cleanly from the
  same origin/server.
- A JavaScript *runtime* error inside a loaded script still fires the element’s
  `onload` (it would let bootstrap **proceed**, not time out). A 404/MIME refusal
  fires `onerror` → the message would be **“Failed to load script”**, not a
  **timeout**.

A **timeout** specifically means the appConfig.js request produced *no response and
no error*. That is a **transport stall**, not a code/dependency error.

---

## 4. Why the loader waits 15 s and times out (root cause)

`bootstrap.js._load()` (lines 70-96) injects a `<script>` and arms a 15 s timer
(`LOAD_TIMEOUT_MS = 15000`, line 22). It rejects only if **neither** `onload` nor
`onerror` fires in time. Given the file and server are healthy (supabase.js just
loaded), the appConfig.js request is being **intercepted and never resolved**.

### The Service Worker is the prime suspect

- The **only** SW registration is in `js/utils/swRegister.js`, which bootstrap
  loads at **Stage 10 — the final stage**. So on a **first/clean visit** no SW
  exists during Stage 2 ⇒ a first visit cannot fail here (it would work).
- On a **return visit**, the previously-registered SW controls the page from the
  first byte. `sw.js` serves same-origin scripts **cache-first**
  (`sw.js:232-234` → `_cacheFirst`). A *healthy* current (`v6`) SW resolves
  instantly. A **stale / zombie SW** (older `CACHE_VERSION` whose fetch handler
  differs, or one caught mid-activation) can leave the request **hanging** → the
  15 s watchdog fires.
- `swRegister.js:31-33` reloads the page on **every** `controllerchange`
  *unconditionally*. When a newly-deployed SW activates and calls
  `clients.claim()` (`sw.js:144`), an in-flight bootstrap can be interrupted /
  churned, which can manifest as a stalled mid-sequence request.

### Ranked causes

| Rank | Cause | Why it fits | Disambiguator |
|---|---|---|---|
| **1 (primary)** | **Stale / broken Service Worker** controlling a return visit, intercepting `appConfig.js` cache-first and not resolving | Only the SW can make a request hang silently; first-visit has no SW (so works), return-visit does | Fails normally, **works in incognito** (§5) |
| 2 | **Origin server stalling that one request** (deployed host hiccup, half-open connection) | Produces a true no-response stall | Fails **even in incognito**; other assets also flaky |
| 3 | `controllerchange`→reload churn during a fresh SW deploy | Unconditional reload (`swRegister.js:31`) interrupts bootstrap | Repeated auto-reloads visible in the tab |

> **Note on the supabase-ok / appConfig-hung asymmetry:** under a stale SW both are
> intercepted; supabase.js can come from a still-valid cache entry while the
> appConfig.js request stalls (e.g. SW mid-activation between the two sequential
> loads). The incognito test (§5) cleanly separates “SW” from “server”.

---

## 5. Affected files

| File | Role in this failure |
|---|---|
| `index.html` | Hosts the failing loader (`bootstrap.js`, line 2249) — the only surface that shows this error |
| `js/core/bootstrap.js` | The sequential loader + 15 s watchdog that reports the timeout (lines 22, 70-96, 110-112) |
| `js/utils/swRegister.js` | Registers `/sw.js`; **unconditional** `controllerchange`→`location.reload()` (lines 13, 31-33) |
| `sw.js` | Cache-first interception of `/js/config/appConfig.js` (precache line 43; fetch routing lines 232-234); `CACHE_VERSION='v6'` (line 18) |
| `js/config/appConfig.js` | **The victim, not the cause** — verified correct (§2) |

---

## 6. Exact fix required

> Stated as a specification — **not yet applied** (analysis-only task).

### A. Immediate remediation (runtime, no code change) — confirm & clear the SW
1. DevTools → **Application → Service Workers** → check **Update on reload** →
   **Unregister** the active worker.
2. **Application → Storage → Clear site data** (clears the `hm-static-v6` /
   `hm-fonts-v6` caches).
3. **Hard reload** (Ctrl+Shift+R). Bootstrap should reach `complete`.

For end users who can’t open DevTools, shipping a bumped `CACHE_VERSION` in `sw.js`
(e.g. `v6` → `v7`) forces the stale caches to be deleted on activate
(`sw.js:138-146`).

### B. Code hardening (proposed — prevents recurrence)
1. **Don’t let the SW intercept bootstrap-critical config/services.** Either:
   - serve `/js/config/*` and `/js/services/*` **network-first** in `sw.js`
     (mirror the existing `_networkFirst` used for navigations), **or**
   - in `bootstrap.js._load()`, fetch bootstrap scripts with
     `fetch(src, { cache: 'no-store' })` and inject as an inline blob, bypassing
     the SW for the critical path.
2. **Guard the auto-reload.** In `swRegister.js`, only reload on
   `controllerchange` *after the user accepts the update banner* (set a flag in
   the “今すぐ更新” click handler); don’t reload unconditionally — it can interrupt
   an in-flight bootstrap.
3. **Add a single retry** in `_load()` before failing (re-inject once with a
   cache-busting `?v=` query) so a one-off stall self-heals instead of showing a
   fatal banner.
4. **Tighten the watchdog** (optional): 15 s is long for a 569-byte local file;
   a 6–8 s timeout surfaces problems faster without false positives.

> The fixes are ordered: **A** resolves the live incident now; **B** stops it
> happening again. No change to `appConfig.js` itself is needed or warranted.

---

## 7. Validation steps

**Reproduce / confirm the diagnosis**
1. In the affected browser: DevTools → **Application → Service Workers** — confirm
   an **active** worker is present (return visit).
2. DevTools → **Network**: reload and watch `appConfig.js` sit **(pending)** until
   the red banner appears at ~15 s. Confirm `supabase.js` (the prior request)
   completed `200`.
3. **Decisive test:** open `index.html` in a **fresh incognito window** (no SW):
   - **Loads cleanly** → confirms a stale/broken SW (Cause #1). Apply §6A then §6B.
   - **Still fails** → the origin server is stalling the request (Cause #2);
     investigate the host/network, not the SW.

**Verify the fix**
4. After §6A (unregister + clear + hard reload), in the console:
   - `window.__BOOTSTRAP__.stage === 'complete'` and `…ready === true`.
   - `typeof window.HM_CONFIG === 'object'` (e.g. `HM_CONFIG.RETRY.maxAttempts === 3`).
   - No `#hm-boot-error` banner in the DOM.
5. Confirm the page proceeds past every stage (no console `[Bootstrap] FATAL`).
6. After §6B (if applied): with the SW re-registered and active, **return-visit**
   reloads succeed repeatedly; simulate a deploy by bumping `CACHE_VERSION` and
   confirm the update banner appears **without** an interrupted-bootstrap timeout.

**Regression scope**
7. The four static-tag pages (`admin.html`, `booking-app.html`,
   `websiteManagement.html`, `wmcDashboard.html`) are unaffected by this error but
   share the SW — verify they still load after any `sw.js` change.

---

## 8. Summary

- **Root cause:** not the file. `appConfig.js` is present, correctly named/cased,
  correctly pathed, valid, and dependency-free. The 15 s timeout is
  `bootstrap.js`’s watchdog reacting to a **stalled** `appConfig.js` request —
  the Service Worker (`sw.js` cache-first + `swRegister.js` unconditional reload)
  is the prime suspect on **return visits**; a stalling origin server is the
  secondary candidate.
- **Exact fix:** clear/unregister the stale SW (bump `CACHE_VERSION`) to resolve
  now; then keep the SW off the bootstrap-critical path and stop the unconditional
  `controllerchange` reload to prevent recurrence.
- **Decisive diagnostic:** incognito (no-SW) load — clean ⇒ SW cause; still-broken
  ⇒ server cause.

*Investigation only. No code was modified.*
