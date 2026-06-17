-- ════════════════════════════════════════════════════════════════════════════
-- Phase 6B — Customer Isolation & RLS Hardening
-- Migration: 20260617000003_phase6b_customer_isolation_rls
--
-- Implements per-customer data isolation at the DATABASE layer for the Supabase
-- Auth (Magic Link) portal introduced in Phase 6A. A logged-in customer's
-- requests carry an authenticated JWT, so PostgREST evaluates them as role
-- `authenticated` (NOT `anon`). This migration ADDS `authenticated`-role policies
-- scoped to the caller's verified email — WITHOUT touching the existing `TO anon`
-- policies that the admin panel, CMS/WMC, public site and automation rely on.
--
-- ── Design corrections over supabase/recommendations/PHASE_6A_customer_rls_
--    recommendations.sql (which PHASE_6A_RLS_IMPACT_ANALYSIS.md scored 35/100):
--   F1  Public-content tables (hm_data, services, calendar_availability, reviews
--       read) had anon-ONLY policies → a logged-in customer (role authenticated)
--       on index.html would be DENIED and the homepage would break. FIXED: add
--       authenticated SELECT here.
--   F1b reviews authenticated SELECT is "approved OR published OR own booking" so
--       public testimonials are NOT hidden from logged-in users (the raw
--       recommendation hid them).
--   F2  GRANTs ≠ policies. Every authenticated policy gets a matching GRANT.
--   F3  Storage isolation stays app-enforced (private `media` bucket + signed
--       URLs); object-level RLS intentionally NOT added here (see footer note).
--   F4  Column drift resolved against live code: bookings/communications use
--       `customer_email` (confirmed in bookingService.js + portalComms.js).
--   F5  communications RLS state was indeterminate. FIXED: this migration ENABLES
--       RLS on communications AND re-asserts the full anon CRUD base policies so
--       admin send/read + the edge-function status patch keep working, THEN adds
--       the authenticated SELECT-own policy (otherwise it would be inert/widening).
--   (missing) bookings authenticated INSERT for the public booking form submitted
--       by a logged-in customer.
--
-- Scope:        bookings, communications, reviews, audit_log (+ public-content
--               read coverage on hm_data, services, calendar_availability).
-- Change type:  Additive policies + grants. communications also gets ENABLE RLS.
--               No schema change, no data change, no anon policy removed.
-- Idempotent:   DROP POLICY IF EXISTS before each CREATE; ENABLE RLS is idempotent.
-- Depends on:   20260617000001 (reviews.booking_reference) — referenced by the
--               reviews ownership join below. Apply 6A.5 migrations first.
--
-- PRECONDITION (operational, NOT enforced here): the Email/Magic Link provider
-- and portal redirect allow-list are configured. Enabling Auth WITHOUT these
-- authenticated policies is what breaks the portal — apply this with the cut-over.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run  (staging first).
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- A. PUBLIC-CONTENT TABLES — authenticated READ coverage (fixes F1)
--    These tables already have anon SELECT USING(true) + RLS enabled. A logged-in
--    customer hitting index.html is `authenticated`, so without these policies the
--    hero/FAQ/footer/services/calendar/testimonials would be DENIED. Read-only —
--    no authenticated write policies (customers never edit site content).
-- ════════════════════════════════════════════════════════════════════════════

-- hm_data (hero, FAQ, footer, theme, prices, …)
DROP POLICY IF EXISTS "hm_data_auth_select" ON hm_data;
CREATE POLICY "hm_data_auth_select"
  ON hm_data FOR SELECT
  TO authenticated
  USING (true);

-- services (service card listings)
DROP POLICY IF EXISTS "services_auth_select" ON services;
CREATE POLICY "services_auth_select"
  ON services FOR SELECT
  TO authenticated
  USING (true);

-- calendar_availability (public booking calendar)
DROP POLICY IF EXISTS "calendar_availability_auth_select" ON calendar_availability;
CREATE POLICY "calendar_availability_auth_select"
  ON calendar_availability FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON hm_data               TO authenticated;
