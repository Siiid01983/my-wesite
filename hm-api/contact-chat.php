<?php
// ════════════════════════════════════════════════════════════════════════════
//  contact-chat.php — customer ⇄ company Contact Chat (booking-INDEPENDENT)
//
//  A persistent お問い合わせ conversation that is NOT tied to a booking. It reuses
//  the existing inbox_messages store (thread_id = 'contact:<CODE>') so every
//  message shows up in the admin Inbox automatically, and adds ONE small table
//  (contact_conversations) that owns identity (public_contact_id + email) and the
//  retention lifecycle. It never touches bookings / Estimate / BA overlay.
//
//  Reached at:  <API_BASE>/contact-chat.php?action=…
//  Auth model:  there is NO server session. Public actions are gated by X-API-KEY;
//               every message action re-verifies CONTACT ID + EMAIL against
//               contact_conversations (the short code is NEVER an authenticator on
//               its own). Anti-enumeration: identical generic response for both
//               "unknown code" and "wrong email". Admin actions require a valid
//               staff session token (X-ADMIN-TOKEN), verified inline.
//
//  PUBLIC actions (X-API-KEY):
//    start   { name, email, category?, message }
//              → creates the conversation, generates a short Contact ID, stores
//                the FIRST message (nothing is admin-visible until this call),
//                emails the customer a confirmation carrying the Contact ID, and
//                notifies the company (Telegram + Inbox row). Returns { public_contact_id }.
//    resume  { contact_id, email }         → { public_contact_id, category, status, name, messages }
//    list    { contact_id, email }         → { public_contact_id, status, messages }   (poll)
//    send    { contact_id, email, message }→ { id }
//
//  ADMIN actions (X-ADMIN-TOKEN, role admin|manager):
//    admin-reply { contact_id, message }   → stores an outbound reply in-thread and,
//                 when the customer is NOT recently active, emails them (active rule).
//    admin-close { contact_id, status? }   → archive/close (or reopen) a conversation.
//    admin-meta  ?contact_id=…             → conversation status/last-activity strip.
//
//  Retention: contact_conversations.expires_at is set to NOW()+contact_retention_days
//  (default 180) on creation and rolled forward on every activity. contact-retention.php
//  (cron) hard-deletes expired conversations + their messages + attachment files.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_cache.php';
require_once __DIR__ . '/_ratelimit.php';
require_once __DIR__ . '/_telegram.php';   // admin notification channel (replaces LINE for Contact Chat)

// Guarded load so a missing EmailService.php degrades to "not emailed" instead of
// a fatal — the in-app reply is always stored regardless of mail availability.
$HM_EMAIL_READY = false;
if (is_file(__DIR__ . '/EmailService.php')) {
  require_once __DIR__ . '/EmailService.php';
  $HM_EMAIL_READY = class_exists('EmailService');
}

hm_cors();
hm_require_api_key();

$cfg    = hm_config();
$action = (string)($_GET['action'] ?? '');

$RETENTION_DAYS = max(1,  (int)($cfg['contact_retention_days'] ?? 180));
$ACTIVE_WINDOW  = max(30, (int)($cfg['contact_active_window']  ?? 300)); // seconds
$SITE_URL       = rtrim((string)($cfg['site_url'] ?? 'https://hello-moving.com'), '/');
$ADMIN_LINK     = $SITE_URL . '/websiteManagement.html#inbox';
$MAILBOX        = 'contact@hello-moving.com';

// Contact-ID alphabet — human-friendly: no O/0, I/1, S/5 (per UX spec).
// A–H, J–N, P–R, T–Z + 2–9  = 23 letters + 8 digits = 31 symbols.
// Format: 'HM' + 5 chars  → e.g. HM7K4P2  (31^5 ≈ 28.6M combinations).
const CC_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ23456789';
const CC_BODY_LEN = 5;

