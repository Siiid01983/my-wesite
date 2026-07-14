<?php
// ════════════════════════════════════════════════════════════════════════════
//  booking-slot.hourly.php — interval version of booking-slot.php  [REVIEW DRAFT]
//
//  Same auth/CORS/rate-limit contract as the deployed booking-slot.php, but the
//  slot is a time INTERVAL, not a band. Requires 001_bookings_hourly.sql applied
//  and _intervals.php present. When approved, deploy over booking-slot.php (or
//  point the app at this filename first, then swap).
//
//  Actions (JSON body / GET / POST):
//    reserve  { booking_id, start_time, end_time }   (ISO 8601)
//        Atomic overlap-checked reserve/reschedule. Conflict → 409 slot_taken.
//    release  { booking_id }
//        Clears start_at/end_at.
//
//  Response:
//    { ok:true, action:"reserved", booking_id, start, end }
//    { ok:true, action:"released", booking_id }
//    { ok:false, error:"slot_taken", with:"<id>" }   HTTP 409
//    { ok:false, error:"..." }                        HTTP 4xx/5xx
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/../../_lib.php';   // adjust include path on deploy
require_once __DIR__ . '/../../_db.php';
require_once __DIR__ . '/../../_intervals.php';   // canonical copy lives in hm-api/ root

$isCli = (PHP_SAPI === 'cli');

function ivx_out(array $payload, bool $isCli, int $status = 200): void {
  if ($isCli) {
    fwrite(STDOUT, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    exit;
  }
  hm_json($payload, $status);
}

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

if (!$isCli) {
  require_once __DIR__ . '/../../_ratelimit.php';
  hm_cors();
  hm_require_api_key();
  hm_rate_limit('booking_slot', 30, 60);
}

// Dual auth — identical to booking-slot.php.
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
    if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('booking_slot');
    ivx_out(['ok' => false, 'error' => 'forbidden — admin session (X-ADMIN-TOKEN) or ?token= required'], false, 403);
  }
}

$action = strtolower(trim((string)($param('action') ?? '')));
if (!in_array($action, ['reserve', 'release'], true)) {
  ivx_out(['ok' => false, 'error' => "invalid action — use 'reserve' or 'release'"], $isCli, 400);
}
$bookingId = trim((string)($param('booking_id') ?? ''));
if ($bookingId === '') ivx_out(['ok' => false, 'error' => 'booking_id required'], $isCli, 400);

try {
  $db = hm_db();

  if ($action === 'release') {
    hm_iv_release($db, $bookingId);
    ivx_out(['ok' => true, 'action' => 'released', 'booking_id' => $bookingId], $isCli);
  }

  // reserve
  $start = (string)($param('start_time') ?? '');
  $end   = (string)($param('end_time') ?? '');
  $res   = hm_iv_reserve($db, $bookingId, $start, $end);

  if (!empty($res['conflict'])) {
    ivx_out([
      'ok'        => false,
      'error'     => 'slot_taken',
      'with'      => (string)($res['with'] ?? ''),
      'with_name' => (string)($res['with_name'] ?? ''),
    ], $isCli, 409);
  }
  if (!empty($res['error'])) {
    ivx_out(['ok' => false, 'error' => (string)$res['error']], $isCli, 400);
  }
  ivx_out([
    'ok' => true, 'action' => 'reserved', 'booking_id' => $bookingId,
    'start' => $res['start'] ?? $start, 'end' => $res['end'] ?? $end,
  ], $isCli);

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) hm_log_error('booking-slot.hourly failed', ['err' => $e->getMessage(), 'action' => $action, 'booking' => $bookingId]);
  ivx_out(['ok' => false, 'error' => hm_safe_msg('Request failed', $e)], $isCli, 500);
}
