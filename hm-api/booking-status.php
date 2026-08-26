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

// Thrown when confirming a booking whose (date, band) is already held by a
// DIFFERENT real booking — surfaced as HTTP 409 (double-booking guard).

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
  'completed'      => 'completed',
  'complete'       => 'completed',
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
// notify defaults ON (customer gets an inbox notification, as chat has always
// done). Callers that only want the status/slot change pass notify=false/0.
$nv = $param('notify');
$notifyCustomer = ($nv === null) ? true : !in_array(strtolower(trim((string)$nv)), ['0', 'false', 'no', 'off'], true);

try {
  $db = hm_db();
  // Deploy-order-safe: ensure the agreed_price column exists before we read it.
  if (function_exists('hm_bookings_ensure_price_col')) hm_bookings_ensure_price_col($db);

  // Booking must exist and not be an admin block.
  $q = $db->prepare('SELECT customer_name, customer_email, booking_date, notes, status, start_at, agreed_price FROM bookings WHERE id = ? LIMIT 1');
  $q->execute([$bookingId]);
  $bk = $q->fetch(PDO::FETCH_ASSOC);
  if (!$bk) bkst_out(['ok' => false, 'error' => 'not_found'], $isCli, 404);
  if ((string)$bk['status'] === 'admin_blocked') {
    bkst_out(['ok' => false, 'error' => 'cannot change status of an admin block'], $isCli, 400);
  }

  $name  = (string)($bk['customer_name']  ?? '');
  $email = (string)($bk['customer_email'] ?? '');
  $bdate = (string)($bk['booking_date']   ?? '未定');
  // Old status (BEFORE this update) — the idempotency key: lifecycle EMAILS fire only
  // on a real transition (old !== new), never on re-saving an already-set status.
  $oldStatus = strtolower(trim((string)($bk['status'] ?? '')));
  // Prefer the human HM- reference packed in notes; fall back to the row id.
  $ref = $bookingId;
  if (preg_match('/^ref:\s*(\S+)/m', (string)($bk['notes'] ?? ''), $rm)) $ref = trim($rm[1]);
  // Service (packed in notes by bookingService._packNotes) + confirmed start time
  // (from the timeline start_at) — surfaced on the confirmed/completed notifications.
  $svc = '';
  if (preg_match('/^service:\s*(.+)$/m', (string)($bk['notes'] ?? ''), $sm)) $svc = trim($sm[1]);
  $startTime = '';
  $saRaw = (string)($bk['start_at'] ?? '');
  if ($saRaw !== '') { $sts = strtotime($saRaw); if ($sts) $startTime = date('H:i', $sts); }
  // Agreed price — a DEDICATED INT (JPY) column, NEVER parsed from notes. NULL / absent
  // for estimate-stage or pre-existing bookings → the price line is simply omitted.
  $priceLine = '';
  if (isset($bk['agreed_price']) && $bk['agreed_price'] !== null && $bk['agreed_price'] !== '') {
    $priceInt = (int)$bk['agreed_price'];
    if ($priceInt > 0) $priceLine = '確定金額: ' . number_format($priceInt) . '円';
  }
  // Signed, single-use review link — set only on the completed transition below.
  // Used as the HTML email's 「評価する」 button + a plaintext fallback link.
  $reviewUrl = '';

  // Customer-facing message (clean, professional). Needs_Revision carries the note.
  //   confirmed → 予約確定のお知らせ (STEP B) · completed → 作業完了のお知らせ (STEP C)
  $head = [
    'confirmed'      => '✅ 予約確定のお知らせ',
    'completed'      => '🎉 作業完了のお知らせ',
    'cancelled'      => '❌ ご予約がキャンセルされました',
    'needs_revision' => '✏️ ご予約内容のご確認をお願いします',
    'pending'        => '🕒 ご予約を確認中です',
  ][$status] ?? 'ご予約の状態が更新されました';

  $lines = [
    $head, '',
    "予約番号: {$ref}",
    "お名前: {$name} 様",
  ];
  if ($svc !== '') $lines[] = "サービス: {$svc}";
  $lines[] = "日程: {$bdate}" . ($startTime !== '' ? "（開始 {$startTime}）" : '');
  // Confirmed / completed notifications show the stored agreed price (dedicated column).
  if ($priceLine !== '' && in_array($status, ['confirmed', 'completed'], true)) $lines[] = $priceLine;
  // The admin note is a free-form remark only (NOT the price). Needs_Revision carries
  // the revision request; everything else labels it 備考.
  if ($note !== '') {
    $lines[] = ($status === 'needs_revision' ? '修正のお願い: ' : '備考: ') . $note;
  }
  // STEP C: thank-you + a one-tap review link. The link carries an opaque, signed,
  // single-use token (no login required, no sensitive data in the URL) → review.html
  // → review.php, which writes into the SAME reviews table as the portal flow.
  if ($status === 'completed') {
    require_once __DIR__ . '/_reviewtoken.php';
    $siteUrl   = rtrim((string)(hm_config()['site_url'] ?? 'https://hello-moving.com'), '/');
    $reviewUrl = $siteUrl . '/review.html?token=' . hm_review_token_make($bookingId);
    $lines[] = '';
    $lines[] = 'この度はご利用いただき誠にありがとうございました。';
    $lines[] = 'よろしければ、下記のボタンより★の評価をお聞かせください（所要1分・コメントは任意です）。';
    // The raw URL is NOT inlined here — the HTML email renders a 「評価する」 button
    // and the plaintext part appends the link (below), keeping the body clean.
  }
  $msg = implode("\n", $lines);

  $db->beginTransaction();
  try {
    // 1) Update the booking status.
    $up = $db->prepare('UPDATE bookings SET status = ? WHERE id = ?');
    $up->execute([$status, $bookingId]);

    // TIMELINE-ONLY: a booking's reservation IS its interval (start_at/end_at), locked
    // atomically at create/reschedule via hm_iv_reserve. Confirming is status-only;
    // cancelling is status-only too — hm_iv_day() excludes cancelled rows, so the
    // interval is freed automatically. No band reserve/release. (All legacy band
    // bookings were converted to intervals by migrate-bookings-to-timeline.php.)

    // 2) Needs_Revision: also append the note to the booking's revision history
    //    (notes) so it's retained on the booking itself, not only in the message.
    if ($status === 'needs_revision' && $note !== '') {
      $stamp = date('Y-m-d H:i');
      $rev = "\n[REVISION {$stamp}] " . mb_substr($note, 0, 1000);
      $un = $db->prepare('UPDATE bookings SET notes = CONCAT(COALESCE(notes, ""), ?) WHERE id = ?');
      $un->execute([$rev, $bookingId]);
    }

    // 3) Auto-notification row (mirrors create-booking.php's inbox_messages insert).
    if ($notifyCustomer) {
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
    }

    $db->commit();
  } catch (Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    throw $e;
  }

  if (function_exists('hm_cache_invalidate_table')) {
    hm_cache_invalidate_table('bookings');
    hm_cache_invalidate_table('inbox_messages');
  }

  // ── Customer EMAIL (Phase B) — a real email for the lifecycle events, IN ADDITION
  //    to the in-app inbox row. Sent regardless of the `notify` flag (which only
  //    governs the inbox row): Ops confirm passes notify=false yet the customer must
  //    still get the email. Non-fatal + ALWAYS logged (success / failure / SMTP
  //    error) — never silently fails; a send error does not fail the status change.
  // Duplicate-email guard (idempotency): a lifecycle email fires ONLY on a real
  // status transition (old !== new). Re-saving an already-confirmed / already-completed
  // / already-cancelled booking sends NOTHING. The status UPDATE itself is idempotent
  // and always runs; only the notification semantics are transition-gated.
  $isTransition = ($oldStatus !== $status);
  $emailStatus = 'skipped';
  if (!$isTransition && in_array($status, ['confirmed', 'completed', 'cancelled'], true)) {
    $emailStatus = 'skipped_no_transition';
  }
  if ($isTransition
      && in_array($status, ['confirmed', 'completed', 'cancelled'], true)
      && $email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $emailStatus = 'error';
    try {
      require_once __DIR__ . '/EmailService.php';
      if (class_exists('EmailService')) {
        $ecfg = hm_config();
        $subj = "【予約 {$ref}】" . $head;
        $acc  = EmailService::account($ecfg, 'booking');
        $html = EmailService::customerHtml($acc, $msg, $ref, EmailService::chatUrl($ecfg, $ref), $reviewUrl);
        // Plaintext part keeps the review link actionable (HTML uses the button).
        $textBody = $reviewUrl !== '' ? ($msg . "\n\n▶ " . $reviewUrl) : $msg;
        $eres = EmailService::deliver($ecfg, ['account' => 'booking', 'to' => $email, 'subject' => $subj, 'html' => $html, 'text' => $textBody]);
        if (!empty($eres['ok'])) {
          $emailStatus = 'sent';
          if (function_exists('hm_log_write')) hm_log_write('info.log', ['type' => 'booking_status_email', 'result' => 'sent', 'status' => $status, 'booking' => $bookingId, 'to' => $email, 'transport' => (string)($eres['transport'] ?? '')]);
        } else {
          $emailStatus = (string)($eres['code'] ?? 'error');
          if (function_exists('hm_log_error')) hm_log_error('booking-status email FAILED — customer not notified by email', ['status' => $status, 'booking' => $bookingId, 'to' => $email, 'code' => (string)($eres['code'] ?? 'unknown'), 'error' => (string)($eres['error'] ?? '')]);
        }
      } else {
        $emailStatus = 'service_missing';
        if (function_exists('hm_log_error')) hm_log_error('booking-status email: EmailService.php unavailable', ['status' => $status, 'booking' => $bookingId]);
      }
    } catch (Throwable $e) {
      if (function_exists('hm_log_error')) hm_log_error('booking-status email exception', ['status' => $status, 'booking' => $bookingId, 'err' => $e->getMessage()]);
    }
  }

  bkst_out(['ok' => true, 'booking_id' => $bookingId, 'status' => $status, 'notified' => $notifyCustomer, 'email' => $emailStatus], $isCli);

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) hm_log_error('booking-status failed', ['err' => $e->getMessage(), 'booking' => $bookingId, 'status' => $status ?? '']);
  bkst_out(['ok' => false, 'error' => hm_safe_msg('Request failed', $e)], $isCli, 500);
}