function cc_gen_code(): string {
  $a = CC_ALPHABET; $n = strlen($a); $s = 'HM';
  for ($i = 0; $i < CC_BODY_LEN; $i++) $s .= $a[random_int(0, $n - 1)];
  return $s;
}
function cc_valid_code(string $c): bool {
  return (bool)preg_match('/^HM[' . CC_ALPHABET . ']{' . CC_BODY_LEN . '}$/', $c);
}
function cc_thread(string $code): string { return 'contact:' . $code; }

// Idempotent table creation — makes the endpoint deploy-order-safe (works even
// before contact-migrate.php is run). Mirrors chat.php's inline audit_log create.
function cc_ensure_table(PDO $db): void {
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
}

// ── Shared: verify the caller owns the conversation (contact_id + email) ─────
// The email is the mandatory second factor. Returns the row (+ parsed body) or
// emits an IDENTICAL generic response for "unknown code" and "wrong email" so a
// short code can never be brute-force-probed for existence.
function cc_verify(PDO $db): array {
  // Self-heal: ensure the table exists so resume/list/send return the intended
  // generic 'invalid' (not a 500) even before contact-migrate.php has been run or
  // any conversation has been started. Creates an EMPTY table only — no rows, so
  // this never fabricates or exposes a conversation.
  cc_ensure_table($db);
  $p     = hm_body();
  $email = strtolower(trim((string)($p['email'] ?? '')));
  $code  = strtoupper(trim((string)($p['contact_id'] ?? $p['code'] ?? '')));
  if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || !cc_valid_code($code)) {
    hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'invalid', 'code' => 'invalid']], 401);
  }
  try {
    $st = $db->prepare('SELECT * FROM contact_conversations WHERE public_contact_id = ? LIMIT 1');
    $st->execute([$code]);
    $row = $st->fetch();
  } catch (Throwable $e) {
    hm_log_error('contact verify failed', ['err' => $e->getMessage()]);
    hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'server', 'code' => 'server']], 500);
  }
  if (!$row || strtolower(trim((string)($row['email'] ?? ''))) !== $email) {
    hm_log_auth_fail('contact_access');
    hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'invalid', 'code' => 'invalid']], 401);
  }
  return ['row' => $row, 'email' => $email, 'code' => $code, 'body' => $p];
}

// Verify a staff session token inline (mirrors chat.php admin-delete-media).
// Returns the actor id on success, or emits 403 and exits.
function cc_require_staff(): string {
  $tok = hm_request_header('X-ADMIN-TOKEN');
  if (is_string($tok) && $tok !== '' && function_exists('hm_admin_token_verify')) {
    $pl   = hm_admin_token_verify($tok);
    $role = is_array($pl) ? ($pl['role'] ?? '') : '';
    if ($pl !== null && ($role === 'admin' || $role === 'manager') && hm_admin_token_account_valid($pl)) {
      return (string)($pl['email'] ?? ($pl['sub'] ?? 'admin'));
    }
  }
  if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('contact_admin');
  hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'forbidden', 'code' => 'forbidden']], 403);
  return ''; // unreachable
}

// Serialize a conversation's messages (from inbox_messages) for the client.
function cc_messages(PDO $db, string $code): array {
  $thread = cc_thread($code);
  $st = $db->prepare(
    'SELECT id, sender, sender_name, email, body, body_text, labels, is_read, created_at, received_at
       FROM inbox_messages
      WHERE thread_id = ?
      ORDER BY COALESCE(received_at, created_at) ASC, id ASC'
  );
  $st->execute([$thread]);
  $rows = $st->fetchAll();
  $out = [];
  foreach ($rows as $r) {
    $labels = [];
    if (!empty($r['labels'])) {
      $labels = is_array($r['labels']) ? $r['labels'] : (json_decode((string)$r['labels'], true) ?: []);
    }
    if (!empty($labels['deleted'])) continue;            // hidden tombstone
    $isOut = !empty($labels['outbound']);
    $text  = ($r['body_text'] !== null && $r['body_text'] !== '') ? (string)$r['body_text'] : (string)($r['body'] ?? '');
    $out[] = [
      'id'          => (string)$r['id'],
      'sender_type' => $isOut ? 'company' : 'customer',
      'sender_name' => $isOut ? ((string)($r['sender_name'] ?? '') ?: 'Hello Moving')
                              : ((string)($r['sender_name'] ?? '') ?: (string)($r['sender'] ?? '')),
      'text'        => $text,
      'created_at'  => (string)($r['received_at'] ?? $r['created_at'] ?? ''),
    ];
  }
  return $out;
}

