# Phase 6A.3 — Drift Dependency Map & Resolution Plan

**Goal:** Map every code path that depends on the three drifted columns and define
the safest resolution strategy before Phase 6B.
**Constraint:** Analysis only — **no SQL executed, no migrations created, no
database/Supabase change, no code change.** Only this report is written. Phase 6B
not started.

**Columns in scope (code expects them; live DB lacks them):**
- `bookings.updated_at`
- `reviews.source`
- `reviews.booking_reference`

> **Method:** full-codebase trace of each column **and its local-shape alias**
> (`reviews.source ↔ local r.source`, `reviews.booking_reference ↔ local
> r.bookingId`). Unrelated `source` tokens (event `detail.source`, DataProvider
> `source:'supabase'`, `camera`) and `bookingId` tokens (invoices, automation
> send-trackers, `communications.booking_id`) were inspected and **excluded** as
> false positives.

---

## 1. Dependency inventory

### 1.1 `bookings.updated_at` — written, never read

| # | File : line | Function | Op | Effect of missing column |
|---|---|---|---|---|
| B1 | `bookingService.js:228` | `updateBooking` | UPDATE `{...fields, updated_at}` | 🔴 `400` PGRST204 → update never persists |
| B2 | `bookingService.js:255` | `cancelBooking` | UPDATE `{status, updated_at}` | 🔴 cancel never persists |
| B3 | `bookingService.js:288` | `approveEstimate` | UPDATE `{status, updated_at}` | 🔴 **portal estimate approval** never persists |
| B4 | `supabaseAdapter.js:362` | `Adapter.updateBooking` | UPDATE `{...fields, updated_at}` | 🔴 **admin status changes + automation** never persist |

**Reads:** none. `statisticsService` selects an explicit column list **without**
`updated_at`; no module sorts/filters by it. → No read breakage.

**Not bookings (excluded, all reference tables that *do* have the column):**
`supabaseAdapter.js:87` (hm_data upsert), the six WMC `hm_data` upserts, and
storage-metadata reads `entry.updated_at` in `portalDocs`/`portalPhotos`.
*Out-of-scope observation:* `supabaseAdapter.js:396` upserts
`calendar_availability` with `updated_at`, which the live table also lacks — a
**separate** drift, not part of this phase.

### 1.2 `reviews.source` — written + tolerantly read

| # | File : line | Function | Op | Effect |
|---|---|---|---|---|
| S1 | `supabaseAdapter.js:239` | `reviewToSb` (used by `addReview`/`updateReview`) | UPSERT incl. `source` | 🔴 admin review create/edit/approve never persists |
| S2 | `portalReviews.js:162` | `submit` | INSERT `source:'customer'` | 🔴 portal review submit fails |
| S3 | `faq.js:256-261` | public/embedded review form → `Adapter.addReview({source:'customer'})` | UPSERT incl. `source` | 🔴 this review form’s Supabase write fails |
| S4 | `supabaseAdapter.js:257` | `sbToReview` | READ `r.source \|\| 'admin'` | 🟡 tolerant — missing col → always `'admin'` (info lost, no error) |
| S5 | `reviewsEditor.js:56,278` | badge / meta render | READ local `r.source` | 🟡 cosmetic — badge always shows 「管理者登録」 |

### 1.3 `reviews.booking_reference` — written + **read in a filter**

| # | File : line | Function | Op | Effect |
|---|---|---|---|---|
| R1 | `supabaseAdapter.js:240` | `reviewToSb` | UPSERT `booking_reference: r.bookingId` | 🔴 admin review write fails (same write as S1) |
| R2 | `portalReviews.js:164` | `submit` | INSERT `booking_reference` | 🔴 portal review write fails (same as S2) |
| R3 | `portalReviews.js:65` | `existingReview` | SELECT `.in('booking_reference', ids)` | 🔴 **read fails** `400` → duplicate-guard errors (caught → returns null) |
| R4 | `supabaseAdapter.js:258` | `sbToReview` | READ `r.booking_reference` | 🟡 tolerant — missing col → `bookingId:null` |
| R5 | `faq.js:228` | dedupe `getReviews().find(r=>r.bookingId===…)` | READ local | 🟡 dedupe ineffective (always `null` after sync) |
| R6 | `reviewsEditor.js:157,203,280` | edit form field / save / meta | READ+WRITE local `bookingId` | feeds S1/R1 write; display only |

