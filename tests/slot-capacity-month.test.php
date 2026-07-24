<?php
// ════════════════════════════════════════════════════════════════════════════
//  slot-capacity-month.test.php — Phase 1 verification for hm_cap_month()
//  (the read behind the slot-aware admin month calendar). Uses in-memory SQLite;
//  the helper is pure SELECT + PHP, so no MySQL-specific DDL is exercised.
//  Run: php tests/slot-capacity-month.test.php
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/../hm-api/_capacity.php';

$fail = 0; $pass = 0;
function chk(string $label, $got, $want) {
  global $fail, $pass;
  $ok = ($got === $want);
  $ok ? $pass++ : $fail++;
  printf("  [%s] %-52s got=%-10s want=%-10s\n", $ok ? 'ok' : 'XX', $label,
    var_export($got, true), var_export($want, true));
}

// ── Pure-logic checks: hm_cap_state() (DB-free — always run) ─────────────────
echo "hm_cap_state() status derivation\n";
chk("available: cap3 used0",        hm_cap_state(3, 0, false)['status'], 'available');
chk("available: cap1 used0",        hm_cap_state(1, 0, false)['status'], 'available');
chk("full: cap1 used1",             hm_cap_state(1, 1, false)['status'], 'full');
chk("full: cap0 (no capacity)",     hm_cap_state(0, 0, false)['status'], 'full');
chk("limited: cap2 used1 (low=1)",  hm_cap_state(2, 1, false)['status'], 'limited');
chk("limited: cap4 used2 (low=2)",  hm_cap_state(4, 2, false)['status'], 'limited');
chk("available: cap5 used1 (rem4>2)", hm_cap_state(5, 1, false)['status'], 'available');
chk("available: cap4 used0 (no use)", hm_cap_state(4, 0, false)['status'], 'available');
chk("closed wins over capacity",    hm_cap_state(5, 0, true, '祝日')['status'], 'closed');
chk("closed surfaces reason",       hm_cap_state(5, 0, true, '祝日')['reason'], '祝日');
chk("open hides reason",            hm_cap_state(3, 0, false, '祝日')['reason'], '');
chk("remaining clamped at 0",       hm_cap_state(1, 3, false)['remaining'], 0);
chk("negative used clamped",        hm_cap_state(2, -5, false)['used'], 0);

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
  echo "\nSKIP (DB portion): pdo_sqlite not available in this PHP build\n";
  echo ($fail ? "FAIL: $fail failed, $pass passed\n" : "PASS: all $pass checks (pure-logic only)\n");
  exit($fail ? 1 : 0);
}

function fresh_db(bool $withTables): PDO {
  $db = new PDO('sqlite::memory:');
  $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  if ($withTables) {
    $db->exec("CREATE TABLE slot_capacity (booking_date TEXT, time_band TEXT, capacity INTEGER, is_closed INTEGER, reason TEXT)");
    $db->exec("CREATE TABLE booking_slots (id TEXT, booking_date TEXT, time_band TEXT, slot_index INTEGER, booking_id TEXT, status TEXT)");
  }
  return $db;
}

// ── Fixture: 3-day window 2026-08-10 .. 2026-08-12 ───────────────────────────
$db = fresh_db(true);
$db->exec("INSERT INTO slot_capacity VALUES ('*','am',3,0,'')");                 // am default capacity 3
$db->exec("INSERT INTO slot_capacity VALUES ('2026-08-10','pm',1,1,'お盆')");   // pm closed on the 10th
$db->exec("INSERT INTO slot_capacity VALUES ('2026-08-11','am',2,0,'')");        // am capacity 2 on the 11th
$db->exec("INSERT INTO booking_slots VALUES ('s1','2026-08-11','am',0,'b1','reserved')"); // 1 used am on 11th
$db->exec("INSERT INTO booking_slots VALUES ('s2','2026-08-12','pm',0,'b2','reserved')"); // 1 used pm on 12th

$m = hm_cap_month($db, '2026-08-10', '2026-08-12');

echo "range shape\n";
chk("day count", count($m), 3);
chk("has 2026-08-10", isset($m['2026-08-10']), true);
chk("has 2026-08-12", isset($m['2026-08-12']), true);
chk("4 bands per day", array_keys($m['2026-08-10']), ['am', 'pm', 'ev', 'nt']);

echo "per-band default applied (am default capacity 3)\n";
chk("10 am status",   $m['2026-08-10']['am']['status'],   'available');
chk("10 am capacity", $m['2026-08-10']['am']['capacity'], 3);
chk("12 am capacity", $m['2026-08-12']['am']['capacity'], 3);
chk("10 ev capacity (no row → 1)", $m['2026-08-10']['ev']['capacity'], 1);

echo "date override: pm closed on the 10th with reason\n";
chk("10 pm status", $m['2026-08-10']['pm']['status'], 'closed');
chk("10 pm closed", $m['2026-08-10']['pm']['closed'], true);
chk("10 pm reason", $m['2026-08-10']['pm']['reason'], 'お盆');
chk("11 pm not closed (override is date-scoped)", $m['2026-08-11']['pm']['status'], 'available');

echo "capacity + usage → limited / full\n";
chk("11 am capacity (override 2)", $m['2026-08-11']['am']['capacity'], 2);
chk("11 am used",      $m['2026-08-11']['am']['used'],      1);
chk("11 am remaining", $m['2026-08-11']['am']['remaining'], 1);
chk("11 am status limited", $m['2026-08-11']['am']['status'], 'limited');
chk("12 pm used",      $m['2026-08-12']['pm']['used'],      1);
chk("12 pm remaining", $m['2026-08-12']['pm']['remaining'], 0);
chk("12 pm status full", $m['2026-08-12']['pm']['status'], 'full');

echo "reason only surfaces when closed\n";
chk("11 am reason empty", $m['2026-08-11']['am']['reason'], '');

echo "reversed from/to is normalised\n";
$rev = hm_cap_month($db, '2026-08-12', '2026-08-10');
chk("reversed day count", count($rev), 3);
chk("reversed still has 10th", isset($rev['2026-08-10']), true);

echo "single-day range\n";
$one = hm_cap_month($db, '2026-08-11', '2026-08-11');
chk("single day count", count($one), 1);
chk("single day is the 11th", isset($one['2026-08-11']), true);

echo "pre-migration safety: missing tables → all-open defaults\n";
$bare = fresh_db(false);
$dm = hm_cap_month($bare, '2026-09-01', '2026-09-02');
chk("bare day count", count($dm), 2);
chk("bare am available", $dm['2026-09-01']['am']['status'], 'available');
chk("bare am capacity 1", $dm['2026-09-01']['am']['capacity'], 1);
chk("bare am used 0", $dm['2026-09-01']['am']['used'], 0);

echo "\n" . ($fail ? "FAIL: $fail failed, $pass passed\n" : "PASS: all $pass checks\n");
exit($fail ? 1 : 0);
