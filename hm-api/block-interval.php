<?php
// ════════════════════════════════════════════════════════════════════════════
//  block-interval.php — Manual ARBITRARY-RANGE calendar blocking (admin, hourly)
//
//  The interval counterpart to block-slot.php. Where block-slot.php blocks a whole
//  BAND (am/pm/ev/nt) via a booking_slots row, this blocks an arbitrary time RANGE
//  by writing an `admin_blocked` row into the `bookings` table with start_at/end_at
//  set. Because _intervals.php's hm_iv_reserve() counts every non-cancelled row
//  with an interval as a potential conflict, a block automatically prevents
//  overlapping bookings AND shows up in availability.php's `intervals` (so the grid
//  renders it as busy) — no new table needed.
//
//  ── Gate ────────────────────────────────────────────────────────────────────
//  Requires hourly to be live (hm_iv_active = 'hourly_enabled' flag ON AND the
//  bookings.start_at column migrated). Otherwise every action returns
//  'hourly_disabled' and writes nothing — dormant + deploy-order-safe, exactly
//  like create-booking / availability.
//
//  ── Auth (dual gate — identical to block-slot.php) ──────────────────────────
//  1. Admin session token (header X-ADMIN-TOKEN), verified inline.
//  2. Fallback: admin_setup_token in _config.php as ?token= (cPanel/manual).
//  CLI is always trusted.
//
//  ── Actions (JSON body / GET / POST) ────────────────────────────────────────
//    block   { date, start_time, end_time, reason? }
//        start_time/end_time accept "HH:MM"("HH:MM:SS") — combined with date — or a
//        full "YYYY-MM-DD HH:MM[:SS]". Overlap-checked against real bookings AND
//        other blocks; a collision with a REAL booking → 409 slot_taken (no write).
//        Returns { ok, action:"blocked", id, start, end }.
//    unblock { id }
//        DELETE only WHERE status='admin_blocked' — NEVER removes a real booking.
//        Returns { ok, action:"unblocked", id, removed }.
//    list    { date }
//        Read-only: the day's busy intervals (orders + blocks), same shape as
//        availability.php `intervals`. Returns { ok, action:"list", date, intervals }.
//
//  ── Response (error) ────────────────────────────────────────────────────────
//    { ok:false, error:"hourly_disabled" }                    HTTP 409
//    { ok:false, error:"slot_taken", with, with_name }        HTTP 409
//    { ok:false, error:"..." }                                HTTP 4xx/5xx
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_slots.php';       // hm_slot_uuid()
require_once __DIR__ . '/_intervals.php';   // hm_iv_active / hm_iv_reserve / hm_iv_normalize / hm_iv_day

$isCli = (PHP_SAPI === 'cli');

function bx_out(array $payload, bool $isCli, int $status = 200): void {
  if ($isCli) {
    fwrite(STDOUT, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    exit;
  }
  hm_json($payload, $status);
}

// Combine a bare "HH:MM[:SS]" with the date; pass a full datetime through untouched.
function bx_combine(string $date, $timeVal): string {
  $t = trim((string)$timeVal);
  if ($t === '') return '';
  if (preg_match('/^\d{1,2}:\d{2}(:\d{2})?$/', $t)) return $date . ' ' . $t;
  return $t;
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
  // CLI:  php block-interval.php <action> <date> <start> <end> [reason]
  $a = array_slice($argv, 1);
  foreach (['action', 'date', 'start_time', 'end_time', 'reason'] as $i => $k) {
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
  hm_rate_limit('block_interval', 30, 60);   // admin action: max 30 / IP / minute
}

// ── Dual auth gate (mirror block-slot.php) ───────────────────────────────────
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
    if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('block_interval');
    bx_out(['ok' => false, 'error' => 'forbidden — admin session (X-ADMIN-TOKEN) or ?token=<admin_setup_token> required'], false, 403);
  }
}

// ── Validate action ──────────────────────────────────────────────────────────
$action = strtolower(trim((string)($param('action') ?? '')));
if (!in_array($action, ['block', 'unblock', 'list'], true)) {
  bx_out(['ok' => false, 'error' => "invalid action — use 'block', 'unblock', or 'list'"], $isCli, 400);
}

