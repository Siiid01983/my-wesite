-- ════════════════════════════════════════════════════════════════════════════
--  001_rollback.sql — reverse 001_create_hm_service_images.sql
--
--  Drops the service-card image table. DESTRUCTIVE: removes all uploaded-image
--  records (the files in the media bucket are NOT touched by this script). Safe to
--  run — the frontend simply falls back to the built-in SERVICE_CONFIG placeholders.
-- ════════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS hm_service_images;
