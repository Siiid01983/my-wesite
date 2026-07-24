<?php
// ════════════════════════════════════════════════════════════════════════════
//  slot-capacity-engine.test.php — booking-engine invariants that back the
//  "no duplicate reservation" + "closed day/band hidden from availability" QA
//  items. Exercises the pure-SELECT validation layer (hm_cap_day_closed /
//  hm_cap_confirm_check / hm_cap_count) — the SAME functions availability.php,
//  booking-status.php and reschedule.php call. (hm_cap_reserve's SELECT … FOR
//  UPDATE is MySQL-only and covered by tests/slot-safe-drive.sh, not here.)
//  In-memory SQLite; skips gracefully if pdo_sqlite is absent. Run:
//  php tests/slot-capacity-engine.test.php
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/../hm-api/_capacity.php';

$fail = 0; $pass = 0;
function chk(string $label, $got, $want) {
  global $fail, $pass;
  $ok = ($got === $want);
  $ok ? $pass++ : $fail++;
  printf("  [%s] %-56s got=%-12s want=%-12s\n", $ok ? 'ok' : 'XX', $label, var_export($got, true), var_export($want, true));
}

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
  echo "SKIP: pdo_sqlite not available in this PHP build (runs in CI)\n";
  exit(0);
}

$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec("CREATE TABLE slot_capacity (booking_date TEXT, time_band TEXT, capacity INTEGER, is_closed INTEGER, reason TEXT, PRIMARY KEY(booking_date,time_band))");
$db->exec("CREATE TABLE booking_slots (id TEXT, booking_date TEXT, time_band TEXT, slot_index INTEGER, booking_id TEXT, status TEXT)");
$bands = ['am','pm','ev','nt'];

// ── whole-day closure (close-day writes all 4 bands is_closed=1) ──────────────
foreach ($bands as $b) $db->exec("INSERT INTO slot_capacity VALUES ('2026-08-20','$b',1,1,'お盆')");
// ── partial closure: only pm closed on the 10th ──────────────────────────────
$db->exec("INSERT INTO slot_capacity VALUES ('2026-08-10','pm',1,1,'点検')");
// ── capacity 2 on am/12th ────────────────────────────────────────────────────
$db->exec("INSERT INTO slot_capacity VALUES ('2026-08-12','am',2,0,'')");

echo "hm_cap_day_closed()\n";
chk('all bands closed → day closed', hm_cap_day_closed($db, '2026-08-20')['closed'], true);
chk('day-closed reason surfaces',    hm_cap_day_closed($db, '2026-08-20')['reason'], 'お盆');
chk('partial closure → NOT day closed', hm_cap_day_closed($db, '2026-08-10')['closed'], false);
chk('no rows → NOT day closed',      hm_cap_day_closed($db, '2026-08-15')['closed'], false);

echo "hm_cap_confirm_check() — closure rules\n";
chk('confirm on fully-closed day → day_closed',       hm_cap_confirm_check($db, '2026-08-20', 'am')['reason'] ?? 'ok', 'day_closed');
chk('band-less booking on closed day → day_closed',   hm_cap_confirm_check($db, '2026-08-20', null)['reason'] ?? 'ok', 'day_closed');
chk('confirm on closed band (pm/10th) → band_closed', hm_cap_confirm_check($db, '2026-08-10', 'pm')['reason'] ?? 'ok', 'band_closed');
chk('open band on partial-closed day → ok',           !empty(hm_cap_confirm_check($db, '2026-08-10', 'am')['ok']), true);
chk('band-less on partial-closed day → ok',            !empty(hm_cap_confirm_check($db, '2026-08-10', null)['ok']), true);

echo "no duplicate reservation — capacity guard\n";
// Default capacity 1 on am/11th: one reservation fills it.
$db->exec("INSERT INTO booking_slots VALUES ('s1','2026-08-11','am',0,'bk1','reserved')");
chk('used count = 1',                         hm_cap_count($db, '2026-08-11', 'am'), 1);
chk('2nd booking blocked (cap 1 full) → slot_taken', hm_cap_confirm_check($db, '2026-08-11', 'am')['reason'] ?? 'ok', 'slot_taken');
chk('same booking re-confirm (exclude self) → ok',   !empty(hm_cap_confirm_check($db, '2026-08-11', 'am', 'bk1')['ok']), true);

// Capacity 2 on am/12th: first fits, second fills, third blocked.
chk('cap2 empty → ok',                        !empty(hm_cap_confirm_check($db, '2026-08-12', 'am')['ok']), true);
$db->exec("INSERT INTO booking_slots VALUES ('s2','2026-08-12','am',0,'bk2','reserved')");
chk('cap2 with 1 used → still ok',            !empty(hm_cap_confirm_check($db, '2026-08-12', 'am', 'bkX')['ok']), true);
$db->exec("INSERT INTO booking_slots VALUES ('s3','2026-08-12','am',1,'bk3','reserved')");
chk('cap2 with 2 used → slot_taken',          hm_cap_confirm_check($db, '2026-08-12', 'am')['reason'] ?? 'ok', 'slot_taken');

echo "undated / non-date input is inert\n";
chk('empty date → ok (nothing to enforce)',   !empty(hm_cap_confirm_check($db, '', 'am')['ok']), true);

echo "\n" . ($fail ? "FAIL: $fail failed, $pass passed\n" : "PASS: all $pass checks\n");
exit($fail ? 1 : 0);
