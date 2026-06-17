-- ════════════════════════════════════════════════════════════════════════════
-- Phase 6A.5 — Schema Drift Remediation: reviews
-- Migration: 20260617000001_phase6a_reviews_drift
--
-- Closes the confirmed live drift on public.reviews: the columns `source` and
-- `booking_reference` are written by both the admin moderation path
-- (Adapter.reviewToSb) and the portal review path (portalReviews.submit), but
-- are ABSENT in the live database — every such INSERT/UPSERT and the portal
-- duplicate-guard SELECT (.in('booking_reference', …)) currently fails with
-- PostgREST 400 (PGRST204 "column … does not exist"). The UI masks this via an
-- optimistic localStorage write, so the database silently never changes.
--
-- Scope:        ADDITIVE ONLY. Two nullable TEXT columns. No constraints
--               (no CHECK / FK / UNIQUE), no data transformation, no code change.
-- Data volume:  reviews = 0 rows live → zero backfill, zero risk.
-- Idempotent:   ADD COLUMN IF NOT EXISTS — safe to re-run.
-- Compatibility: see PHASE_6A_FINAL_MIGRATION_PLAN.md §reviews. All read paths
--               (sbToReview via SELECT *, contentLoader, statisticsService) are
--               tolerant of / unaffected by the new fields.
--
-- NOTE: migration 002_add_reference_fields.sql already declares these two adds
-- with IF NOT EXISTS. The live audit (6A.1) confirmed they are NOT present in
-- production, so this migration re-asserts them authoritatively and idempotently.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- Apply BEFORE the bookings drift migration (lowest risk first).
-- ════════════════════════════════════════════════════════════════════════════


-- ── reviews ─────────────────────────────────────────────────────────────────
-- source:            'admin' | 'customer'  (admin moderation vs. portal/FAQ form).
--                    Nullable: legacy/unspecified writers may omit it.
-- booking_reference: the HM-* booking ID a review is linked to (portal reviews);
--                    admin reviews without a linked booking write NULL.
--                    Plain TEXT — no FK: booking refs live inside bookings.notes,
--                    so a foreign key could not resolve (see plan §risk).
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS source            TEXT;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS booking_reference TEXT;


-- ── PostgREST schema cache reload ────────────────────────────────────────────
-- Supabase auto-reloads the REST schema on DDL via an event trigger. This nudge
-- forces an immediate reload so the new columns are visible to the REST API
-- right away (avoids a brief window of 404 / PGRST204 on the first writes).
NOTIFY pgrst, 'reload schema';


-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'reviews'
  AND  column_name IN ('source', 'booking_reference')
ORDER  BY column_name;
