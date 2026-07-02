-- ════════════════════════════════════════════════════════════════════════════
--  HELLO MOVING — AUTHORITATIVE MySQL schema  (self-hosted cPanel; post-Supabase)
--
--  Regenerated from a full codebase scan. Every table below is referenced by the
--  live code; nothing speculative is included. Sources of truth:
--    • hm-api/rest.php  $SCHEMA  — the table+column allowlist the API enforces
--    • Direct SQL in hm-api/{create-booking,get-booking,auth,receive-email}.php
--      and hm-api/admin/{stats,bookings}.php
--    • Frontend .from('<table>') calls (js/services/*, js/modules/*, bookingService.js)
--
--  Import:  cPanel → phpMyAdmin → (select DB) → Import → choose this file
--      OR:  mysql -u <user> -p <db> < schema.mysql.sql
--
--  Engine: InnoDB · Charset: utf8mb4 (full Japanese + emoji). Requires MySQL 5.7+
--  or MariaDB 10.2+ (JSON type). All CHAR(36) UUID PKs are generated in PHP by
--  hm_uuid4() on INSERT — no DB-side UUID default needed.
--
--  Foreign keys: NONE are enforced (matches the live design). booking_id /
--  booking_reference are LOGICAL references to bookings.id and are kept as plain
--  indexed columns so inserts never fail on order/missing parents. See migration
--  notes in the accompanying report before adding hard FKs.
-- ════════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ── hm_data : generic key-value CMS store (hero, faq, footer, prices, theme, …)
--    Used by: apiAdapter, contentLoader, healthCheck, wmc*, pageManager.
CREATE TABLE IF NOT EXISTS hm_data (
  id         CHAR(36)     NOT NULL,
  `key`      VARCHAR(191) NOT NULL,
  `value`    JSON         NOT NULL,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY hm_data_key_unique (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── bookings : customer moving bookings (public form + admin + portal)
--    HM-xxx reference + from/to/time/service are packed inside `notes`.
--    Used by: bookingService, apiAdapter, statisticsService, create-booking.php,
--             get-booking.php, auth.php (portal login), admin/{stats,bookings}.php.
CREATE TABLE IF NOT EXISTS bookings (
  id             CHAR(36)     NOT NULL,
  customer_name  TEXT,
  customer_email VARCHAR(255),
  customer_phone VARCHAR(60),
  booking_date   VARCHAR(40),
  service_id     VARCHAR(191),
  status         VARCHAR(20)  NOT NULL DEFAULT 'pending',
  notes          TEXT,
  items          JSON,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY bookings_status_idx (status),               -- admin/bookings.php WHERE status=?
  KEY bookings_booking_date_idx (booking_date),   -- calendar / availability views
  KEY bookings_email_idx (customer_email),        -- get-booking.php ?email=
  KEY bookings_created_at_idx (created_at)         -- ORDER BY created_at DESC everywhere
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── calendar_availability : stores ONLY non-available date overrides
--    Used by: apiAdapter (setDate/getAvail), contentLoader, public calendar.
CREATE TABLE IF NOT EXISTS calendar_availability (
  id         CHAR(36)    NOT NULL,
  `date`     VARCHAR(40) NOT NULL,
  status     VARCHAR(20) NOT NULL DEFAULT 'full',
  updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY calendar_date_unique (`date`),       -- upsert onConflict: date
  KEY calendar_status_idx (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── reviews : customer reviews (public submit + admin approve/publish)
--    Used by: apiAdapter, statisticsService, contentLoader, portalReviews.
CREATE TABLE IF NOT EXISTS reviews (
  id                CHAR(36)     NOT NULL,
  reference_id      VARCHAR(191) NOT NULL,
  customer_name     TEXT,
  rating            TINYINT,
  review_text       TEXT,
  approved          TINYINT(1)   NOT NULL DEFAULT 0,
  published         TINYINT(1)   NOT NULL DEFAULT 0,
  headline          TEXT,
  service           VARCHAR(191),
  date_label        VARCHAR(80),
  location          VARCHAR(120),
  source            VARCHAR(20)  NOT NULL DEFAULT 'admin',
  booking_reference VARCHAR(191),
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY reviews_reference_id_unique (reference_id),   -- upsert onConflict
  KEY reviews_created_at_idx (created_at),
  KEY reviews_approved_idx (approved, published)           -- admin/stats WHERE approved=0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── services : public service listings (admin-editable)
--    Used by: apiAdapter, contentLoader, admin/stats.php, wmcServices.
CREATE TABLE IF NOT EXISTS services (
  id            CHAR(36)     NOT NULL,
  reference_id  VARCHAR(191) NOT NULL,
  title         TEXT,
  description   TEXT,
  display_order SMALLINT     NOT NULL DEFAULT 0,
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  badge         VARCHAR(120),
  cta_text      VARCHAR(120),
  PRIMARY KEY (id),
  UNIQUE KEY services_reference_id_unique (reference_id),  -- upsert onConflict
  KEY services_order_idx (display_order)                   -- ORDER BY display_order
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── blog_posts : public blog (admin-editable; Public Blog System Phase 1)
--    Used by: blogManager, apiAdapter (blogToRow/rowToBlog), public blog renderer.
--    reads public · writes staff-gated (rest.php $CONTENT_TABLES_FULL).
CREATE TABLE IF NOT EXISTS blog_posts (
  id             CHAR(36)     NOT NULL,
  reference_id   VARCHAR(191) NOT NULL,
  slug           VARCHAR(191) NOT NULL,
  title          TEXT,
  content        MEDIUMTEXT,
  excerpt        TEXT,
  featured_image TEXT,
  categories     JSON,
  tags           JSON,
  status         VARCHAR(20)  NOT NULL DEFAULT 'draft',
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
  KEY blog_posts_status_pub_idx (status, published_at),
  KEY blog_posts_scheduled_idx (status, scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── communications : admin ↔ customer message log (+ email delivery status)
--    AUTO_INCREMENT BIGINT id (rest.php: uuid_pk=false, int id). Logical
--    booking_id → bookings.id (no FK). Used by: communications.js, portalComms.
CREATE TABLE IF NOT EXISTS communications (
  id             BIGINT       NOT NULL AUTO_INCREMENT,
  booking_id     VARCHAR(191),
  customer_email VARCHAR(255),
  sender_email   VARCHAR(255) NOT NULL DEFAULT 'booking@hello-moving.com',
  subject        TEXT,
  message        TEXT         NOT NULL,
  direction      VARCHAR(12)  NOT NULL DEFAULT 'outbound',
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by     VARCHAR(191),
  email_status   VARCHAR(12)  DEFAULT 'pending',
  email_error    TEXT,
  sent_at        DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_comm_booking_id (booking_id),
  KEY idx_comm_customer_email (customer_email),
  KEY idx_comm_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── inbox_messages : inbound email (receive-email.php webhook target)
--    Used by: inbox.js, receive-email.php. Logical booking_id → bookings.id.
CREATE TABLE IF NOT EXISTS inbox_messages (
  id          CHAR(36)     NOT NULL,
  sender      TEXT         NOT NULL,
  email       VARCHAR(255) NOT NULL,
  subject     TEXT         NOT NULL,
  body        TEXT         NOT NULL,
  booking_id  VARCHAR(191),
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Email Center (Phase 1, additive). `body` is retained for backward compat;
  -- body_text/body_html are the new canonical body columns. Populated by the
  -- IMAP poller (Phase 2); nullable so existing rows + the JSON webhook still work.
  mailbox     VARCHAR(255) DEFAULT NULL,        -- which company mailbox received it
  body_html   MEDIUMTEXT   DEFAULT NULL,
  body_text   MEDIUMTEXT   DEFAULT NULL,
  message_id  VARCHAR(255) DEFAULT NULL,        -- RFC Message-ID of the inbound mail
  in_reply_to VARCHAR(255) DEFAULT NULL,
  thread_id   VARCHAR(191) DEFAULT NULL,        -- conversation grouping key
  is_read     TINYINT(1)   NOT NULL DEFAULT 0,
  starred     TINYINT(1)   NOT NULL DEFAULT 0,
  archived    TINYINT(1)   NOT NULL DEFAULT 0,
  status      VARCHAR(20)  NOT NULL DEFAULT 'open',   -- open|pending|waiting|resolved|closed
  assignee    VARCHAR(191) DEFAULT NULL,
  labels      JSON         DEFAULT NULL,
  sender_name VARCHAR(255) DEFAULT NULL,        -- parsed From display name (Phase 2 IMAP)
  received_at DATETIME     DEFAULT NULL,         -- mail Date header (≠ created_at insert time)
  PRIMARY KEY (id),
  KEY idx_inbox_created_at (created_at),
  KEY idx_inbox_booking_id (booking_id),
  KEY idx_inbox_email (email),
  KEY idx_inbox_mailbox (mailbox),
  KEY idx_inbox_thread_id (thread_id),
  KEY idx_inbox_message_id (message_id),
  KEY idx_inbox_status (status),
  KEY idx_inbox_is_read (is_read),
  KEY idx_inbox_received_at (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── audit_log : append-only action trail
--    Used by: auditService.js (.from('audit_log')), auditLog.js.
CREATE TABLE IF NOT EXISTS audit_log (
  id          CHAR(36)     NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor       VARCHAR(191) NOT NULL DEFAULT 'system',
  action      VARCHAR(40)  NOT NULL DEFAULT 'other',
  target_type VARCHAR(40)  NOT NULL DEFAULT '-',
  target_id   VARCHAR(191) NOT NULL DEFAULT '',
  details     TEXT,
  PRIMARY KEY (id),
  KEY idx_audit_created_at (created_at),
  KEY idx_audit_action (action),
  KEY idx_audit_target (target_type, target_id),
  KEY idx_audit_actor (actor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;

-- ════════════════════════════════════════════════════════════════════════════
--  SEED — services + a few approved reviews so the public site shows content on
--         a fresh database. (hm_data keys are optional: the JS Adapter has
--         built-in defaults for hero/faq/footer/prices/etc.) UUIDs are fixed
--         constants so re-import is idempotent.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO services (id, reference_id, title, description, display_order, active, badge, cta_text) VALUES
 ('11111111-0000-4000-8000-0000000000s1','SVC-1','単身引越し','1人分の荷物に最適化。必要な分だけコンパクトに対応。',0,1,'人気サービス','無料お見積り →'),
 ('11111111-0000-4000-8000-0000000000s2','SVC-2','カップル・ご夫婦引越し','養生から家具配置まで。二人の新生活をスムーズに。',1,1,'人気サービス','無料お見積り →'),
 ('11111111-0000-4000-8000-0000000000s3','SVC-3','学生・新生活引越し','初めての引越しも段取りから設置まで対応。',2,1,'人気サービス','無料お見積り →'),
 ('11111111-0000-4000-8000-0000000000s4','SVC-4','当日・お急ぎ引越しプラン','急な引越しも当日対応。最短2時間でご返信します。',3,1,'緊急対応',''),
 ('11111111-0000-4000-8000-0000000000s5','SVC-5','不用品回収・処分','回収・処分・搬出まで一括。手続き不要。',4,1,'','無料お見積り →'),
 ('11111111-0000-4000-8000-0000000000s6','SVC-6','家具組立・分解','IKEA・大型家具の組立・分解に対応。',5,1,'','無料お見積り →')
ON DUPLICATE KEY UPDATE title=VALUES(title), description=VALUES(description),
  display_order=VALUES(display_order), active=VALUES(active), badge=VALUES(badge), cta_text=VALUES(cta_text);

INSERT INTO reviews (id, reference_id, customer_name, rating, review_text, approved, published, headline, service, date_label, location, source) VALUES
 ('22222222-0000-4000-8000-00000000rev1','REV-SEED-1','田中 美咲',5,'丁寧に対応していただき、引越しがスムーズに完了しました。スタッフの方々がとても親切で、大切な家具も傷一つなく運んでいただけました。また利用したいと思います。',1,1,'対応が丁寧で安心でした','単身引越し','2026年4月','渋谷区','admin'),
 ('22222222-0000-4000-8000-00000000rev2','REV-SEED-2','Kenji Tanaka',5,'Very professional service! They handled everything carefully and were perfectly on time. English support was excellent throughout. Highly recommended for expats moving in Tokyo.',1,1,'Excellent English support — highly recommended','カップル・ご夫婦引越し','2026年3月','港区','admin'),
 ('22222222-0000-4000-8000-00000000rev3','REV-SEED-3','山田 太郎',5,'急な引越しにも関わらず、当日対応していただきました。料金も明確で、追加費用なしで完了しました。対応の速さと丁寧さに大変満足しております。',1,1,'当日対応で本当に助かりました','当日・お急ぎ引越しプラン','2026年5月','新宿区','admin'),
 ('22222222-0000-4000-8000-00000000rev4','REV-SEED-4','鈴木 花子',5,'学生の一人暮らし引越しで利用しました。初めての引越しで不安でしたが、スタッフの方が丁寧に説明してくださり安心できました。料金もリーズナブルでした。',1,1,'初めての引越しも安心してお任せできました','学生・新生活引越し','2026年4月','豊島区','admin'),
 ('22222222-0000-4000-8000-00000000rev5','REV-SEED-5','佐藤 健太',5,'不用品の回収もまとめてお願いしました。引越しと同時に処分できたので非常に助かりました。対応が迅速で、見積もり通りの金額で完了しました。',1,1,'引越しと不用品回収を同時に対応','不用品回収・処分','2026年2月','世田谷区','admin')
ON DUPLICATE KEY UPDATE customer_name=VALUES(customer_name), rating=VALUES(rating), review_text=VALUES(review_text),
  approved=VALUES(approved), published=VALUES(published), headline=VALUES(headline), service=VALUES(service),
  date_label=VALUES(date_label), location=VALUES(location), source=VALUES(source);
