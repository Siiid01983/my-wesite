<?php
// ════════════════════════════════════════════════════════════════════════════
//  conversations.php — SCOPED staff/worker conversation endpoint (Worker Phase W1)
//
//  The ONLY path that ever grants a 'worker' access to conversation data. It sits
//  on TOP of the existing inbox_messages store (no new table, no schema change) and
//  reuses the existing Contact Chat reply core (_contact.php). It never duplicates a
//  chat system.
//
//  Authorization (server-side, never trust the client):
//    • admin / manager (token role 'admin') → full access (same as rest.php grants).
//    • worker (token role 'worker')         → access ONLY to conversations ASSIGNED
//        to them (inbox_messages.assignee == their account email), AND ONLY while
//        hm_worker_role_enabled() is true. Otherwise 403. Sender identity + audit
//        actor are DERIVED FROM THE TOKEN — a worker can never spoof another sender.
//
//  DORMANCY: with worker_role_enabled=false (default) no worker can even log in
//  (admin-login.php), so the worker branch here is unreachable in production until
//  the operator flips the flag. This endpoint is additive and nothing calls it yet.
//
//  Actions (X-API-KEY + X-ADMIN-TOKEN):
//    list       → conversations visible to the caller (worker: assigned only)
//    thread     { thread_id }            → full message history (incl. internal notes; STAFF view)
//    reply      { thread_id, message }   → company reply (contact → active-rule email; booking → in-app)
//    mark-read  { thread_id }            → mark this conversation's inbound rows read
//    note       { thread_id, text }      → add an internal (staff-only) note
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_cache.php';
require_once __DIR__ . '/_ratelimit.php';
require_once __DIR__ . '/_admin_users.php';   // hm_admin_user_by_id (resolve actor from token uid)
require_once __DIR__ . '/_contact.php';       // cc_thread / cc_insert_message / cc_do_admin_reply

$HM_EMAIL_READY = false;
if (is_file(__DIR__ . '/EmailService.php')) {
  require_once __DIR__ . '/EmailService.php';
  $HM_EMAIL_READY = class_exists('EmailService');
}

hm_cors();
hm_require_api_key();
hm_rate_limit('conversations', 120, 60);

$cfg    = hm_config();
$body   = hm_body();
$action = (string)($_GET['action'] ?? ($body['action'] ?? ''));

$RETENTION_DAYS = max(1,  (int)($cfg['contact_retention_days'] ?? 180));
$ACTIVE_WINDOW  = max(30, (int)($cfg['contact_active_window']  ?? 300));
$SITE_URL       = rtrim((string)($cfg['site_url'] ?? 'https://hello-moving.com'), '/');
$MAILBOX        = 'contact@hello-moving.com';

// ── Auth helpers ─────────────────────────────────────────────────────────────
function conv_forbid(string $why): void {
  if (function_exists('hm_log_auth_fail')) hm_log_auth_fail($why);
  hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'forbidden', 'code' => 'forbidden']], 403);
}
// Verify signature + revocation; return the token payload or 403.
function conv_auth(): array {
  $tok = hm_request_header('X-ADMIN-TOKEN');
  $p   = (is_string($tok) && $tok !== '') ? hm_admin_token_verify($tok) : null;
  if (!$p || !hm_admin_token_account_valid($p)) conv_forbid('conv_token');
  return $p;
}
// Token role: admin+manager mint 'admin'; workers mint 'worker' (admin-login.php).
function conv_is_full(array $p):   bool { return ($p['role'] ?? '') === 'admin'; }
function conv_is_worker(array $p): bool { return ($p['role'] ?? '') === 'worker'; }

// Resolve the acting account (email/name) from the token's uid — SERVER-side, so a
// reply/note/audit is always attributed to the real authenticated account.
function conv_actor(array $p): array {
  $uid = (string)($p['uid'] ?? '');
  $email = ''; $name = 'スタッフ';
  if ($uid !== '' && function_exists('hm_admin_user_by_id')) {
    $u = hm_admin_user_by_id($uid);
    if ($u) { $email = strtolower(trim((string)($u['email'] ?? ''))); $name = (string)($u['name'] ?? '') ?: ($email ?: 'スタッフ'); }
  }
  return ['uid' => $uid, 'email' => $email, 'name' => $name];
}

