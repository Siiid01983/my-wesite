# Phase 6A.6 — Deployment Runbook

**Goal:** The exact, step-by-step procedure to deploy the two already-authored
migration files that close the confirmed schema drift in `bookings` and `reviews`.

**Status:** Procedure only. **Nothing in this runbook has been executed.** No SQL
run, no migration applied, no Supabase change, no code change. Phase 6B not started.

**Date prepared:** 2026-06-17

---

## 0. Scope & artifacts

| Item | Value |
|---|---|
| Migration 1 | `supabase/migrations/20260617000001_phase6a_reviews_drift.sql` |
| Migration 2 | `supabase/migrations/20260617000002_phase6a_bookings_drift.sql` |
| Apply order | **reviews (1) → bookings (2)** — lowest risk first |
| Change type | Additive only (`source`, `booking_reference` on reviews; `updated_at` + trigger on bookings) |
| Live volume | reviews = 0 rows, bookings = 22 rows |
| Linked project | `hello-moving` — ref `ursohvtxzqxeczvrspiw` (from `supabase/.temp/linked-project.json`) |
| Supabase CLI | v2.106.0 (from `supabase/.temp/cli-latest`) |
| Reversible | Yes — `DROP COLUMN` / `DROP TRIGGER`, no data transformation |

> **Choose ONE deployment path** — Dashboard (§1) **or** CLI (§2). Do not run both;
> they apply the same DDL. The CLI path also records the migrations in
> `supabase_migrations.schema_migrations`; the Dashboard path does not (see §2 note).

---

## 1. Dashboard deployment steps (SQL Editor)

Use this path if you want a manual, copy-paste apply with the verify output shown
inline. Recommended for a first/staging run.

1. Open **Supabase Dashboard → project `hello-moving` → SQL Editor → New query**.
2. Confirm the project ref in the URL is `ursohvtxzqxeczvrspiw`.
3. **Apply migration 1 (reviews):**
   - Paste the entire contents of `20260617000001_phase6a_reviews_drift.sql`.
   - Click **Run**.
   - Confirm the trailing verify `SELECT` returns the two rows:
     `source | text | YES` and `booking_reference | text | YES`.
4. **Apply migration 2 (bookings):**
   - Open a new query, paste `20260617000002_phase6a_bookings_drift.sql`.
   - Click **Run**.
   - Confirm the verify output shows:
     - `updated_at | timestamp with time zone | NO | now()`
     - trigger `trg_bookings_updated_at` present (`tgenabled = O`).
5. If a subsequent app write briefly returns `404` / `PGRST204` for a new column,
   run a one-line query to force a REST cache reload:
   ```sql
   NOTIFY pgrst, 'reload schema';
   ```
   (Both files already emit this, but it is safe to re-issue.)
6. Proceed to **§4 Post-deployment verification**.

> **Dashboard note:** running SQL in the editor does **not** insert a row into the
> CLI's `supabase_migrations.schema_migrations` ledger. If you later use
> `supabase db push`, mark these as already-applied to avoid a re-run:
> ```bash
> supabase migration repair --status applied 20260617000001
> supabase migration repair --status applied 20260617000002
> ```
> (Both files are idempotent, so a re-run would be a no-op anyway — but repairing
> keeps the ledger honest.)

---

## 2. Supabase CLI deployment steps

Use this path for a tracked, repeatable apply that records the migration ledger.
Run all commands from the repo root (`C:\Users\DELL\my-website`).

**Pre-checks**
```bash
supabase --version                 # expect 2.106.0 or newer
supabase projects list             # confirm you are authenticated
supabase migration list            # shows local vs. remote migration state
```
- If not logged in: `supabase login`.
- If the project is not linked in this shell:
  `supabase link --project-ref ursohvtxzqxeczvrspiw`.

**Dry-run inspection (no apply)**
```bash
supabase db diff --linked          # review what the remote is missing
supabase migration list            # the two 20260617* files should show as
                                   # local-only (not yet applied remotely)
```