// Insert one message row into the conversation's thread. $out = admin/company.
function cc_insert_message(PDO $db, string $code, string $category, string $name,
                           string $email, string $body, bool $out, string $mailbox): string {
  $mid    = '<contact-' . hm_uuid4() . '@hello-moving.com>';
  $labels = ['contact' => true, 'cid' => $code, 'category' => $category];
  if ($out) { $labels['outbound'] = true; $labels['chat'] = true; }
  $st = $db->prepare(
    'INSERT INTO inbox_messages
       (id, sender, sender_name, email, subject, body, body_text, mailbox,
        message_id, thread_id, labels, received_at, is_read, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, NOW(), ?, \'open\')'
  );
  $st->execute([
    hm_uuid4(), $name, $name, $email,
    'お問い合わせ（' . $code . '）', $body, $body, $mailbox,
    $mid, cc_thread($code), json_encode($labels, JSON_UNESCAPED_UNICODE),
    $out ? 1 : 0,
  ]);
  return $mid;
}

// ── action=start ─────────────────────────────────────────────────────────────
if ($action === 'start') {
  hm_rate_limit('contact_start', 5, 60);
  $db = hm_db();
  cc_ensure_table($db);

  $p        = hm_body();
  $name     = mb_substr(trim((string)($p['name'] ?? '')), 0, 100);
  $email    = strtolower(trim((string)($p['email'] ?? '')));
  $category = mb_substr(trim((string)($p['category'] ?? '')), 0, 40);
  $message  = trim((string)($p['message'] ?? ''));

  if ($name === '') hm_err('お名前を入力してください', 400, 'missing_name');
  if ($email === '' || strpbrk($email, "\r\n") !== false || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    hm_err('メールアドレスが正しくありません', 400, 'bad_email');
  }
  if ($message === '') hm_err('メッセージを入力してください', 400, 'empty_message');
  if (mb_strlen($message) > 4000) $message = mb_substr($message, 0, 4000);

  // Allocate a unique short code. The UNIQUE index is the real guarantee; on the
  // (rare) collision the INSERT throws and we regenerate.
  $code = ''; $convId = hm_uuid4();
  for ($try = 0; $try < 6; $try++) {
    $cand = cc_gen_code();
    try {
      $st = $db->prepare(
        'INSERT INTO contact_conversations
           (id, public_contact_id, email, customer_name, category, status,
            created_at, updated_at, confirmed_at, last_customer_activity, expires_at)
         VALUES (?,?,?,?,?, \'open\', NOW(), NOW(), NOW(), NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))'
      );
      $st->execute([$convId, $cand, $email, $name, $category, $RETENTION_DAYS]);
      $code = $cand;
      break;
    } catch (Throwable $e) {
      $msg = $e->getMessage();
      if (stripos($msg, 'Duplicate') === false && stripos($msg, '1062') === false) {
        hm_log_error('contact start insert failed', ['err' => $msg]);
        hm_err('お問い合わせを作成できませんでした', 500, 'create_failed');
      }
      // else: duplicate code — loop and try a new one.
    }
  }
  if ($code === '') hm_err('お問い合わせ番号を発行できませんでした。再度お試しください', 500, 'code_alloc');

  // First message becomes admin-visible ONLY here (on explicit submit/confirm).
  try {
    cc_insert_message($db, $code, $category, $name, $email, $message, false, $MAILBOX);
    hm_cache_invalidate_table('inbox_messages');
  } catch (Throwable $e) {
    hm_log_error('contact start message failed', ['err' => $e->getMessage(), 'code' => $code]);
    hm_err('メッセージを保存できませんでした', 500, 'msg_failed');
  }

  // Customer confirmation email — sends the Contact ID so the customer can resume
  // later (resume requires contact_id + email). Unlike admin-reply there is NO
  // active/away gate: a brand-new inquiry always gets a confirmation. Fire-and-
  // forget — a mail failure is logged but never fails the customer's submission
  // (the conversation + Contact ID already exist and are shown on-screen).
  if ($HM_EMAIL_READY) {
    $acc      = EmailService::account($cfg, 'contact');
    $bodyText = "お問い合わせを受け付けました。担当者より順次ご返信いたします。\n\n"
      . "────────────\n"
      . "お問い合わせ番号：{$code}\n"
      . "この番号とご登録のメールアドレスで、いつでもお問い合わせを再開できます。\n{$SITE_URL}";
    $res = EmailService::deliver($cfg, [
      'account' => 'contact',
      'to'      => $email,
      'subject' => '[Hello Moving] お問い合わせを受け付けました（' . $code . '）',
      'html'    => EmailService::customerHtml($acc, $bodyText, ''),
      'text'    => $bodyText,
    ]);
    if (empty($res['ok'])) {
      hm_log_error('contact start email failed', ['code' => $code, 'err' => $res['error_raw'] ?? $res['error'] ?? '']);
    }
  }

  // Company notification — Telegram admin channel; the admin Inbox pollers also
  // pick up the new row. Fire-and-forget (hm_telegram_send never throws), so a
  // Telegram outage can never fail the customer's request.
  hm_telegram_send(
    "📩 新着お問い合わせ（チャット）\n\n" .
    "お問い合わせ番号: {$code}\n" .
    "カテゴリ: " . ($category !== '' ? $category : '（未選択）') . "\n" .
    "お名前: {$name}\n" .
    "メール: {$email}\n\n" .
    "▶ {$ADMIN_LINK}"
  );

  hm_ok(['public_contact_id' => $code, 'category' => $category, 'status' => 'open']);
}

// ── action=resume ────────────────────────────────────────────────────────────
if ($action === 'resume') {
  hm_rate_limit('contact_resume', 10, 60);
  $db  = hm_db();
  $v   = cc_verify($db);
  $row = $v['row']; $code = $v['code'];
  try { $db->prepare('UPDATE contact_conversations SET last_customer_activity = NOW() WHERE id = ?')->execute([(string)$row['id']]); }
  catch (Throwable $e) { /* non-fatal */ }
  hm_ok([
    'public_contact_id' => $code,
    'category'          => (string)($row['category'] ?? ''),
    'status'            => (string)($row['status'] ?? 'open'),
    'name'             => (string)($row['customer_name'] ?? ''),
    'messages'          => cc_messages($db, $code),
  ]);
}

// ── action=list (poll) ───────────────────────────────────────────────────────
if ($action === 'list') {
  hm_rate_limit('contact_list', 60, 60);
  $db = hm_db();
  $v  = cc_verify($db);
  // Recording last_customer_activity here is the "customer is active" signal that
  // suppresses duplicate reply-emails (admin-reply active rule).
  try { $db->prepare('UPDATE contact_conversations SET last_customer_activity = NOW() WHERE id = ?')->execute([(string)$v['row']['id']]); }
  catch (Throwable $e) { /* non-fatal */ }
  hm_ok([
    'public_contact_id' => $v['code'],
    'status'            => (string)($v['row']['status'] ?? 'open'),
    'messages'          => cc_messages($db, $v['code']),
  ]);
}

// ── action=send (customer) ───────────────────────────────────────────────────
if ($action === 'send') {
  hm_rate_limit('contact_send', 30, 60);
  $db  = hm_db();
  $v   = cc_verify($db);
  $row = $v['row']; $code = $v['code']; $p = $v['body'];

  $message = trim((string)($p['message'] ?? ''));
  if ($message === '') hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'empty', 'code' => 'empty']], 400);
  if (mb_strlen($message) > 4000) $message = mb_substr($message, 0, 4000);

  $name     = trim((string)($row['customer_name'] ?? '')) ?: 'お客様';
  $category = (string)($row['category'] ?? '');
  try {
    cc_insert_message($db, $code, $category, $name, $v['email'], $message, false, $MAILBOX);
    // Rolling retention + reopen a closed thread on a new customer message.
    $db->prepare(
      'UPDATE contact_conversations
          SET last_customer_activity = NOW(), updated_at = NOW(), status = \'open\',
              expires_at = DATE_ADD(NOW(), INTERVAL ? DAY)
        WHERE id = ?'
    )->execute([$RETENTION_DAYS, (string)$row['id']]);
    hm_cache_invalidate_table('inbox_messages');
  } catch (Throwable $e) {
    hm_log_error('contact send failed', ['err' => $e->getMessage(), 'code' => $code]);
    hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'server', 'code' => 'server']], 500);
  }

  // Fire-and-forget Telegram admin alert (never fails the customer's send).
  $preview = mb_substr($message, 0, 200);
  hm_telegram_send(
    "💬 新着メッセージ\n\n" .
    "お問い合わせ番号: {$code}\n\n" .
    "{$preview}\n\n" .
    "▶ {$ADMIN_LINK}"
  );
  hm_ok(['id' => 'ok']);
}

