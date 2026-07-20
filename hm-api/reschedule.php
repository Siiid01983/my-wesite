<?php
// ════════════════════════════════════════════════════════════════════════════
//  reschedule.php — Admin move/resize a booking (date + time), atomically.
//
//  Persists booking_date / start_at / end_at AND, for a CONFIRMED booking, TRANSFERS
//  its slot reservation: release the old (release-by-booking → no duplicate/ghost
//  rows) and reserve the new (date, band) via the capacity engine — all in ONE
//  transaction, so a full/closed target rolls back and the old slot stays intact.
//  Then emails the customer the reschedule (old → new) and logs every outcome.
//
//  Auth: dual gate — X-ADMIN-TOKEN (verified inline) or ?token=admin_setup_token.
//
//  Request (JSON / POST / GET):
//    { booking_id, booking_date, start_at?, end_at? }   // datetimes 'YYYY-MM-DD HH:MM:SS'
//  Response:
//    { ok:true, booking_id, moved:bool, old:{date,time}, new:{date,time}, email:"sent|…" }
//    { ok:false, error:"slot_taken", reason:"full|closed" }   HTTP 409  (old slot untouched)
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_slots.php';
require_once __DIR__ . '/_capacity.php';

$isCli = (PHP_SAPI === 'cli');
class HmRsConflict extends RuntimeException { public $reason = 'full'; }

function rs_out(array $p, bool $isCli, int $status = 200): void {
  if ($isCli) { fwrite(STDOUT, json_encode($p, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL); exit; }
  hm_json($p, $status);
}

$body = [];
if (!$isCli) { $raw = file_get_contents('php://input'); if ($raw) { $j = json_decode($raw, true); if (is_array($j)) $body = $j; } }
$param = function (string $k) use ($body) {
  if (isset($_GET[$k])) return $_GET[$k];
  if (isset($_POST[$k])) return $_POST[$k];
  if (array_key_exists($k, $body)) return $body[$k];
  return null;
};

if (!$isCli) {
  require_once __DIR__ . '/_ratelimit.php';
  hm_cors(); hm_require_api_key(); hm_rate_limit('reschedule', 40, 60);
  // Dual admin auth — identical to booking-status.php.
  $authed = false;
  $tok = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  if (is_string($tok) && $tok !== '' && function_exists('hm_admin_token_verify')) {
    $pl = hm_admin_token_verify($tok);
    if ($pl !== null && ($pl['role'] ?? '') === 'admin' && hm_admin_token_account_valid($pl)) $authed = true;
  }
  if (!$authed) {
    $setup = (string)(hm_config()['admin_setup_token'] ?? '');
    if ($setup !== '' && hash_equals($setup, (string)($param('token') ?? ''))) $authed = true;
  }
  if (!$authed) { if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('reschedule'); rs_out(['ok' => false, 'error' => 'forbidden'], false, 403); }
}

// ── Params ───────────────────────────────────────────────────────────────────
$bookingId = trim((string)($param('booking_id') ?? ''));
if ($bookingId === '') rs_out(['ok' => false, 'error' => 'booking_id required'], $isCli, 400);
$newDate  = trim((string)($param('booking_date') ?? ''));
$newStart = trim((string)($param('start_at') ?? ''));
$newEnd   = trim((string)($param('end_at') ?? ''));
if ($newDate === '' && $newStart !== '') $newDate = substr($newStart, 0, 10);
if ($newDate === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $newDate)) {
  rs_out(['ok' => false, 'error' => 'valid booking_date (YYYY-MM-DD) required'], $isCli, 400);
}

// Time 'HH:MM' out of a datetime; band id out of a time (reuse the slot layer).
$hm    = fn(?string $dt) => ($dt && preg_match('/(\d{1,2}:\d{2})/', substr((string)$dt, 10), $m)) ? $m[1] : '';
$bandOf = fn(?string $dt, ?string $notes) => hm_slot_band_id($hm($dt) ?: '') ?? hm_slot_band_from_notes($notes);

