# Phase 6A.5 — Migration Implementation Report

**Goal:** Author the migration files that close the confirmed schema drift in
`bookings` and `reviews`, per the approved `PHASE_6A_FINAL_MIGRATION_PLAN.md`.

**Status:** ✅ Migration files authored. **NOT executed, NOT pushed, NOT applied.**
No SQL run, no Supabase change, no production change, no code change. Phase 6B not started.

**Date:** 2026-06-17

---

## 1. Migration files created

Both files live under `supabase/migrations/` and follow the repo's existing
timestamp-prefix convention (`YYYYMMDDHHMMSS_description.sql`). They are ordered
by filename so a sequential apply runs **reviews → bookings** (lowest risk first),
exactly as the deployment plan specifies.

| # | File | Table | Risk | Live rows |
|---|---|---|---|---|
| 1 | `supabase/migrations/20260617000001_phase6a_reviews_drift.sql` | `public.reviews` | Zero (empty table) | 0 |
| 2 | `supabase/migrations/20260617000002_phase6a_bookings_drift.sql` | `public.bookings` | Low (additive, safe default) | 22 |

Neither file has been run. Creating the files does not touch the database.

---

## 2. Columns added

### `reviews` (file 1)

| Column | Type | Nullable | Default | Constraints | Purpose |
|---|---|---|---|---|---|
| `source` | `TEXT` | YES | none (NULL) | none | `'admin'` \| `'customer'` — moderation vs. portal/FAQ submission |
| `booking_reference` | `TEXT` | YES | none (NULL) | none | HM-* booking ID a review links to; NULL for admin reviews with no booking |

- No `CHECK` / `FK` / `UNIQUE` — booking refs live inside `bookings.notes`, so a
  foreign key could not resolve (per plan §reviews / §risk).
- `customer_email` (the optional RLS enabler) is **intentionally NOT included** —
  it is deferred (needs writer-code changes that are out of scope for 6A.5), and
  the task's approved column list is `source` + `booking_reference` only.

### `bookings` (file 2)

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| `updated_at` | `TIMESTAMPTZ` | **NOT NULL** | `now()` | Last-modified timestamp written by every UPDATE path |

Plus two supporting objects:

| Object | Kind | Idempotency |
|---|---|---|
| `set_updated_at()` | trigger function (re-asserted from migration 001) | `CREATE OR REPLACE` |
| `trg_bookings_updated_at` | `BEFORE UPDATE … FOR EACH ROW` trigger | `DROP IF EXISTS` then `CREATE` |

`NOT NULL` is safe because `DEFAULT now()` backfills the 22 existing rows at
add-time. A **one-time historical backfill** (`updated_at = created_at`) runs
inside the guarded `DO` block so pre-existing rows reflect their true age rather
than the deploy time.

---

## 3. Compatibility verification

Traced against `PHASE_6A_SCHEMA_DRIFT_REMEDIATION.md` §1 (every Supabase touch point):

### Fixed by these migrations

| Path | Before | After |
|---|---|---|
| `bookingService.updateBooking` / `cancelBooking` (UPDATE w/ `updated_at`) | 🔴 400 PGRST204 → never persists | ✅ persists |
| `bookingService.approveEstimate` (portal estimate approval, 5F) | 🔴 400 → status never moves to `confirmed` | ✅ persists |
| `Adapter.updateBooking` (admin confirm/complete/cancel + automation `autoStatusRules`) | 🔴 400 → reverts on re-sync | ✅ persists + Realtime broadcast |
| `Adapter.addReview` / `updateReview` → `reviewToSb` (admin moderation/approve) | 🔴 400 (unknown `source`, `booking_reference`) | ✅ persists |
| `portalReviews.submit` (portal review, 5G) | 🔴 INSERT 400 → customers can't review | ✅ persists |
| `portalReviews.existingReview` `.in('booking_reference', …)` (duplicate guard) | 🔴 SELECT 400 (caught → false "no review") | ✅ correct detection |
| `faq.js` review form → `Adapter.addReview` | 🔴 never persists | ✅ persists |

### Verified unaffected (no degradation)

| Path | Why safe |
|---|---|
| `bookingService.createBooking` / `Adapter.addBooking` INSERT | Sends no `updated_at` → `DEFAULT now()` fills it |
| `statisticsService` SELECT (`id,booking_date,service_id,status,customer_email,customer_name,created_at`) | Explicit column list excludes `updated_at` → unchanged |
| `Adapter.syncFromSupabase` / Realtime `SELECT *` | `sbToBooking` / `sbToReview` map only known fields; ignore extras |
| `contentLoader` public testimonials (`approved & published`) | Does not read the new review columns |
| `review.html` public form | localStorage only — never hits Supabase |
| CMS / WMC (`hm_data`, `services`, storage) | Does not touch `bookings` or `reviews` |

**Additive-only, backward compatible:** existing reads/writes that don't use the
new columns behave identically; the only behavioral change is **positive** —
status changes and review writes that previously failed silently now persist.

