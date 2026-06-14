-- ════════════════════════════════════════════════════════
-- Phase 30 — Real Email Delivery
-- Run in Supabase SQL Editor.
-- SAFE: uses ADD COLUMN IF NOT EXISTS — no drops, no recreation.
-- ════════════════════════════════════════════════════════

-- 1. Extend communications table (additive only)
ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS email_status text    DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS email_error  text,
  ADD COLUMN IF NOT EXISTS sent_at      timestamptz;

-- 2. Add a CHECK constraint on email_status (safe to add, skipped if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'communications_email_status_check'
      AND conrelid = 'public.communications'::regclass
  ) THEN
    ALTER TABLE public.communications
      ADD CONSTRAINT communications_email_status_check
      CHECK (email_status IN ('pending', 'sent', 'failed'));
  END IF;
END $$;

-- 3. Allow anon to UPDATE (needed for email status updates)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'communications' AND policyname = 'comm_anon_update'
  ) THEN
    EXECUTE 'CREATE POLICY "comm_anon_update" ON public.communications
             FOR UPDATE TO anon USING (true) WITH CHECK (true)';
  END IF;
END $$;

GRANT UPDATE ON public.communications TO anon;

-- 4. Verify result
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'communications'
ORDER BY ordinal_position;
