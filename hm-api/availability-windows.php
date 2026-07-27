<?php
// ════════════════════════════════════════════════════════════════════════════
//  availability-windows.php — admin CRUD for allow-list working periods (timeline)
//
//  The admin draws AVAILABLE periods on the hourly timeline; this endpoint
//  persists them in `availability_windows` (via _windows.php). Customers can only
//  book inside these windows (create-booking + availability enforce/serve them
//  once 'timeline_enabled' is ON). Like slot-capacity.php / blocks.php, the
//  MANAGEMENT endpoint works regardless of the feature flag, so the admin can lay
//  out windows before the timeline goes live.
//
//  ── Auth (dual gate — identical to slot-capacity.php / block-interval.php) ────
//    1. Admin session token (header X-ADMIN-TOKEN), verified inline.
//    2. Fallback: admin_setup_token in _config.php as ?token= (cPanel/manual).
//    CLI is always trusted.
//
//  ── Actions (JSON body / GET / POST) ────────────────────────────────────────
//    get    { date }                          → windows for a day + config
//    range  { from, to }                      → windows across [from,to] (≤366d)
//    slots  { date, duration? }               → bookable start times (preview)
//    add    { date, start_time, end_time } | { start, end }  → create a window
//    update { id, date, start_time, end_time } | { id, start, end }  → move/resize
//    delete { id }                            → remove a window
//
//  Response envelope: { ok:true, … } | { ok:false, error:"…" } (+ HTTP 4xx/5xx).
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_windows.php';

$isCli = (PHP_SAPI === 'cli');

function aw_out(array $payload, bool $isCli, int $status = 200): void {
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
  require_once __DIR__ . '/_ratelimit.php';
  hm_cors();
  hm_require_api_key();
  hm_rate_limit('availability_windows', 60, 60);
}

// ── Dual auth gate ───────────────────────────────────────────────────────────
if (!$isCli) {
  $authed = false;
  $tok = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  if (is_string($tok) && $tok !== '' && function_exists('hm_admin_token_verify')) {
    $pl = hm_admin_token_verify($tok);
    if ($pl !== null && ($pl['role'] ?? '') === 'admin'
        && (!function_exists('hm_admin_token_account_valid') || hm_admin_token_account_valid($pl))) {
      $authed = true;
    }
  }
  if (!$authed) {
    $setup = (string)(hm_config()['admin_setup_token'] ?? '');
    $sent  = (string)($param('token') ?? '');
    if ($setup !== '' && hash_equals($setup, $sent)) $authed = true;
  }
  if (!$authed) {
    if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('availability_windows');
    aw_out(['ok' => false, 'error' => 'forbidden — admin session (X-ADMIN-TOKEN) or ?token= required'], false, 403);
  }
}

$action = strtolower(trim((string)($param('action') ?? 'get')));
if (!in_array($action, ['get', 'range', 'slots', 'add', 'update', 'delete'], true)) {
  aw_out(['ok' => false, 'error' => 'invalid action — use get|range|slots|add|update|delete'], $isCli, 400);
}

// Strict YYYY-MM-DD validator.
$validDay = function (string $d): ?string {
  $p = DateTime::createFromFormat('!Y-m-d', $d);
  $e = DateTime::getLastErrors();
  $ok = $p instanceof DateTime && $p->format('Y-m-d') === $d
     && (($e['warning_count'] ?? 0) === 0) && (($e['error_count'] ?? 0) === 0);
  return $ok ? $d : null;
};

// Resolve start/end from either {start,end} full datetimes or {date,start_time,end_time}.
$resolveRange = function () use ($param, $validDay): array {
  $start = trim((string)($param('start') ?? ''));
  $end   = trim((string)($param('end') ?? ''));
  if ($start !== '' && $end !== '') return [$start, $end];
  $date = $validDay(trim((string)($param('date') ?? '')));
  $s = trim((string)($param('start_time') ?? ''));
  $e = trim((string)($param('end_time') ?? ''));
  if ($date !== null && preg_match('/^\d{1,2}:\d{2}$/', $s) && preg_match('/^\d{1,2}:\d{2}$/', $e)) {
    return [$date . ' ' . $s . ':00', $date . ' ' . $e . ':00'];
  }
  return ['', ''];
};