try {
  $db = hm_db();

  // ── Gate: hourly must be live (flag ON + migration run) ──────────────────────
  if (!hm_iv_active($db)) {
    bx_out(['ok' => false, 'error' => 'hourly_disabled — enable hourly_enabled and run the interval migration first'], $isCli, 409);
  }

  // ── unblock: delete an admin_blocked row by id (status-guarded) ──────────────
  if ($action === 'unblock') {
    $id = trim((string)($param('id') ?? ''));
    if ($id === '') bx_out(['ok' => false, 'error' => 'id required'], $isCli, 400);
    $del = $db->prepare("DELETE FROM bookings WHERE id = ? AND status = 'admin_blocked'");
    $del->execute([$id]);
    bx_out(['ok' => true, 'action' => 'unblocked', 'id' => $id, 'removed' => $del->rowCount()], $isCli);
  }

  // ── validate date (block + list both need it) ────────────────────────────────
  $date = trim((string)($param('date') ?? ''));
  $parsed = DateTime::createFromFormat('!Y-m-d', $date);
  $de = DateTime::getLastErrors();
  $validDate = $parsed instanceof DateTime
    && $parsed->format('Y-m-d') === $date
    && (($de['warning_count'] ?? 0) === 0)
    && (($de['error_count'] ?? 0) === 0);
  if (!$validDate) {
    bx_out(['ok' => false, 'error' => 'invalid date — expected YYYY-MM-DD'], $isCli, 400);
  }

  // ── list: the day's busy intervals (orders + blocks), read-only ──────────────
  if ($action === 'list') {
    bx_out(['ok' => true, 'action' => 'list', 'date' => $date, 'intervals' => hm_iv_day($db, $date)], $isCli);
  }

  // ── block: insert an admin_blocked interval, overlap-guarded ─────────────────
  $start = hm_iv_normalize(bx_combine($date, $param('start_time')));
  $end   = hm_iv_normalize(bx_combine($date, $param('end_time')));
  if ($start === null) bx_out(['ok' => false, 'error' => 'invalid start_time — expected HH:MM or a full datetime'], $isCli, 400);
  if ($end === null)   bx_out(['ok' => false, 'error' => 'invalid end_time — expected HH:MM or a full datetime'], $isCli, 400);
  if ($start >= $end)  bx_out(['ok' => false, 'error' => 'end_time must be after start_time'], $isCli, 400);
  if (substr($start, 0, 10) !== $date || substr($end, 0, 10) !== $date) {
    bx_out(['ok' => false, 'error' => 'start_time and end_time must fall on the given date'], $isCli, 400);
  }

  $reason  = trim((string)($param('reason') ?? ''));
  $blockId = hm_slot_uuid();

  // Insert the block row first (start_at/end_at NULL), then let hm_iv_reserve set
  // the interval AND run the overlap check inside ONE transaction. hm_iv_reserve
  // excludes the row's own id, so a conflict can only be another booking/block.
  $db->beginTransaction();
  try {
    $ins = $db->prepare(
      "INSERT INTO bookings (id, customer_name, status, booking_date, notes, created_at)
       VALUES (?, '（ブロック）', 'admin_blocked', ?, ?, NOW())"
    );
    $ins->execute([$blockId, $date, ($reason !== '' ? $reason : null)]);

    $res = hm_iv_reserve($db, $blockId, $start, $end);   // runs within this tx (ownTx=false)
    if (!empty($res['error'])) {
      $db->rollBack();
      bx_out(['ok' => false, 'error' => (string)$res['error']], $isCli, 400);
    }
    if (!empty($res['conflict'])) {
      $db->rollBack();
      bx_out([
        'ok'        => false,
        'error'     => 'slot_taken',
        'with'      => (string)($res['with'] ?? ''),
        'with_name' => (string)($res['with_name'] ?? ''),
      ], $isCli, 409);
    }
    $db->commit();
  } catch (Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    throw $e;
  }

  bx_out(['ok' => true, 'action' => 'blocked', 'id' => $blockId, 'start' => $start, 'end' => $end], $isCli);

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) {
    hm_log_error('block-interval failed', ['err' => $e->getMessage(), 'action' => $action ?? '', 'date' => $date ?? '']);
  }
  bx_out(['ok' => false, 'error' => hm_safe_msg('Request failed', $e)], $isCli, 500);
}
