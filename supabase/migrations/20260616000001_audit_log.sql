-- ════════════════════════════════════════════════════════
-- Phase 5F — Audit Log Migration
-- Centralized, Supabase-backed audit trail (replaces the
-- localStorage `hm_audit_log` ring buffer as the source of truth).
--
-- Additive only. Does NOT touch the bookings or communications
-- schema. Append-only (no UPDATE/DELETE policy) → immutable trail.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor       TEXT        NOT NULL DEFAULT 'system',   -- 'admin' | 'customer:<email>' | 'system'
  action      TEXT        NOT NULL DEFAULT 'other',    -- add|update|delete|save|login|logout|export|other
  target_type TEXT        NOT NULL DEFAULT '-',        -- booking|quote|review|price|service|media|page|…
  target_id   TEXT        NOT NULL DEFAULT '',         -- booking ref / entity id
  details     TEXT        NOT NULL DEFAULT ''          -- human-readable description
);

-- Indexes: admin list (newest first) + filterable columns the 監査ログ UI uses.
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action     ON public.audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_target     ON public.audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor      ON public.audit_log (actor);

-- ─────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- INSERT — granted to anon so BOTH portal customers and the admin panel
-- (which share the public anon key) can append entries.
-- This is the "customers can only create audit entries" grant.
DROP POLICY IF EXISTS "audit_anon_insert" ON public.audit_log;
CREATE POLICY "audit_anon_insert"
  ON public.audit_log FOR INSERT
  TO anon
  WITH CHECK (true);

-- SELECT — granted to anon because the admin panel reads with the same anon
-- key (this project does not use Supabase Auth; see the header note in
-- 20260101000000_rls_policies.sql — role separation is enforced in app code).
--
-- The customer-vs-admin READ restriction is enforced at the application layer:
--   • the customer portal bundle exposes NO audit-read path;
--   • AuditService.query() refuses unless an admin session is present
--     (the portal never loads window.Auth).
--
-- To enforce the read restriction at the DATABASE layer, move reads behind a
-- service_role Edge Function, or adopt Supabase Auth with role claims and a
-- policy such as:  USING (auth.jwt() ->> 'role' = 'admin').
DROP POLICY IF EXISTS "audit_anon_select" ON public.audit_log;
CREATE POLICY "audit_anon_select"
  ON public.audit_log FOR SELECT
  TO anon
  USING (true);

-- NO update / delete policies → audit rows are immutable and cannot be
-- altered or removed by any anon client (append-only trail).

GRANT INSERT, SELECT ON public.audit_log TO anon;

-- ─────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'audit_log'
ORDER  BY ordinal_position;
