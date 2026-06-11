-- =================================================================
-- Hello Moving — RLS Policy Migration
-- =================================================================
-- Security model:
--   Every browser request (public site, admin panel, WMC) uses the
--   same anon key.  Supabase Auth is not used.  Application-level
--   authentication (salted-hash session in Auth/js) controls who
--   can reach write paths; RLS can only enforce role-level access.
--
--   Consequence: anon must be granted full CRUD on all tables so
--   the admin and WMC write paths work.  Restricting public
--   visitors from writing is enforced in application code, not here.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- =================================================================


-- ─────────────────────────────────────────────────────────────────
-- hm_data  (key-value content store: hero, FAQ, footer, theme …)
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE hm_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hm_data_anon_select" ON hm_data;
DROP POLICY IF EXISTS "hm_data_anon_insert" ON hm_data;
DROP POLICY IF EXISTS "hm_data_anon_update" ON hm_data;
DROP POLICY IF EXISTS "hm_data_anon_delete" ON hm_data;

-- Public site reads content via ContentLoader
CREATE POLICY "hm_data_anon_select"
  ON hm_data FOR SELECT
  TO anon
  USING (true);

-- Admin / WMC write content via Adapter._kv()
CREATE POLICY "hm_data_anon_insert"
  ON hm_data FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "hm_data_anon_update"
  ON hm_data FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "hm_data_anon_delete"
  ON hm_data FOR DELETE
  TO anon
  USING (true);


-- ─────────────────────────────────────────────────────────────────
-- services  (service card listings)
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "services_anon_select" ON services;
DROP POLICY IF EXISTS "services_anon_insert" ON services;
DROP POLICY IF EXISTS "services_anon_update" ON services;
DROP POLICY IF EXISTS "services_anon_delete" ON services;

-- Public site reads services via ContentLoader
CREATE POLICY "services_anon_select"
  ON services FOR SELECT
  TO anon
  USING (true);

-- Admin manages services via Adapter._upsert() / saveServices()
CREATE POLICY "services_anon_insert"
  ON services FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "services_anon_update"
  ON services FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "services_anon_delete"
  ON services FOR DELETE
  TO anon
  USING (true);


-- ─────────────────────────────────────────────────────────────────
-- reviews  (customer reviews; public submission + admin moderation)
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reviews_anon_select" ON reviews;
DROP POLICY IF EXISTS "reviews_anon_insert" ON reviews;
DROP POLICY IF EXISTS "reviews_anon_update" ON reviews;
DROP POLICY IF EXISTS "reviews_anon_delete" ON reviews;

-- Public site reads approved+published reviews via ContentLoader
CREATE POLICY "reviews_anon_select"
  ON reviews FOR SELECT
  TO anon
  USING (true);

-- Customers submit via public review form; admin adds via panel
CREATE POLICY "reviews_anon_insert"
  ON reviews FOR INSERT
  TO anon
  WITH CHECK (true);

-- Admin approves / rejects / edits via Adapter.updateReview()
CREATE POLICY "reviews_anon_update"
  ON reviews FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Admin deletes via Adapter.deleteReview()
CREATE POLICY "reviews_anon_delete"
  ON reviews FOR DELETE
  TO anon
  USING (true);


-- ─────────────────────────────────────────────────────────────────
-- bookings  (customer bookings; public submission + admin management)
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bookings_anon_select" ON bookings;
DROP POLICY IF EXISTS "bookings_anon_insert" ON bookings;
DROP POLICY IF EXISTS "bookings_anon_update" ON bookings;
DROP POLICY IF EXISTS "bookings_anon_delete" ON bookings;

-- Admin reads bookings via Adapter.getBookings() / syncBookings()
CREATE POLICY "bookings_anon_select"
  ON bookings FOR SELECT
  TO anon
  USING (true);

-- Customers submit via BookingService; admin adds via panel
CREATE POLICY "bookings_anon_insert"
  ON bookings FOR INSERT
  TO anon
  WITH CHECK (true);

-- Admin updates status via Adapter.updateBooking()
CREATE POLICY "bookings_anon_update"
  ON bookings FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Admin deletes via Adapter.deleteBooking()
CREATE POLICY "bookings_anon_delete"
  ON bookings FOR DELETE
  TO anon
  USING (true);


-- ─────────────────────────────────────────────────────────────────
-- calendar_availability  (booked / blocked dates)
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE calendar_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calendar_availability_anon_select" ON calendar_availability;
DROP POLICY IF EXISTS "calendar_availability_anon_insert" ON calendar_availability;
DROP POLICY IF EXISTS "calendar_availability_anon_update" ON calendar_availability;
DROP POLICY IF EXISTS "calendar_availability_anon_delete" ON calendar_availability;

-- Public site reads availability via ContentLoader (_applyCalendar)
CREATE POLICY "calendar_availability_anon_select"
  ON calendar_availability FOR SELECT
  TO anon
  USING (true);

-- Admin sets dates via Adapter.setDate()
CREATE POLICY "calendar_availability_anon_insert"
  ON calendar_availability FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "calendar_availability_anon_update"
  ON calendar_availability FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Adapter.setDate('available') removes rows via _del()
CREATE POLICY "calendar_availability_anon_delete"
  ON calendar_availability FOR DELETE
  TO anon
  USING (true);
