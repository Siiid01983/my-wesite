-- ============================================================================
-- Phase 6A — Customer Isolation RLS RECOMMENDATIONS  (DO NOT AUTO-APPLY)
-- ============================================================================
-- STATUS: RECOMMENDATION ONLY. This file lives OUTSIDE supabase/migrations/ on
-- purpose so it is never picked up by `supabase db push` / the migration runner.
-- Review, adapt to your real column names, and apply MANUALLY in the Supabase
-- SQL Editor only after staging verification.
--
-- ----------------------------------------------------------------------------
-- WHY THIS MATTERS (the central Phase 6A finding)
-- ----------------------------------------------------------------------------
-- Before Phase 6A every browser (public site, admin, WMC, portal) hit Supabase
-- as PostgREST role `anon`, and all RLS policies were written `TO anon` with
-- `USING (true)`. Customer isolation was enforced ONLY in application code.
--
-- Phase 6A introduces Supabase Auth (Magic Link) for customers. A logged-in
-- customer's requests now carry an authenticated JWT, so PostgREST evaluates
-- them as role `authenticated` — NOT `anon`. Two consequences:
--
--   1. SECURITY OPPORTUNITY: we can now enforce real per-customer isolation at
--      the database layer using auth.email(), instead of trusting app code.
--
--   2. COMPATIBILITY REQUIREMENT: if RLS is enforced exactly as it stands today
--      (anon-only policies), an authenticated customer matches NO policy and is
--      DENIED. Therefore, before/with enabling Auth in production you must add
--      `authenticated`-role policies (below) or the portal will read nothing.
--
-- The admin panel / public site keep using the `anon` key (no Auth), so the
-- existing `TO anon` policies are LEFT IN PLACE unchanged. We only ADD
-- `authenticated`-role policies scoped to the caller's verified email.
--
-- Assumptions to verify against your schema before applying:
--   • bookings.customer_email holds the email used at booking time.
--   • communications.customer_email holds the customer's email.
--   • reviews has NO email column → customer SELECT stays app-scoped (see notes).
--   • Storage objects live in bucket `media` under customer-documents/<bookingId>/…
--     where <bookingId> is NOT derivable from email alone, so storage isolation
--     is recommended via a booking-ownership join (see the storage section).
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────
-- 1. bookings — a customer may read ONLY their own rows
-- ─────────────────────────────────────────────────────────────────
-- Keep the existing anon policies (admin reads all; public form inserts).
-- ADD an authenticated SELECT policy bound to the verified email.

DROP POLICY IF EXISTS "bookings_auth_select_own" ON bookings;
CREATE POLICY "bookings_auth_select_own"
  ON bookings FOR SELECT
  TO authenticated
  USING (lower(customer_email) = lower(auth.email()));

-- Allow an authenticated customer to approve their OWN estimate (status update)
-- ONLY on their own booking. (Admin continues to update via the anon path.)
-- Tighten the WITH CHECK further if you want to whitelist specific transitions.
DROP POLICY IF EXISTS "bookings_auth_update_own" ON bookings;
CREATE POLICY "bookings_auth_update_own"
  ON bookings FOR UPDATE
  TO authenticated
  USING      (lower(customer_email) = lower(auth.email()))
  WITH CHECK (lower(customer_email) = lower(auth.email()));


-- ─────────────────────────────────────────────────────────────────
-- 2. communications — a customer may read ONLY their own correspondence
-- ─────────────────────────────────────────────────────────────────
-- Mirrors the app-layer guard in portalComms.js (customer_email match).

DROP POLICY IF EXISTS "comm_auth_select_own" ON communications;
CREATE POLICY "comm_auth_select_own"
  ON communications FOR SELECT
  TO authenticated
  USING (lower(customer_email) = lower(auth.email()));

-- Customers do NOT need INSERT/UPDATE/DELETE on communications from the portal
-- (the portal Communication Center is read-only). Do not add write policies.


-- ─────────────────────────────────────────────────────────────────
-- 3. reviews — customers submit + read their own
-- ─────────────────────────────────────────────────────────────────
-- reviews has no email column today; rows are keyed by booking_reference. Two
-- options — pick ONE:
--
--   (A) RECOMMENDED — join to bookings to prove ownership by email:
DROP POLICY IF EXISTS "reviews_auth_select_own" ON reviews;
CREATE POLICY "reviews_auth_select_own"
  ON reviews FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE lower(b.customer_email) = lower(auth.email())
        AND reviews.booking_reference IN (b.id::text,
              (SELECT split_part(split_part(b.notes, 'ref:', 2), E'\n', 1)))
    )
  );

