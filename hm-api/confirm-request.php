<?php
// ════════════════════════════════════════════════════════════════════════════
//  confirm-request.php — Admin confirm / reject for the Client-Request model
//
//  In the Client-Request booking model a customer submits a PENDING request with
//  preferred appointment time(s) (preferred_start_1/2) and NO fixed duration. The
//  admin reviews it and either:
//    • CONFIRM — decides the final Start + End, which is overlap-checked against
//      existing confirmed bookings/blocks (via _intervals.php hm_iv_reserve) and,
//      on success, sets bookings.start_at/end_at AND status='confirmed' — all in
//      ONE transaction. A collision → 409 slot_taken, nothing changes.
//    • REJECT — sets status='rejected' (start_at/end_at stay NULL).
//
//  ── Gate ────────────────────────────────────────────────────────────────────
//  Requires hourly to be live (hm_iv_active = 'hourly_enabled' ON AND migrated).
//  Otherwise returns 'hourly_disabled' and changes nothing — dormant + deploy-
//  order-safe like create-booking / availability / block-interval.
//
//  ── Auth (dual gate — identical to block-interval.php / block-slot.php) ──────
//  1. Admin session token (header X-ADMIN-TOKEN), verified inline.
//  2. Fallback: admin_setup_token in _config.php as ?token= (cPanel/manual).
//  CLI is always trusted.
//
//  ── Actions (JSON body / GET / POST) ────────────────────────────────────────
//    confirm { booking_id, start_time, end_time }
//        start_time/end_time are full datetimes (datetime-local / ISO 8601).
//        → { ok, action:"confirmed", booking_id, start, end, status:"confirmed" }
//        → 409 { ok:false, error:"slot_taken", with, with_name }  on overlap
//    reject  { booking_id }
//        → { ok, action:"rejected", booking_id, status:"rejected" }
//
//  ── Error responses ─────────────────────────────────────────────────────────
//    { ok:false, error:"hourly_disabled" }        HTTP 409
//    { ok:false, error:"not_found" }               HTTP 404
//    { ok:false, error:"..." }                     HTTP 4xx/5xx
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_intervals.php';   // hm_iv_active / hm_iv_reserve / hm_iv_release

$isCli = (PHP_SAPI === 'cli');

