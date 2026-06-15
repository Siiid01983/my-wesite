# Phase 5G — Customer Review System — Report

**Status:** ✅ Complete and validated (19/19 checks pass)
**Date:** 2026-06-16
**Scope:** Review submission inside the customer portal (`portal.html`), backed by
the **existing** `reviews` table and Supabase Storage. No schema change.

---

## Goal

Let a customer leave a review — rate the service, write feedback, and attach
photos — for their own booking, **only after the move is completed**, flowing into
the existing admin review-approval workflow.

---

## Features delivered

| Feature | Implementation |
|---|---|
| **Leave Review** | Free-text feedback (`review_text`, ≤2000 chars). |
| **Rate Service** | Interactive 1–5 star rating (`rating`). |
| **Upload Photos** | Optional photos → `media` bucket, booking-scoped: `customer-documents/<bookingId>/reviews/<file>`, previewed via short-lived signed URLs (never public). |

---

## Availability — only after booking completion

A new **レビュー** sidebar item opens the reviews view. `PortalReviews.canReview()`
returns true **only when `booking.status === '完了'`** (completed). For any other
status the view shows a locked message with the current status — **active
customers cannot review**.

---

## What was built

| File | Change |
|---|---|
| `js/portal/portalReviews.js` | **New.** `window.PortalReviews` — `canReview`, `existingReview` (duplicate guard), `submit`, `uploadPhoto`, `listPhotos`, `signedUrl`, scope guard. |
| `portal.html` | New **レビュー** nav item + `reviews` view; star/form/photo CSS; async `loadReviews()` with star, photo-upload, and submit handlers; `render()` dispatch; `portalReviews.js` include. |
| `reviews_test.mjs` | **New.** 19-check Playwright validation. |
| `PHASE_5G_REVIEWS_REPORT.md` | This report. |

---

## Preservation & workflow connection (per the rules)

- **Preserve existing reviews system** — **zero schema change.** The portal writes
  to the existing `reviews` table using the same columns the Adapter's
  `reviewToSb` produces (`reference_id`, `customer_name`, `rating`, `review_text`,
  `approved`, `published`, `source`, `service`, `booking_reference`, `created_at`).
  The public review page (`review.html`) and admin review editor are untouched.
- **Connect to existing review workflows** — submissions are written with
  `source:'customer'` and `approved:false`, so they appear in the admin reviews
  **pending** tab with the existing **顧客** badge, and the existing
  `approveRev()` / `publishRev()` flow promotes them to the public site. No new
  approval path was created.
- **Prevent duplicate reviews** — `existingReview()` queries `reviews` by
  `booking_reference` (both the HM ref and numeric id) before showing the form and
  again on submit; a booking that already has a review shows the submitted review
  read-only instead of a second form. One review per booking.

### Storage / photos (schema-neutral)

Review photos reuse the `media` bucket under a booking-scoped sub-tree (same
pattern as Phases 5D/5E). Because duplicates are prevented, the booking maps 1:1
to its review, so `customer-documents/<bookingId>/reviews/` is effectively that
review's photo set — no `reviews`-table column was added. All previews use
300-second signed URLs; an in-scope guard blocks other-booking paths and `..`
traversal.

---

## Validation

Run (dev server on `:5050` required):

```bash
node serve.js
node reviews_test.mjs   # → 19 passed, 0 failed
```

`reviews_test.mjs` uses a controlled fake Supabase modeling the `reviews` table +
storage (deterministic; no real data mutated). Coverage of the required checks:

- **Completed customers can review** — `submit()` with `status:'完了'` inserts a
  `reviews` row (rating + text + `source:'customer'`, `approved:false`,
  `booking_reference`, `REV-*` reference_id) and writes a centralized audit entry.
- **Active customers cannot review** — `submit()` with `status:'確定'` (or any
  non-完了) is refused (`not-completed`) and writes no row; `canReview()` is true
  only for `完了`. The UI shows the locked message for non-completed bookings.
- **Ratings save correctly** — the inserted row's `rating` equals the selected
  value; ratings outside 1–5 are rejected (`bad-rating`).
- Plus: duplicate prevention (second submit → `duplicate`, no row), photo upload
  to the booking-scoped review folder with a signed (non-public) URL, the photo
  scope guard, the UI availability invariant, and mobile responsiveness.

---

## Notes / out of scope

- Review photos are linked to the review via the booking (1:1, duplicates
  prevented) rather than a new `reviews` column — keeping the reviews schema
  unchanged. A future additive `review_photos` column could store the paths
  inline if inline admin display is desired.
- The submission integrates with the Phase 5F `AuditService` (action `add`,
  target `review`), so customer reviews appear in the admin 監査ログ.
- No Supabase migration, public review page, or admin review code was modified.
