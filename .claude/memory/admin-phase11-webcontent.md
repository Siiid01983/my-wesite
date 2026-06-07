---
name: admin-phase11-webcontent
description: "Phase 11 Website Management module — REMOVED from admin as of 2026-06-07"
metadata: 
  node_type: memory
  type: project
  originSessionId: a004896a-c8ea-4bc2-9c64-0a2b707b58d2
---

Phase 11 (ウェブサイト管理) was **fully removed** from the admin on 2026-06-07.

**What was removed:**
- All `.wc-*` CSS classes from admin.html
- Sidebar button `data-view="webcontent"`
- Entire `#view-webcontent` HTML section (242 lines, 7 tabs)
- `<script src="js/services/contentService.js"></script>` from admin.html
- `webcontent` entry from VIEW_TITLES in admin-ui.js
- `go('webcontent')` handler in admin-ui.js
- `WC_FIELDS`, `switchWcTab`, `_wcGetValues`, `_wcSetValues`, `wcLivePreview`, `renderWebContent`, `wcSaveSection`, `_syncWebContentFromSupabase` from admin-ui.js

**contentService.js deleted from repo** — removed via `git rm` in commit `1ebdbe8` (pushed 2026-06-07).

**Verified (2026-06-07):** Playwright headless check confirmed — admin loads cleanly, zero console errors, `#view-webcontent` absent from DOM, `VIEW_TITLES` has no `webcontent` key, navigation to bookings/calendar/dashboard all work correctly.

**How to apply:** Do not reference webcontent, WC_FIELDS, ContentService, or the `ui_content` Supabase table anywhere in admin files.
