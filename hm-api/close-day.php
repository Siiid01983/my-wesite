<?php
// ════════════════════════════════════════════════════════════════════════════
//  close-day.php — admin CRUD for whole-day CLOSURES (timeline scheduler)
//
//  Closing a day removes ALL availability for that date (explicit windows AND the
//  default business-hours window): availability.php then returns no slots and the
//  customer sees "unavailable" — the internal reason is NEVER exposed publicly.
//  Reason is REQUIRED (Holiday / Staff vacation / Truck maintenance / Manual
//  reservation / Emergency stop / custom text). Stored with closed_by + closed_at.
//
//  Auth mirrors availability-windows.php exactly (dual gate: X-ADMIN-TOKEN, or
//  ?token=admin_setup_token; CLI trusted).
//
//  Actions (JSON body / GET / POST):
//    get    { date }            → { closed:bool, info:{day,reason,closed_by,closed_at}|null }
//    range  { from, to }        → { closed:[{day,reason,closed_by,closed_at}, …] }
//    close  { date, reason }    → close the day (reason required)
//    reopen { date }            → reopen the day
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_closedays.php';

$isCli = (PHP_SAPI === 'cli');

function cd_out(array $payload, bool $isCli, int $status = 200): void {
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

$closedBy = 'admin';
if (!$isCli) {
  require_once __DIR__ . '/_ratelimit.php';
  hm_cors();
  hm_require_api_key();
  hm_rate_limit('close_day', 60, 60);

  // ── Dual auth gate (identical to availability-windows.php) ─────────────────
  $authed = false;
  $tok = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  if (is_string($tok) && $tok !== '' && function_exists('hm_admin_token_verify')) {
    $pl = hm_admin_token_verify($tok);
    if ($pl !== null && ($pl['role'] ?? '') === 'admin'
        && (!function_exists('hm_admin_token_account_valid') || hm_admin_token_account_valid($pl))) {
      $authed = true;
      $closedBy = (string)($pl['email'] ?? $pl['sub'] ?? $pl['name'] ?? 'admin');
    }
  }
  if (!$authed) {
    $setup = (string)(hm_config()['admin_setup_token'] ?? '');
    $sent  = (string)($param('token') ?? '');
    if ($setup !== '' && hash_equals($setup, $sent)) { $authed = true; $closedBy = 'setup-token'; }
  }
  if (!$authed) {
    if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('close_day');
    cd_out(['ok' => false, 'error' => 'forbidden — admin session (X-ADMIN-TOKEN) or ?token= required'], false, 403);
  }
}

$action = strtolower(trim((string)($param('action') ?? 'get')));
if (!in_array($action, ['get', 'range', 'close', 'reopen'], true)) {
  cd_out(['ok' => false, 'error' => 'invalid action — use get|range|close|reopen'], $isCli, 400);
}

$validDay = function (string $d): ?string {
  $p = DateTime::createFromFormat('!Y-m-d', $d);
  $e = DateTime::getLastErrors();
  $ok = $p instanceof DateTime && $p->format('Y-m-d') === $d
     && (($e['warning_count'] ?? 0) === 0) && (($e['error_count'] ?? 0) === 0);
  return $ok ? $d : null;
};

try {
  $db = hm_db();
  hm_closedays_ensure_table($db);

  if ($action === 'get') {
    $date = $validDay(trim((string)($param('date') ?? '')));
    if ($date === null) cd_out(['ok' => false, 'error' => 'date required — YYYY-MM-DD'], $isCli, 400);
    $info = hm_day_close_info($db, $date);
    cd_out(['ok' => true, 'date' => $date, 'closed' => $info !== null, 'info' => $info], $isCli);
  }

  if ($action === 'range') {
    $from = $validDay(trim((string)($param('from') ?? '')));
    $to   = $validDay(trim((string)($param('to') ?? '')));
    if ($from === null || $to === null) cd_out(['ok' => false, 'error' => 'from/to required — YYYY-MM-DD'], $isCli, 400);
    if (strcmp($from, $to) > 0) { $t = $from; $from = $to; $to = $t; }
    cd_out(['ok' => true, 'from' => $from, 'to' => $to, 'closed' => hm_closedays_range($db, $from, $to)], $isCli);
  }

  if ($action === 'close') {
    $date = $validDay(trim((string)($param('date') ?? '')));
    if ($date === null) cd_out(['ok' => false, 'error' => 'date required — YYYY-MM-DD'], $isCli, 400);
    $reason = trim((string)($param('reason') ?? ''));
    if ($reason === '') cd_out(['ok' => false, 'error' => 'reason required'], $isCli, 400);
    $res = hm_day_close($db, $date, $reason, $closedBy);
    if (isset($res['error'])) cd_out(['ok' => false, 'error' => $res['error']], $isCli, 400);
    cd_out(['ok' => true, 'action' => 'close'] + $res, $isCli);
  }

  if ($action === 'reopen') {
    $date = $validDay(trim((string)($param('date') ?? '')));
    if ($date === null) cd_out(['ok' => false, 'error' => 'date required — YYYY-MM-DD'], $isCli, 400);
    $res = hm_day_reopen($db, $date);
    if (isset($res['error'])) cd_out(['ok' => false, 'error' => $res['error']], $isCli, 400);
    // Never report a false success: if the day is somehow still closed, surface it so
    // the client shows an error instead of a misleading "reopened" that leaves it stuck.
    if (!empty($res['still_closed'])) {
      cd_out(['ok' => false, 'error' => 'reopen failed — day still closed', 'date' => $date], $isCli, 500);
    }
    cd_out(['ok' => true, 'action' => 'reopen'] + $res, $isCli);
  }

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) hm_log_error('close-day failed', ['err' => $e->getMessage(), 'action' => $action]);
  cd_out(['ok' => false, 'error' => hm_safe_msg('Request failed', $e)], $isCli, 500);
}
