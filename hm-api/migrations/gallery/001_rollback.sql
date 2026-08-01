-- ════════════════════════════════════════════════════════════════════════════
--  001_rollback.sql — reverses 001_create_website_gallery.sql
--
--  Drops the website_gallery table. This removes ALL gallery rows; the underlying
--  image files in the storage.php `media` bucket (gallery/ prefix) are NOT touched
--  by this script and must be cleared separately if a full purge is intended.
-- ════════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS website_gallery;
