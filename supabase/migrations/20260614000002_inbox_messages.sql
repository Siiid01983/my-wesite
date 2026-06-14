-- ════════════════════════════════════════════════════════
-- Phase 31 — Inbound Email Inbox
-- Creates inbox_messages table for Resend inbound webhooks.
-- Additive only — no existing tables touched.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.inbox_messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sender     TEXT        NOT NULL,
  email      TEXT        NOT NULL,
  subject    TEXT        NOT NULL DEFAULT '',
  body       TEXT        NOT NULL DEFAULT '',
  booking_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes: admin inbox list (newest first), filter by booking, filter by sender
CREATE INDEX IF NOT EXISTS idx_inbox_created_at  ON public.inbox_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_booking_id  ON public.inbox_messages (booking_id);
CREATE INDEX IF NOT EXISTS idx_inbox_email       ON public.inbox_messages (email);

-- RLS off — edge function writes with service_role key; admin reads with anon key
ALTER TABLE public.inbox_messages DISABLE ROW LEVEL SECURITY;

-- Verify
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'inbox_messages'
ORDER  BY ordinal_position;