// ── action=admin-reply (staff) ───────────────────────────────────────────────
if ($action === 'admin-reply') {
  $actor = cc_require_staff();
  hm_rate_limit('contact_admin_reply', 60, 60);
  $db = hm_db();

  $p       = hm_body();
  $code    = strtoupper(trim((string)($p['contact_id'] ?? $p['code'] ?? '')));
  $message = trim((string)($p['message'] ?? ''));
  if (!cc_valid_code($code)) hm_err('invalid contact id', 400, 'bad_code');
  if ($message === '')       hm_err('empty message', 400, 'empty');
  if (mb_strlen($message) > 4000) $message = mb_substr($message, 0, 4000);

  try {
    $st = $db->prepare('SELECT * FROM contact_conversations WHERE public_contact_id = ? LIMIT 1');
    $st->execute([$code]);
    $row = $st->fetch();
  } catch (Throwable $e) {
    hm_log_error('contact admin-reply lookup failed', ['err' => $e->getMessage()]);
    hm_err('server error', 500, 'server');
  }
  if (!$row) hm_err('conversation not found', 404, 'not_found');

  $category = (string)($row['category'] ?? '');
  try {
    cc_insert_message($db, $code, $category, 'Hello Moving', (string)$row['email'], $message, true, $MAILBOX);
    $db->prepare(
      'UPDATE contact_conversations
          SET last_admin_activity = NOW(), updated_at = NOW(),
              expires_at = DATE_ADD(NOW(), INTERVAL ? DAY)
        WHERE id = ?'
    )->execute([$RETENTION_DAYS, (string)$row['id']]);
    hm_cache_invalidate_table('inbox_messages');
  } catch (Throwable $e) {
    hm_log_error('contact admin-reply failed', ['err' => $e->getMessage(), 'code' => $code]);
    hm_err('server error', 500, 'server');
  }

  // ── Active rule ── email the customer ONLY when they are not recently active
  // (i.e. not currently watching the poll), so a live chat never double-notifies.
  $lastActTs = !empty($row['last_customer_activity']) ? (int)strtotime((string)$row['last_customer_activity']) : 0;
  $isActive  = $lastActTs > 0 && (time() - $lastActTs) < $ACTIVE_WINDOW;
  $emailed   = false; $reason = $isActive ? 'customer_active' : 'no_mailer';

  if (!$isActive && $HM_EMAIL_READY) {
    $acc      = EmailService::account($cfg, 'contact');
    $bodyText = $message
      . "\n\n────────────\n"
      . "お問い合わせ番号：{$code}\n"
      . "この番号とご登録のメールアドレスで、いつでもお問い合わせを再開できます。\n{$SITE_URL}";
    $html = EmailService::customerHtml($acc, $bodyText, '');
    $res  = EmailService::deliver($cfg, [
      'account' => 'contact',
      'to'      => (string)$row['email'],
      'subject' => '[Hello Moving] お問い合わせへのご返信（' . $code . '）',
      'html'    => $html,
      'text'    => $bodyText,
    ]);
    $emailed = (bool)($res['ok'] ?? false);
    $reason  = $emailed ? 'emailed' : 'email_failed';
    if (!$emailed) {
      hm_log_error('contact admin-reply email failed', ['code' => $code, 'err' => $res['error_raw'] ?? $res['error'] ?? '']);
    }
  }

  hm_ok(['id' => 'ok', 'emailed' => $emailed, 'notify' => $reason]);
}

