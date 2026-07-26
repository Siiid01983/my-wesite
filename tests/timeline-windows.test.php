<?php
// ════════════════════════════════════════════════════════════════════════════
//  timeline-windows.test.php — allow-list availability windows + slot generation
//
//  PURE half: hm_tl_union / hm_tl_gen_slots / hm_tl_fits (no DB — runs anywhere).
//  DB half:   window CRUD + slot reads on in-memory SQLite (skips if pdo_sqlite
//             is absent; runs in CI).
//  Run: php tests/timeline-windows.test.php   (or npm run test:timeline)
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

$fail = 0; $pass = 0;
function ck(string $label, $got, $want): void {
  global $fail, $pass;
  $ok = ($got === $want);
  $ok ? $pass++ : $fail++;
  printf("  [%s] %-52s got=%s want=%s\n", $ok ? 'ok' : 'XX', $label,
    json_encode($got, JSON_UNESCAPED_UNICODE), json_encode($want, JSON_UNESCAPED_UNICODE));
}

// Stub hm_config so _windows.php config getters use defaults (no _config.php here).
if (!function_exists('hm_config')) { function hm_config(): array { return []; } }

require_once __DIR__ . '/../hm-api/_windows.php';

echo "hm_tl_union (merge overlapping/adjacent ranges)\n";
ck('disjoint kept',        hm_tl_union([[540,600],[660,720]]), [[540,600],[660,720]]);
ck('overlap merged',       hm_tl_union([[540,660],[600,720]]), [[540,720]]);
ck('adjacent (touch) merged', hm_tl_union([[540,600],[600,660]]), [[540,660]]);
ck('unsorted normalised',  hm_tl_union([[660,720],[540,600]]), [[540,600],[660,720]]);
ck('zero-length dropped',  hm_tl_union([[540,540],[600,660]]), [[600,660]]);

echo "\nhm_tl_gen_slots (bookable starts inside windows, minus busy)\n";
// Window 09:00–12:00 (540–720), 120-min duration, 30-min step, no busy.
// Valid starts: 09:00,09:30,10:00 (10:00+120=12:00 fits; 10:30+120=12:30 does not).
ck('2h/30step empty day', hm_tl_gen_slots([[540,720]], [], 120, 30), ['09:00','09:30','10:00']);
// Busy 10:00–11:00 (600–660) blocks any 2h window overlapping it → only 09:00?
//   09:00–11:00 overlaps busy → out. 09:30–11:30 overlaps → out. 10:00–12:00 overlaps → out.
//   → none free for 2h.
ck('2h blocked by mid busy', hm_tl_gen_slots([[540,720]], [[600,660]], 120, 30), []);
// Same busy but 60-min duration: 09:00–10:00 ok, 11:00–12:00 ok; 09:30/10:00/10:30 overlap.
ck('1h around busy',        hm_tl_gen_slots([[540,720]], [[600,660]], 60, 30), ['09:00','11:00']);
// Two 60-min windows (09:00–10:00, 11:00–12:00); 30-min duration+step → two per window.
ck('two windows 30m',       hm_tl_gen_slots([[540,600],[660,720]], [], 30, 30), ['09:00','09:30','11:00','11:30']);
ck('duration exceeds window', hm_tl_gen_slots([[540,600]], [], 120, 30), []);

echo "\nhm_tl_fits (server-side backstop for a chosen start)\n";
ck('fits open window',      hm_tl_fits([[540,720]], [], 540, 120), true);
ck('outside window',        hm_tl_fits([[540,720]], [], 630, 120), false);   // 10:30+2h=12:30 > 12:00
ck('overlaps busy',         hm_tl_fits([[540,720]], [[600,660]], 540, 120), false);
ck('no windows → nothing',  hm_tl_fits([], [], 540, 120), false);

echo "\nhm_tl_min / hm_tl_hhmm / hm_tl_snap\n";
ck('min parse datetime',    hm_tl_min('2026-08-15 09:30:00'), 570);
ck('hhmm format',           hm_tl_hhmm(570), '09:30');
ck('snap to 30',            hm_tl_snap(575, 30), 570);

echo "\ndefaults\n";
ck('default duration 120',  hm_timeline_default_duration(), 120);
ck('step 30',               hm_timeline_step(), 30);
ck('durations set',         hm_timeline_durations(), [30,60,90,120,180]);

// ── DB half (in-memory SQLite) ───────────────────────────────────────────────
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
  echo "\nSKIP (DB portion): pdo_sqlite not available in this PHP build (runs in CI)\n";
  echo ($fail ? "FAIL: $fail failed, $pass passed\n" : "PASS: all $pass checks (pure-logic only)\n");
  exit($fail ? 1 : 0);
}

