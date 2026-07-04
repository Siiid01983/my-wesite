<?php
// ════════════════════════════════════════════════════════════════════════════
//  inbox-migrate.php — additive migration for the Email Center (Phase 1).
//
//  Adds the new inbox_messages columns/indexes to an EXISTING install, in place
//  and idempotently (each column/index is checked in information_schema first and
//  only added when missing). Safe to re-run; never drops or alters existing data.
//
//  RUN — preferred (cPanel → Terminal / SSH):
//      php hm-api/inbox-migrate.php
//
//  RUN — over HTTP (no shell): set 'admin_setup_token' in _config.php to a long
//  random string, then visit ONCE:
//      https://<host>/hm-api/inbox-migrate.php?token=<admin_setup_token>
//  Refuses over HTTP without a matching token. Remove the token afterwards.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';

$isCli = (PHP_SAPI === 'cli');

function inbox_mig_out(array $payload, bool $isCli, int $status = 200): void {
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
  hm_rate_limit('inbox_migrate', 5, 60);
  $setup = (string)(hm_config()['admin_setup_token'] ?? '');
  $sent  = (string)($_GET['token'] ?? '');
  if ($setup === '' || !hash_equals($setup, $sent)) {
    inbox_mig_out(['ok' => false, 'error' => 'forbidden — set admin_setup_token in _config.php and pass ?token='], false, 403);
  }
}

// Column DDL (added only if absent). Order preserved for readability.
$COLUMNS = [
  'mailbox'     => "ADD COLUMN `mailbox` VARCHAR(255) DEFAULT NULL",
  'body_html'   => "ADD COLUMN `body_html` MEDIUMTEXT DEFAULT NULL",
  'body_text'   => "ADD COLUMN `body_text` MEDIUMTEXT DEFAULT NULL",
  'message_id'  => "ADD COLUMN `message_id` VARCHAR(255) DEFAULT NULL",
  'in_reply_to' => "ADD COLUMN `in_reply_to` VARCHAR(255) DEFAULT NULL",
  'thread_id'   => "ADD COLUMN `thread_id` VARCHAR(191) DEFAULT NULL",
  'is_read'     => "ADD COLUMN `is_read` TINYINT(1) NOT NULL DEFAULT 0",
  'starred'     => "ADD COLUMN `starred` TINYINT(1) NOT NULL DEFAULT 0",
  'archived'    => "ADD COLUMN `archived` TINYINT(1) NOT NULL DEFAULT 0",
  'status'      => "ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'open'",
  'assignee'    => "ADD COLUMN `assignee` VARCHAR(191) DEFAULT NULL",
  'labels'      => "ADD COLUMN `labels` JSON DEFAULT NULL",
  // Phase 2 (IMAP ingestion): the parsed sender display name and the mail's own
  // Date header (distinct from created_at, which is the DB insert time).
  'sender_name' => "ADD COLUMN `sender_name` VARCHAR(255) DEFAULT NULL",
  'received_at' => "ADD COLUMN `received_at` DATETIME DEFAULT NULL",
];
$INDEXES = [
  'idx_inbox_mailbox'    => "ADD KEY `idx_inbox_mailbox` (`mailbox`)",
  'idx_inbox_thread_id'  => "ADD KEY `idx_inbox_thread_id` (`thread_id`)",
  'idx_inbox_message_id' => "ADD KEY `idx_inbox_message_id` (`message_id`)",
  'idx_inbox_status'     => "ADD KEY `idx_inbox_status` (`status`)",
  'idx_inbox_is_read'    => "ADD KEY `idx_inbox_is_read` (`is_read`)",
  'idx_inbox_received_at'=> "ADD KEY `idx_inbox_received_at` (`received_at`)",
];

try {
  $db = hm_db();

  // Guard: the base table must exist (run schema.mysql.sql first on a fresh DB).
  $exists = $db->query("SHOW TABLES LIKE 'inbox_messages'")->fetch();
  if (!$exists) {
    inbox_mig_out(['ok' => false, 'error' => "inbox_messages does not exist — run schema.mysql.sql first"], $isCli, 500);
  }

  // Existing columns / indexes (current schema, this connection's database).
  $haveCols = [];
  foreach ($db->query("SHOW COLUMNS FROM `inbox_messages`") as $r) $haveCols[$r['Field']] = true;
  $haveIdx = [];
  foreach ($db->query("SHOW INDEX FROM `inbox_messages`") as $r) $haveIdx[$r['Key_name']] = true;

  $addCols = [];
  foreach ($COLUMNS as $name => $ddl) if (empty($haveCols[$name])) $addCols[$name] = $ddl;
  $addIdx = [];
  foreach ($INDEXES as $name => $ddl) if (empty($haveIdx[$name])) $addIdx[$name] = $ddl;

  $applied = [];
  // Add columns first (one ALTER for all missing columns), then indexes.
  if ($addCols) {
    $db->exec('ALTER TABLE `inbox_messages` ' . implode(', ', array_values($addCols)));
    $applied = array_merge($applied, array_keys($addCols));
  }
  if ($addIdx) {
    // Re-check columns exist before indexing them (they now do after the ALTER above).
    $db->exec('ALTER TABLE `inbox_messages` ' . implode(', ', array_values($addIdx)));
    $applied = array_merge($applied, array_keys($addIdx));
  }

  // ── Recipient-channel backfill (Inbox categorization) ──────────────────────
  // Retroactively classify rows that predate recipient tracking (or arrived via
  // the generic webhook without one): mailbox = the receiving company address.
  // Default = contact@hello-moving.com, matching receive-email.php and the
  // admin Inbox UI fallback. Idempotent — only NULL/'' rows are touched; rows
  // classified by the IMAP poller / create-booking.php are never overwritten.
  $backfilled = $db->exec(
    "UPDATE `inbox_messages` SET `mailbox` = 'contact@hello-moving.com'
      WHERE `mailbox` IS NULL OR `mailbox` = ''"
  );

  inbox_mig_out([
    'ok'         => true,
    'status'     => ($applied || $backfilled) ? 'migrated' : 'already_current',
    'added'      => $applied,
    'backfilled' => (int)$backfilled,   // rows classified as contact@ (default channel)
    'columns'    => array_keys($COLUMNS),
    'message'    => ($applied || $backfilled)
      ? 'inbox_messages upgraded (Email Center columns + recipient-channel backfill).'
      : 'inbox_messages already has all Email Center columns — nothing to do.',
  ], $isCli);

} catch (Throwable $e) {
  hm_log_error('inbox-migrate failed', ['err' => $e->getMessage()]);
  inbox_mig_out(['ok' => false, 'error' => hm_debug() ? $e->getMessage() : 'migration failed'], $isCli, 500);
}
