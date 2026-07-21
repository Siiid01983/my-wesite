<?php
// ════════════════════════════════════════════════════════════════════════════
//  migrate-calendar-to-slotcap.php — one-time backfill of legacy day-closures
//
//  BACKGROUND
//  Day closures made on the admin MONTH ○△× calendar were historically written
//  ONLY to `calendar_availability` (status='full'/'closed'). The booking engine
//  (availability.php / create-booking.php / booking-status.php) reads ONLY
//  `slot_capacity`, so those closures never blocked a booking. The month calendar
//  now writes slot_capacity directly (CalendarService.syncDayClosure →
//  slot-capacity.php close-day). This script backfills the EXISTING legacy rows so
//  previously-closed days take effect too.
//
//  WHAT IT DOES  (idempotent, additive, reversible)
//    apply    : for every calendar_availability row with status IN (full,closed[,booked]),
//               close ALL FOUR bands (am/pm/ev/nt) for that date in slot_capacity
//               (is_closed=1, reason). Same effect as the 全日休止 admin action.
//    rollback : reopen exactly those same dates (is_closed=0) — the inverse.
//    (default): DRY-RUN — reports what it WOULD do; writes nothing.
//
//  'limited' rows are IGNORED (a soft display hint, not a closure).
//
//  RUN — preferred (cPanel → Terminal / SSH):
//      php hm-api/migrate-calendar-to-slotcap.php            # dry-run (no writes)
//      php hm-api/migrate-calendar-to-slotcap.php apply       # write closures
//      php hm-api/migrate-calendar-to-slotcap.php rollback    # reverse (reopen)
//
//  RUN — over HTTP (no shell): set 'admin_setup_token' in _config.php, then:
//      https://<host>/hm-api/migrate-calendar-to-slotcap.php?token=<t>              # dry-run
//      https://<host>/hm-api/migrate-calendar-to-slotcap.php?token=<t>&apply=1      # write
//      https://<host>/hm-api/migrate-calendar-to-slotcap.php?token=<t>&rollback=1   # reverse
//  Refuses over HTTP without a matching token. Safe to re-run (idempotent).
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_capacity.php';   // hm_cap_set / hm_cap_ensure_table / HM_CAP_BANDS

$isCli = (PHP_SAPI === 'cli');

function mig_out(array $payload, bool $isCli, int $status = 200): void {
  if ($isCli) {
    fwrite(STDOUT, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL);
  } else {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  }
  exit;
}

// ── Access control: CLI trusted; HTTP requires the one-time setup token ───────
$mode = 'dry-run';
if ($isCli) {
  $args = array_slice($argv, 1);
  if (in_array('apply', $args, true))         $mode = 'apply';
  elseif (in_array('rollback', $args, true))  $mode = 'rollback';
} else {
  require_once __DIR__ . '/_ratelimit.php';
  hm_rate_limit('migrate_cal_slotcap', 5, 60);
  $setup = (string)(hm_config()['admin_setup_token'] ?? '');
  $sent  = (string)($_GET['token'] ?? '');
  if ($setup === '' || !hash_equals($setup, $sent)) {
    mig_out(['ok' => false, 'error' => 'forbidden — set admin_setup_token in _config.php and pass ?token='], false, 403);
  }
  if (($_GET['apply'] ?? '') === '1')          $mode = 'apply';
  elseif (($_GET['rollback'] ?? '') === '1')   $mode = 'rollback';
}

// Closure reason stamped on backfilled bands (self-documenting in the admin UI).
const MIG_REASON = '休止（カレンダー移行）';

try {
  $db = hm_db();
  hm_cap_ensure_table($db);

  // Guard: calendar_availability must exist (it always does in a real install).
  if (!$db->query("SHOW TABLES LIKE 'calendar_availability'")->fetch()) {
    mig_out(['ok' => false, 'error' => "calendar_availability table not found"], $isCli, 500);
  }

  // Collect the legacy closed dates (full/closed/booked → a whole-day closure).
  $st = $db->prepare(
    "SELECT DISTINCT `date` AS d FROM calendar_availability
     WHERE LOWER(status) IN ('full','closed','booked')
     ORDER BY `date`"
  );
  $st->execute();
  $dates = [];
  foreach ($st as $r) {
    $d = (string)($r['d'] ?? '');
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) $dates[] = $d;
  }

  $closing = ($mode !== 'rollback');   // apply/dry-run target the CLOSED state; rollback reopens
  $willWrite = ($mode === 'apply' || $mode === 'rollback');

  $affected = [];
  foreach ($dates as $d) {
    // Report the resulting day-closed state we are (or would be) driving toward.
    $before = hm_cap_day_closed($db, $d);   // {closed, reason}
    if ($willWrite) {
      foreach (HM_CAP_BANDS as $b) {
        hm_cap_set($db, $d, $b, null, $closing, $closing ? MIG_REASON : null);
      }
    }
    $after = $willWrite ? hm_cap_day_closed($db, $d) : ['closed' => $closing];
    $affected[] = [
      'date'         => $d,
      'was_closed'   => (bool)($before['closed'] ?? false),
      'now_closed'   => (bool)($after['closed'] ?? false),
    ];
  }

  mig_out([
    'ok'        => true,
    'mode'      => $mode,
    'wrote'     => $willWrite,
    'reason'    => MIG_REASON,
    'dates'     => count($dates),
    'bands_per_day' => count(HM_CAP_BANDS),
    'writes'    => $willWrite ? (count($dates) * count(HM_CAP_BANDS)) : 0,
    'detail'    => $affected,
    'note'      => $willWrite
      ? ($closing ? 'Legacy day-closures written into slot_capacity.' : 'Legacy day-closures reopened in slot_capacity.')
      : 'DRY-RUN — no writes. Re-run with `apply` (or ?apply=1) to commit, `rollback` to reverse.',
  ], $isCli);

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) hm_log_error('migrate-calendar-to-slotcap failed', ['err' => $e->getMessage(), 'mode' => $mode]);
  mig_out(['ok' => false, 'error' => hm_safe_msg('Migration failed', $e)], $isCli, 500);
}