echo "\nDB: window CRUD + slot reads (SQLite)\n";
$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
// Minimal bookings table so hm_iv_day (busy reader) works.
$db->exec("CREATE TABLE bookings (id TEXT, customer_name TEXT, status TEXT, booking_date TEXT, start_at TEXT, end_at TEXT, duration_min INTEGER)");
hm_windows_ensure_table($db);

// Add a window 09:00–12:00 on 2026-08-15.
$add = hm_windows_add($db, '2026-08-15 09:00', '2026-08-15 12:00');
ck('add ok',                !empty($add['ok']), true);
ck('day lists 1 window',    count(hm_windows_day($db, '2026-08-15')), 1);

// Slots for 2h/30step with no bookings → 09:00,09:30,10:00.
ck('slots empty day',       hm_timeline_slots($db, '2026-08-15', 120, 30), ['09:00','09:30','10:00']);

// Insert a booking 10:00–11:00 → 1h slots become 09:00 & 11:00.
$db->exec("INSERT INTO bookings (id,customer_name,status,booking_date,start_at,end_at) VALUES ('b1','X','pending','2026-08-15','2026-08-15 10:00:00','2026-08-15 11:00:00')");
ck('slots avoid booking',   hm_timeline_slots($db, '2026-08-15', 60, 30), ['09:00','11:00']);
ck('start_ok free',         hm_timeline_start_ok($db, '2026-08-15', '2026-08-15 09:00:00', 60), true);
ck('start_ok on booking',   hm_timeline_start_ok($db, '2026-08-15', '2026-08-15 10:00:00', 60), false);

// Cancelled booking is ignored (frees the slot).
$db->exec("UPDATE bookings SET status='キャンセル' WHERE id='b1'");
ck('cancelled frees slot',  hm_timeline_start_ok($db, '2026-08-15', '2026-08-15 10:00:00', 60), true);

// Update (resize) the window to 09:00–10:00 → only 09:00 for 60m.
$upd = hm_windows_update($db, (string)$add['id'], '2026-08-15 09:00', '2026-08-15 10:00');
ck('update ok',             !empty($upd['ok']), true);
ck('resized slots',         hm_timeline_slots($db, '2026-08-15', 60, 30), ['09:00']);

// Delete the explicit window → the date now falls back to the DEFAULT business-
// hours window (09:00–18:00), so customers still receive slots (the #1 fix). The
// booking above is cancelled, so a 60m/30-step day yields 09:00 … 17:00.
$del = hm_windows_delete($db, (string)$add['id']);
ck('delete count 1',        (int)($del['deleted'] ?? 0), 1);
$defSlots = hm_timeline_slots($db, '2026-08-15', 60, 30);
ck('default window slots',  count($defSlots), 17);              // 09:00 … 17:00
ck('default first slot',    $defSlots[0] ?? '', '09:00');
ck('default last slot',     end($defSlots), '17:00');

// Update a non-existent id → not found.
$nf = hm_windows_update($db, 'nope', '2026-08-15 09:00', '2026-08-15 10:00');
ck('update missing → error', $nf['error'] ?? '', 'not found');

// ── Close-day: a closed date suppresses ALL availability (explicit + default) ──
echo "\nDB: whole-day closures\n";
hm_closedays_ensure_table($db);
$cl = hm_day_close($db, '2026-08-15', 'スタッフ休暇', 'admin@test');
ck('close ok',              !empty($cl['ok']), true);
ck('day is closed',         hm_day_is_closed($db, '2026-08-15'), true);
ck('closed → no slots',     hm_timeline_slots($db, '2026-08-15', 60, 30), []);
ck('closed → no windows',   hm_windows_day_effective($db, '2026-08-15'), []);
$info = hm_day_close_info($db, '2026-08-15');
ck('closure reason stored', $info['reason'] ?? '', 'スタッフ休暇');
ck('closure closed_by',     $info['closed_by'] ?? '', 'admin@test');
ck('close reason required',  hm_day_close($db, '2026-08-16', '', 'admin')['error'] ?? '', 'reason required');
// Reopen → default window slots return.
$ro = hm_day_reopen($db, '2026-08-15');
ck('reopen ok',             !empty($ro['ok']), true);
ck('reopened not closed',   hm_day_is_closed($db, '2026-08-16'), false);   // fresh date (cache-safe)
ck('reopened → slots back', count(hm_timeline_slots($db, '2026-08-15', 60, 30)) > 0, true);

echo "\n" . ($fail ? "FAIL: $fail failed, $pass passed\n" : "PASS: all $pass checks\n");
exit($fail ? 1 : 0);
