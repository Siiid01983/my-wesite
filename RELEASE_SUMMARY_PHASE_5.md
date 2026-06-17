# Release Summary — Phase 5 (Customer Portal)

A self-service customer portal (`portal.html` + `login.html`) built on the
existing no-build, browser-globals stack and the existing Supabase backend.
Every feature is booking-scoped, session-guarded, and reuses existing
infrastructure — no public-site or admin regressions.

---

## Phases

### 5A — Portal Foundation
Login + portal shell. Customers authenticate with **email + booking reference**
(both must match the same booking; generic error messages avoid disclosure).
Session in `sessionStorage` with a 60-minute sliding expiry and a route guard
that bounces unauthenticated visitors to `login.html`.
- `js/portal/portalAuth.js` (`PortalAuth`), `login.html`, `portal.html` shell.

### 5B — Dashboard
The portal home: 5 cards (booking status, move date, assigned staff, quote
status, latest updates) + a status timeline, all derived from the single
authorised booking record.
- `portal.html` overview view, sidebar nav, mobile drawer.

### 5C — Communication Center (read-only)
Booking-scoped message history (company ↔ customer), read-only.
- `js/portal/portalComms.js` (`PortalComms`), messages view.

### 5D — Documents Center
View/download the booking's documents (Estimate PDF / Contracts / Attachments)
+ an aggregate Download Center, from Supabase Storage (reuses the `media`
bucket). Read-only, booking-scoped, time-limited **signed URLs**, with an
out-of-scope guard.
- `js/portal/portalDocs.js` (`PortalDocs`), documents view, `docs_test.mjs`.

### 5E — Photo Upload
Customers upload moving photos by category (Room / Furniture / Special Items)
into their own booking folder, preview them (signed URLs), and delete their own
uploads. No public storage access; in-scope guard blocks other bookings + path
traversal.
- `js/portal/portalPhotos.js` (`PortalPhotos`), 写真 view, `photos_test.mjs`.

### 5F — Approval System
An **Approve Estimate** action transitions a booking awaiting approval
(新規/確認中, "Quote Sent") to **確定** ("Quote Approved"). Schema-preserving —
reuses the existing `confirmed` status value via a **targeted** single-column
`BookingService` update (mirrors `cancelBooking`); guarded + idempotent. Admin
sees it via the existing Realtime/sync.
- `bookingService.js` `approveEstimate()`, `js/portal/portalApproval.js`
  (`PortalApproval`), approve bar in the dashboard, `approval_test.mjs` (21/21).
- Commit `a43cefc` — *feat: Phase 5F Customer Estimate Approval*.

### 5F — Audit Migration
Centralizes the audit trail in a Supabase **`audit_log`** table (append-only,
RLS), replacing the `localStorage` `hm_audit_log` ring buffer as the source of
truth. New `AuditService` is the single write/read layer:
`record()` (INSERT, everyone) and `query()` (SELECT, **admin-gated**; merges any
legacy localStorage entries for backward compatibility). The admin 監査ログ UI
and all existing `AuditLog.record()` callers are preserved (writes now persist to
Supabase transparently); the portal records approvals to it.
- `supabase/migrations/20260616000001_audit_log.sql`,
  `js/services/auditService.js`, `js/modules/audit/auditLog.js` (integration),
  `audit_migration_test.mjs` (20/20).
- Commit `1542d3b` — *feat: migrate Audit Log to Supabase*.
- **Security note:** the app uses one shared anon key (no Supabase Auth), so the
  customer-vs-admin **read** restriction is enforced in application code (the
  portal exposes no audit-read path; `query()` requires an admin session). DB-
  level enforcement (service_role Edge Function or Auth role claims) is the
  documented hardening path.

### 5G — Reviews
Customers leave a review — **rate the service**, write feedback, attach **photos**
— for their own booking, available **only after completion (完了)**. Writes to the
existing `reviews` table with `source:'customer'`, `approved:false`, so reviews
flow into the existing admin **pending → approve/publish** workflow. Duplicate
reviews are prevented (one per booking); photos go to the `media` bucket under
`customer-documents/<bookingId>/reviews/`. No schema change.
- `js/portal/portalReviews.js` (`PortalReviews`), レビュー view, `reviews_test.mjs`
  (19/19).
- Commit `13935bd` — *feat: Phase 5G Customer Review System*.

---

## Validation

| Suite | Result |
|---|---|
| `approval_test.mjs` | 21 passed, 0 failed |
| `audit_migration_test.mjs` | 20 passed, 0 failed |
| `reviews_test.mjs` | 19 passed, 0 failed |
| `docs_test.mjs` (5D) | 16 checks |
| `photos_test.mjs` (5E) | 24 checks |

Each Playwright suite logs into a real booking, then exercises the feature
against a controlled fake Supabase (deterministic; no real data mutated).

---

## Cross-cutting properties

- **Booking-scoped & guarded** — every read/write is confined to the authenticated
  booking; storage access uses short-lived signed URLs (never public) with
  in-scope guards against other-booking paths and `..` traversal.
- **Schema-preserving** — 5F approval and 5G reviews add **no** columns/status
  values; the only new table is `audit_log` (additive, append-only).
- **Workflow-connected** — approvals update the real `bookings` row; reviews enter
  the real admin review queue; actions land in the centralized audit trail.
- **No regressions** — public site (`index.html`), admin panel (`admin.html`),
  and Supabase Edge Functions were not broken; the admin audit UI is preserved.

---

## Commits (this release segment)

```
13935bd feat: Phase 5G Customer Review System
1542d3b feat: migrate Audit Log to Supabase
a43cefc feat: Phase 5F Customer Estimate Approval
```

Earlier Phase 5 commits: `43af0db` (5A), `40a32f7` (5B), `2cb36c0` (5C),
`550bd6b` (5D), `3a68308` (5E).

---

## Required follow-up (deployment)

The Supabase migration must be applied to the live project before the audit trail
works in production:

```
supabase/migrations/20260616000001_audit_log.sql
```

Run it in: Supabase Dashboard → SQL Editor → New Query → Run.