// Conversation assignee resolution lives in _lib.php (hm_conversation_assignee) so
// storage.php can share the exact same logic for attachment scoping.

// THE worker-scope gate. admin/manager → allow. worker → allow ONLY when the phase
// is enabled AND the thread is assigned to them. Everything else → 403.
function conv_require_access(PDO $db, string $threadId, array $p, array $actor): void {
  if (conv_is_full($p)) return;
  if (conv_is_worker($p)) {
    if (!hm_worker_role_enabled()) conv_forbid('worker_disabled');
    $assignee = hm_conversation_assignee($db, $threadId);
    if ($assignee !== '' && $actor['email'] !== '' && $assignee === $actor['email']) return;
    conv_forbid('worker_conv_scope');
  }
  conv_forbid('conv_role');
}

function conv_audit(PDO $db, string $action, string $threadId, array $actor, array $details): void {
  try {
    $st = $db->prepare('INSERT INTO audit_log (id, actor, action, target_type, target_id, details) VALUES (?,?,?,?,?,?)');
    $st->execute([
      hm_uuid4(), mb_substr($actor['email'] !== '' ? $actor['email'] : 'staff', 0, 191),
      mb_substr($action, 0, 40), 'conversation', mb_substr($threadId, 0, 191),
      json_encode(array_merge(['by' => $actor['email']], $details), JSON_UNESCAPED_UNICODE),
    ]);
  } catch (Throwable $e) { hm_log_error('conv audit failed', ['err' => $e->getMessage()]); }
}

// Serialize a thread's messages for a STAFF surface (internal notes INCLUDED — D2).
function conv_serialize(PDO $db, string $threadId): array {
  $st = $db->prepare(
    'SELECT id, sender, sender_name, email, body, body_text, labels, is_read, booking_id, created_at, received_at
       FROM inbox_messages WHERE thread_id = ?
      ORDER BY COALESCE(received_at, created_at) ASC, id ASC'
  );
  $st->execute([$threadId]);
  $out = [];
  foreach ($st->fetchAll() as $r) {
    $lb = $r['labels'] ? (is_array($r['labels']) ? $r['labels'] : (json_decode((string)$r['labels'], true) ?: [])) : [];
    if (!empty($lb['deleted'])) continue;
    $internal = !empty($lb['internal']);
    $out[] = [
      'id'          => (string)$r['id'],
      'sender_type' => $internal ? 'internal' : (!empty($lb['outbound']) ? 'company' : 'customer'),
      'sender_name' => (string)($r['sender_name'] ?? '') ?: (string)($r['sender'] ?? ''),
      'text'        => ($r['body_text'] !== null && $r['body_text'] !== '') ? (string)$r['body_text'] : (string)($r['body'] ?? ''),
      'attachments' => (!$internal && !empty($lb['attachments']) && is_array($lb['attachments'])) ? $lb['attachments'] : [],
      'is_read'     => (int)($r['is_read'] ?? 0) === 1,
      'created_at'  => (string)($r['received_at'] ?? $r['created_at'] ?? ''),
    ];
  }
  return $out;
}

// ── action=list ──────────────────────────────────────────────────────────────
if ($action === 'list') {
  $p = conv_auth(); $actor = conv_actor($p); $db = hm_db();
  if (conv_is_worker($p)) {
    if (!hm_worker_role_enabled()) conv_forbid('worker_disabled');
    if ($actor['email'] === '') { hm_ok([]); }
    // All rows of any thread that has at least one row assigned to this worker
    // (so newly-arrived NULL-assignee inbound rows of an assigned thread are included).
    $st = $db->prepare(
      'SELECT * FROM inbox_messages
        WHERE thread_id IN (SELECT DISTINCT thread_id FROM inbox_messages WHERE assignee = ? AND thread_id IS NOT NULL)
        ORDER BY COALESCE(received_at, created_at) DESC, id DESC LIMIT 400'
    );
    $st->execute([$actor['email']]);
    hm_ok($st->fetchAll());
  }
  if (conv_is_full($p)) {
    $st = hm_db()->query('SELECT * FROM inbox_messages ORDER BY COALESCE(received_at, created_at) DESC, id DESC LIMIT 400');
    hm_ok($st->fetchAll());
  }
  conv_forbid('conv_role');
}

