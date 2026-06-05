-- ════════════════════════════════════════════════════════════════════════════
-- Hello Moving — Reference Fields Migration
-- Migration: 002_add_reference_fields
-- Adds the columns needed to bridge the admin panel's string IDs (HM-*, REV-*,
-- SVC-*) with the UUID primary keys used in the Supabase tables.
-- ════════════════════════════════════════════════════════════════════════════


-- ── bookings ──────────────────────────────────────────────────────────────────
-- reference_id: stores the admin's HM-YYYYMMDD-XXXX display ID
-- time_slot:    stores the preferred move time window (e.g. '午前 8:00〜12:00')
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reference_id TEXT UNIQUE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS time_slot    TEXT;


-- ── reviews ───────────────────────────────────────────────────────────────────
-- reference_id:      stores the admin's REV-* ID
-- headline:          short review headline / title
-- service:           service the customer used
-- date_label:        human-readable date string (e.g. '2026年6月')
-- location:          customer location label
-- published:         controls public visibility (separate from approved)
-- source:            'admin' | 'public' | 'google'
-- booking_reference: the HM-* booking ID this review is linked to
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reference_id      TEXT UNIQUE;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS headline          TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS service           TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS date_label        TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS location          TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS published         BOOLEAN DEFAULT FALSE;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS source            TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS booking_reference TEXT;


-- ── services ──────────────────────────────────────────────────────────────────
-- reference_id: stores the admin's SVC-* ID
-- badge:        badge label shown on the card (e.g. '人気サービス')
-- cta_text:     call-to-action button text
ALTER TABLE services ADD COLUMN IF NOT EXISTS reference_id TEXT UNIQUE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS badge        TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS cta_text     TEXT;
