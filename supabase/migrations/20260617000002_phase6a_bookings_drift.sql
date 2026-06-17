-- ════════════════════════════════════════════════════════════════════════════
-- Phase 6A.5 — Schema Drift Remediation: bookings
-- Migration: 20260617000002_phase6a_bookings_drift
--
-- Closes the confirmed live drift on public.bookings: the column `updated_at`
-- is sent on every UPDATE by bookingService.updateBooking / cancelBooking /
-- approveEstimate (portal estimate approval, Phase 5F) and Adapter.updateBooking
-- (admin confirm/complete/cancel + automation autoStatusRules), but is ABSENT in
-- the live database — every such UPDATE fails with PostgREST 400 (PGRST204
-- "column bookings.updated_at does not exist"). The UI masks this via an
-- optimistic localStorage write, so status changes silently never persist and
-- revert on the next syncFromSupabase (login).
--
-- Scope:        ADDITIVE ONLY. One timestamptz column + the shared
--               set_updated_at() trigger fn (from migration 001) re-asserted, and
--               a BEFORE UPDATE trigger. No data transformation. No code change.
-- Data volume:  bookings = 22 rows live. NOT NULL is safe — DEFAULT now()
--               backfills all existing rows at add-time.
-- Idempotent:   column add + one-time historical backfill are guarded by a DO
--               block (run only when the column is first created); the function
--               is CREATE OR REPLACE; the trigger is DROP IF EXISTS then CREATE.
--               Safe to re-run with no side effects.
-- Compatibility: see PHASE_6A_FINAL_MIGRATION_PLAN.md §bookings. INSERT paths
--               (createBooking / addBooking) send no updated_at → default fills
--               it. statisticsService SELECTs an explicit column list that
--               excludes updated_at → unaffected. SELECT * / Realtime mappers
--               (sbToBooking) ignore unknown fields.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- Apply AFTER 20260617000001_phase6a_reviews_drift.sql (lowest risk first).
-- ════════════════════════════════════════════════════════════════════════════


-- ── Shared trigger function (re-asserted defensively) ─────────────────────────
-- Defined originally in migration 001. Its live existence is unconfirmed, so we
-- CREATE OR REPLACE it before attaching the trigger (idempotent; identical body).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ── bookings.updated_at ───────────────────────────────────────────────────────
-- Guarded so BOTH the column add and the one-time historical backfill run only
-- when the column does not yet exist. Re-running this migration is then a no-op
-- (the backfill never overwrites real updated_at values written after deploy).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'bookings'
      AND column_name  = 'updated_at'
  ) THEN
    -- NOT NULL is safe: DEFAULT now() backfills the 22 existing rows at add-time.
    ALTER TABLE public.bookings
      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

    -- One-time historical backfill (cosmetic): align updated_at with created_at
    -- for pre-existing rows so they don't all read "just now". Runs once only.
    UPDATE public.bookings SET updated_at = created_at;
  END IF;
END $$;


-- ── Trigger: keep updated_at current on every UPDATE ──────────────────────────
-- The four writers already send updated_at explicitly, so the trigger is not
-- strictly required for them — it is the safety net so any future write that
-- omits the field (or a DB-side change) still keeps the timestamp current,
-- matching migration 001's original design. Drop-then-create = idempotent.
DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;
CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── PostgREST schema cache reload ────────────────────────────────────────────
-- Forces an immediate REST schema reload so updated_at is visible to the API
-- right away (avoids a brief window of 404 / PGRST204 on the first writes).
NOTIFY pgrst, 'reload schema';


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'bookings'
  AND  column_name  = 'updated_at';

SELECT tgname, tgenabled
FROM   pg_trigger
WHERE  tgrelid = 'public.bookings'::regclass
  AND  tgname  = 'trg_bookings_updated_at';
