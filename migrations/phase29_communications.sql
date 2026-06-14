-- ════════════════════════════════════════════════════════
-- Phase 29 — Internal Communications
-- Run this in your Supabase SQL Editor.
-- ════════════════════════════════════════════════════════

-- 1. Create communications table
CREATE TABLE IF NOT EXISTS public.communications (
  id             bigserial         PRIMARY KEY,
  booking_id     text,
  customer_email text,
  sender_email   text              NOT NULL DEFAULT 'booking@hello-moving.com',
  subject        text,
  message        text              NOT NULL DEFAULT '',
  direction      text              NOT NULL DEFAULT 'outbound'
                                   CHECK (direction IN ('outbound', 'inbound')),
  created_at     timestamptz       NOT NULL DEFAULT now(),
  created_by     text
);

-- 2. Indexes for fast lookup by booking, customer, and date
CREATE INDEX IF NOT EXISTS idx_comm_booking_id     ON public.communications (booking_id);
CREATE INDEX IF NOT EXISTS idx_comm_customer_email ON public.communications (customer_email);
CREATE INDEX IF NOT EXISTS idx_comm_created_at     ON public.communications (created_at DESC);

-- 3. Enable Row Level Security
ALTER TABLE public.communications ENABLE ROW LEVEL SECURITY;

-- 4. Policies — allow anon key full access (matches the pattern used by bookings table)
--    Adjust these if you tighten your Supabase RLS rules later.

DROP POLICY IF EXISTS "comm_anon_select" ON public.communications;
DROP POLICY IF EXISTS "comm_anon_insert" ON public.communications;
DROP POLICY IF EXISTS "comm_service_all" ON public.communications;

CREATE POLICY "comm_anon_select" ON public.communications
  FOR SELECT TO anon USING (true);

CREATE POLICY "comm_anon_insert" ON public.communications
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "comm_service_all" ON public.communications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. Grant usage to anon (required for SELECT / INSERT through the JS client)
GRANT SELECT, INSERT ON public.communications TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.communications_id_seq TO anon;