try {
  $db = hm_db();
  hm_windows_ensure_table($db);

  if ($action === 'get') {
    $date = $validDay(trim((string)($param('date') ?? '')));
    if ($date === null) aw_out(['ok' => false, 'error' => 'date required — YYYY-MM-DD'], $isCli, 400);
    [$dayStart, $dayEnd] = hm_timeline_day_bounds();
    aw_out([
      'ok' => true, 'date' => $date,
      'windows' => hm_windows_day($db, $date),
      'config'  => [
        'day_start'        => $dayStart,
        'day_end'          => $dayEnd,
        'step'             => hm_timeline_step(),
        'durations'        => hm_timeline_durations(),
        'default_duration' => hm_timeline_default_duration(),
        'active'           => hm_timeline_active($db),
      ],
    ], $isCli);
  }

  if ($action === 'range') {
    $from = $validDay(trim((string)($param('from') ?? '')));
    $to   = $validDay(trim((string)($param('to') ?? '')));
    if ($from === null || $to === null) aw_out(['ok' => false, 'error' => 'from/to required — YYYY-MM-DD'], $isCli, 400);
    if (strcmp($from, $to) > 0) { $t = $from; $from = $to; $to = $t; }
    if ((strtotime($to) - strtotime($from)) / 86400 > 366) aw_out(['ok' => false, 'error' => 'range too large (max 366 days)'], $isCli, 400);
    // Also return SCHEDULED bookings in range (start_at set, not cancelled) so the
    // admin timeline can render + drag-reschedule them. Cheap single query.
    $bookings = [];
    try {
      $bs = $db->prepare(
        "SELECT id, customer_name, status, start_at, end_at FROM bookings
          WHERE start_at IS NOT NULL AND end_at IS NOT NULL
            AND start_at >= ? AND start_at <= ?
            AND status NOT IN ('キャンセル','cancelled','admin_blocked')
          ORDER BY start_at ASC"
      );
      $bs->execute([$from . ' 00:00:00', $to . ' 23:59:59']);
      $bookings = $bs->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $be) { $bookings = []; }   // start_at column may not exist pre-migration
    // Manual admin BLOCKS — a SEPARATE entity in the `availability_blocks` table
    // (NOT bookings). Rendered distinctly on the timeline with their reason + memo.
    // Same {id,reason,memo,start_at,end_at} shape the frontend already consumes.
    $blocks = hm_blocks_between($db, $from . ' 00:00:00', $to . ' 23:59:59');
    aw_out(['ok' => true, 'from' => $from, 'to' => $to,
            'windows'  => hm_windows_range($db, $from, $to),
            'bookings' => $bookings,
            'blocks'   => $blocks,
            'closed'   => hm_closedays_range($db, $from, $to)], $isCli);
  }

  if ($action === 'slots') {
    $date = $validDay(trim((string)($param('date') ?? '')));
    if ($date === null) aw_out(['ok' => false, 'error' => 'date required — YYYY-MM-DD'], $isCli, 400);
    $dur = (int)($param('duration') ?? hm_timeline_default_duration());
    if ($dur <= 0) $dur = hm_timeline_default_duration();
    aw_out(['ok' => true, 'date' => $date, 'duration' => $dur, 'slots' => hm_timeline_slots($db, $date, $dur)], $isCli);
  }

  if ($action === 'add') {
    [$start, $end] = $resolveRange();
    if ($start === '' || $end === '') aw_out(['ok' => false, 'error' => 'start/end required (full datetime, or date+start_time+end_time)'], $isCli, 400);
    $res = hm_windows_add($db, $start, $end);
    if (isset($res['error'])) aw_out(['ok' => false, 'error' => $res['error']], $isCli, 400);
    aw_out(['ok' => true, 'action' => 'add'] + $res, $isCli);
  }

  if ($action === 'update') {
    $id = trim((string)($param('id') ?? ''));
    if ($id === '') aw_out(['ok' => false, 'error' => 'id required'], $isCli, 400);
    [$start, $end] = $resolveRange();
    if ($start === '' || $end === '') aw_out(['ok' => false, 'error' => 'start/end required'], $isCli, 400);
    $res = hm_windows_update($db, $id, $start, $end);
    if (isset($res['error'])) aw_out(['ok' => false, 'error' => $res['error']], $isCli, ($res['error'] === 'not found' ? 404 : 400));
    aw_out(['ok' => true, 'action' => 'update'] + $res, $isCli);
  }

  if ($action === 'delete') {
    $id = trim((string)($param('id') ?? ''));
    if ($id === '') aw_out(['ok' => false, 'error' => 'id required'], $isCli, 400);
    aw_out(['ok' => true, 'action' => 'delete'] + hm_windows_delete($db, $id), $isCli);
  }

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) hm_log_error('availability-windows failed', ['err' => $e->getMessage(), 'action' => $action]);
  aw_out(['ok' => false, 'error' => hm_safe_msg('Request failed', $e)], $isCli, 500);
}
