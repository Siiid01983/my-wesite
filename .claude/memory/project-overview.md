---
name: project-overview
description: "Hello Moving website — stack, design system, admin architecture, and core constraints"
metadata: 
  node_type: memory
  type: project
  originSessionId: c2e2b131-943a-4529-9b93-587d19591065
---

Pure HTML/CSS/JS no-build site. Two surfaces: public (index.html) and admin (admin.html + JS modules).

Design system: Japanese minimalist. Navy (#0a1f44), ink (#0b0f17), gray scale. Noto Sans JP + Inter. No decorative gold. All spacing/radius/shadow via CSS custom properties.

**Why:** Preserve premium Japanese aesthetic while improving conversion — do NOT redesign.

**How to apply:** All changes must stay within the existing variable/naming system. Avoid adding new color families, new font families, or restructuring the CSS architecture.

## Admin panel architecture (Phase 14 — 2026-06-07)

admin.html is HTML + CSS only. All JavaScript lives in external files loaded in this order:

```
js/services/        ← Supabase infrastructure (Adapter, DataProvider, etc.)
js/core/            ← Auth, navigation (go), appBootstrap (startup IIFE), EventBus, AdminState
js/utils/           ← formatters, dom, pdf, storage, validators
admin-bookings.js   ← CalendarService, BookingService, buildTable, emptyHTML
admin-analytics.js  ← renderAnalytics, drawBarChart, _DOW_JP global
js/core/navigation.js ← go(), _dpSync, VIEW_TITLES (after data modules)
js/modules/**       ← 20 domain folders (dashboard, calendar, pricing, etc.)
js/services/serviceRegistry.js ← populated last (except appBootstrap)
js/core/appBootstrap.js ← startup IIFE — MUST be last script tag
```

Key globals: `Auth` (auth.js), `go()` / `_dpSync` (navigation.js), `toast` / `esc` / `fmtD` (formatters.js), `Adapter` (supabaseAdapter.js), `DataProvider` (dataProvider.js), `EventBus` (eventBus.js), `AdminState` (stateManager.js).

See [[admin-architecture]] for full module map. See CLAUDE.md for complete loading order.