function cr_out(array $payload, bool $isCli, int $status = 200): void {
  if ($isCli) {
    fwrite(STDOUT, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    exit;
  }
  hm_json($payload, $status);
}

// ── Params from JSON body / GET / POST ───────────────────────────────────────
$body = [];
if (!$isCli) {
  $raw = file_get_contents('php://input');
  if ($raw !== '' && $raw !== false) {
    $j = json_decode($raw, true);
    if (is_array($j)) $body = $j;
  }
}
$argMap = [];
if ($isCli) {
  // CLI:  php confirm-request.php <action> <booking_id> [start] [end]
  $a = array_slice($argv, 1);
  foreach (['action', 'booking_id', 'start_time', 'end_time'] as $i => $k) {
    if (isset($a[$i])) $argMap[$k] = $a[$i];
  }
}
$param = function (string $k) use ($body, $argMap) {
  if (array_key_exists($k, $argMap)) return $argMap[$k];
  if (isset($_GET[$k]))              return $_GET[$k];
  if (isset($_POST[$k]))             return $_POST[$k];
  if (array_key_exists($k, $body))   return $body[$k];
  return null;
};

// ── HTTP guards ──────────────────────────────────────────────────────────────
if (!$isCli) {
  require_once __DIR__ . '/_ratelimit.php';
  hm_cors();
  hm_require_api_key();
  hm_rate_limit('confirm_request', 30, 60);   // admin action: max 30 / IP / minute
}

// ── Dual auth gate (mirror block-interval.php) ───────────────────────────────
if (!$isCli) {
  $authed = false;
  $tok = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  if (is_string($tok) && $tok !== '') {
    $pl = hm_admin_token_verify($tok);
    if ($pl !== null && ($pl['role'] ?? '') === 'admin' && hm_admin_token_account_valid($pl)) {
      $authed = true;
    }
  }
  if (!$authed) {
    $setup = (string)(hm_config()['admin_setup_token'] ?? '');
    $sent  = (string)($param('token') ?? '');
    if ($setup !== '' && hash_equals($setup, $sent)) $authed = true;
  }
  if (!$authed) {
    if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('confirm_request');
    cr_out(['ok' => false, 'error' => 'forbidden — admin session (X-ADMIN-TOKEN) or ?token=<admin_setup_token> required'], false, 403);
  }
}

// ── Validate action + booking_id ─────────────────────────────────────────────
$action = strtolower(trim((string)($param('action') ?? '')));
if (!in_array($action, ['confirm', 'reject'], true)) {
  cr_out(['ok' => false, 'error' => "invalid action — use 'confirm' or 'reject'"], $isCli, 400);
}
$bookingId = trim((string)($param('booking_id') ?? ''));
if ($bookingId === '') {
  cr_out(['ok' => false, 'error' => 'booking_id required'], $isCli, 400);
}

try {
  $db = hm_db();

  // ── Gate: hourly must be live ────────────────────────────────────────────────
  if (!hm_iv_active($db)) {
    cr_out(['ok' => false, 'error' => 'hourly_disabled — enable hourly_enabled and run the interval migration first'], $isCli, 409);
  }

  // ── The booking must exist and be a real booking (not an admin block) ────────
  $q = $db->prepare('SELECT status FROM bookings WHERE id = ? LIMIT 1');
  $q->execute([$bookingId]);
  $curStatus = $q->fetchColumn();
  if ($curStatus === false) {
    cr_out(['ok' => false, 'error' => 'not_found'], $isCli, 404);
  }
  if ((string)$curStatus === 'admin_blocked') {
    cr_out(['ok' => false, 'error' => 'cannot confirm/reject an admin block'], $isCli, 400);
  }

  // ── reject: set status='rejected' (interval left NULL) ───────────────────────
  if ($action === 'reject') {
    $up = $db->prepare("UPDATE bookings SET status = 'rejected' WHERE id = ?");
    $up->execute([$bookingId]);
    cr_out(['ok' => true, 'action' => 'rejected', 'booking_id' => $bookingId, 'status' => 'rejected'], $isCli);
  }

  // ── confirm: set the admin's final start/end (overlap-checked) + confirm ─────
  $start = (string)($param('start_time') ?? '');
  $end   = (string)($param('end_time') ?? '');

  $db->beginTransaction();
  try {
    $res = hm_iv_reserve($db, $bookingId, $start, $end);   // runs within this tx (ownTx=false)
    if (!empty($res['error'])) {
      $db->rollBack();
      cr_out(['ok' => false, 'error' => (string)$res['error']], $isCli, 400);
    }
    if (!empty($res['conflict'])) {
      $db->rollBack();
      cr_out([
        'ok'        => false,
        'error'     => 'slot_taken',
        'with'      => (string)($res['with'] ?? ''),
        'with_name' => (string)($res['with_name'] ?? ''),
      ], $isCli, 409);
    }
    $up = $db->prepare("UPDATE bookings SET status = 'confirmed' WHERE id = ?");
    $up->execute([$bookingId]);
    $db->commit();
  } catch (Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    throw $e;
  }

  cr_out([
    'ok' => true, 'action' => 'confirmed', 'booking_id' => $bookingId,
    'start' => $res['start'] ?? $start, 'end' => $res['end'] ?? $end, 'status' => 'confirmed',
  ], $isCli);

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) {
    hm_log_error('confirm-request failed', ['err' => $e->getMessage(), 'action' => $action ?? '', 'booking' => $bookingId ?? '']);
  }
  cr_out(['ok' => false, 'error' => hm_safe_msg('Request failed', $e)], $isCli, 500);
}