GRANT SELECT ON services              TO authenticated;
GRANT SELECT ON calendar_availability TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- B. bookings — a customer may read/update only their OWN rows; may still INSERT
-- ════════════════════════════════════════════════════════════════════════════
-- Anon policies (admin read-all, public/admin insert, admin update/delete) remain.

-- SELECT own (portal dashboard resolves bookings by verified email)
DROP POLICY IF EXISTS "bookings_auth_select_own" ON bookings;
CREATE POLICY "bookings_auth_select_own"
  ON bookings FOR SELECT
  TO authenticated
  USING (lower(customer_email) = lower(auth.email()));

-- INSERT (the public booking form, submitted by a logged-in customer, runs as
-- `authenticated`; without this it would be DENIED and booking creation breaks).
-- WITH CHECK (true) mirrors the anon insert path; app sets customer_email.
DROP POLICY IF EXISTS "bookings_auth_insert" ON bookings;
CREATE POLICY "bookings_auth_insert"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- UPDATE own (Phase 5F estimate approval moves status on the customer's OWN row).
DROP POLICY IF EXISTS "bookings_auth_update_own" ON bookings;
CREATE POLICY "bookings_auth_update_own"
  ON bookings FOR UPDATE
  TO authenticated
  USING      (lower(customer_email) = lower(auth.email()))
  WITH CHECK (lower(customer_email) = lower(auth.email()));

GRANT SELECT, INSERT, UPDATE ON bookings TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- C. reviews — read own-or-public; submit own
-- ════════════════════════════════════════════════════════════════════════════
-- reviews has no email column; ownership is proven by joining booking_reference
-- to a booking owned by the caller's email. The SELECT is "public testimonial OR
-- own review" so logged-in customers STILL see public testimonials (fixes F1b).
DROP POLICY IF EXISTS "reviews_auth_select_own" ON reviews;
CREATE POLICY "reviews_auth_select_own"
  ON reviews FOR SELECT
  TO authenticated
  USING (
    -- public testimonials remain visible to everyone, incl. logged-in users
    (approved IS TRUE OR published IS TRUE)
    OR
    -- a customer may always see their own review(s), even before moderation
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE lower(b.customer_email) = lower(auth.email())
        AND reviews.booking_reference IN (
              b.id::text,
              split_part(split_part(b.notes, 'ref:', 2), E'\n', 1)
            )
    )
  );

-- INSERT (portal/FAQ review submit). App enforces 1-per-booking + approved:false;
-- moderation stays admin-side. Permissive CHECK mirrors the anon insert path.
DROP POLICY IF EXISTS "reviews_auth_insert" ON reviews;
CREATE POLICY "reviews_auth_insert"
  ON reviews FOR INSERT
  TO authenticated
  WITH CHECK (true);

GRANT SELECT, INSERT ON reviews TO authenticated;
-- NOTE: no authenticated UPDATE/DELETE on reviews — customers cannot edit/remove
-- reviews (admin moderates via the anon path).


-- ════════════════════════════════════════════════════════════════════════════
-- D. communications — ENABLE RLS + preserve anon CRUD + customer reads own (F5)
-- ════════════════════════════════════════════════════════════════════════════
-- The repo never ENABLEd RLS here (only a comm_anon_update policy existed, which
-- is inert while RLS is off). To make the customer SELECT-own policy actually
-- enforce isolation we ENABLE RLS — but first re-assert the full anon CRUD base
-- policies so the admin Communication Center (send/read/update/delete via the
-- anon key) keeps working. The send-email / receive-email edge functions use
-- service_role, which BYPASSES RLS, so they are unaffected.

-- Anon base policies (admin + JS client). Idempotent re-assert.
DROP POLICY IF EXISTS "comm_anon_select" ON public.communications;
CREATE POLICY "comm_anon_select"
  ON public.communications FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "comm_anon_insert" ON public.communications;
CREATE POLICY "comm_anon_insert"
  ON public.communications FOR INSERT
  TO anon
  WITH CHECK (true);

