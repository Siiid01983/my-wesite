<?php
// ════════════════════════════════════════════════════════════════════════════
//  backfill-slots.php — Smart Booking Engine, Phase 0 setup + one-time backfill
//
//  Non-destructive. Does three additive things, all idempotent:
//    1. CREATE TABLE IF NOT EXISTS booking_slots  (the lock table).
//    2. Mirror slot capacity into hm_data KV 'hm_slot_capacity' = {"perBand":1}
//       — TEMPORARY migration bridge (Stage B) so the server has a capacity
//       value to read in later phases; NOT the permanent source of truth.
//    3. Backfill booking_slots from existing ACTIVE bookings, deriving the
//       canonical band ID from each booking's packed notes (time:...).
//
//  DRY-RUN BY DEFAULT — reports what it would do and never writes rows/KV.
//  Pass ?apply=1 (HTTP) or `apply` arg (CLI) to actually write. The table is
//  ensured in both modes (CREATE IF NOT EXISTS is safe + lets you verify it).
//
//  RUN — preferred (cPanel → Terminal / SSH):
//      php hm-api/backfill-slots.php            # dry-run
//      php hm-api/backfill-slots.php apply       # write
//
//  RUN — over HTTP (no shell): set 'admin_setup_token' in _config.php, then:
//      https://<host>/hm-api/backfill-slots.php?token=<t>            # dry-run
//      https://<host>/hm-api/backfill-slots.php?token=<t>&apply=1    # write
//  Refuses over HTTP without a matching token. Safe to re-run (idempotent).
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_slots.php';

$isCli = (PHP_SAPI === 'cli');

function bfs_out(array $payload, bool $isCli, int $status = 200): void {
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
$apply = false;
if ($isCli) {
  $apply = in_array('apply', array_slice($argv, 1), true);
} else {
  require_once __DIR__ . '/_ratelimit.php';
  hm_rate_limit('backfill_slots', 5, 60);
  $setup = (string)(hm_config()['admin_setup_token'] ?? '');
  $sent  = (string)($_GET['token'] ?? '');
  if ($setup === '' || !hash_equals($setup, $sent)) {
    bfs_out(['ok' => false, 'error' => 'forbidden — set admin_setup_token in _config.php and pass ?token='], false, 403);
  }
  $apply = (($_GET['apply'] ?? '') === '1');
}

try {
  $db = hm_db();

  // 1) Ensure the lock table exists (idempotent, additive).
  hm_slot_ensure_table($db);

  // Guard: bookings table must exist (it always does in a real install).
  if (!$db->query("SHOW TABLES LIKE 'bookings'")->fetch()) {
    bfs_out(['ok' => false, 'error' => "bookings table not found — run schema.mysql.sql first"], $isCli, 500);
  }

  // 2) Scan ACTIVE bookings and derive canonical bands.
  $rows = $db->query(
    "SELECT id, booking_date, notes, status FROM bookings
     WHERE status NOT IN ('cancelled','キャンセル')"
  )->fetchAll();

  $scanned = count($rows);
  $noBand = 0; $withBand = 0; $badDate = 0;
  $slotMap = [];   // "date|band" => [booking_id, ...]  (detects legacy double-books)
  $plan = [];      // rows we would insert: [id(booking), date, band]

  foreach ($rows as $r) {
    $date = trim((string)($r['booking_date'] ?? ''));
    if ($date === '' || strtotime($date) === false) { $badDate++; continue; }
    $band = hm_slot_band_from_notes($r['notes'] ?? '');
    if ($band === null) { $noBand++; continue; }     // flexible / 時間指定なし → not locked
    $withBand++;
    $key = $date . '|' . $band;
    $slotMap[$key][] = (string)$r['id'];
    $plan[] = ['booking_id' => (string)$r['id'], 'date' => $date, 'band' => $band];
  }

  // Legacy double-books: >1 active booking mapping to the same (date, band).
  $conflicts = [];
  foreach ($slotMap as $key => $ids) {
    if (count($ids) > 1) $conflicts[$key] = $ids;
  }
  $distinctSlots = count($slotMap);

  $inserted = 0; $capacityWritten = false;
  if ($apply) {
    // INSERT IGNORE → idempotent on the UNIQUE(date,band,slot_index) key and
    // safely no-ops the 2nd member of any legacy double-book (reported above).
    $ins = $db->prepare(
      'INSERT IGNORE INTO booking_slots (id, booking_date, time_band, slot_index, booking_id, status)
       VALUES (?,?,?,0,?,?)'
    );
    foreach ($plan as $p) {
      $ins->execute([hm_slot_uuid(), $p['date'], $p['band'], $p['booking_id'], 'reserved']);
      $inserted += $ins->rowCount();   // 1 = inserted, 0 = already present / ignored
    }

    // 3) Capacity bridge (Stage B) — write once if absent; never overwrite an
    //    admin-tuned value. Stored in the existing hm_data KV (JSON value).
    $has = $db->prepare("SELECT 1 FROM hm_data WHERE `key` = 'hm_slot_capacity' LIMIT 1");
    $has->execute();
    if (!$has->fetch()) {
      $kv = $db->prepare("INSERT INTO hm_data (id, `key`, `value`) VALUES (?, 'hm_slot_capacity', ?)");
      $kv->execute([hm_slot_uuid(), json_encode(['perBand' => 1], JSON_UNESCAPED_UNICODE)]);
      $capacityWritten = true;
    }
    if (function_exists('hm_cache_invalidate_table')) { @hm_cache_invalidate_table('hm_data'); }
  }

  bfs_out([
    'ok'              => true,
    'mode'            => $apply ? 'apply' : 'dry-run',
    'table'           => 'booking_slots (ensured)',
    'scanned_active'  => $scanned,
    'with_band'       => $withBand,
    'no_band_skipped' => $noBand,       // flexible / 時間指定なし — intentionally not locked
    'bad_date_skipped'=> $badDate,
    'distinct_slots'  => $distinctSlots,
    'legacy_conflicts'=> array_slice($conflicts, 0, 25, true),  // (date|band) => [booking ids]
    'conflict_count'  => count($conflicts),
    'inserted'        => $apply ? $inserted : null,
    'would_insert'    => $apply ? null : $distinctSlots,
    'capacity_bridge' => $apply ? ($capacityWritten ? 'written (perBand=1)' : 'already present') : 'skipped (dry-run)',
    'note'            => $apply
      ? 'Backfill applied. Re-running is safe (idempotent). Review legacy_conflicts — those are pre-existing same-band double-books in historical data.'
      : 'DRY-RUN only — no rows or KV written. Review legacy_conflicts, then re-run with apply to write.',
  ], $isCli);

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) hm_log_error('backfill-slots failed', ['err' => $e->getMessage()]);
  bfs_out(['ok' => false, 'error' => 'backfill failed: ' . $e->getMessage()], $isCli, 500);
}
