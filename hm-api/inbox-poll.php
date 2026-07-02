<?php
// ════════════════════════════════════════════════════════════════════════════
//  inbox-poll.php — Email Center Phase 2: IMAP inbound sync (cron-safe).
//
//  Polls each company mailbox (booking@ / support@ / contact@) over self-hosted
//  IMAPS, imports NEW mail into inbox_messages, deduplicates by Message-ID, and
//  resolves threading from Message-ID / In-Reply-To / References. Incremental via
//  a per-mailbox UID watermark stored in hm_data. No external provider.
//
//  RUN — cron (preferred):
//      */5 * * * * php /home/<user>/public_html/hm-api/inbox-poll.php >/dev/null 2>&1
//  RUN — CLI once:
//      php hm-api/inbox-poll.php
//  RUN — HTTP (no cron/shell): set 'imap_poll_token' in _config.php, then hit
//      https://<host>/hm-api/inbox-poll.php?token=<imap_poll_token>
//
//  Safety: single-flight file lock (no overlapping runs); read-only IMAP (server
//  \Seen untouched); each mailbox isolated in try/catch; credentials never logged.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_imap.php';

$isCli = (PHP_SAPI === 'cli');

function poll_out(array $payload, bool $isCli, int $status = 200): void {
  if ($isCli) {
    fwrite(STDOUT, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL);
  } else {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  }
  exit;
}

// ── Access control (HTTP path): token + rate limit. CLI is trusted (shell). ───
if (!$isCli) {
  require_once __DIR__ . '/_ratelimit.php';
  hm_rate_limit('inbox_poll', 6, 60);
  $token = (string)(hm_config()['imap_poll_token'] ?? '');
  $sent  = (string)($_GET['token'] ?? '');
  if ($token === '' || !hash_equals($token, $sent)) {
    poll_out(['ok' => false, 'error' => 'forbidden — set imap_poll_token in _config.php and pass ?token='], false, 403);
  }
}

$cfg = hm_config();

if (empty($cfg['imap_enabled'])) {
  poll_out(['ok' => false, 'error' => "IMAP polling disabled (set 'imap_enabled' => true in _config.php)"], $isCli, 200);
}
if (!hm_imap_available()) {
  hm_log_error('inbox-poll: php-imap missing', []);
  poll_out(['ok' => false, 'error' => 'php-imap extension not installed on this server'], $isCli, 500);
}

$accounts = is_array($cfg['imap_accounts'] ?? null) ? $cfg['imap_accounts'] : [];
if (!$accounts) {
  poll_out(['ok' => false, 'error' => 'no imap_accounts configured'], $isCli, 200);
}

// ── Single-flight lock (skip if a previous run is still going) ───────────────
$lockPath = ($cfg['cache_dir'] ?? (__DIR__ . '/_cache')) . '/imap-poll.lock';
@is_dir(dirname($lockPath)) || @mkdir(dirname($lockPath), 0775, true);
$lock = @fopen($lockPath, 'c');
if ($lock === false || !@flock($lock, LOCK_EX | LOCK_NB)) {
  poll_out(['ok' => true, 'status' => 'skipped', 'reason' => 'another poll is running'], $isCli, 200);
}

// ── UID-watermark state in hm_data (key: imap_state:<mailbox>) ───────────────
function poll_state_get(string $mailbox): array {
  try {
    $st = hm_db()->prepare('SELECT `value` FROM hm_data WHERE `key` = ? LIMIT 1');
    $st->execute(['imap_state:' . $mailbox]);
    $row = $st->fetch();
    if ($row) {
      $v = json_decode((string)$row['value'], true);
      if (is_array($v)) return ['uidvalidity' => (int)($v['uidvalidity'] ?? 0), 'last_uid' => (int)($v['last_uid'] ?? 0)];
    }
  } catch (Throwable $e) { /* fall through to zero-state */ }
  return ['uidvalidity' => 0, 'last_uid' => 0];
}
function poll_state_set(string $mailbox, int $uidvalidity, int $lastUid): void {
  $json = json_encode(['uidvalidity' => $uidvalidity, 'last_uid' => $lastUid]);
  $st = hm_db()->prepare(
    'INSERT INTO hm_data (id, `key`, `value`) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = CURRENT_TIMESTAMP'
  );
  $st->execute([hm_uuid4(), 'imap_state:' . $mailbox, $json]);
}

// ── Dedup + threading (DB lookups) ───────────────────────────────────────────
function inbox_has_message_id(string $mid): bool {
  if ($mid === '') return false;
  $st = hm_db()->prepare('SELECT id FROM inbox_messages WHERE message_id = ? LIMIT 1');
  $st->execute([$mid]);
  return (bool)$st->fetch();
}
// Resolve thread_id: (1) any parent id (In-Reply-To/References) already in the
// table shares its thread; (2) else same sender + normalized subject; (3) else
// this message starts a new thread (thread_id = its own Message-ID).
function inbox_resolve_thread(array $parentIds, string $email, string $subjectNorm, string $selfMid): string {
  foreach ($parentIds as $pid) {
    if ($pid === '') continue;
    $st = hm_db()->prepare('SELECT thread_id FROM inbox_messages WHERE message_id = ? AND thread_id IS NOT NULL LIMIT 1');
    $st->execute([$pid]);
    $r = $st->fetch();
    if ($r && $r['thread_id'] !== null && $r['thread_id'] !== '') return (string)$r['thread_id'];
  }
  if ($email !== '' && $subjectNorm !== '') {
    $st = hm_db()->prepare('SELECT subject, thread_id FROM inbox_messages WHERE email = ? AND thread_id IS NOT NULL ORDER BY created_at DESC LIMIT 25');
    $st->execute([$email]);
    foreach ($st->fetchAll() as $row) {
      if (hm_imap_norm_subject((string)$row['subject']) === $subjectNorm && $row['thread_id'] !== '') {
        return (string)$row['thread_id'];
      }
    }
  }
  return $selfMid !== '' ? $selfMid : hm_uuid4();
}

