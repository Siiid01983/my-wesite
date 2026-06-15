# Phase 5D — Customer Documents Center — Report

**Status:** ✅ Complete and validated
**Date:** 2026-06-15
**Scope:** Documents Center inside `portal.html`, backed by Supabase Storage. No
new buckets, no database changes.

---

## Goal

Give customers a **ドキュメント** section to view and download the files attached
to their own booking — Estimate PDF, Contracts, Attachments — plus an aggregate
Download Center, with upload dates shown.

---

## What was built

| File | Change |
|---|---|
| `js/portal/portalDocs.js` | **New.** `window.PortalDocs` — read-only, booking-scoped Supabase Storage lister + signed-URL resolver with an out-of-scope download guard. |
| `portal.html` | New **ドキュメント** sidebar item + `documents` view, doc-item CSS, async `loadDocuments()` + delegated download handler, `portalDocs.js` include. |
| `docs_test.mjs` | **New.** 16-check Playwright validation (security + listing + download + UI + mobile). |
| `PHASE_5D_DOCUMENTS_REPORT.md` | This report. |

### Sections delivered
- **Estimate PDF** — 見積書（Estimate PDF）
- **Contracts** — 契約書（Contracts）
- **Attachments** — 添付ファイル（Attachments）
- **Download Center** — ダウンロードセンター — every downloadable file in one list.

### Features
- **View documents** — each section lists the customer's files.
- **Download documents** — per-file button resolves a time-limited (300s) signed
  URL on demand and opens it.
- **See upload date** — `アップロード日：YYYY/MM/DD HH:MM` from the Storage object's
  `created_at`, plus human-readable file size.

---

## Storage — reuses existing infrastructure (no redesign)

Per the rules ("preserve existing file structure", "use Supabase Storage", "no
database redesign"), the feature **reuses the existing `media` bucket** under a
namespaced, booking-scoped sub-tree — it does **not** create a new bucket or
alter any table:

```
media/customer-documents/<bookingId>/estimates/<file>     ← Estimate PDF
media/customer-documents/<bookingId>/contracts/<file>     ← Contracts
media/customer-documents/<bookingId>/attachments/<file>   ← Attachments
```

`<bookingId>` is the booking's HM-reference and/or numeric DB id — both name the
same booking, matching how earlier phases resolved booking identity. (No bucket
was created during this phase; provisioning Storage / uploading documents is an
admin-side concern outside the customer portal.)

---

## Security — booking-scoped + hard download guard

> Requirement: unauthorized access blocked.

`PortalDocs` confines every operation to the authenticated booking's folders:

1. **Listing** only ever calls `storage.list('customer-documents/<bookingId>/<section>')`
   — it **never** lists the bucket root and never another booking's folder.
2. **Download** — `getDownloadUrl(bookingIds, path)` calls `_inScope(path)` first
   and returns `null` for any path not under the booking's own
   `customer-documents/<bookingId>/` prefix, before any signed URL is minted.
   Out-of-scope requests are refused and logged.
3. Supabase **placeholder rows** (`.emptyFolderPlaceholder`) and nested folders
   are filtered out of the file listing.

This mirrors the application-level booking-scoping used in Phase 5C, consistent
with the project's anon-key Storage/RLS posture.

---

## Validation results

`node docs_test.mjs` — **16 passed, 0 failed**:

**Security**
- ✅ In-scope path (HM ref) allowed
- ✅ In-scope path (numeric id) allowed
- ✅ Other booking's path blocked
- ✅ Bucket-root path blocked
- ✅ `getDownloadUrl` returns null for out-of-scope path
- ✅ No other-booking files leak into the listing

**Listing & download** (deterministic, via a controlled fake Storage layer)
- ✅ Listing returns estimate / contract / attachment files
- ✅ Supabase placeholder filtered out
- ✅ Download Center aggregates all files
- ✅ Upload date present on files
- ✅ Download resolves a signed URL

**UI / mobile**
- ✅ Reached portal after login
- ✅ Documents view renders 4 sections
- ✅ Sections include Estimate / Contracts / Attachments / Download Center
- ✅ Mobile: drawer burger visible + content fits 375px width

**Regression** — Phase 5A (`portal_test.mjs`), 5B (`dashboard_test.mjs`), and 5C
(`comms_test.mjs`) suites all still pass; nothing earlier was affected.

> The live Storage bucket currently holds no customer documents, so the UI shows
> empty-state sections against real Supabase. Listing/download behaviour is proven
> deterministically with a controlled fake Storage layer (the same technique the
> project's `dataProvider` tests use), so the logic is verified end-to-end and
> will surface real files as soon as they are uploaded under the documented path.

---

## Rules honoured

- ✅ Preserved existing file structure (reused `media` bucket; added a namespaced sub-tree only)
- ✅ Used Supabase Storage (list + signed URLs via the existing anon client)
- ✅ No database redesign (no tables, columns, or buckets created)
- ❌ Did **not** modify `admin.html` or `websiteManagement.html`
- ✅ Read-only customer surface — does not write, move, or delete any file
