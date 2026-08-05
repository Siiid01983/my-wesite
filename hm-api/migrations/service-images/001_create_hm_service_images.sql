-- ════════════════════════════════════════════════════════════════════════════
--  001_create_hm_service_images.sql — Service Card Images (サービス画像管理), Phase 1 (ADDITIVE)
--
--  A dedicated table backing the DB-driven service-card images on the public
--  homepage and their admin CRUD:
--     public read  : hm-api/service-images.php   (GET active rows)
--     admin write  : hm-api/admin/service-images.php (create/replace/delete/reorder)
--
--  One row PER service slug (UNIQUE service_slug) — each of the 6 homepage service
--  cards maps to at most one custom image. When a slug has no active row, the
--  frontend falls back to the built-in SERVICE_CONFIG placeholder image, so this
--  table is a no-op for every existing code path until a row is added.
--
--  Images live in the storage.php `media` bucket (world-readable) under the
--  service-images/ prefix; only the relative paths/URLs are stored here.
--
--  Apply on the cPanel host via phpMyAdmin (paste this file) or the mysql CLI.
--  Idempotent: CREATE TABLE IF NOT EXISTS — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hm_service_images (
  id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  service_slug  VARCHAR(40)      NOT NULL,                -- sameday|single|couple|student|disposal|furniture
  image_url     VARCHAR(255)     NOT NULL,               -- original (re-encoded)
  image_webp    VARCHAR(255)         NULL,               -- generated on upload (WebP)
  thumb_url     VARCHAR(255)         NULL,               -- 400px, admin list only
  width         SMALLINT UNSIGNED    NULL,               -- prevents CLS on the card
  height        SMALLINT UNSIGNED    NULL,
  alt_text      VARCHAR(200)     NOT NULL DEFAULT '',    -- SEO + a11y
  active        TINYINT(1)       NOT NULL DEFAULT 1,     -- 0 → card uses default placeholder
  display_order INT              NOT NULL DEFAULT 0,
  created_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_service_slug (service_slug),           -- one image per service card
  KEY idx_active_order (active, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
