-- ════════════════════════════════════════════════════════════════════════════
--  admin_users — server-side admin authentication (MySQL)
--
--  Migrates admin login OFF browser localStorage (hm_admin_creds / hm_staff) and
--  onto a MySQL table with password_hash()/password_verify() (bcrypt). Supports
--  multiple admin accounts and roles. Verified by hm-api/admin-login.php, which
--  starts a PHP session AND mints the existing HMAC admin token (rest.php gate
--  stays unchanged).
--
--  APPLY:    run this file once against the Hello Moving database, OR run
--            `php hm-api/admin-migrate.php` (which executes this + seeds an admin).
--  ROLLBACK: `DROP TABLE admin_users;` then set 'admin_auth_enabled' => false in
--            _config.php. Login falls back to the legacy single-hash / localStorage
--            path (see ADMIN_AUTH_MIGRATION.md).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `admin_users` (
  `id`            CHAR(36)     NOT NULL,                       -- uuid4 (hm_uuid4)
  `email`         VARCHAR(190) NOT NULL,                       -- login id, lowercased
  `name`          VARCHAR(120) NOT NULL DEFAULT '',
  `pass_hash`     VARCHAR(255) NOT NULL,                       -- password_hash(PASSWORD_DEFAULT)
  `role`          VARCHAR(20)  NOT NULL DEFAULT 'admin',       -- 'admin' | 'manager'
  `active`        TINYINT(1)   NOT NULL DEFAULT 1,
  `must_change_password` TINYINT(1) NOT NULL DEFAULT 0,       -- force password change on next login
  `last_login`    DATETIME     NULL DEFAULT NULL,
  `tokens_valid_after` BIGINT UNSIGNED NULL DEFAULT NULL,      -- logout/revocation cutoff (epoch s); tokens with iat < this are rejected
  `reset_hash`    VARCHAR(255) NULL DEFAULT NULL,              -- reserved: hashed one-time reset token
  `reset_expires` DATETIME     NULL DEFAULT NULL,              -- reserved: reset token expiry
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_admin_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
