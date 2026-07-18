<?php
// ════════════════════════════════════════════════════════════════════════════
//  chat.php — customer portal ⇄ admin LINE-style chat, on top of inbox_messages
//
//  NO NEW TABLES. A reservation's "chat room" is simply every inbox_messages row
//  sharing thread_id = 'chat:<bookingId>'. Customer messages are inbound rows on
//  the contact@ channel; admin replies (send-email.php log_inbox) thread onto the
//  same room and render in the existing admin Inbox. Media metadata is stored in
//  the EXISTING labels JSON column (labels.attachments) — the same no-migration
//  pattern inbox.js already uses for labels.quote / labels.outbound.
//
//  Reached at:  <API_BASE>/chat.php?action=list|send
//  Auth model:  matches auth.php / the portal — there is NO server session, so
//               every call re-verifies EMAIL + BOOKING REFERENCE against the
//               bookings table (anti-enumeration: generic 'invalid' on mismatch)
//               and scopes strictly to that one booking's room.
//
//  action=list  body { email, reference }
//               → { ok, data:{ room, messages:[ {id,sender_type,sender_name,text,
//                   attachments:[{name,mime,url}], created_at, is_read} ] } }
//  action=send  body { email, reference, message?, attachments?:[{path,name,mime,size}] }
//               → { ok, data:{ id } }
//
//  Files are uploaded separately by the client through storage.php (private
//  `chat` bucket, MIME-validated from bytes). Here we only validate that each
//  referenced path is inside THIS booking's folder, then persist the metadata and
//  return freshly-signed, short-lived read URLs (same HMAC scheme as storage.php).
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_cache.php';
require_once __DIR__ . '/_ratelimit.php';
require_once __DIR__ . '/_line.php';

hm_cors();
hm_require_api_key();

$cfg    = hm_config();
$action = (string)($_GET['action'] ?? '');

// Chat is chattier than the contact form — allow a higher ceiling, still bounded.
hm_rate_limit('chat', 60, 60);   // max 60 chat calls / IP / minute

$BUCKET       = 'chat';
$SIGN_TTL     = 300;   // seconds a media read URL stays valid
$SECRET       = (string)($cfg['storage_secret'] ?? 'change-me');
$ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

// ── Shared: verify the caller owns the booking (email + reference) ───────────
// Mirrors auth.php exactly so the two never diverge. Returns the booking row or
// emits a generic invalid + exits (never discloses whether a reference exists).
function chat_verify_booking(): array {
  $p     = hm_body();
  $email = strtolower(trim((string)($p['email'] ?? '')));
  $ref   = trim((string)($p['reference'] ?? ''));
  if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || $ref === '') {
    hm_json(['ok' => false, 'data' => null, 'error' => 'invalid'], 400);
  }
  try {
    $st = hm_db()->prepare('SELECT * FROM bookings WHERE notes LIKE ? ORDER BY created_at DESC LIMIT 1');
    $st->execute(['%ref:' . $ref . '%']);
    $row = $st->fetch();
  } catch (Throwable $e) {
    hm_log_error('chat verify failed', ['err' => $e->getMessage()]);
    hm_json(['ok' => false, 'data' => null, 'error' => 'server'], 500);
  }
  if (!$row || strtolower(trim((string)($row['customer_email'] ?? ''))) !== $email) {
    hm_log_auth_fail('chat_access');
    hm_json(['ok' => false, 'data' => null, 'error' => 'invalid']);
  }
  return ['row' => $row, 'email' => $email, 'ref' => $ref, 'body' => $p];
}

// The room's stable conversation key. All chat rows for a booking share this.
function chat_thread_id(string $bookingId): string { return 'chat:' . $bookingId; }

// The auto placeholder body written for a media-only message.
function chat_is_placeholder(string $t): bool {
  return (bool) preg_match('/^\s*\[\d+件の添付ファイルを送信しました\]\s*$/', $t);
}

