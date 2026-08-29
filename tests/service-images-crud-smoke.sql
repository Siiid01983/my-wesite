-- ════════════════════════════════════════════════════════════════════════════
--  service-images-crud-smoke.sql — LIVE CRUD smoke for hm_service_images.
--
--  WHY THIS FILE EXISTS: the dev environment has no MySQL driver/client and no
--  production credentials (cPanel MySQL is host=localhost, server-local only),
--  so the live DB CRUD test cannot run from CI/dev. Paste this whole file into
--  phpMyAdmin (database: hello_moving) and press "Go" — it runs the full
--  SELECT → INSERT → UPDATE → deactivate/reactivate → DELETE → verify-gone
--  sequence and CLEANS UP AFTER ITSELF.
--
--  SAFE BY DESIGN:
--    • Never CREATE/ALTER/DROP/migrate — read+write rows only.
--    • Uses a NON-canonical category '__svcimg_test__' that can NEVER appear on
--      the public site or the six admin cards (the app only maps the six
--      canonical slugs), so even a mid-run abort leaves no visible effect.
--    • Deletes its own row at the end and asserts zero residue.
--
--  EXPECTED RESULT (read the result grids top-to-bottom):
--    step 2  → exactly 1 row
--    step 3  → image_path/alt_text/display_order updated, is_active = 0
--    step 4  → is_active = 1
--    step 5  → should_be_zero = 0
--    step 6  → test_residue  = 0   ← table left exactly as found
-- ════════════════════════════════════════════════════════════════════════════

-- (optional) 0. confirm the real production schema
-- DESCRIBE hm_service_images;

-- 1. INSERT a temporary test row (image_path is NOT NULL → supply a sentinel)
INSERT INTO hm_service_images (category, title, image_path, alt_text, is_active, display_order)
VALUES ('__svcimg_test__', 'CRUD smoke', '/__smoke__/a.jpg', 'smoke alt', 1, 99999);
SET @tid := LAST_INSERT_ID();

-- 2. SELECT it back  (expect 1 row)
SELECT * FROM hm_service_images WHERE id = @tid;

-- 3. UPDATE image_path + alt_text + display_order + is_active (deactivate)
UPDATE hm_service_images
   SET image_path = '/__smoke__/b.jpg',
       alt_text   = 'smoke alt v2',
       display_order = 99998,
       is_active  = 0
 WHERE id = @tid;
SELECT id, image_path, alt_text, display_order, is_active   -- expect b.jpg / v2 / 99998 / 0
  FROM hm_service_images WHERE id = @tid;

-- 4. reactivate  (expect is_active = 1)
UPDATE hm_service_images SET is_active = 1 WHERE id = @tid;
SELECT is_active FROM hm_service_images WHERE id = @tid;

-- 5. DELETE + verify gone  (expect should_be_zero = 0)
DELETE FROM hm_service_images WHERE id = @tid;
SELECT COUNT(*) AS should_be_zero FROM hm_service_images WHERE id = @tid;

-- 6. confirm zero test residue  (expect test_residue = 0)
SELECT COUNT(*) AS test_residue FROM hm_service_images WHERE category = '__svcimg_test__';
