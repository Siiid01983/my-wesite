<?php
// ════════════════════════════════════════════════════════════════════════════
//  booking-status.php — Admin booking lifecycle (Accept / Cancel / Needs-Revision)
//
//  One endpoint for the chat/admin BookingCard actions. Updates bookings.status
//  and inserts a customer-facing notification row into inbox_messages (the same
//  channel create-booking.php uses), linked by booking_id. For Needs_Revision the
//  admin's note is carried into that notification (the message history).
//
//  ── Auth (dual gate — identical to confirm-request.php / block-interval.php) ──
//    1. Admin session token (header X-ADMIN-TOKEN), verified inline.
//    2. Fallback: admin_setup_token in _config.php as ?token=.  CLI always trusted.
//
//  ── Request (JSON body / GET / POST) ────────────────────────────────────────
//    { booking_id, status, note? }
//    status ∈ Accepted | Cancelled | Needs_Revision | Pending  (case-insensitive)
//      → stored canonically: confirmed | cancelled | needs_revision | pending
//
//  ── Response ────────────────────────────────────────────────────────────────
//    { ok:true, booking_id, status:"<canonical>", notified:true }
//    { ok:false, error:"not_found" }                 HTTP 404
//    { ok:false, error:"invalid status — …" }        HTTP 400
//    { ok:false, error:"…" }                          HTTP 4xx/5xx
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';

$isCli = (PHP_SAPI === 'cli');