**Apply**
```bash
supabase db push                   # applies pending migrations in filename order:
                                   #   20260617000001_phase6a_reviews_drift.sql
                                   #   20260617000002_phase6a_bookings_drift.sql
```
- The CLI applies in lexical filename order, which already encodes reviews → bookings.
- If prompted, review the list of pending migrations and confirm.

**Confirm**
```bash
supabase migration list            # both 20260617* now show as applied remotely
```
- Proceed to **§4 Post-deployment verification**.

> **CLI note:** `supabase db push` runs each file in its own transaction. The
> verify `SELECT`s at the end of each file print to the CLI output — confirm they
> match §6. If `db push` reports the files as already applied (e.g. after a
> Dashboard run), that is expected; do not force a re-run.

---

## 3. Pre-deployment checklist

Complete **before** running either path.

- [ ] Confirm you are targeting the correct project: ref `ursohvtxzqxeczvrspiw` (`hello-moving`).
- [ ] **Snapshot the rollback baseline** — capture current columns and grants:
  ```sql
  SELECT table_name, column_name, data_type, is_nullable
  FROM   information_schema.columns
  WHERE  table_schema = 'public' AND table_name IN ('bookings','reviews')
  ORDER  BY table_name, ordinal_position;

  SELECT * FROM pg_policies WHERE schemaname = 'public'
    AND tablename IN ('bookings','reviews');
  ```
  Save the output (this is the documented rollback reference state).
- [ ] Confirm live row counts match expectations: `bookings` ≈ 22, `reviews` = 0.
  ```sql
  SELECT 'bookings' t, count(*) FROM bookings
  UNION ALL SELECT 'reviews', count(*) FROM reviews;
  ```
- [ ] Confirm neither column already exists (idempotent files make this safe either way):
  ```sql
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND
    ((table_name='bookings' AND column_name='updated_at') OR
     (table_name='reviews'  AND column_name IN ('source','booking_reference')));
  ```
- [ ] Choose deployment path: **Dashboard (§1)** *or* **CLI (§2)** — not both.
- [ ] Schedule a **low-traffic window** for production.
- [ ] Run the full sequence in **staging first** if a staging project exists.
- [ ] Have `PHASE_6A_MIGRATION_IMPLEMENTATION_REPORT.md` open for the rollback SQL.

---

## 4. Post-deployment verification (run immediately after apply)

Run in SQL Editor or `psql`. All must pass before declaring success.

```sql
-- reviews: both columns present, nullable text
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema='public' AND table_name='reviews'
  AND  column_name IN ('source','booking_reference')
ORDER  BY column_name;

-- bookings: updated_at present, NOT NULL, default now()
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema='public' AND table_name='bookings' AND column_name='updated_at';

-- bookings: trigger attached
SELECT tgname, tgenabled
FROM   pg_trigger
WHERE  tgrelid='public.bookings'::regclass AND tgname='trg_bookings_updated_at';

-- bookings: every existing row has a non-null updated_at (backfill worked)
SELECT count(*) AS null_updated_at FROM bookings WHERE updated_at IS NULL;  -- expect 0

-- trigger function exists
SELECT proname FROM pg_proc WHERE proname='set_updated_at';
```

- [ ] No row count change on `bookings` (still ≈ 22) or `reviews` (still 0).
- [ ] No errors in the Dashboard/CLI output.

---

## 5. Rollback procedure

No data transformation occurs, so there is **no data rollback** — only the added
objects are removed. Dropping `bookings.updated_at` returns writes to the prior
*broken-but-stable* behaviour (only timestamp values lost; no business data).

**Run in reverse apply order — bookings (2) first, then reviews (1):**

