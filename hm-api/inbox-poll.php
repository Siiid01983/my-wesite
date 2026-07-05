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
//  RUN — HTTP (cron with curl, same server only): set 'imap_poll_token' in
//  _config.php, then:
//      curl -s -H "X-Poll-Token: <imap_poll_token>" https://<host>/hm-api/inbox-poll.php
//  The HTTP path is restricted to requests FROM this server (loopback or the
//  server's own IP) — browsers/external callers get 403 even with the token.
//  (?token= in the query string still works for back-compat but is logged in
//  the access log; prefer the header.)
//
//  Safety: single-flight file lock (no overlapping runs); read-only IMAP (server
//  \Seen untouched); each mailbox isolated in try/catch; credentials never logged.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_imap.php';
require_once __DIR__ . '/_line.php';

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

// ── Access control (HTTP path): same-server + token + rate limit. CLI trusted. ─
if (!$isCli) {
  require_once __DIR__ . '/_ratelimit.php';
  hm_rate_limit('inbox_poll', 6, 60);

  // Same-server only: the sole legitimate HTTP caller is this box's own cron
  // (curl). Reject anything not from loopback or the server's own address, so
  // even a leaked token is useless from anywhere else. NOTE: this also blocks
  // triggering from a browser — that is intentional. If the site ever sits
  // behind a proxy/CDN, point the cron's curl at the local vhost instead.
  $remote  = (string)($_SERVER['REMOTE_ADDR'] ?? '');
  $allowed = ['127.0.0.1', '::1'];
  $self    = (string)($_SERVER['SERVER_ADDR'] ?? '');
  if ($self !== '') $allowed[] = $self;
  if ($remote === '' || !in_array($remote, $allowed, true)) {
    poll_out(['ok' => false, 'error' => 'forbidden — inbox-poll.php accepts same-server requests only'], false, 403);
  }

  // Token: prefer the X-Poll-Token HEADER (never written to access logs). The
  // legacy ?token= query form still works but lands in the server access log —
  // migrate the cron to the header form, then rotate the token.
  $token = (string)(hm_config()['imap_poll_token'] ?? '');
  $sent  = (string)($_SERVER['HTTP_X_POLL_TOKEN'] ?? ($_GET['token'] ?? ''));
  if ($token === '' || !hash_equals($token, $sent)) {
    poll_out(['ok' => false, 'error' => 'forbidden — set imap_poll_token in _config.php and send X-Poll-Token'], false, 403);
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
  $res = ['mailbox' => $mailbox, 'imported' => 0, 'skipped' => 0, 'scanned' => 0, 'error' => null, 'notify' => []];
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
          // Sender resolution: normally From. For a SELF-SENT notification
          // (From = one of our own polled mailboxes, customer in Reply-To —
          // e.g. the contact-form email) store the Reply-To instead, so the
          // Inbox reply 宛先 targets the customer, not our own mailbox.
          $own = [];
          foreach (($cfg['imap_accounts'] ?? []) as $a) {
            $mb = strtolower(trim((string)($a['mailbox'] ?? '')));
            if ($mb !== '') $own[$mb] = true;
          }
          $senderEmail = $msg['from_email'];
          $senderName  = $msg['from_name'];
          $rt = strtolower(trim((string)($msg['reply_to_email'] ?? '')));
          if ($rt !== '' && isset($own[strtolower($senderEmail)]) && !isset($own[$rt])) {
            $senderEmail = (string)$msg['reply_to_email'];
            $senderName  = (string)($msg['reply_to_name'] ?? '') !== '' ? (string)$msg['reply_to_name'] : $senderEmail;
          }

          $parentIds   = array_merge($msg['in_reply_to'] !== '' ? [$msg['in_reply_to']] : [], $msg['references']);
          $subjectNorm = hm_imap_norm_subject($msg['subject']);
          $threadId    = inbox_resolve_thread($parentIds, $senderEmail, $subjectNorm, $mid);

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
            $senderName !== '' ? $senderName : $senderEmail,
            $senderName !== '' ? $senderName : null,
            $senderEmail,
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
          // LINE alert candidate — genuine inbound only (never our own mailboxes).
          if (!isset($own[strtolower($senderEmail)])) {
            $res['notify'][] = ['name' => $senderName, 'email' => $senderEmail, 'subject' => $msg['subject']];
          }
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

// ── LINE alert for newly imported inbound mail (one push per run) ────────────
// Dedup by construction: a message is imported exactly ONCE (Message-ID dedup
// + UID watermark), so a notification can never repeat for the same mail, and
// own-mailbox senders are excluded upstream. Aggregating into a single push
// per run means a first-time backlog import can never flood LINE.
// Fire-and-forget — hm_line_push never throws.
$notify = [];
foreach ($results as $r) { foreach (($r['notify'] ?? []) as $n) $notify[] = $n; }
if ($notify && hm_line_enabled()) {
  $url = 'https://hello-moving.com/websiteManagement.html#inbox';
  $who = function (array $n): string {
    return ($n['name'] !== '' && strcasecmp($n['name'], $n['email']) !== 0)
      ? "{$n['name']}（{$n['email']}）" : $n['email'];
  };
  if (count($notify) === 1) {
    $n   = $notify[0];
    $msg = "📩 新着メッセージ: {$who($n)}\n件名: " . ($n['subject'] !== '' ? $n['subject'] : '（件名なし）') . "\n▶ {$url}";
  } else {
    $lines = [];
    foreach (array_slice($notify, 0, 5) as $n) $lines[] = '• ' . $who($n);
    $more = count($notify) - 5;
    $msg  = '📩 新着メッセージ ' . count($notify) . "件\n" . implode("\n", $lines)
          . ($more > 0 ? "\n…他{$more}件" : '') . "\n▶ {$url}";
  }
  hm_line_push($msg);
}

poll_out([
  'ok'       => !$hadError,
  'status'   => 'polled',
  'imported' => $totImported,
  'skipped'  => $totSkipped,
  'mailboxes'=> $results,
  'ts'       => date('c'),
], $isCli, 200);