// ── action=admin-close (staff) ───────────────────────────────────────────────
// Archive / close / reopen a conversation. status ∈ open | closed | archived.
if ($action === 'admin-close') {
  cc_require_staff();
  hm_rate_limit('contact_admin_close', 60, 60);
  $db = hm_db();
  $p     = hm_body();
  $code  = strtoupper(trim((string)($p['contact_id'] ?? $p['code'] ?? '')));
  $newSt = strtolower(trim((string)($p['status'] ?? 'archived')));
  if (!cc_valid_code($code)) hm_err('invalid contact id', 400, 'bad_code');
  if (!in_array($newSt, ['open', 'closed', 'archived'], true)) $newSt = 'archived';
  try {
    $st = $db->prepare('UPDATE contact_conversations SET status = ?, updated_at = NOW() WHERE public_contact_id = ?');
    $st->execute([$newSt, $code]);
  } catch (Throwable $e) {
    hm_log_error('contact admin-close failed', ['err' => $e->getMessage(), 'code' => $code]);
    hm_err('server error', 500, 'server');
  }
  if ($st->rowCount() === 0) hm_err('conversation not found', 404, 'not_found');
  hm_ok(['public_contact_id' => $code, 'status' => $newSt]);
}

// ── action=admin-meta (staff) ────────────────────────────────────────────────
// Lightweight status / last-activity strip for the admin Inbox contact thread.
if ($action === 'admin-meta') {
  cc_require_staff();
  hm_rate_limit('contact_admin_meta', 120, 60);
  $db   = hm_db();
  $code = strtoupper(trim((string)($_GET['contact_id'] ?? '')));
  if (!cc_valid_code($code)) hm_err('invalid contact id', 400, 'bad_code');
  try {
    $st = $db->prepare(
      'SELECT public_contact_id, email, customer_name, category, status,
              created_at, last_customer_activity, last_admin_activity, expires_at
         FROM contact_conversations WHERE public_contact_id = ? LIMIT 1'
    );
    $st->execute([$code]);
    $row = $st->fetch();
  } catch (Throwable $e) {
    hm_log_error('contact admin-meta failed', ['err' => $e->getMessage()]);
    hm_err('server error', 500, 'server');
  }
  if (!$row) hm_err('conversation not found', 404, 'not_found');
  hm_ok([
    'public_contact_id'      => (string)$row['public_contact_id'],
    'email'                  => (string)$row['email'],
    'customer_name'          => (string)($row['customer_name'] ?? ''),
    'category'               => (string)($row['category'] ?? ''),
    'status'                 => (string)($row['status'] ?? 'open'),
    'created_at'             => (string)($row['created_at'] ?? ''),
    'last_customer_activity' => (string)($row['last_customer_activity'] ?? ''),
    'last_admin_activity'    => (string)($row['last_admin_activity'] ?? ''),
    'expires_at'             => (string)($row['expires_at'] ?? ''),
  ]);
}

hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'unknown_action', 'code' => 'unknown_action']], 400);