// Hard-delete a message's attachment files from the private `chat` bucket. Only
// removes files under THIS booking's own folder (path prefix guard) — so a
// deletion can never reach another booking's or an arbitrary file. Best-effort.
function chat_purge_files($atts, string $bookingId, array $cfg): void {
  if (!is_array($atts)) return;
  $root   = rtrim((string)($cfg['storage_dir'] ?? (__DIR__ . '/_uploads')), '/\\');
  $prefix = $bookingId . '/';
  foreach ($atts as $a) {
    $path = str_replace('\\', '/', (string)($a['path'] ?? ''));
    if ($path === '' || strpos($path, '..') !== false) continue;
    if (strncmp($path, $prefix, strlen($prefix)) !== 0) continue;
    // Sanitise each segment exactly like storage.php before touching the disk.
    $parts = array_filter(explode('/', $path), fn($p) => $p !== '' && $p !== '.' && $p !== '..');
    $clean = implode('/', array_map(fn($p) => preg_replace('/[^A-Za-z0-9._-]/', '', $p), $parts));
    $file  = "$root/chat/$clean";
    if (is_file($file)) @unlink($file);
  }
}

// Append an audit_log row (append-only trail). Best-effort: an audit failure must
// never break the delete. Ensures the table first (idempotent) so it works even
// before the schema migration has been applied.
function chat_audit(string $actor, string $action, string $msgId, string $bookingId, array $details): void {
  try {
    $db = hm_db();
    $db->exec(
      "CREATE TABLE IF NOT EXISTS audit_log (
        id CHAR(36) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        actor VARCHAR(191) NOT NULL DEFAULT 'system', action VARCHAR(40) NOT NULL DEFAULT 'other',
        target_type VARCHAR(40) NOT NULL DEFAULT '-', target_id VARCHAR(191) NOT NULL DEFAULT '',
        details TEXT, PRIMARY KEY (id), KEY idx_audit_action (action),
        KEY idx_audit_target (target_type, target_id), KEY idx_audit_actor (actor)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    $st = $db->prepare('INSERT INTO audit_log (id, actor, action, target_type, target_id, details) VALUES (?,?,?,?,?,?)');
    $st->execute([
      hm_uuid4(), mb_substr($actor, 0, 191), $action, 'inbox_message', mb_substr($msgId, 0, 191),
      json_encode(array_merge(['booking_id' => $bookingId], $details), JSON_UNESCAPED_UNICODE),
    ]);
  } catch (Throwable $e) {
    hm_log_error('chat audit failed', ['err' => $e->getMessage(), 'action' => $action, 'msg' => $msgId]);
  }
}

// Replace the attachment at $path with a "deleted" tombstone — the message bubble
// and its POSITION are kept; only the file reference (path/mime/size/url) is
// dropped. Returns [newAttachments, targetOrNull]. Already-deleted markers pass
// through untouched (idempotent).
function chat_tombstone_attachment(array $atts, string $path): array {
  $out = []; $target = null;
  foreach ($atts as $a) {
    if (!empty($a['deleted'])) { $out[] = $a; continue; }
    if ($target === null && (string)($a['path'] ?? '') === $path) {
      $target = $a;
      $out[] = ['deleted' => true, 'name' => (string)($a['name'] ?? 'file')];
    } else {
      $out[] = $a;
    }
  }
  return [$out, $target];
}

// Endpoint URL of storage.php on this same install (same dir as chat.php).
function chat_storage_url(): string {
  $https  = (($_SERVER['HTTPS'] ?? '') === 'on') || (($_SERVER['SERVER_PORT'] ?? '') == 443);
  $scheme = $https ? 'https' : 'http';
  $dir    = rtrim(str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/hm-api/chat.php'))), '/');
  return $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir . '/storage.php';
}

// Short-lived signed read URL for a private `chat` file — identical HMAC scheme
// to storage.php's `sign` action so the `get` action accepts it.
function chat_sign_url(string $bucket, string $path, string $secret, int $ttl): string {
  $exp = time() + $ttl;
  $sig = hash_hmac('sha256', "$bucket/$path:$exp", $secret);
  return chat_storage_url() . '?action=get&bucket=' . rawurlencode($bucket)
       . '&path=' . rawurlencode($path) . '&exp=' . $exp . '&sig=' . $sig;
}

// Keep only in-scope attachments (path must live under this booking's folder)
// with an allowed MIME. Defends against a client referencing another booking's
// or an arbitrary file. Returns the sanitised list to persist in labels.
function chat_clean_attachments($raw, string $bookingId, array $allowedMime): array {
  if (!is_array($raw)) return [];
  $prefix = $bookingId . '/';
  $out = [];
  foreach ($raw as $a) {
    if (!is_array($a)) continue;
    $path = str_replace('\\', '/', trim((string)($a['path'] ?? '')));
    if ($path === '' || strpos($path, '..') !== false) continue;
    if (strncmp($path, $prefix, strlen($prefix)) !== 0) continue;   // must be this booking's file
    $mime = strtolower(trim((string)($a['mime'] ?? '')));
    if ($mime !== '' && !in_array($mime, $allowedMime, true)) continue;
    $out[] = [
      'path' => $path,
      'name' => mb_substr(trim((string)($a['name'] ?? 'file')), 0, 200),
      'mime' => $mime,
      'size' => (int)($a['size'] ?? 0),
    ];
    if (count($out) >= 10) break;   // hard cap per message
  }
  return $out;
}

// ── action=list ──────────────────────────────────────────────────────────────
if ($action === 'list') {
  $v         = chat_verify_booking();
  $bookingId = (string)$v['row']['id'];
  $thread    = chat_thread_id($bookingId);

  try {
    $st = hm_db()->prepare(
      'SELECT id, sender, sender_name, email, subject, body, body_text, mailbox,
              labels, message_id, thread_id, is_read, created_at, received_at
         FROM inbox_messages
        WHERE booking_id = ? AND thread_id = ?
        ORDER BY COALESCE(received_at, created_at) ASC, id ASC'
    );
    $st->execute([$bookingId, $thread]);
    $rows = $st->fetchAll();
  } catch (Throwable $e) {
    hm_log_error('chat list failed', ['err' => $e->getMessage()]);
    hm_json(['ok' => false, 'data' => null, 'error' => 'server'], 500);
  }

  $messages = [];
  foreach ($rows as $r) {
    $labels = [];
    if (!empty($r['labels'])) {
      $labels = is_array($r['labels']) ? $r['labels'] : (json_decode((string)$r['labels'], true) ?: []);
    }
    $isOutbound = !empty($labels['outbound']);   // admin/company reply vs customer
    $deleted    = !empty($labels['deleted']);
    // Channel: customer messages are always 'chat'. Company messages are 'chat'
    // when sent from the admin Direct Chat (labels.chat) and 'email' when they
    // are a formal email reply (send-email.php log_inbox) — the portal styles
    // the two differently so the customer can tell them apart.
    $channel = $isOutbound ? (!empty($labels['chat']) ? 'chat' : 'email') : 'chat';

    $atts = [];
    if (!$deleted && !empty($labels['attachments']) && is_array($labels['attachments'])) {
      foreach ($labels['attachments'] as $a) {
        // A deleted attachment keeps its slot as a placeholder ("Attachment
        // deleted") — the bubble stays, the file is gone.
        if (!empty($a['deleted'])) {
          $atts[] = ['deleted' => true, 'name' => (string)($a['name'] ?? 'file')];
          continue;
        }
        $path = (string)($a['path'] ?? '');
        if ($path === '') continue;
        $atts[] = [
          'name' => (string)($a['name'] ?? 'file'),
          'mime' => (string)($a['mime'] ?? ''),
          'path' => $path,   // returned so the client can request per-item deletion
          'url'  => chat_sign_url($BUCKET, $path, $SECRET, $SIGN_TTL),
        ];
      }
    }
    $text = ($r['body_text'] !== null && $r['body_text'] !== '') ? (string)$r['body_text'] : (string)($r['body'] ?? '');
    // Drop the "[N件の添付ファイル…]" placeholder for media-only messages so the
    // portal shows just the image bubbles (never the placeholder text).
    if ($atts && chat_is_placeholder($text)) $text = '';
    $messages[] = [
      'id'          => (string)$r['id'],
      'sender_type' => $isOutbound ? 'company' : 'customer',
      'sender_name' => $isOutbound ? ((string)($r['sender_name'] ?? '') ?: 'Hello Moving')
                                   : ((string)($r['sender_name'] ?? '') ?: (string)($r['sender'] ?? '')),
      'channel'     => $channel,
      'deleted'     => $deleted,
      'text'        => $deleted ? '' : $text,
      'attachments' => $atts,
      'is_read'     => (int)($r['is_read'] ?? 0) === 1,
      'created_at'  => (string)($r['received_at'] ?? $r['created_at'] ?? ''),
    ];
  }

  hm_ok(['room' => $thread, 'booking_id' => $bookingId, 'ref' => $v['ref'], 'messages' => $messages]);
}

// ── action=send ──────────────────────────────────────────────────────────────
if ($action === 'send') {
  $v         = chat_verify_booking();
  $row       = $v['row'];
  $p         = $v['body'];
  $bookingId = (string)$row['id'];
  $thread    = chat_thread_id($bookingId);

  $name    = trim((string)($row['customer_name'] ?? '')) ?: 'お客様';
  $email   = $v['email'];
  $message = trim((string)($p['message'] ?? ''));
  $atts    = chat_clean_attachments($p['attachments'] ?? null, $bookingId, $ALLOWED_MIME);

  // A message must carry text OR at least one valid attachment.
  if ($message === '' && !$atts) {
    hm_json(['ok' => false, 'data' => null, 'error' => 'empty'], 400);
  }
  // Length guard (defence-in-depth; the UI also caps this).
  if (mb_strlen($message) > 4000) $message = mb_substr($message, 0, 4000);

  // Body: the text, or a placeholder so the admin Inbox card is never blank.
  $body = $message !== '' ? $message : '[' . count($atts) . '件の添付ファイルを送信しました]';
  // labels.ref = the human-readable reservation reference (HM-…) so both the
  // admin Inbox and the portal can show it instead of the UUID booking_id.
  $labels = ['ref' => $v['ref']];
  if ($atts) $labels['attachments'] = $atts;
  $mid    = '<chat-' . hm_uuid4() . '@hello-moving.com>';

  try {
    $st = hm_db()->prepare(
      'INSERT INTO inbox_messages
         (id, sender, sender_name, email, subject, body, body_text, booking_id,
          mailbox, message_id, thread_id, labels, is_read, status, received_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,\'open\',NOW())'
    );
    $st->execute([
      hm_uuid4(),
      $name,
      $name,
      $email,
      'チャット（予約番号 ' . $v['ref'] . '）',
      $body,
      $body,
      $bookingId,
      'contact@hello-moving.com',            // visible channel → admin Inbox contact@ tab
      $mid,
      $thread,                               // stable room key
      json_encode($labels, JSON_UNESCAPED_UNICODE),
    ]);
    hm_cache_invalidate_table('inbox_messages');
  } catch (Throwable $e) {
    hm_log_error('chat send failed', ['err' => $e->getMessage(), 'booking' => $bookingId]);
    hm_json(['ok' => false, 'data' => null, 'error' => 'server'], 500);
  }

  // LINE alert — mirrors the new-booking / contact push. Fire-and-forget.
  $preview = $message !== '' ? mb_substr($message, 0, 60) : '📎 添付ファイル';
  hm_line_push("💬 新着チャット: {$name}（予約 {$v['ref']}）\n{$preview}\n▶ https://hello-moving.com/websiteManagement.html#inbox");

  hm_ok(['id' => $mid]);
}

// ── action=delete-media ──────────────────────────────────────────────────────
// Customer deletes ONE image/file from their OWN message. The message + bubble
// are KEPT; the attachment is replaced with an "Attachment deleted" placeholder
// and the physical file is purged. Ownership: scoped by email+reference to this
// booking's room and refused on company (outbound) messages. Audited.
if ($action === 'delete-media') {
  $v         = chat_verify_booking();
  $p         = $v['body'];
  $bookingId = (string)$v['row']['id'];
  $thread    = chat_thread_id($bookingId);
  $id        = trim((string)($p['id'] ?? ''));
  $path      = str_replace('\\', '/', trim((string)($p['path'] ?? '')));
  if ($id === '' || $path === '') hm_json(['ok' => false, 'data' => null, 'error' => 'missing_param'], 400);

  try {
    $st = hm_db()->prepare(
      'SELECT id, labels FROM inbox_messages WHERE id = ? AND booking_id = ? AND thread_id = ? LIMIT 1'
    );
    $st->execute([$id, $bookingId, $thread]);
    $row = $st->fetch();
  } catch (Throwable $e) {
    hm_log_error('chat delete-media lookup failed', ['err' => $e->getMessage()]);
    hm_json(['ok' => false, 'data' => null, 'error' => 'server'], 500);
  }
  if (!$row) hm_json(['ok' => false, 'data' => null, 'error' => 'not_found'], 404);

  $labels = [];
  if (!empty($row['labels'])) {
    $labels = is_array($row['labels']) ? $row['labels'] : (json_decode((string)$row['labels'], true) ?: []);
  }
  // Ownership check — a customer may delete media only on their own (inbound) message.
  if (!empty($labels['outbound'])) hm_json(['ok' => false, 'data' => null, 'error' => 'forbidden'], 403);

  $atts = (isset($labels['attachments']) && is_array($labels['attachments'])) ? $labels['attachments'] : [];
  [$newAtts, $target] = chat_tombstone_attachment($atts, $path);
  if ($target === null) hm_ok(['id' => $id, 'path' => $path, 'removed' => false]);   // idempotent

  chat_purge_files([$target], $bookingId, $cfg);   // remove the physical file
  $labels['attachments'] = $newAtts;               // keep the message; tombstone the item
  try {
    $st = hm_db()->prepare('UPDATE inbox_messages SET labels = ? WHERE id = ?');
    $st->execute([json_encode($labels, JSON_UNESCAPED_UNICODE), $id]);
    hm_cache_invalidate_table('inbox_messages');
  } catch (Throwable $e) {
    hm_log_error('chat delete-media failed', ['err' => $e->getMessage(), 'id' => $id]);
    hm_json(['ok' => false, 'data' => null, 'error' => 'server'], 500);
  }
  chat_audit($v['email'], 'attachment_deleted', $id, $bookingId,
    ['path' => $path, 'name' => (string)($target['name'] ?? ''), 'via' => 'customer']);
  hm_ok(['id' => $id, 'path' => $path, 'removed' => true, 'deleted' => false]);
}

// ── action=admin-delete-media ────────────────────────────────────────────────
// ADMIN OVERRIDE: delete ANY attachment on ANY chat message (ownership bypass).
// Authed by the admin session token (X-ADMIN-TOKEN), verified inline — the same
// gate as booking-status.php / block-slot.php. Purges the file, tombstones the
// attachment (message kept), and writes an attachment_deleted audit entry. The
// file purge is still confined to the message's OWN booking folder (no traversal).
if ($action === 'admin-delete-media') {
  $adminOk = false; $adminActor = 'admin';
  $tok = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  if (is_string($tok) && $tok !== '' && function_exists('hm_admin_token_verify')) {
    $pl = hm_admin_token_verify($tok);
    if ($pl !== null && ($pl['role'] ?? '') === 'admin' && hm_admin_token_account_valid($pl)) {
      $adminOk = true;
      $adminActor = (string)($pl['email'] ?? ($pl['sub'] ?? 'admin'));
    }
  }
  if (!$adminOk) {
    if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('chat_admin_delete');
    hm_json(['ok' => false, 'data' => null, 'error' => 'forbidden'], 403);
  }

  $p    = hm_body();
  $id   = trim((string)($p['id'] ?? ''));
  $path = str_replace('\\', '/', trim((string)($p['path'] ?? '')));
  if ($id === '' || $path === '') hm_json(['ok' => false, 'data' => null, 'error' => 'missing_param'], 400);

  try {
    $st = hm_db()->prepare('SELECT id, booking_id, labels FROM inbox_messages WHERE id = ? LIMIT 1');
    $st->execute([$id]);
    $row = $st->fetch();
  } catch (Throwable $e) {
    hm_log_error('chat admin-delete-media lookup failed', ['err' => $e->getMessage()]);
    hm_json(['ok' => false, 'data' => null, 'error' => 'server'], 500);
  }
  if (!$row) hm_json(['ok' => false, 'data' => null, 'error' => 'not_found'], 404);

  $bookingId = (string)($row['booking_id'] ?? '');
  $labels = [];
  if (!empty($row['labels'])) {
    $labels = is_array($row['labels']) ? $row['labels'] : (json_decode((string)$row['labels'], true) ?: []);
  }
  $atts = (isset($labels['attachments']) && is_array($labels['attachments'])) ? $labels['attachments'] : [];
  [$newAtts, $target] = chat_tombstone_attachment($atts, $path);
  if ($target === null) hm_ok(['id' => $id, 'path' => $path, 'removed' => false]);

  chat_purge_files([$target], $bookingId, $cfg);
  $labels['attachments'] = $newAtts;
  try {
    $st = hm_db()->prepare('UPDATE inbox_messages SET labels = ? WHERE id = ?');
    $st->execute([json_encode($labels, JSON_UNESCAPED_UNICODE), $id]);
    hm_cache_invalidate_table('inbox_messages');
  } catch (Throwable $e) {
    hm_log_error('chat admin-delete-media failed', ['err' => $e->getMessage(), 'id' => $id]);
    hm_json(['ok' => false, 'data' => null, 'error' => 'server'], 500);
  }
  chat_audit($adminActor, 'attachment_deleted', $id, $bookingId,
    ['path' => $path, 'name' => (string)($target['name'] ?? ''), 'via' => 'admin']);
  hm_ok(['id' => $id, 'path' => $path, 'removed' => true, 'deleted' => false]);
}

// ── action=delete ────────────────────────────────────────────────────────────
// Customer deletes one of their OWN chat messages. Scoped by email+reference and
// to this booking's room; refuses to touch admin/company (outbound) messages.
// Purges any attachment files immediately (privacy + storage), then leaves a
// soft-delete tombstone row so the conversation keeps its context.
if ($action === 'delete') {
  $v         = chat_verify_booking();
  $p         = $v['body'];
  $bookingId = (string)$v['row']['id'];
  $thread    = chat_thread_id($bookingId);
  $id        = trim((string)($p['id'] ?? ''));
  if ($id === '') hm_json(['ok' => false, 'data' => null, 'error' => 'missing_id'], 400);

  try {
    $st = hm_db()->prepare(
      'SELECT id, labels FROM inbox_messages WHERE id = ? AND booking_id = ? AND thread_id = ? LIMIT 1'
    );
    $st->execute([$id, $bookingId, $thread]);
    $row = $st->fetch();
  } catch (Throwable $e) {
    hm_log_error('chat delete lookup failed', ['err' => $e->getMessage()]);
    hm_json(['ok' => false, 'data' => null, 'error' => 'server'], 500);
  }
  if (!$row) hm_json(['ok' => false, 'data' => null, 'error' => 'not_found'], 404);

  $labels = [];
  if (!empty($row['labels'])) {
    $labels = is_array($row['labels']) ? $row['labels'] : (json_decode((string)$row['labels'], true) ?: []);
  }
  // A customer may only delete their own message — never the company's.
  if (!empty($labels['outbound'])) hm_json(['ok' => false, 'data' => null, 'error' => 'forbidden'], 403);
  if (!empty($labels['deleted']))  hm_ok(['id' => $id, 'deleted' => true]);   // idempotent

  chat_purge_files($labels['attachments'] ?? [], $bookingId, $cfg);

  $tomb = ['ref' => (string)($labels['ref'] ?? $v['ref']), 'deleted' => true];
  try {
    $st = hm_db()->prepare('UPDATE inbox_messages SET body = ?, body_text = ?, labels = ? WHERE id = ?');
    $st->execute(['', '', json_encode($tomb, JSON_UNESCAPED_UNICODE), $id]);
    hm_cache_invalidate_table('inbox_messages');
  } catch (Throwable $e) {
    hm_log_error('chat delete failed', ['err' => $e->getMessage(), 'id' => $id]);
    hm_json(['ok' => false, 'data' => null, 'error' => 'server'], 500);
  }
  hm_ok(['id' => $id, 'deleted' => true]);
}

hm_json(['ok' => false, 'data' => null, 'error' => 'unknown_action'], 400);