// ── Poll one mailbox ─────────────────────────────────────────────────────────
function poll_mailbox(array $cfg, array $acct): array {
  $mailbox = (string)($acct['mailbox'] ?? '');
  $user    = (string)($acct['user'] ?? $mailbox);
  $pass    = (string)($acct['pass'] ?? '');
  $res = ['mailbox' => $mailbox, 'imported' => 0, 'skipped' => 0, 'scanned' => 0, 'error' => null];
  if ($mailbox === '' || $pass === '') { $res['error'] = 'missing mailbox or password'; return $res; }

  $imap = null;
  try {
    $imap = hm_imap_open($cfg, $user, $pass);
    $status = hm_imap_status($imap, $cfg);

    $state = poll_state_get($mailbox);
    // UIDVALIDITY changed (mailbox rebuilt) → reset watermark; Message-ID dedup
    // still prevents any re-import.
    $lastUid = ($state['uidvalidity'] === $status['uidvalidity']) ? $state['last_uid'] : 0;

    $uids = hm_imap_new_uids($imap, $lastUid + 1, $status['uidnext']);
    $res['scanned'] = count($uids);
    $maxHandledUid = $lastUid;   // highest UID successfully imported OR confirmed duplicate
    $firstFailUid  = 0;          // lowest UID that hit a hard error (0 = none)

    foreach ($uids as $uid) {
      try {
        $msg = hm_imap_parse($imap, $uid);
        // Synthesize a stable Message-ID when the mail lacks one (dedup key).
        $mid = $msg['message_id'] !== '' ? $msg['message_id']
             : '<imap-' . rawurlencode($mailbox) . '-' . $uid . '@hello-moving.com>';

        if (inbox_has_message_id($mid)) {
          $res['skipped']++;
        } else {
          $parentIds   = array_merge($msg['in_reply_to'] !== '' ? [$msg['in_reply_to']] : [], $msg['references']);
          $subjectNorm = hm_imap_norm_subject($msg['subject']);
          $threadId    = inbox_resolve_thread($parentIds, $msg['from_email'], $subjectNorm, $mid);

          $bodyLegacy = $msg['body_text'] !== '' ? $msg['body_text']
                      : (strip_tags($msg['body_html']) ?: '(本文なし)');

          $ins = hm_db()->prepare(
            'INSERT INTO inbox_messages
               (id, sender, sender_name, email, subject, body, body_text, body_html,
                mailbox, message_id, in_reply_to, thread_id, received_at, is_read, status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,\'open\')'
          );
          $ins->execute([
            hm_uuid4(),
            $msg['from_name'] !== '' ? $msg['from_name'] : $msg['from_email'],
            $msg['from_name'] !== '' ? $msg['from_name'] : null,
            $msg['from_email'],
            $msg['subject'],
            $bodyLegacy,
            $msg['body_text'] !== '' ? $msg['body_text'] : null,
            $msg['body_html'] !== '' ? $msg['body_html'] : null,
            $mailbox,
            $mid,
            $msg['in_reply_to'] !== '' ? $msg['in_reply_to'] : null,
            $threadId,
            $msg['received_at'],
          ]);
          $res['imported']++;
        }
        $maxHandledUid = max($maxHandledUid, $uid);   // committed (imported or duplicate)
      } catch (Throwable $e) {
        // One bad message must not abort the mailbox; log and continue. Record the
        // lowest failing UID so the watermark does NOT advance past it (see below).
        if ($firstFailUid === 0 || $uid < $firstFailUid) $firstFailUid = $uid;
        hm_log_error('inbox-poll message failed', ['mailbox' => $mailbox, 'uid' => $uid, 'err' => $e->getMessage()]);
      }
    }

    // Advance the watermark only up to just BEFORE the first failure, so any
    // message that failed to insert (e.g. a missing column, or a transient DB
    // error) is retried on the next run rather than skipped forever. Message-ID
    // dedup makes re-processing already-imported messages safe. Never go backwards.
    $newWatermark = $firstFailUid > 0 ? min($maxHandledUid, $firstFailUid - 1) : $maxHandledUid;
    if ($newWatermark < $lastUid) $newWatermark = $lastUid;
    poll_state_set($mailbox, $status['uidvalidity'], $newWatermark);
  } catch (Throwable $e) {
    $res['error'] = $e->getMessage();
    hm_log_error('inbox-poll mailbox failed', ['mailbox' => $mailbox, 'err' => $e->getMessage()]);
  } finally {
    if ($imap) { @imap_errors(); @imap_alerts(); @imap_close($imap); }
  }
  return $res;
}

// ── Run all mailboxes ────────────────────────────────────────────────────────
$results = [];
$totImported = 0; $totSkipped = 0; $hadError = false;
try {
  foreach ($accounts as $acct) {
    $r = poll_mailbox($cfg, $acct);
    $results[] = $r;
    $totImported += $r['imported'];
    $totSkipped  += $r['skipped'];
    if ($r['error']) $hadError = true;
  }
} finally {
  @flock($lock, LOCK_UN);
  @fclose($lock);
}

poll_out([
  'ok'       => !$hadError,
  'status'   => 'polled',
  'imported' => $totImported,
  'skipped'  => $totSkipped,
  'mailboxes'=> $results,
  'ts'       => date('c'),
], $isCli, 200);
