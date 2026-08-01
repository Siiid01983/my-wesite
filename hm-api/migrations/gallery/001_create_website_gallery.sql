-- ════════════════════════════════════════════════════════════════════════════
--  001_create_website_gallery.sql — Works Gallery (作業事例ギャラリー), Phase 1 (ADDITIVE)
--
--  A dedicated table backing the DB-driven public gallery carousel and its admin
--  CRUD (hm-api/gallery.php public GET, hm-api/admin/gallery.php admin CRUD).
--  Nothing in the existing booking / CMS / admin flows reads or writes this table;
--  creating it is a no-op for every current code path.
--
--  Images live in the storage.php `media` bucket (world-readable) under the
--  gallery/ prefix; only the relative paths/URLs are stored here.
--
--  Apply on the cPanel host via phpMyAdmin (paste this file) or the mysql CLI.
--  Idempotent: CREATE TABLE IF NOT EXISTS — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS website_gallery (
  id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  title         VARCHAR(120)     NOT NULL,
  description   VARCHAR(400)         NULL,
  alt_text      VARCHAR(200)     NOT NULL,               -- required: SEO + a11y
  image_url     VARCHAR(255)     NOT NULL,               -- original (re-encoded)
  image_webp    VARCHAR(255)         NULL,               -- generated on upload
  thumb_url     VARCHAR(255)         NULL,               -- 400px, admin list only
  width         SMALLINT UNSIGNED    NULL,               -- prevents CLS
  height        SMALLINT UNSIGNED    NULL,
  category      VARCHAR(40)      NOT NULL DEFAULT 'general',
  display_order INT              NOT NULL DEFAULT 0,
  is_active     TINYINT(1)       NOT NULL DEFAULT 1,
  is_featured   TINYINT(1)       NOT NULL DEFAULT 0,
  created_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_active_order (is_active, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
