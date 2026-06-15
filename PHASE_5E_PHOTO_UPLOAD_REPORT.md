# Phase 5E — Customer Photo Upload — Report

**Status:** ✅ Complete and validated (24/24 checks pass)
**Date:** 2026-06-16
**Scope:** Photo upload section inside `portal.html`, backed by Supabase Storage.
No new buckets, no database changes.

---

## Goal

Let customers upload photos of their move — organised into three categories —
into their **own** booking's folder, preview them, and delete their own uploads.

---

## Categories delivered

| Category | Label | Storage sub-folder |
|---|---|---|
| Room Photos | 部屋の写真（Room Photos） | `…/photos/room/` |
| Furniture Photos | 家具の写真（Furniture Photos） | `…/photos/furniture/` |
| Special Items | 特別な品物（Special Items） | `…/photos/special/` |

---

## What was built

| File | Change |
|---|---|
| `js/portal/portalPhotos.js` | **New.** `window.PortalPhotos` — booking-scoped upload / list / delete on Supabase Storage; every preview uses a short-lived signed URL; in-scope guard on list, signed-URL and delete. |
| `portal.html` | New **写真** sidebar item + `photos` view; photo-grid/upload CSS; async `loadPhotos()`, delegated upload + delete handlers; `portalPhotos.js` include; `render()` dispatch. |
| `photos_test.mjs` | **New.** 24-check Playwright validation (security + upload + preview + delete + path-linkage + UI + mobile). |
| `PHASE_5E_PHOTO_UPLOAD_REPORT.md` | This report. |

---

## Storage — reuses existing infrastructure (no redesign)

Per the rules ("use Supabase Storage", "no public storage access", "signed URLs
if required"), the feature **reuses the existing `media` bucket** under the same
namespaced, booking-scoped sub-tree introduced in Phase 5D. It does **not**
create a new bucket or alter any table:

```
media/customer-documents/<bookingId>/photos/room/<file>        ← Room Photos
media/customer-documents/<bookingId>/photos/furniture/<file>   ← Furniture Photos
media/customer-documents/<bookingId>/photos/special/<file>     ← Special Items
```

`<bookingId>` is the booking's HM-reference (and/or numeric DB id) — both name
the same booking, matching how earlier phases resolve booking identity. New
uploads are filed under the HM-reference shown to the customer; listing/delete
pass both identifiers so legacy records are still found.

---

## Features

- **Upload** — each category has a hidden `<input type="file" accept="image/*">`
  behind a styled button. The upload path is **built server-path-side from the
  session's own booking id** (`PortalPhotos.upload(bookingId, category, file)`),
  so a customer can never target another booking. Client guards: image MIME type
  and a 10 MB size cap; the module also passes `upsert:false`.
- **Preview** — uploaded photos render as a responsive thumbnail grid. Each
  thumbnail's `src` is a **short-lived (300s) signed URL** resolved per file —
  the module never produces a public URL. A broken/expired image falls back to a
  "プレビューを読み込めません" placeholder.
- **Delete own uploads** — a trash button on each tile calls
  `PortalPhotos.remove(scopeIds, path)` after a confirm. The module refuses any
  path outside the booking's own `…/photos/` sub-tree.

---

## Security — "customer uploads only to their booking"

| Rule | How it's enforced |
|---|---|
| Upload only to own booking | Path is constructed from the authenticated session's booking id inside `upload()`; the UI never lets the customer type a path. |
| No public storage access | Previews and any access go through `createSignedUrl(path, 300)`. The photos module has **no** `getPublicUrl` call path. |
| Cannot list/preview/delete another booking | `_inScope(path, ids)` requires the path to start with `customer-documents/<ownId>/photos/`; rejects bucket-root, other-booking paths, and `..` traversal. Enforced on `signedUrl`, `list`, and `remove`. |
| Category integrity | Only `room` / `furniture` / `special` accepted; anything else → `bad-category`. |
| File integrity | Non-image MIME rejected (`not-an-image`); >10 MB rejected (`too-large`). |

> Note: these are application-layer guards. For defence-in-depth, Supabase
> Storage RLS policies on the `media` bucket should additionally restrict object
> paths to the authenticated booking — that is an infra/admin concern outside the
> portal code and unchanged by this phase.

---

## Validation

Run (dev server on `:5050` required):

```bash
node serve.js          # in one shell
node photos_test.mjs   # in another
```

**Result: `24 passed, 0 failed`.** Coverage:

- **Upload works** — succeeds for own booking; rejects bad category and
  non-image; uploaded file appears in its category listing.
- **Preview works** — listed photos carry a `https://signed…` URL (never public);
  upload date present.
- **Storage path linked to booking** — upload path matches
  `customer-documents/HM-AAA/photos/<category>/…`; delete targets the exact
  booking-scoped path; no other-booking photo ever leaks into a listing.
- **Security** — in-scope (HM-ref + numeric id) allowed; other-booking, bucket
  root and path-traversal blocked on `_inScope`, `signedUrl`, and `remove`.
- **UI** — 3 category sections render, each with an upload control; graceful on
  empty storage; mobile drawer + width-fit at 375px.

---

## Notes / out of scope

- No image compression/resizing is applied client-side; the 10 MB cap bounds
  upload size. (The admin-side `CameraCapture` module does compression for staff
  captures; the customer flow keeps originals.)
- Provisioning the `media` bucket and Storage RLS policies are admin/infra tasks,
  not part of the customer portal and unchanged here.