function bkst_out(array $payload, bool $isCli, int $status = 200): void {
  if ($isCli) {
    fwrite(STDOUT, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    exit;
  }
  hm_json($payload, $status);
}

// Accepted input labels → canonical bookings.status value.
const HM_BKST_MAP = [
  'accepted'       => 'confirmed',
  'confirmed'      => 'confirmed',
  'cancelled'      => 'cancelled',
  'canceled'       => 'cancelled',
  'needs_revision' => 'needs_revision',
  'needs revision' => 'needs_revision',
  'pending'        => 'pending',
];

// ── Params ───────────────────────────────────────────────────────────────────
$body = [];
if (!$isCli) {
  $raw = file_get_contents('php://input');
  if ($raw !== '' && $raw !== false) {
    $j = json_decode($raw, true);
    if (is_array($j)) $body = $j;
  }
}
$param = function (string $k) use ($body) {
  if (isset($_GET[$k]))            return $_GET[$k];
  if (isset($_POST[$k]))           return $_POST[$k];
  if (array_key_exists($k, $body)) return $body[$k];
  return null;
};

// ── HTTP guards ──────────────────────────────────────────────────────────────
if (!$isCli) {
  require_once __DIR__ . '/_ratelimit.php';
  hm_cors();
  hm_require_api_key();
  hm_rate_limit('booking_status', 40, 60);
}

// ── Dual admin auth gate ─────────────────────────────────────────────────────
if (!$isCli) {
  $authed = false;
  $tok = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  if (is_string($tok) && $tok !== '') {
    $pl = hm_admin_token_verify($tok);
    if ($pl !== null && ($pl['role'] ?? '') === 'admin' && hm_admin_token_account_valid($pl)) $authed = true;
  }
  if (!$authed) {
    $setup = (string)(hm_config()['admin_setup_token'] ?? '');
    $sent  = (string)($param('token') ?? '');
    if ($setup !== '' && hash_equals($setup, $sent)) $authed = true;
  }
  if (!$authed) {
    if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('booking_status');
    bkst_out(['ok' => false, 'error' => 'forbidden — admin session (X-ADMIN-TOKEN) or ?token= required'], false, 403);
  }
}

// ── Validate booking_id + status ─────────────────────────────────────────────
$bookingId = trim((string)($param('booking_id') ?? ''));
if ($bookingId === '') bkst_out(['ok' => false, 'error' => 'booking_id required'], $isCli, 400);

$statusIn = strtolower(trim((string)($param('status') ?? '')));
if (!isset(HM_BKST_MAP[$statusIn])) {
  bkst_out(['ok' => false, 'error' => 'invalid status — use Accepted | Cancelled | Needs_Revision | Pending'], $isCli, 400);
}
$status = HM_BKST_MAP[$statusIn];
$note   = trim((string)($param('note') ?? ''));

try {
  $db = hm_db();

  // Booking must exist and not be an admin block.
  $q = $db->prepare('SELECT customer_name, customer_email, booking_date, notes, status FROM bookings WHERE id = ? LIMIT 1');
  $q->execute([$bookingId]);
  $bk = $q->fetch(PDO::FETCH_ASSOC);
  if (!$bk) bkst_out(['ok' => false, 'error' => 'not_found'], $isCli, 404);
  if ((string)$bk['status'] === 'admin_blocked') {
    bkst_out(['ok' => false, 'error' => 'cannot change status of an admin block'], $isCli, 400);
  }

  $name  = (string)($bk['customer_name']  ?? '');
  $email = (string)($bk['customer_email'] ?? '');
  $bdate = (string)($bk['booking_date']   ?? '未定');
  // Prefer the human HM- reference packed in notes; fall back to the row id.
  $ref = $bookingId;
  if (preg_match('/^ref:\s*(\S+)/m', (string)($bk['notes'] ?? ''), $rm)) $ref = trim($rm[1]);

  // Customer-facing message (clean, professional). Needs_Revision carries the note.
  $head = [
    'confirmed'      => '✅ ご予約が確定しました',
    'cancelled'      => '❌ ご予約がキャンセルされました',
    'needs_revision' => '✏️ ご予約内容のご確認をお願いします',
    'pending'        => '🕒 ご予約を確認中です',
  ][$status] ?? 'ご予約の状態が更新されました';

  $lines = [
    $head, '',
    "予約番号: {$ref}",
    "お名前: {$name} 様",
    "日程: {$bdate}",
  ];
  if ($note !== '') $lines[] = ($status === 'needs_revision' ? "修正のお願い: " : "備考: ") . $note;
  $msg = implode("\n", $lines);

  $db->beginTransaction();
  try {
    // 1) Update the booking status.
    $up = $db->prepare('UPDATE bookings SET status = ? WHERE id = ?');
    $up->execute([$status, $bookingId]);

    // 2) Needs_Revision: also append the note to the booking's revision history
    //    (notes) so it's retained on the booking itself, not only in the message.
    if ($status === 'needs_revision' && $note !== '') {
      $stamp = date('Y-m-d H:i');
      $rev = "\n[REVISION {$stamp}] " . mb_substr($note, 0, 1000);
      $un = $db->prepare('UPDATE bookings SET notes = CONCAT(COALESCE(notes, ""), ?) WHERE id = ?');
      $un->execute([$rev, $bookingId]);
    }

    // 3) Auto-notification row (mirrors create-booking.php's inbox_messages insert).
    $ins = $db->prepare(
      'INSERT INTO inbox_messages (id, sender, email, subject, body, body_text, booking_id, mailbox, sender_name, received_at)
       VALUES (?,?,?,?,?,?,?,?,?,NOW())'
    );
    $ins->execute([
      hm_uuid4(),
      'Hello Moving',
      $email,
      "【予約 {$ref}】" . $head,
      $msg,
      $msg,
      $bookingId,
      'booking@hello-moving.com',
      'Hello Moving',
    ]);

    $db->commit();
  } catch (Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    throw $e;
  }

  if (function_exists('hm_cache_invalidate_table')) {
    hm_cache_invalidate_table('bookings');
    hm_cache_invalidate_table('inbox_messages');
  }

  bkst_out(['ok' => true, 'booking_id' => $bookingId, 'status' => $status, 'notified' => true], $isCli);

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) hm_log_error('booking-status failed', ['err' => $e->getMessage(), 'booking' => $bookingId, 'status' => $status ?? '']);
  bkst_out(['ok' => false, 'error' => hm_safe_msg('Request failed', $e)], $isCli, 500);
}
