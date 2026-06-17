# Text Source Audit — `ていねいに、運びます。test`

**Goal:** Determine why the hero text `ていねいに、運びます。test` still appears on
the live site.

**Verdict (TL;DR):** The `test` suffix is **not in the repository.** It lives in
the **Supabase `hm_data` table, row `key = 'hm_hero'`, field `headline_ja`**, where
it was typed into the CMS hero editor and saved. On every public page load,
`ContentLoader` fetches that value live from Supabase and **overwrites** the static
hero text in `index.html`. The Service Worker cannot be the cause — Supabase API
responses are **network-only** (never cached). This is a **data/content issue, not
a code or cache issue.**

**Analysis only — nothing was modified.**

---

## Source Location

### Repository search for the exact string `ていねいに、運びます。test`
**Result: NOT FOUND anywhere in the repo.** The `test` suffix exists only on the
live site (i.e. in the database), not in source control.

### Repository occurrences of the base string `ていねいに、運びます。` (no `test`)

| File | Line | Content type | Role |
|---|---|---|---|
| `index.html` | 1263 | **HTML** (`<span class="ja" id="heroTitleJa">`) | Static default hero headline shown before/without dynamic content |
| `migrations/001_initial_schema.sql` | 326 | **SQL seed** (JSON `headline_ja` in the `hm_data` seed) | Initial DB seed value (no `test`) |
| `js/services/supabaseAdapter.js` | 497 | **JS** (`getHero` default object) | Admin-side fallback default (no `test`) |

➡️ None of the three repo copies contains `test`. The only place that can hold
`…test` is the **live `hm_data.hm_hero` row in Supabase**.

---

## Runtime Flow (how the text reaches the page)

```
index.html:1263  <span id="heroTitleJa">ていねいに、運びます。</span>   ← static default (no "test")
        │
        │  (end of <body>) bootstrap → contentLoader.js → ContentLoader.init()
        ▼
contentLoader.js _load():
   sb.from('hm_data').select('key,value')                       ← live Supabase fetch
        │  kv.hm_hero = { headline_ja: "ていねいに、運びます。test", … }
        ▼
   _applyHero(kv.hm_hero)  →  _set('heroTitleJa', h.headline_ja)
        │   _set only overwrites when the value is non-empty:
        │   `if (e && val != null && val !== '') e.textContent = val;`
        ▼
   #heroTitleJa.textContent = "ていねいに、運びます。test"        ← DB value WINS over static HTML
```

**Determination — the hero text is loaded from:**

| Candidate source | Is it the source? | Evidence |
|---|---|---|
| Static HTML (`index.html`) | ❌ Only the initial paint; immediately overwritten | `contentLoader.js:31` `_set('heroTitleJa', h.headline_ja)` |
| **`hm_data` table (`hm_hero`)** | ✅ **YES — authoritative** | `contentLoader.js:265,277,281`; `_applyHero` reads `kv.hm_hero.headline_ja` |
| `services` table | ❌ | Services cards only (`_applyServiceCards`) |
| ContentLoader | ✅ (the *mechanism*) | It fetches `hm_data` and applies it |
| localStorage | ❌ (not a display source for hero) | ContentLoader *writes* `hm_hero` to localStorage (`_ls`, line 275) but the public hero never *reads* it back for display |
| sessionStorage | ❌ | Not used for hero content |
| Service Worker cache | ❌ | Supabase API is network-only (see Cache Analysis) |

---

## Cache Analysis (can cache explain it?)

**No — the Service Worker cannot serve this text.**

| Check | Finding |
|---|---|
| Current `CACHE_VERSION` | `v7` (`sw.js:18`; bumped from v6 in the prior hotfix) |
| Are hero/content endpoints cached? | **No.** `sw.js:196` `if (url.hostname.endsWith('.supabase.co')) return;` → all Supabase API calls (incl. the `hm_data` hero fetch) are **network-only**, bypassing the SW entirely. |
| Cache strategy for `index.html` | Navigation = **network-first** (`sw.js:226-229`); even a cached fallback contains the **base** string (no `test`) |
| Could stale content still be served? | **Not for the hero text.** The dynamic value comes straight from the network each load; the SW has no copy of it. A stale `index.html` from cache would show *less* text (the static default), never *more* (`…test`). |

**Conclusion:** Cache is ruled out. The `test` is fetched fresh from Supabase on
every load. (Clearing caches / bumping `CACHE_VERSION` would **not** remove it.)

---

## Supabase Analysis (can the database explain it?)

**Yes — this is the source.**

CMS write path that produced the value:

```
wmcDashboard.html / admin.html  (hero editor view)
   └─ #heroHdJa input  ──────────────────────────────────────────┐
js/modules/hero/hero.js:8     headline_ja = #heroHdJa.value       │ "…test" typed here
js/modules/hero/hero.js:118   saveHero()                          │
js/modules/hero/hero.js:121   Adapter.saveHero(h)                 ▼
js/services/supabaseAdapter.js:510  saveHero: v => wt('hm_hero', v)
   └─ wt() write-through → Supabase  hm_data  row  key='hm_hero'  (value.headline_ja = "ていねいに、運びます。test")
                                     + localStorage mirror
```

Frontend render path that surfaces it (above, Runtime Flow):
`contentLoader.js` → `_applyHero(kv.hm_hero)` → `#heroTitleJa`.

So `hm_data.hm_hero.headline_ja` currently equals `ていねいに、運びます。test`, and
that is exactly what the live page displays. The repository seed/default
(`…運びます。`) was overwritten in the live DB by a CMS save.

---

## Root Cause

**Single most likely cause:** Someone edited the hero **日本語見出し (`headline_ja`)**
field in the CMS hero editor — appending `test` — and saved it. `Adapter.saveHero`
wrote that string to the Supabase **`hm_data` row `key='hm_hero'`**. On every public
page load, `ContentLoader` fetches `hm_data` and `_applyHero` overwrites the static
`index.html` hero text with the database value. The text persists because it is
**live database content**, independent of the codebase and not cached by the
Service Worker.

It is **not** caused by: the repository (the string isn’t there), the Service
Worker / cache (Supabase is network-only), localStorage/sessionStorage (not a hero
display source), or a deployment.

---

## Recommended Fix (recommendation only — not implemented)

1. **Correct the content at the source (no code/deploy needed):** in the admin/WMC
   hero editor, edit the **日本語見出し** field to remove `test`, then **save**
   (`saveHero` → `wt('hm_hero')`). The corrected value writes to `hm_data.hm_hero`
   and appears on the next public page load. *(Equivalent alternative: update the
   `headline_ja` field of the `hm_data` row `key='hm_hero'` directly in Supabase.)*
2. **No cache action is required**, because the hero text is never SW-cached.
   (Optionally, the editor’s own browser holds a stale `localStorage.hm_hero`
   mirror; it is cosmetic and is overwritten on the next ContentLoader run.)
3. **Optional process hardening (future, out of scope):** add a confirm/validation
   or a “preview vs publish” gate on the hero editor so stray test text cannot
   reach the live `hm_data` value; consider trimming/validating CMS input.

*Audit complete. No code, Supabase, Service Worker, or database content was modified.*