// ── action=thread ────────────────────────────────────────────────────────────
if ($action === 'thread') {
  $p = conv_auth(); $actor = conv_actor($p); $db = hm_db();
  $threadId = trim((string)($body['thread_id'] ?? $_GET['thread_id'] ?? ''));
  if ($threadId === '') hm_err('missing thread_id', 400, 'missing');
  conv_require_access($db, $threadId, $p, $actor);
  hm_ok(['thread_id' => $threadId, 'messages' => conv_serialize($db, $threadId)]);
}

// ── action=reply ─────────────────────────────────────────────────────────────
if ($action === 'reply') {
  global $RETENTION_DAYS, $ACTIVE_WINDOW, $SITE_URL, $MAILBOX, $HM_EMAIL_READY, $cfg;
  $p = conv_auth(); $actor = conv_actor($p); $db = hm_db();
  hm_rate_limit('conversations_reply', 60, 60);
  $threadId = trim((string)($body['thread_id'] ?? ''));
  $message  = trim((string)($body['message'] ?? ''));
  if ($threadId === '') hm_err('missing thread_id', 400, 'missing');
  if ($message === '')  hm_err('empty message', 400, 'empty');
  if (mb_strlen($message) > 4000) $message = mb_substr($message, 0, 4000);
  conv_require_access($db, $threadId, $p, $actor);

  // Contact Chat thread → reuse the shared reply core (identical customer behavior).
  if (strncmp($threadId, 'contact:', 8) === 0) {
    $code = strtoupper(substr($threadId, 8));
    try {
      $st = $db->prepare('SELECT * FROM contact_conversations WHERE public_contact_id = ? LIMIT 1');
      $st->execute([$code]);
      $row = $st->fetch();
    } catch (Throwable $e) { hm_log_error('conv reply lookup failed', ['err' => $e->getMessage()]); hm_err('server error', 500, 'server'); }
    if (!$row) hm_err('conversation not found', 404, 'not_found');
    try {
      $r = cc_do_admin_reply($db, $cfg, $row, $code, $message, $RETENTION_DAYS, $ACTIVE_WINDOW, $SITE_URL, $MAILBOX, $HM_EMAIL_READY);
    } catch (Throwable $e) { hm_log_error('conv contact reply failed', ['err' => $e->getMessage()]); hm_err('server error', 500, 'server'); }
    conv_audit($db, 'reply', $threadId, $actor, ['type' => 'contact']);
    hm_ok(['id' => 'ok', 'emailed' => $r['emailed'], 'notify' => $r['notify']]);
  }

  // Booking chat thread → append an outbound in-app row (mirrors the existing
  // ops/admin _directChatSend). Customer email + reference are derived SERVER-side
  // from an existing thread row (never trusted from the client).
  if (strncmp($threadId, 'chat:', 5) === 0) {
    $bookingId = substr($threadId, 5);
    $custEmail = ''; $ref = '';
    try {
      $st = $db->prepare("SELECT email, labels FROM inbox_messages WHERE thread_id = ? ORDER BY COALESCE(received_at, created_at) ASC, id ASC");
      $st->execute([$threadId]);
      foreach ($st->fetchAll() as $r0) {
        $lb0 = $r0['labels'] ? (is_array($r0['labels']) ? $r0['labels'] : (json_decode((string)$r0['labels'], true) ?: [])) : [];
        if ($ref === '' && !empty($lb0['ref'])) $ref = (string)$lb0['ref'];
        if ($custEmail === '' && empty($lb0['outbound']) && empty($lb0['internal']) && !empty($r0['email'])) $custEmail = (string)$r0['email'];
      }
    } catch (Throwable $e) { hm_log_error('conv booking reply lookup failed', ['err' => $e->getMessage()]); hm_err('server error', 500, 'server'); }

    $uuid   = hm_uuid4();
    $mid    = '<chat-' . $uuid . '@hello-moving.com>';
    $labels = ['outbound' => true, 'chat' => true, 'ref' => $ref, 'staff_id' => $actor['uid']];
    try {
      $st = $db->prepare(
        'INSERT INTO inbox_messages
           (id, sender, sender_name, email, subject, body, body_text, booking_id, mailbox,
            message_id, thread_id, labels, is_read, status, received_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,\'open\',NOW())'
      );
      $st->execute([
        $uuid, 'Hello Moving', 'Hello Moving', $custEmail,
        'チャット' . ($ref ? '（予約番号 ' . $ref . '）' : ''), $message, $message,
        $bookingId, $MAILBOX, $mid, $threadId, json_encode($labels, JSON_UNESCAPED_UNICODE),
      ]);
      hm_cache_invalidate_table('inbox_messages');
    } catch (Throwable $e) { hm_log_error('conv booking reply failed', ['err' => $e->getMessage()]); hm_err('server error', 500, 'server'); }
    conv_audit($db, 'reply', $threadId, $actor, ['type' => 'booking']);
    hm_ok(['id' => $mid]);
  }

  hm_err('reply not supported for this conversation type', 400, 'unsupported');
}

// ── action=mark-read ─────────────────────────────────────────────────────────
if ($action === 'mark-read') {
  $p = conv_auth(); $actor = conv_actor($p); $db = hm_db();
  $threadId = trim((string)($body['thread_id'] ?? ''));
  if ($threadId === '') hm_err('missing thread_id', 400, 'missing');
  conv_require_access($db, $threadId, $p, $actor);
  try {
    $st = $db->prepare('UPDATE inbox_messages SET is_read = 1 WHERE thread_id = ? AND is_read = 0');
    $st->execute([$threadId]);
    hm_cache_invalidate_table('inbox_messages');
  } catch (Throwable $e) { hm_log_error('conv mark-read failed', ['err' => $e->getMessage()]); hm_err('server error', 500, 'server'); }
  hm_ok(['marked' => true]);
}

// ── action=note (internal, staff-only) ───────────────────────────────────────
if ($action === 'note') {
  $p = conv_auth(); $actor = conv_actor($p); $db = hm_db();
  $threadId = trim((string)($body['thread_id'] ?? ''));
  $text     = trim((string)($body['text'] ?? ''));
  if ($threadId === '') hm_err('missing thread_id', 400, 'missing');
  if ($text === '')     hm_err('empty note', 400, 'empty');
  if (mb_strlen($text) > 4000) $text = mb_substr($text, 0, 4000);
  conv_require_access($db, $threadId, $p, $actor);
  $bookingId = (strncmp($threadId, 'chat:', 5) === 0) ? substr($threadId, 5) : null;
  $uuid = hm_uuid4();
  $labels = ['internal' => true];
  if (strncmp($threadId, 'contact:', 8) === 0) $labels['cid'] = strtoupper(substr($threadId, 8));
  try {
    $st = $db->prepare(
      'INSERT INTO inbox_messages
         (id, sender, sender_name, email, subject, body, body_text, booking_id, mailbox,
          message_id, thread_id, labels, is_read, status, received_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,\'open\',NOW())'
    );
    $st->execute([
      $uuid, $actor['name'], $actor['name'], '', '内部メモ', $text, $text,
      $bookingId, 'contact@hello-moving.com', '<note-' . $uuid . '@hello-moving.com>',
      $threadId, json_encode($labels, JSON_UNESCAPED_UNICODE),
    ]);
    hm_cache_invalidate_table('inbox_messages');
  } catch (Throwable $e) { hm_log_error('conv note failed', ['err' => $e->getMessage()]); hm_err('server error', 500, 'server'); }
  conv_audit($db, 'internal_note', $threadId, $actor, ['len' => mb_strlen($text)]);
  hm_ok(['id' => $uuid]);
}

hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'unknown_action', 'code' => 'unknown_action']], 400);