-- Authenticated customers may INSERT a review (app still enforces 1-per-booking,
-- approved:false). Keep it permissive on INSERT; moderation is admin-side.
DROP POLICY IF EXISTS "reviews_auth_insert" ON reviews;
CREATE POLICY "reviews_auth_insert"
  ON reviews FOR INSERT
  TO authenticated
  WITH CHECK (true);
--
--   (B) SIMPLER — if you add a customer_email column to reviews, scope exactly
--       like bookings/communications above. (Requires a schema change + a
--       backfill, so it is intentionally NOT scripted here.)


-- ─────────────────────────────────────────────────────────────────
-- 4. audit_log — customers may APPEND only; never read
-- ─────────────────────────────────────────────────────────────────
-- Append-only is already enforced (no UPDATE/DELETE policy). Add an
-- authenticated INSERT so logged-in customers can still record approvals/reviews.
DROP POLICY IF EXISTS "audit_auth_insert" ON public.audit_log;
CREATE POLICY "audit_auth_insert"
  ON public.audit_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- IMPORTANT: do NOT add an authenticated SELECT policy. The audit trail must not
-- be readable by customers. (Admin reads via the anon key + app-layer gate. To
-- harden the admin read too, move audit reads behind a service_role Edge
-- Function or adopt an admin role claim — see 20260616000001_audit_log.sql.)


-- ─────────────────────────────────────────────────────────────────
-- 5. inbox_messages — customers must NOT read
-- ─────────────────────────────────────────────────────────────────
-- This table currently has RLS DISABLED (edge function writes w/ service_role,
-- admin reads w/ anon). Do NOT grant `authenticated` any access. If RLS is ever
-- enabled, leave authenticated with no policy (= denied). No change recommended.


-- ─────────────────────────────────────────────────────────────────
-- 6. Storage (bucket: media) — customer documents & photos
-- ─────────────────────────────────────────────────────────────────
-- Files are stored under  customer-documents/<bookingId>/{estimates|contracts|
-- attachments|photos/*|reviews}/…  . The portal already (a) confines every
-- list/download/upload/delete to the booking's own prefix and (b) uses
-- short-lived SIGNED urls (never public). To enforce at the DB layer, restrict
-- storage.objects to objects whose <bookingId> path segment belongs to a booking
-- owned by the caller's email.
--
-- This requires resolving <bookingId> (an HM-reference stored in bookings.notes,
-- or the numeric id) to the owner email — non-trivial in a single policy. The
-- recommended, lower-risk approach is to keep the `media` bucket PRIVATE (no
-- public policy) and serve customer files exclusively through signed URLs minted
-- by the app (already the case in portalDocs.js / portalPhotos.js / portalReviews.js).
--
-- If you want object-level RLS, add a helper that maps a storage path to an owner
-- email and reference it in a policy, e.g.:
--
--   CREATE OR REPLACE FUNCTION public.hm_storage_owner_email(object_name text)
--   RETURNS text LANGUAGE sql STABLE AS $$
--     SELECT lower(b.customer_email)
--     FROM bookings b
--     WHERE split_part(object_name, '/', 2) IN (
--             b.id::text,
--             split_part(split_part(b.notes, 'ref:', 2), E'\n', 1))
--     LIMIT 1
--   $$;
--
--   CREATE POLICY "media_auth_rw_own" ON storage.objects
--     FOR ALL TO authenticated
--     USING (bucket_id = 'media'
--            AND public.hm_storage_owner_email(name) = lower(auth.email()))
--     WITH CHECK (bucket_id = 'media'
--            AND public.hm_storage_owner_email(name) = lower(auth.email()));
--
-- Validate this carefully against real paths before applying.


-- ============================================================================
-- ROLLOUT ORDER (suggested)
--   1. Enable the Email (Magic Link) provider in Supabase → Authentication.
--   2. Add portal.html / login.html origins to Auth → URL Configuration.
--   3. Apply sections 1–4 in STAGING; verify the portal reads/writes succeed for
--      an authenticated customer AND that customer A cannot read customer B.
--   4. Confirm the admin panel & public site (still `anon`) are unaffected.
--   5. Promote to production. Keep booking-lookup app logic until verified.
-- ============================================================================
