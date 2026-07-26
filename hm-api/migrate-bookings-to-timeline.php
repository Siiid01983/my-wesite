<?php
// ════════════════════════════════════════════════════════════════════════════
//  migrate-bookings-to-timeline.php — ONE-TIME conversion of legacy band bookings
//  to the timeline (interval) format. Run ONCE per environment, THEN the band
//  runtime can be deleted (nothing left needs band logic).
//
//  WHAT IT DOES  (idempotent, additive, reversible)
//    For every non-cancelled booking with start_at IS NULL that carries a band in
//    its notes (午前/午後/夕方/夜間 → am/pm/ev/nt), set:
//        start_at = booking_date + band start   (am 09 · pm 12 · ev 15 · nt 18)
//        end_at   = booking_date + band end     (am 12 · pm 15 · ev 18 · nt 21)
//        duration_min = end - start (180)
//    → the booking becomes a normal 3-hour timeline booking.
//
//    Bookings with NO band (時間指定なし / flexible) are left unscheduled
//    (start_at NULL) — they never required band logic and the admin assigns a time
//    on the timeline. So after this runs, NO booking needs the band engine.
//
//  RUN — CLI (preferred):   php hm-api/migrate-bookings-to-timeline.php          # dry-run
//                           php hm-api/migrate-bookings-to-timeline.php apply     # convert
//                           php hm-api/migrate-bookings-to-timeline.php rollback  # undo (clears the interval)
//  RUN — HTTP (no shell):   ?token=<admin_setup_token>[&apply=1|&rollback=1]  (or X-ADMIN-TOKEN)
//
//  ⚠ BACK UP THE DATABASE FIRST. Reversible: rollback re-NULLs ONLY the rows this
//  migration converted (tagged in the migration log below), so a booking that
//  already had an interval is never touched.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_slots.php';   // hm_slot_band_from_notes

$isCli = (PHP_SAPI === 'cli');

function mbt_out(array $p, bool $isCli, int $status = 200): void {
  if ($isCli) { fwrite(STDOUT, json_encode($p, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL); exit; }
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($p, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

$mode = 'dry-run';
if ($isCli) {
  $args = array_slice($argv, 1);
  if (in_array('apply', $args, true))        $mode = 'apply';
  elseif (in_array('rollback', $args, true)) $mode = 'rollback';
} else {
  require_once __DIR__ . '/_ratelimit.php';
  hm_rate_limit('migrate_bookings_timeline', 5, 60);
  $authed = false;
  $tok = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  if (is_string($tok) && $tok !== '' && function_exists('hm_admin_token_verify')) {
    $pl = hm_admin_token_verify($tok);
    if ($pl !== null && ($pl['role'] ?? '') === 'admin'
        && (!function_exists('hm_admin_token_account_valid') || hm_admin_token_account_valid($pl))) $authed = true;
  }
  if (!$authed) {
    $setup = (string)(hm_config()['admin_setup_token'] ?? '');
    $sent  = (string)($_GET['token'] ?? ($_POST['token'] ?? ''));
    if ($setup !== '' && hash_equals($setup, $sent)) $authed = true;
  }
  if (!$authed) mbt_out(['ok' => false, 'error' => 'forbidden — admin session (X-ADMIN-TOKEN) or ?token= required'], false, 403);
  if (($_GET['apply'] ?? ($_POST['apply'] ?? '')) === '1')       $mode = 'apply';
  elseif (($_GET['rollback'] ?? ($_POST['rollback'] ?? '')) === '1') $mode = 'rollback';
}

// Band → [startHH, endHH]. A band booking becomes this fixed 3-hour interval.
const MBT_BANDS = ['am' => ['09:00', '12:00'], 'pm' => ['12:00', '15:00'], 'ev' => ['15:00', '18:00'], 'nt' => ['18:00', '21:00']];
// Marker stamped in notes so rollback only touches rows THIS migration converted.
const MBT_TAG = "\n[HM_TL_MIGRATED]";

try {
  $db = hm_db();

  // Guard: the interval columns must exist (hourly/001 migration).
  $has = false;
  try { $has = (bool)$db->query("SHOW COLUMNS FROM bookings LIKE 'start_at'")->fetch(); } catch (Throwable $e) {}
  if (!$has) mbt_out(['ok' => false, 'error' => 'bookings.start_at missing — run migrations/hourly/001_bookings_hourly.sql first'], $isCli, 500);
  $hasDur = false;
  try { $hasDur = (bool)$db->query("SHOW COLUMNS FROM bookings LIKE 'duration_min'")->fetch(); } catch (Throwable $e) {}

  if ($mode === 'rollback') {
    // Undo: clear the interval ONLY on rows this migration tagged.
    $rows = $db->query("SELECT id, notes FROM bookings WHERE notes LIKE '%[HM_TL_MIGRATED]%' AND start_at IS NOT NULL")->fetchAll(PDO::FETCH_ASSOC);
    $n = 0;
    foreach ($rows as $r) {
      $clean = str_replace(MBT_TAG, '', (string)$r['notes']);
      $sql = 'UPDATE bookings SET start_at = NULL, end_at = NULL' . ($hasDur ? ', duration_min = NULL' : '') . ', notes = ? WHERE id = ?';
      $db->prepare($sql)->execute([$clean, $r['id']]);
      $n++;
    }
    mbt_out(['ok' => true, 'mode' => 'rollback', 'reverted' => $n], $isCli);
  }

  // Find legacy band bookings: no interval yet, not cancelled, with a real date.
  $st = $db->prepare(
    "SELECT id, booking_date, notes FROM bookings
      WHERE start_at IS NULL
        AND status NOT IN ('キャンセル','cancelled')
        AND booking_date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}'"
  );
  $st->execute();

  $converted = [];
  $skipped = 0;
  $writes = ($mode === 'apply');
  foreach ($st as $r) {
    $band = hm_slot_band_from_notes((string)($r['notes'] ?? ''));
    if ($band === null || !isset(MBT_BANDS[$band])) { $skipped++; continue; }   // flexible / no band → leave unscheduled
    $day   = substr((string)$r['booking_date'], 0, 10);
    $start = $day . ' ' . MBT_BANDS[$band][0] . ':00';
    $end   = $day . ' ' . MBT_BANDS[$band][1] . ':00';
    if ($writes) {
      $sets = ['start_at = ?', 'end_at = ?'];
      $vals = [$start, $end];
      if ($hasDur) { $sets[] = 'duration_min = ?'; $vals[] = 180; }
      $sets[] = 'notes = ?'; $vals[] = ((string)($r['notes'] ?? '')) . MBT_TAG;   // tag for reversibility
      $vals[] = $r['id'];
      $db->prepare('UPDATE bookings SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($vals);
    }
    $converted[] = ['id' => (string)$r['id'], 'band' => $band, 'start' => $start, 'end' => $end];
  }

  mbt_out([
    'ok' => true, 'mode' => $mode, 'wrote' => $writes,
    'converted' => count($converted), 'skipped_flexible' => $skipped,
    'detail' => $converted,
    'note' => $writes
      ? 'Legacy band bookings converted to 3-hour timeline intervals. No booking needs band logic now.'
      : 'DRY-RUN — no writes. Re-run with `apply` (or ?apply=1) to convert.',
  ], $isCli);

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) hm_log_error('migrate-bookings-to-timeline failed', ['err' => $e->getMessage(), 'mode' => $mode]);
  mbt_out(['ok' => false, 'error' => hm_safe_msg('Migration failed', $e)], $isCli, 500);
}