```sql
-- ── Rollback migration 2 (bookings) ─────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;
ALTER TABLE public.bookings DROP COLUMN IF EXISTS updated_at;
-- DO NOT drop set_updated_at(): it is shared (calendar_availability uses it).

-- ── Rollback migration 1 (reviews) ──────────────────────────────────────────
ALTER TABLE public.reviews DROP COLUMN IF EXISTS booking_reference;
ALTER TABLE public.reviews DROP COLUMN IF EXISTS source;

-- Refresh REST cache after rollback
NOTIFY pgrst, 'reload schema';
```

**If deployed via CLI**, also reconcile the ledger so the files re-apply cleanly later:
```bash
supabase migration repair --status reverted 20260617000002
supabase migration repair --status reverted 20260617000001
```

> ⚠️ **Never** `DROP FUNCTION set_updated_at()` — `calendar_availability` (and any
> other table from migration 001) still triggers on it. The bookings rollback only
> needs to drop the trigger and the column.

**Post-rollback check:**
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND
  ((table_name='bookings' AND column_name='updated_at') OR
   (table_name='reviews'  AND column_name IN ('source','booking_reference')));
-- expect 0 rows
```

---

## 6. Expected successful results

| Check | Expected output |
|---|---|
| reviews verify `SELECT` | 2 rows: `booking_reference \| text \| YES`, `source \| text \| YES` |
| bookings column verify | `updated_at \| timestamp with time zone \| NO \| now()` |
| bookings trigger verify | 1 row: `trg_bookings_updated_at \| O` |
| `set_updated_at` function | 1 row: `set_updated_at` |
| null `updated_at` count | `0` (backfill set all 22 rows) |
| bookings row count | unchanged (≈ 22) |
| reviews row count | unchanged (0) |
| CLI `migration list` (CLI path) | both `20260617*` marked applied remotely |
| Dashboard/CLI errors | none |

No `[SUPABASE ERROR]` lines should appear in the browser console once the app
exercises the previously-failing write paths.

---

## 7. Production validation checklist (exercise the app)

Run after §4 passes. Drives the real application against live Supabase.

**reviews**
- [ ] Admin: create a review → persists to Supabase; reload admin → still present.
- [ ] Admin: toggle **approve** → `approved` change persists across refresh.
- [ ] Portal (Phase 5G): submit a review on a completed booking → row written with
      `source='customer'`, `approved=false`.
- [ ] Portal: `existingReview` duplicate guard now returns the submitted review
      (no `400`; cannot submit twice).
- [ ] FAQ-page form: submit → persists with `source='customer'`.
- [ ] Public site: testimonials (`approved & published`) still render correctly.

**bookings**
- [ ] Admin: confirm / complete / cancel a booking → status **persists** and
      survives a fresh `syncFromSupabase` (log out and back in).
- [ ] Portal (Phase 5F): estimate approval → status moves to `確定`/`confirmed`
      in Supabase (verify the DB row, not just the portal UI).
- [ ] Automation: an `autoStatusRules` transition → persists to Supabase.
- [ ] Realtime: a `bookings` UPDATE broadcasts (a second admin tab updates without reload).
- [ ] `updated_at` advances on each UPDATE (query the row before/after).
- [ ] Dashboard / BI counts unchanged vs. the pre-deploy baseline.

**Cross-cutting**
- [ ] Public booking form INSERT still succeeds (no `updated_at` sent → default fills it).
- [ ] CMS / WMC content save (`hm_data`) unaffected.
- [ ] No new `[SUPABASE ERROR]` console lines during any of the above.

**Gate**
- [ ] Only after **both** tables verify green → proceed to Phase 6A RLS (separately gated).
- [ ] **Do not** enable any RLS policy or Magic Link provider during this deploy.
- [ ] **Do not** start Phase 6B.

---

## 8. What this runbook does NOT do

- ❌ No SQL executed.
- ❌ No migration applied / no `supabase db push` run.
- ❌ No push to Supabase.
- ❌ No application code modified.
- ❌ Phase 6B not started.

*Procedure authored only. Stop point reached: deployment runbook created, nothing executed.*
