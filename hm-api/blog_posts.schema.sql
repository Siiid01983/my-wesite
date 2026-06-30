-- ════════════════════════════════════════════════════════════════════════════
--  HELLO MOVING — blog_posts table (Public Blog System, Phase 1)
--
--  Dedicated table for blog posts (replaces the localStorage-only / hm_data
--  string store). Mirrors the services/reviews convention:
--    • CHAR(36) UUID PK generated in PHP by hm_uuid4() on INSERT
--    • reference_id = the client-side post id, UNIQUE → upsert onConflict target
--    • slug UNIQUE → public URL lookup (/blog/{slug}); enforced at DB level
--    • categories/tags are JSON arrays (utf8mb4 → full Japanese + emoji)
--
--  Reads are public (rest.php 'select'); writes are staff-gated
--  (rest.php $CONTENT_TABLES_FULL).
--
--  Import:  cPanel → phpMyAdmin → (select DB) → Import → choose this file
--      OR:  mysql -u <user> -p <db> < hm-api/blog_posts.schema.sql
-- ════════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS blog_posts (
  id             CHAR(36)     NOT NULL,
  reference_id   VARCHAR(191) NOT NULL,                 -- client post id (upsert onConflict)
  slug           VARCHAR(191) NOT NULL,                 -- public URL key (/blog/{slug})
  title          TEXT,
  content        MEDIUMTEXT,                            -- Markdown source
  excerpt        TEXT,
  featured_image TEXT,                                  -- URL (uploaded via storage.php)
  categories     JSON,
  tags           JSON,
  status         VARCHAR(20)  NOT NULL DEFAULT 'draft', -- draft | published | scheduled
  featured       TINYINT(1)   NOT NULL DEFAULT 0,
  author         VARCHAR(191),
  author_bio     TEXT,
  scheduled_at   DATETIME     NULL,
  published_at   DATETIME     NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY blog_posts_reference_id_unique (reference_id),  -- upsert onConflict
  UNIQUE KEY blog_posts_slug_unique (slug),                  -- public lookup + integrity
  KEY blog_posts_status_pub_idx (status, published_at),      -- public list: WHERE status='published' ORDER BY published_at
  KEY blog_posts_scheduled_idx (status, scheduled_at)        -- scheduled publisher sweep
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
