<?php
// ════════════════════════════════════════════════════════════════════════════
//  backfill.php — one-shot recipient-channel backfill for the admin Inbox.
//
//  Sets mailbox = 'contact@hello-moving.com' on every inbox_messages row where
//  mailbox is NULL or '' (legacy rows that predate recipient tracking), so they
//  appear under the contact@ channel tab in the admin Inbox. Idempotent — rows
//  already classified (IMAP poller / create-booking.php) are never touched.
//
//  RUN — preferred (cPanel → Terminal / SSH):
//      php hm-api/backfill.php
//
//  RUN — over HTTP (no shell): set 'admin_setup_token' in _config.php to a long
//  random string, then visit ONCE:
//      https://<host>/hm-api/backfill.php?token=<admin_setup_token>
//  Refuses over HTTP without a matching token. DELETE THIS FILE afterwards.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';

$isCli = (PHP_SAPI === 'cli');

// Default receiving channel — must match receive-email.php and the Inbox UI fallback.
const HM_BACKFILL_MAILBOX = 'contact@hello-moving.com';

function backfill_out(array $payload, bool $isCli, int $status = 200): void {
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
  hm_rate_limit('inbox_backfill', 5, 60);
  $setup = (string)(hm_config()['admin_setup_token'] ?? '');
  $sent  = (string)($_GET['token'] ?? '');
  if ($setup === '' || !hash_equals($setup, $sent)) {
    backfill_out(['ok' => false, 'error' => 'forbidden — set admin_setup_token in _config.php and pass ?token='], false, 403);
  }
}

try {
  $db = hm_db();

  // Guards: the table and the mailbox column must exist (run inbox-migrate.php first).
  $exists = $db->query("SHOW TABLES LIKE 'inbox_messages'")->fetch();
  if (!$exists) {
    backfill_out(['ok' => false, 'error' => 'inbox_messages does not exist — run schema.mysql.sql first'], $isCli, 500);
  }
  $haveCols = [];
  foreach ($db->query("SHOW COLUMNS FROM `inbox_messages`") as $r) $haveCols[$r['Field']] = true;
  if (empty($haveCols['mailbox'])) {
    backfill_out(['ok' => false, 'error' => 'mailbox column missing — run inbox-migrate.php first'], $isCli, 500);
  }

  $pending = (int)$db->query(
    "SELECT COUNT(*) FROM `inbox_messages` WHERE `mailbox` IS NULL OR `mailbox` = ''"
  )->fetchColumn();

  $updated = 0;
  if ($pending > 0) {
    $stmt = $db->prepare(
      "UPDATE `inbox_messages` SET `mailbox` = ? WHERE `mailbox` IS NULL OR `mailbox` = ''"
    );
    $stmt->execute([HM_BACKFILL_MAILBOX]);
    $updated = $stmt->rowCount();
  }

  // Post-state: rows per channel, so the result is verifiable at a glance.
  $byMailbox = [];
  foreach ($db->query(
    "SELECT COALESCE(NULLIF(`mailbox`, ''), '(unset)') AS mb, COUNT(*) AS n
       FROM `inbox_messages` GROUP BY mb ORDER BY n DESC"
  ) as $r) {
    $byMailbox[$r['mb']] = (int)$r['n'];
  }

  backfill_out([
    'ok'         => true,
    'status'     => $updated > 0 ? 'backfilled' : 'nothing_to_do',
    'backfilled' => $updated,
    'mailbox'    => HM_BACKFILL_MAILBOX,
    'channels'   => $byMailbox,
    'message'    => $updated > 0
      ? "$updated legacy message(s) assigned to the contact@ channel — they will now appear in the admin Inbox."
      : 'No rows with an empty mailbox — nothing to do. (Already backfilled?)',
  ], $isCli);

} catch (Throwable $e) {
  hm_log_error('inbox backfill failed', ['err' => $e->getMessage()]);
  backfill_out(['ok' => false, 'error' => hm_debug() ? $e->getMessage() : 'backfill failed'], $isCli, 500);
}
