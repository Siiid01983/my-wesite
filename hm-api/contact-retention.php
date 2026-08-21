<?php
// ════════════════════════════════════════════════════════════════════════════
//  contact-retention.php — automatic retention purge for Contact Chat.
//
//  Enforces the Contact Chat retention policy: a conversation whose expires_at is
//  in the past is HARD-DELETED together with all of its messages (inbox_messages
//  thread 'contact:<CODE>') and any attachment files under the private storage
//  folder contact/<CODE>/. Writes an append-only audit_log row per purge.
//
//  The retention window is contact_retention_days in _config.php (default 180) and
//  is applied at write time (contact-chat.php sets/rolls expires_at). This job only
//  ACTS on expires_at — so the period is configured server-side in exactly one place.
//
//  RUN — cron (preferred):
//      # daily, 04:10
//      10 4 * * * php /home/<user>/public_html/hm-api/contact-retention.php >/dev/null 2>&1
//  RUN — HTTP (cron with curl, same server only): set 'contact_cron_token' in
//  _config.php, then:
//      curl -s -H "X-Cron-Token: <contact_cron_token>" https://<host>/hm-api/contact-retention.php
//  Same-server only (loopback / server's own IP) — external callers get 403 even
//  with the token.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';

$isCli = (PHP_SAPI === 'cli');

function cr_out(array $payload, bool $isCli, int $status = 200): void {
  if ($isCli) {
    foreach ($payload as $k => $v) {
      if (is_bool($v)) $v = $v ? 'true' : 'false';
      fwrite(STDOUT, str_pad($k, 16) . ' : ' . (is_scalar($v) ? (string)$v : json_encode($v)) . PHP_EOL);
    }
  } else {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  }
  exit;
}

// ── Access control (HTTP path): same-server + token + rate limit. CLI trusted. ──
if (!$isCli) {
  require_once __DIR__ . '/_ratelimit.php';
  hm_rate_limit('contact_retention', 5, 60);
  $ip     = (string)($_SERVER['REMOTE_ADDR'] ?? '');
  $server = (string)($_SERVER['SERVER_ADDR'] ?? '');
  $isLocal = in_array($ip, ['127.0.0.1', '::1'], true) || ($server !== '' && $ip === $server);
  if (!$isLocal) {
    cr_out(['ok' => false, 'error' => 'forbidden — contact-retention.php accepts same-server requests only'], false, 403);
  }
  $token = (string)(hm_config()['contact_cron_token'] ?? '');
  $sent  = (string)($_SERVER['HTTP_X_CRON_TOKEN'] ?? ($_GET['token'] ?? ''));
  if ($token === '' || !hash_equals($token, $sent)) {
    cr_out(['ok' => false, 'error' => 'forbidden — set contact_cron_token in _config.php and send X-Cron-Token'], false, 403);
  }
}

$cfg        = hm_config();
$storageDir = rtrim((string)($cfg['storage_dir'] ?? (__DIR__ . '/_uploads')), '/\\');

// Recursively delete a conversation's attachment folder. Confined to
// storage/contact/<sanitised-code>/ — can never traverse elsewhere. Returns the
// number of files removed. Best-effort (a locked file never aborts the purge).
function cr_purge_dir(string $dir): int {
  if (!is_dir($dir)) return 0;
  $count = 0;
  $items = @scandir($dir);
  if ($items === false) return 0;
  foreach ($items as $it) {
    if ($it === '.' || $it === '..') continue;
    $path = $dir . '/' . $it;
    if (is_dir($path)) { $count += cr_purge_dir($path); @rmdir($path); }
    else { if (@unlink($path)) $count++; }
  }
  @rmdir($dir);
  return $count;
}

// Append an audit_log row (best-effort). Table already exists in schema; guarded.
function cr_audit(PDO $db, string $code, int $msgs, int $files): void {
  try {
    $st = $db->prepare(
      'INSERT INTO audit_log (id, actor, action, target_type, target_id, details)
       VALUES (?,?,?,?,?,?)'
    );
    $st->execute([
      hm_uuid4(), 'system', 'retention_purge', 'contact_conversation', $code,
      json_encode(['messages_deleted' => $msgs, 'files_deleted' => $files], JSON_UNESCAPED_UNICODE),
    ]);
  } catch (Throwable $e) {
    hm_log_error('contact-retention audit failed', ['err' => $e->getMessage(), 'code' => $code]);
  }
}

try {
  $db = hm_db();

  // No table yet → nothing to purge (deploy-order-safe).
  if (!$db->query("SHOW TABLES LIKE 'contact_conversations'")->fetch()) {
    cr_out(['ok' => true, 'status' => 'no_table', 'purged' => 0], $isCli);
  }

  $rows = $db->query(
    "SELECT id, public_contact_id FROM contact_conversations
      WHERE expires_at IS NOT NULL AND expires_at < NOW()"
  )->fetchAll();

  $purged = 0; $msgTotal = 0; $fileTotal = 0;
  foreach ($rows as $c) {
    $cid    = (string)$c['public_contact_id'];
    $thread = 'contact:' . $cid;

    // 1) Delete all messages in the conversation's thread.
    $d = $db->prepare('DELETE FROM inbox_messages WHERE thread_id = ?');
    $d->execute([$thread]);
    $msgs = $d->rowCount();

    // 2) Purge attachment files (folder name = sanitised code; matches upload path).
    $safe  = preg_replace('/[^A-Za-z0-9]/', '', $cid);
    $files = $safe !== '' ? cr_purge_dir($storageDir . '/contact/' . $safe) : 0;

    // 3) Delete the conversation row itself.
    $db->prepare('DELETE FROM contact_conversations WHERE id = ?')->execute([(string)$c['id']]);

    // 4) Audit the purge.
    cr_audit($db, $cid, $msgs, $files);

    $purged++; $msgTotal += $msgs; $fileTotal += $files;
  }

  cr_out([
    'ok'               => true,
    'status'           => 'ok',
    'purged'           => $purged,
    'messages_deleted' => $msgTotal,
    'files_deleted'    => $fileTotal,
  ], $isCli);

} catch (Throwable $e) {
  hm_log_error('contact-retention failed', ['err' => $e->getMessage()]);
  cr_out(['ok' => false, 'error' => hm_debug() ? $e->getMessage() : 'retention failed'], $isCli, 500);
}