-- comm_anon_update already created in 20260614000001; re-assert idempotently.
DROP POLICY IF EXISTS "comm_anon_update" ON public.communications;
CREATE POLICY "comm_anon_update"
  ON public.communications FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "comm_anon_delete" ON public.communications;
CREATE POLICY "comm_anon_delete"
  ON public.communications FOR DELETE
  TO anon
  USING (true);

-- Customer (authenticated) may READ only their own correspondence. Portal
-- Communication Center is read-only → no authenticated write policies.
DROP POLICY IF EXISTS "comm_auth_select_own" ON public.communications;
CREATE POLICY "comm_auth_select_own"
  ON public.communications FOR SELECT
  TO authenticated
  USING (lower(customer_email) = lower(auth.email()));

-- Enable enforcement (idempotent). MUST come after the anon base policies above
-- so admin comms do not break the instant RLS turns on.
ALTER TABLE public.communications ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.communications TO anon;
GRANT SELECT                         ON public.communications TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- E. audit_log — customers may APPEND only; never READ
-- ════════════════════════════════════════════════════════════════════════════
-- Append-only is preserved (no UPDATE/DELETE policy). The audit migration granted
-- INSERT/SELECT to anon ONLY, so the authenticated role needs an explicit grant.
DROP POLICY IF EXISTS "audit_auth_insert" ON public.audit_log;
CREATE POLICY "audit_auth_insert"
  ON public.audit_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

GRANT INSERT ON public.audit_log TO authenticated;
-- DELIBERATELY no authenticated SELECT: the trail must remain unreadable by
-- customers. The portal bundle exposes no audit-read path and never loads
-- window.Auth (see 20260616000001_audit_log.sql).


-- ════════════════════════════════════════════════════════════════════════════
-- F. inbox_messages — OUT OF SCOPE, intentionally unchanged.
-- ════════════════════════════════════════════════════════════════════════════
-- RLS remains DISABLED (edge writes service_role; admin reads anon). NOT granting
-- `authenticated` anything here. NOTE (carried from the impact analysis): with RLS
-- disabled, table-level grants let any role SELECT inbound customer emails — a
-- PRE-EXISTING exposure, not introduced by Phase 6B. Hardening it (ENABLE RLS +
-- an admin-only read policy) is a separate, independently-validated change.


-- ════════════════════════════════════════════════════════════════════════════
-- G. Storage (bucket: media) — OUT OF SCOPE for object-level RLS (fixes F3 stance)
-- ════════════════════════════════════════════════════════════════════════════
-- Customer documents/photos/reviews stay isolated by the APPLICATION: the `media`
-- bucket is PRIVATE, every portal list/upload/download/delete is confined to the
-- booking's own prefix (customer-documents/<bookingId>/…), and files are served
-- only via short-lived signed URLs. Object-level storage.objects RLS is NOT added
-- here (the path→owner-email mapping is non-trivial and must be validated against
-- real paths first). VERIFY in staging that `createSignedUrl`/`upload`/`list`/
-- `remove` still succeed for the `authenticated` role (they should — storage
-- grants are independent of these table policies).


-- ── PostgREST schema cache reload ────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY (read-only) — confirm policy/role coverage after apply
-- ════════════════════════════════════════════════════════════════════════════
-- All four in-scope tables + the public-content tables should show authenticated
-- policies; communications should report rls_enabled = true.
SELECT tablename, policyname, roles, cmd
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename IN ('bookings','communications','reviews','audit_log',
                     'hm_data','services','calendar_availability')
ORDER  BY tablename, cmd, policyname;

SELECT relname, relrowsecurity AS rls_enabled
FROM   pg_class
WHERE  relnamespace = 'public'::regnamespace
  AND  relname IN ('bookings','communications','reviews','audit_log',
                   'hm_data','services','calendar_availability','inbox_messages');

SELECT table_name, grantee, privilege_type
FROM   information_schema.role_table_grants
WHERE  table_schema = 'public'
  AND  grantee = 'authenticated'
  AND  table_name IN ('bookings','communications','reviews','audit_log',
                      'hm_data','services','calendar_availability')
ORDER  BY table_name, privilege_type;