try {
  $db = hm_db();
  $q = $db->prepare('SELECT customer_name, customer_email, booking_date, notes, status, start_at, end_at FROM bookings WHERE id = ? LIMIT 1');
  $q->execute([$bookingId]);
  $bk = $q->fetch(PDO::FETCH_ASSOC);
  if (!$bk) rs_out(['ok' => false, 'error' => 'not_found'], $isCli, 404);
  if ((string)$bk['status'] === 'admin_blocked') rs_out(['ok' => false, 'error' => 'cannot reschedule an admin block'], $isCli, 400);

  $oldDate = (string)($bk['booking_date'] ?? '');
  $oldTime = $hm($bk['start_at']) ?: hm_slot_time_from_notes($bk['notes'] ?? '');
  $newTime = $hm($newStart);
  $confirmed = in_array((string)$bk['status'], ['confirmed', 'completed'], true);
  $newBand   = $bandOf($newStart, $bk['notes']);
  $moved = false;

  // SINGLE-SOURCE validation of the TARGET slot — the SAME hm_cap_confirm_check()
  // the Ops + admin confirm paths use. Covers a whole-day closure even for a
  // band-less booking (the reserve below only guards band closed/full). Excludes
  // this booking's own reservation so moving within a band isn't self-blocked.
  if ($confirmed) {
    $chk = hm_cap_confirm_check($db, $newDate, $newBand, $bookingId);
    if (empty($chk['ok'])) rs_out(['ok' => false, 'error' => 'slot_taken', 'reason' => (string)($chk['reason'] ?? 'slot_taken')], $isCli, 409);
  }

  hm_slot_ensure_table($db);
  $db->beginTransaction();
  try {
    // Transfer the reservation for a CONFIRMED booking: release-by-booking (removes
    // every old row → no duplicate/ghost), then reserve the new band. A full/closed
    // target rolls the whole thing back, so the old reservation is preserved.
    if ($confirmed && $newBand !== null) {
      hm_slot_release($db, $bookingId);
      $res = hm_cap_reserve($db, $newDate, $newBand, $bookingId);
      if (!empty($res['conflict'])) { $c = new HmRsConflict(); $c->reason = (string)($res['reason'] ?? 'full'); throw $c; }
      $moved = true;
    }
    // Persist the new schedule on the booking record (the calendar's source of truth).
    $sets = ['booking_date = ?']; $vals = [$newDate];
    if ($newStart !== '') { $sets[] = 'start_at = ?'; $vals[] = $newStart; }
    if ($newEnd   !== '') { $sets[] = 'end_at = ?';   $vals[] = $newEnd; }
    $vals[] = $bookingId;
    $db->prepare('UPDATE bookings SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($vals);
    $db->commit();
  } catch (Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    if ($e instanceof HmRsConflict) rs_out(['ok' => false, 'error' => 'slot_taken', 'reason' => $e->reason], $isCli, 409);
    throw $e;
  }

  if (function_exists('hm_cache_invalidate_table')) hm_cache_invalidate_table('bookings');

  // ── Rescheduled email (old → new) — only for a confirmed booking with an email.
  //    Always logged (sent / failure / SMTP code); never silent, never fatal.
  $ref = $bookingId;
  if (preg_match('/^ref:\s*(\S+)/m', (string)($bk['notes'] ?? ''), $rm)) $ref = trim($rm[1]);
  $email = (string)($bk['customer_email'] ?? '');
  $emailStatus = 'skipped';
  if ($confirmed && $email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $emailStatus = 'error';
    $oldStr = $oldDate . ($oldTime ? ' ' . $oldTime : '');
    $newStr = $newDate . ($newTime ? ' ' . $newTime : '');
    $head = '🔁 ご予約の日時が変更されました';
    $msg  = implode("\n", [$head, '', "予約番号: {$ref}", "お名前: " . (string)($bk['customer_name'] ?? '') . " 様",
                           "変更前: {$oldStr}", "変更後: {$newStr}"]);
    try {
      require_once __DIR__ . '/EmailService.php';
      if (class_exists('EmailService')) {
        $cfg = hm_config();
        $acc = EmailService::account($cfg, 'booking');
        $html = EmailService::customerHtml($acc, $msg, $ref, EmailService::chatUrl($cfg, $ref));
        $er = EmailService::deliver($cfg, ['account' => 'booking', 'to' => $email, 'subject' => "【予約 {$ref}】" . $head, 'html' => $html, 'text' => $msg]);
        if (!empty($er['ok'])) { $emailStatus = 'sent'; if (function_exists('hm_log_write')) hm_log_write('info.log', ['type' => 'reschedule_email', 'result' => 'sent', 'booking' => $bookingId, 'to' => $email, 'transport' => (string)($er['transport'] ?? '')]); }
        else { $emailStatus = (string)($er['code'] ?? 'error'); if (function_exists('hm_log_error')) hm_log_error('reschedule email FAILED', ['booking' => $bookingId, 'to' => $email, 'code' => (string)($er['code'] ?? ''), 'error' => (string)($er['error'] ?? '')]); }
      } else { $emailStatus = 'service_missing'; if (function_exists('hm_log_error')) hm_log_error('reschedule email: EmailService.php unavailable', ['booking' => $bookingId]); }
    } catch (Throwable $e) { if (function_exists('hm_log_error')) hm_log_error('reschedule email exception', ['booking' => $bookingId, 'err' => $e->getMessage()]); }
  }

  rs_out(['ok' => true, 'booking_id' => $bookingId, 'moved' => $moved, 'band' => $newBand,
          'old' => ['date' => $oldDate, 'time' => $oldTime], 'new' => ['date' => $newDate, 'time' => $newTime],
          'email' => $emailStatus], $isCli);

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) hm_log_error('reschedule failed', ['err' => $e->getMessage(), 'booking' => $bookingId]);
  rs_out(['ok' => false, 'error' => hm_safe_msg('Request failed', $e)], $isCli, 500);
}
