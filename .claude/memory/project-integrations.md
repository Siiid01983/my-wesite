---
name: project-integrations
description: Live production integrations and critical implementation details for Hello Moving
metadata: 
  node_type: memory
  type: project
  originSessionId: 11451bec-b845-4055-bc52-3941c13984b2
---

**Formspree endpoint (production):** `https://formspree.io/f/xdajqzlo`
Submit handler uses `async/await` with `new FormData(form)`. On success clears `sessionStorage['hm_quote']` and shows `#formSuccess`. On failure puts error text directly on the submit button (not in `#step4Error`).

**Why:** Real endpoint added June 2026 to replace fake 700ms timeout. Use exactly as written.

**sessionStorage key:** `hm_quote` — JSON of text inputs saved on every `input` event via `new FormData`. Restored on page load with `el.value = v` (text inputs only; radios/checkboxes not restored by this implementation).

**License number:** 第 431320058126 号 — appears in 3 places:
1. Trust strip: `.trust-sub` inside the 国土交通省 認可 `.trust-item`
2. Company table 許認可 `<dd>`: "国土交通省 認可運送事業者 — 第 431320058126 号"
3. Footer bottom `<small>`: appended before ／

**Compact calendar CSS class:** The `#compactCalendar` div uses `class="compact-calendar"` — this matches the CSS selector `.compact-calendar button.compact-day { ... }` in styles.css (~line 1559). Do NOT change to `compact-cal-strip` or similar.

**LINE link:** `https://line.me/R/ti/p/~hellomoving` — used in header, mobile nav, and page CTAs. No SMS links remain.