---

## 2. Affected files / functions / workflows

| File | Functions | Columns | Surface |
|---|---|---|---|
| `bookingService.js` | `updateBooking`, `cancelBooking`, `approveEstimate` | `updated_at` | Portal (approval), shared |
| `js/services/supabaseAdapter.js` | `updateBooking`; `reviewToSb`/`sbToReview` (`addReview`/`updateReview`) | `updated_at`, `source`, `booking_reference` | Admin |
| `js/portal/portalReviews.js` | `submit`, `existingReview` | `source`, `booking_reference` | Portal |
| `js/modules/faq/faq.js` | public review submit + dedupe | `source`, `booking_reference` | Public/Admin-embedded |
| `js/modules/reviews/reviewsEditor.js` | render/save (badge, 関連予約ID) | `source`, `booking_reference` | Admin (cosmetic) |
| `js/modules/automation/autoStatusRules.js` | `Adapter.updateBooking({status})` | `updated_at` | Automation |

**Workflows broken today (writes silently fail; `localStorage` masks in-tab):**
- Portal: estimate approval (5F); review submit + duplicate-check (5G).
- Admin: booking status confirm/complete/cancel/edit; review create/edit/**approve**.
- Automation: auto status-rule transitions (don’t reach Supabase).
- Public/embedded: FAQ-page review submission.

---

## 3. Impact by surface

| Surface | `updated_at` | `source` | `booking_reference` | Net |
|---|---|---|---|---|
| **Portal** | 🔴 approval write (B3) | 🔴 submit (S2) | 🔴 submit (R2) + read filter (R3) | Approval + reviews broken |
| **Admin** | 🔴 update (B4) | 🔴 moderation (S1) | 🔴 moderation (R1) | Status + review writes don’t persist |
| **CMS / WMC** | 🟢 uses `hm_data.updated_at` (exists) | — | — | **No impact** |
| **Analytics** | 🟢 no direct dep (explicit SELECT omits all three) | 🟢 | 🟢 | **No direct impact**; *indirect* — stale statuses (admin writes never persisted) skew re-synced data |
| **Automation** | 🔴 `autoStatusRules` → `Adapter.updateBooking` (B4 path) | 🟢 (review-request sends email only; no `reviews` write) | 🟢 | Status automations don’t persist |

---

## 4. Required vs optional columns

| Column | Type | Classification | Why |
|---|---|---|---|
| `bookings.updated_at` | `timestamptz` (default `now()`) | **Required** | Unblocks B1–B4 + automation; restores migration-001 intent. |
| `reviews.source` | `text` | **Required** | Unblocks S1–S3. |
| `reviews.booking_reference` | `text` | **Required** | Unblocks R1–R3; the only review→booking link; needed later for review RLS. |
| `bookings` `set_updated_at` trigger | trigger | **Recommended companion** | Keeps `updated_at` auto-current (matches migration 001); column alone stops the 400. |
| `reviews.customer_email` | `text` | **Optional (Phase-6A enabler)** | Enables a simple `customer_email = auth.email()` review RLS instead of a fragile notes-parsing join. Not needed to fix drift. |

---

## 5. Safe vs dangerous changes

**✅ Safe (additive, reversible, no data risk):**
- `ADD COLUMN bookings.updated_at timestamptz DEFAULT now()` (22 rows → default fills; optional backfill `= created_at`).
- `bookings` `BEFORE UPDATE` trigger calling the existing `set_updated_at()`.
- `ADD COLUMN reviews.source text` and `reviews.booking_reference text` (table is **empty** → zero backfill risk).
- Optional `ADD COLUMN reviews.customer_email text`.

**⛔ Dangerous (do NOT do):**
- `NOT NULL` without a default on `bookings.updated_at` (22 existing rows → failure).
- Any FK/`CHECK`/`UNIQUE` constraint on `reviews.booking_reference` or `reviews.source` (could fail and couples to booking ids that live in `notes`).
- Renaming/dropping/retyping any existing column (e.g. forcing `service_id`→`service_type`) — breaks live reads/writes.
- “Fixing” by deleting `updated_at` from code instead — touches 4 sites incl. `Adapter`, risks divergence, and discards an audit field; the additive column is strictly safer.

---

## 6. Safest remediation strategy

**Add the three required columns (additive), reviews first.** This is purely
additive, matches the original migrations’ intent (`001` had `updated_at`+trigger;
`002` had `source`+`booking_reference`), requires **no code change**, and unblocks
portal + admin + automation + the FAQ form simultaneously. Treat
`reviews.customer_email` as an optional add to simplify the later RLS phase.

---

## 7. Deployment sequence (for the approved remediation phase — not now)

1. **Catalog confirm** with `service_role` (6A.1 Appendix A): list live
   `bookings`/`reviews` columns; snapshot `pg_policies`/grants for rollback.
2. **Reviews (empty → zero risk):** add `source`, `booking_reference` (and optional
   `customer_email`). Verify in staging: admin add/edit/**approve** persists;
   `portalReviews.submit` succeeds; `existingReview` returns cleanly (R3 fixed);
   FAQ-form submit persists; public testimonials still render.
3. **Bookings:** add `updated_at` (default `now()`) + `set_updated_at` trigger;
   optional backfill `updated_at = created_at`. Verify: admin confirm/complete/
   cancel persists and survives re-sync; portal approval moves status to 確定;
   `autoStatusRules` transitions persist; Realtime `bookings` UPDATE fires;
   dashboard/BI unchanged.
4. **Regression** across portal / admin / public / automation; confirm CMS untouched.
5. **Gate:** only after both tables verify green, proceed to Phase 6A RLS, then
   Phase 6B.

---

## 8. Rollback sequence

- **Pre-change:** snapshot column list + policies/grants (step 7.1) as the baseline.
- **Reversibility:** every change is additive and individually droppable —
  `reviews.source` / `reviews.booking_reference` / (`reviews.customer_email`);
  `bookings.updated_at` + its trigger. Reviews table is empty so its rollback is
  clean; dropping `bookings.updated_at` simply returns to the prior
  (broken-but-stable) write behaviour — only timestamp values are lost, **no
  business data**.
- **Order:** roll back in reverse of §7 (bookings trigger → bookings column →
  reviews columns).
- **No data rollback** required — these are schema-additive only; no rows are
  transformed.
- **Fast mitigation if a write regresses unexpectedly:** the additive columns
  cannot break existing INSERT/SELECT paths, so the safest immediate action is to
  drop the just-added object and re-verify; no code redeploy is involved.

---

## 9. Readiness score

| Dimension | Score | Basis |
|---|---|---|
| Dependency-map completeness | 10/10 | All 11 dependency sites + aliases traced; false positives excluded; automation & FAQ paths found. |
| Fix safety (additive/reversible) | 9/10 | 3 required `ADD COLUMN`s (+1 trigger) on low/zero-volume tables; trivial drop-based rollback. |
| Current live data-integrity health | 2/10 | Portal approval, admin status/review writes, and automation transitions all silently fail to persist today. |
| Phase-6A RLS unblocking | 7/10 | `booking_reference` (+ optional `customer_email`) and a working approval path become available after the fix. |
| Blast radius / effort | 9/10 | 2 tables, ≤4 schema objects, **zero** code changes on the safe path. |

### **Drift-resolution plan readiness: 90 / 100 — READY (fixes not yet applied)**

- The map is complete and the safe additive strategy is unambiguous. **The live
  schema remains production-incorrect** (silent write failures across portal,
  admin, and automation) until the three columns are added.
- Recommended next step (separate approved phase): execute §7 in staging, starting
  with `reviews`. Do **not** begin Phase 6A RLS or Phase 6B until both tables
  verify green.

*Analysis only. No SQL executed, no migrations created, no database/Supabase/code modified (only this report). Phase 6B not started.*
