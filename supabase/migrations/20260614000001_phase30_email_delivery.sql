-- ════════════════════════════════════════════════════════
-- Phase 30 — Email Delivery Status
-- Extends communications table. Additive only — no drops.
-- ════════════════════════════════════════════════════════

-- 1. Add columns (safe — IF NOT EXISTS prevents errors on re-run)
ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS email_status text    DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS email_error  text,
  ADD COLUMN IF NOT EXISTS sent_at      timestamptz;

-- 2. CHECK constraint on email_status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname      = 'communications_email_status_check'
      AND conrelid     = 'public.communications'::regclass
  ) THEN
    ALTER TABLE public.communications
      ADD CONSTRAINT communications_email_status_check
      CHECK (email_status IN ('pending', 'sent', 'failed'));
  END IF;
END $$;

-- 3. UPDATE policy for anon (JS client patches email_status after delivery)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename  = 'communications'
      AND policyname = 'comm_anon_update'
  ) THEN
    EXECUTE '
      CREATE POLICY "comm_anon_update" ON public.communications
        FOR UPDATE TO anon
        USING (true)
        WITH CHECK (true)';
  END IF;
END $$;

GRANT UPDATE ON public.communications TO anon;

-- 4. Verify — output shows current columns
SELECT column_name, data_type, column_default, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'communications'
ORDER  BY ordinal_position;