---

## 4. Idempotency & safety guarantees

| Property | How it's guaranteed |
|---|---|
| Re-runnable (reviews) | `ADD COLUMN IF NOT EXISTS` on both columns |
| Re-runnable (bookings column + backfill) | Guarded `DO` block — runs the add and the one-time `UPDATE … = created_at` only when the column is absent, so a second run never overwrites real timestamps |
| Re-runnable (function) | `CREATE OR REPLACE FUNCTION` |
| Re-runnable (trigger) | `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER` |
| No data loss | No `DROP`/`ALTER TYPE`/transformation; only additive `ADD COLUMN` + cosmetic backfill |
| Safe `NOT NULL` | `DEFAULT now()` backfills the 22 rows at add-time |
| REST visibility | `NOTIFY pgrst, 'reload schema'` in each file forces an immediate PostgREST cache reload |

---

## 5. Rollback instructions

No data transformation occurs, so there is **no data rollback** — only the added
objects are removed. Dropping `bookings.updated_at` returns writes to the prior
*broken-but-stable* behaviour (only timestamp values are lost; no business data).

**Reverse order of apply (bookings first, then reviews):**

```sql
-- ── Rollback file 2 (bookings) ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;
-- Drop the function ONLY if it is not reused elsewhere (calendar_availability
-- also uses set_updated_at() — leave the function in place if that table exists):
-- DROP FUNCTION IF EXISTS set_updated_at();
ALTER TABLE public.bookings DROP COLUMN IF EXISTS updated_at;

-- ── Rollback file 1 (reviews) ───────────────────────────────────────────────
ALTER TABLE public.reviews DROP COLUMN IF EXISTS booking_reference;
ALTER TABLE public.reviews DROP COLUMN IF EXISTS source;

NOTIFY pgrst, 'reload schema';
```

> ⚠️ **Do not** `DROP FUNCTION set_updated_at()` if `calendar_availability` (or
> any other table) still has a trigger using it — it is shared from migration 001.
> The bookings rollback only needs to drop the trigger and the column.

---

## 6. Deployment checklist (for the later, separately-gated apply phase)

> These files are authored only. The steps below are **not** executed in 6A.5.

**Pre-flight**
- [ ] Snapshot live `bookings`/`reviews` columns + `pg_policies`/grants as the rollback baseline (6A.1 Appendix A).
- [ ] Confirm a low-traffic window for production.

**Apply (staging first, then production — identical steps)**
- [ ] Run `20260617000001_phase6a_reviews_drift.sql` (reviews — zero risk).
- [ ] Confirm the verify block lists `source` + `booking_reference`.
- [ ] Run `20260617000002_phase6a_bookings_drift.sql` (bookings).
- [ ] Confirm the verify blocks show `updated_at` (NOT NULL, default `now()`) and `trg_bookings_updated_at` present.
- [ ] If any write briefly 404s/PGRST204s, re-issue `NOTIFY pgrst, 'reload schema';`.

**Validation — reviews**
- [ ] Admin: create a review → persists; reload admin → still present.
- [ ] Admin: toggle **approve** → change persists.
- [ ] Portal (5G): submit review on a completed booking → row written `source='customer'`, `approved=false`.
- [ ] Portal: `existingReview` returns it (duplicate guard works; no 400).
- [ ] FAQ-page form: submit → persists with `source='customer'`.
- [ ] Public site: testimonials (`approved & published`) still render.

**Validation — bookings**
- [ ] Admin: confirm / complete / cancel → status persists and survives a fresh `syncFromSupabase` (re-login).
- [ ] Portal (5F): estimate approval → status moves to `確定`/`confirmed` in Supabase.
- [ ] Automation: an `autoStatusRules` transition → persists.
- [ ] Realtime: a `bookings` UPDATE broadcasts (admin tab reflects without reload).
- [ ] `updated_at` advances on each UPDATE (trigger working).
- [ ] Dashboard/BI counts unchanged vs. baseline.

**Cross-cutting**
- [ ] Public booking form INSERT still succeeds.
- [ ] CMS/WMC content save (`hm_data`) unaffected.
- [ ] No new `[SUPABASE ERROR]` console lines during the above.

**Gate**
- [ ] Only after both tables verify green → proceed to Phase 6A RLS (separately gated).
- [ ] **Do not** enable any RLS policy or Magic Link provider here.
- [ ] **Do not** start Phase 6B.

---

## 7. What was explicitly NOT done

- ❌ No SQL executed.
- ❌ No push to Supabase / no `supabase db push`.
- ❌ No migration applied.
- ❌ No production change.
- ❌ No application code modified.
- ❌ Phase 6B not started.
- ❌ Out-of-scope drift (`calendar_availability.updated_at`, `services.icon`,
  `reviews.customer_email`) deliberately left for a future phase.

*Files authored only. Stop point reached: migration files created, not run, not deployed.*
