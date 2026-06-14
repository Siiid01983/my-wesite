-- Phase 29b: Fix communications.booking_id column type
-- The column was created as bigint but booking IDs are strings (e.g. HM-20260614-ICJY).
-- Alter to text so string booking IDs can be stored and queried.

ALTER TABLE public.communications
  ALTER COLUMN booking_id TYPE text USING booking_id::text;
