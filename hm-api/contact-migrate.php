<?php
// ════════════════════════════════════════════════════════════════════════════
//  contact-migrate.php — additive migration for the Contact Chat feature.
//
//  Creates the contact_conversations table (identity + retention lifecycle for
//  booking-INDEPENDENT お問い合わせ conversations). Messages themselves reuse the
//  existing inbox_messages table (no change there). Idempotent: safe to re-run;
//  never drops or alters existing data.
//
//  RUN — preferred (cPanel → Terminal / SSH):
//      php hm-api/contact-migrate.php
//
//  RUN — over HTTP (no shell): set 'admin_setup_token' in _config.php to a long
//  random string, then visit ONCE:
//      https://<host>/hm-api/contact-migrate.php?token=<admin_setup_token>
//  Refuses over HTTP without a matching token. Remove the token afterwards.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';

$isCli = (PHP_SAPI === 'cli');

function contact_mig_out(array $payload, bool $isCli, int $status = 200): void {
  if ($isCli) {
    foreach ($payload as $k => $v) {
      if (is_bool($v)) $v = $v ? 'true' : 'false';
      fwrite(STDOUT, str_pad($k, 14) . ' : ' . (is_scalar($v) ? (string)$v : json_encode($v)) . PHP_EOL);
    }
  } else {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  }
  exit;
}

// ── Access control (HTTP path): one-time token, rate-limited. CLI is trusted. ──
if (!$isCli) {
  require_once __DIR__ . '/_ratelimit.php';
  hm_rate_limit('contact_migrate', 5, 60);
  $setup = (string)(hm_config()['admin_setup_token'] ?? '');
  $sent  = (string)($_GET['token'] ?? '');
  if ($setup === '' || !hash_equals($setup, $sent)) {
    contact_mig_out(['ok' => false, 'error' => 'forbidden — set admin_setup_token in _config.php and pass ?token='], false, 403);
  }
}

try {
  $db = hm_db();

  $existed = (bool)$db->query("SHOW TABLES LIKE 'contact_conversations'")->fetch();

  $db->exec(
    "CREATE TABLE IF NOT EXISTS contact_conversations (
      id                     CHAR(36)     NOT NULL,
      public_contact_id      VARCHAR(16)  NOT NULL,
      email                  VARCHAR(255) NOT NULL,
      customer_name          TEXT,
      category               VARCHAR(40)  NOT NULL DEFAULT '',
      status                 VARCHAR(20)  NOT NULL DEFAULT 'open',
      created_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at             TIMESTAMP    NULL DEFAULT NULL,
      confirmed_at           TIMESTAMP    NULL DEFAULT NULL,
      last_customer_activity TIMESTAMP    NULL DEFAULT NULL,
      last_admin_activity    TIMESTAMP    NULL DEFAULT NULL,
      expires_at             TIMESTAMP    NULL DEFAULT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_contact_code (public_contact_id),
      KEY idx_contact_email (email),
      KEY idx_contact_status (status),
      KEY idx_contact_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
  );

  contact_mig_out([
    'ok'      => true,
    'status'  => $existed ? 'already_current' : 'migrated',
    'table'   => 'contact_conversations',
    'message' => $existed
      ? 'contact_conversations already exists — nothing to do.'
      : 'contact_conversations created (Contact Chat identity + retention).',
  ], $isCli);

} catch (Throwable $e) {
  hm_log_error('contact-migrate failed', ['err' => $e->getMessage()]);
  contact_mig_out(['ok' => false, 'error' => hm_debug() ? $e->getMessage() : 'migration failed'], $isCli, 500);
}
