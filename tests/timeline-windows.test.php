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
// Window 09:00–12:00 (540–720), 120-min duration, 30-min step, no busy. The window
// bounds the START (step room, s+30≤720 → last start 11:30); a long job may run past
// the window end (last job of the day), so the tail is NEVER clipped by duration.
ck('2h/30step empty day', hm_tl_gen_slots([[540,720]], [], 120, 30), ['09:00','09:30','10:00','10:30','11:00','11:30']);
// Busy 10:00–11:00 (600–660), 2h duration: starts whose [s,s+120) overlaps are dropped;
// generation continues PAST the block, so 11:00 & 11:30 (clear of busy) still appear.
ck('2h continues past busy', hm_tl_gen_slots([[540,720]], [[600,660]], 120, 30), ['11:00','11:30']);
// Same busy, 60-min duration: 09:00 ok; 09:30/10:00/10:30 overlap; 11:00 & 11:30 ok.
ck('1h around busy',        hm_tl_gen_slots([[540,720]], [[600,660]], 60, 30), ['09:00','11:00','11:30']);
// Two 60-min windows (09:00–10:00, 11:00–12:00); 30-min duration+step → two per window.
ck('two windows 30m',       hm_tl_gen_slots([[540,600],[660,720]], [], 30, 30), ['09:00','09:30','11:00','11:30']);
// A duration longer than the window still yields starts (the job simply runs past the
// window end); only the step must fit — 540/570 both have step room in 540–600.
ck('duration exceeds window', hm_tl_gen_slots([[540,600]], [], 120, 30), ['09:00','09:30']);

echo "\nhm_tl_fits (server-side backstop for a chosen start)\n";
ck('fits open window',      hm_tl_fits([[540,720]], [], 540, 120), true);
// A start inside the window is valid even if the job runs past the window end.
ck('start inside, job overruns', hm_tl_fits([[540,720]], [], 630, 120), true);   // 10:30 start ok
ck('start past window end', hm_tl_fits([[540,720]], [], 730, 120), false);       // 12:10 start: no room
ck('overlaps busy',         hm_tl_fits([[540,720]], [[600,660]], 540, 120), false);
ck('no windows → nothing',  hm_tl_fits([], [], 540, 120), false);

echo "\nhm_tl_min / hm_tl_hhmm / hm_tl_snap\n";
ck('min parse datetime',    hm_tl_min('2026-08-15 09:30:00'), 570);
ck('hhmm format',           hm_tl_hhmm(570), '09:30');
ck('snap to 30',            hm_tl_snap(575, 30), 570);

echo "\ndefaults\n";
ck('default duration 120',  hm_timeline_default_duration(), 120);
ck('step 30',               hm_timeline_step(), 30);
ck('durations set (incl 4h)', hm_timeline_durations(), [30,60,90,120,180,240]);

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

// Slots for 2h/30step, no bookings. The window bounds the START (a job may run past
// the window end — the last job of the day), so 09:00–12:00 gives every 30m to 11:30.
ck('slots empty day',       hm_timeline_slots($db, '2026-08-15', 120, 30), ['09:00','09:30','10:00','10:30','11:00','11:30']);

// Insert a booking 10:00–11:00 → 60m starts skip anything whose [s,s+60) overlaps it.
$db->exec("INSERT INTO bookings (id,customer_name,status,booking_date,start_at,end_at) VALUES ('b1','X','pending','2026-08-15','2026-08-15 10:00:00','2026-08-15 11:00:00')");
ck('slots avoid booking',   hm_timeline_slots($db, '2026-08-15', 60, 30), ['09:00','11:00','11:30']);
ck('start_ok free',         hm_timeline_start_ok($db, '2026-08-15', '2026-08-15 09:00:00', 60), true);
ck('start_ok on booking',   hm_timeline_start_ok($db, '2026-08-15', '2026-08-15 10:00:00', 60), false);

// Cancelled booking is ignored (frees the slot).
$db->exec("UPDATE bookings SET status='キャンセル' WHERE id='b1'");
ck('cancelled frees slot',  hm_timeline_start_ok($db, '2026-08-15', '2026-08-15 10:00:00', 60), true);

// Update (resize) the window to 09:00–10:00 → starts 09:00 & 09:30 (window bounds start).
$upd = hm_windows_update($db, (string)$add['id'], '2026-08-15 09:00', '2026-08-15 10:00');
ck('update ok',             !empty($upd['ok']), true);
ck('resized slots',         hm_timeline_slots($db, '2026-08-15', 60, 30), ['09:00','09:30']);

// Delete the explicit window → the date falls back to the DEFAULT business-day window
// (07:00–22:00), so customers see the FULL working day (the #1 production fix). The
// booking above is cancelled, so a 60m/30-step day yields 07:00 … 21:30 = 30 starts.
$del = hm_windows_delete($db, (string)$add['id']);
ck('delete count 1',        (int)($del['deleted'] ?? 0), 1);
$defSlots = hm_timeline_slots($db, '2026-08-15', 60, 30);
ck('default window slots',  count($defSlots), 30);              // 07:00 … 21:30
ck('default first slot',    $defSlots[0] ?? '', '07:00');
ck('default last slot',     end($defSlots), '21:30');

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
// Reopen → the closure record is DELETED and slots return (the reported bug).
$ro = hm_day_reopen($db, '2026-08-15');
ck('reopen ok',             !empty($ro['ok']), true);
ck('reopen deleted a row',  ($ro['reopened'] ?? 0) >= 1, true);            // the record was actually removed
ck('reopen still_closed=false', !empty($ro['still_closed']), false);        // never a false success
ck('reopened day not closed', hm_day_is_closed($db, '2026-08-15'), false);  // SAME date is now open
ck('reopened → slots back', count(hm_timeline_slots($db, '2026-08-15', 60, 30)) > 0, true);
ck('reopened → windows back', count(hm_windows_day_effective($db, '2026-08-15')) > 0, true);
ck('reopened → start_ok bookable', hm_timeline_start_ok($db, '2026-08-15', '2026-08-15 10:00:00', 120), true);

// Idempotent reopen (reopening an already-open day is a harmless no-op, never errors).
$ro2 = hm_day_reopen($db, '2026-08-15');
ck('idempotent reopen ok',  !empty($ro2['ok']) && empty($ro2['still_closed']), true);

// Full close → reopen → re-close → reopen cycle on the SAME date works every time.
hm_day_close($db, '2026-08-15', 'トラック整備', 'admin');
ck('re-close closes again',  hm_day_is_closed($db, '2026-08-15'), true);
hm_day_reopen($db, '2026-08-15');
ck('re-reopen opens again',  hm_day_is_closed($db, '2026-08-15'), false);

// Multi-day: close a 3-day range, reopen only the middle → middle open, edges closed.
foreach (['2026-10-01','2026-10-02','2026-10-03'] as $d) hm_day_close($db, $d, '祝日', 'admin');
hm_day_reopen($db, '2026-10-02');
ck('multi-day: edge 1 stays closed', hm_day_is_closed($db, '2026-10-01'), true);
ck('multi-day: middle reopened',     hm_day_is_closed($db, '2026-10-02'), false);
ck('multi-day: edge 2 stays closed', hm_day_is_closed($db, '2026-10-03'), true);
$closedRange = hm_closedays_range($db, '2026-10-01', '2026-10-03');
ck('multi-day: range now lists 2',   count($closedRange), 2);
// custom reason + manual-reservation reason both close then fully reopen.
foreach (['カスタム臨時休業','手動予約'] as $i => $rsn) {
  $d = '2026-11-0' . ($i + 1);
  hm_day_close($db, $d, $rsn, 'admin');
  ck('custom reason "' . $rsn . '" closes', hm_day_is_closed($db, $d), true);
  $r = hm_day_reopen($db, $d);
  ck('custom reason "' . $rsn . '" reopens fully', hm_day_is_closed($db, $d) === false && empty($r['still_closed']), true);
}

// ── Blocks are a SEPARATE entity (availability_blocks) — NOT bookings ─────────
//    They remove customer slots + refuse overlapping bookings exactly like a
//    reservation, but they never touch the bookings table.
echo "\nDB: availability blocks (own table) remove slots; never in bookings\n";
hm_blocks_ensure_table($db);
// Fresh day, explicit 08:00–18:00 window; block 09:30–11:00 via the block engine.
hm_windows_add($db, '2026-09-20 08:00', '2026-09-20 18:00');
$ba = hm_blocks_add($db, '2026-09-20 09:30', '2026-09-20 11:00', '（ブロック）', '');
ck('block add ok',                 !empty($ba['ok']), true);
// The block is in availability_blocks, and NOT in bookings.
$cntBlk = (int)$db->query("SELECT COUNT(*) FROM availability_blocks")->fetchColumn();
$cntBk  = (int)$db->query("SELECT COUNT(*) FROM bookings WHERE start_at='2026-09-20 09:30:00'")->fetchColumn();
ck('block stored in availability_blocks', $cntBlk, 1);
ck('block NOT written to bookings',       $cntBk, 0);
$s60 = hm_timeline_slots($db, '2026-09-20', 60, 30);
ck('60m includes 08:00 & 08:30',  in_array('08:00',$s60,true) && in_array('08:30',$s60,true), true);
ck('60m excludes the blocked gap', !in_array('09:00',$s60,true) && !in_array('09:30',$s60,true) && !in_array('10:00',$s60,true), true);
ck('60m resumes at 11:00',         in_array('11:00',$s60,true), true);
// A real booking behaves identically; cancel frees it again.
$db->exec("INSERT INTO bookings (id,customer_name,status,booking_date,start_at,end_at)
           VALUES ('bk9','客','confirmed','2026-09-20','2026-09-20 13:00:00','2026-09-20 15:00:00')");
$s120 = hm_timeline_slots($db, '2026-09-20', 120, 30);
ck('120m excludes booked 13–15',   !in_array('13:00',$s120,true) && !in_array('12:00',$s120,true), true);
$db->exec("UPDATE bookings SET status='cancelled' WHERE id='bk9'");
$s120b = hm_timeline_slots($db, '2026-09-20', 120, 30);
ck('cancel returns the slot',      in_array('13:00',$s120b,true), true);

// Conflict detection unchanged: a customer reservation may not overlap a block, and
// a block may not overlap a real booking or another block.
echo "\nDB: block ↔ booking conflict detection (both directions)\n";
$db->exec("INSERT INTO bookings (id,customer_name,status,booking_date) VALUES ('cust1','客','pending','2026-09-20')");
$rv = hm_iv_reserve($db, 'cust1', '2026-09-20 10:00:00', '2026-09-20 10:30:00');  // overlaps the 09:30–11:00 block
ck('reserve over a block → conflict', !empty($rv['conflict']), true);
$rv2 = hm_iv_reserve($db, 'cust1', '2026-09-20 11:00:00', '2026-09-20 11:30:00'); // clear of the block
ck('reserve clear of block → ok',     !empty($rv2['ok']), true);
$bx = hm_blocks_add($db, '2026-09-20 11:15', '2026-09-20 11:45', 'x', '');        // overlaps cust1's 11:00–11:30 booking
ck('block over a booking → conflict', !empty($bx['conflict']), true);
$bx2 = hm_blocks_add($db, '2026-09-20 09:45', '2026-09-20 10:15', 'x', '');       // overlaps the existing block
ck('block over a block → conflict',   !empty($bx2['conflict']), true);

// ── Slot generation must CONTINUE after a block (never truncate); delete restores.
echo "\nDB: slots continue AFTER a block; delete restores them\n";
$D = '2026-12-05';
hm_windows_add($db, $D . ' 07:00', $D . ' 21:00');           // working hours 07:00–21:00
$b1 = hm_blocks_add($db, "$D 08:00", "$D 16:00", '（ブロック）', '');  // block 08:00–16:00
$g = hm_timeline_slots($db, $D, 30, 30);
ck('block: slots BEFORE (07:00,07:30 present)', in_array('07:00',$g,true) && in_array('07:30',$g,true), true);
ck('block: blocked gap absent (08:00–15:30)',   !in_array('08:00',$g,true) && !in_array('12:00',$g,true) && !in_array('15:30',$g,true), true);
ck('block: slots AFTER present (16:00,17:00,20:30)', in_array('16:00',$g,true) && in_array('17:00',$g,true) && in_array('20:30',$g,true), true);
ck('block: generation did NOT stop at the block', count($g) === 12, true);   // 07:00,07:30 + 16:00..20:30

// Second block — gaps on every side.
$b2 = hm_blocks_add($db, "$D 17:00", "$D 18:00", '（ブロック）', '');
$g2 = hm_timeline_slots($db, $D, 30, 30);
ck('two blocks: 16:00 & 16:30 kept', in_array('16:00',$g2,true) && in_array('16:30',$g2,true), true);
ck('two blocks: 17:00 removed',      !in_array('17:00',$g2,true), true);
ck('two blocks: 18:00 kept',         in_array('18:00',$g2,true), true);

// Delete (unblock) → availability fully restored, verified gone.
$d1 = hm_blocks_delete($db, (string)$b1['id']);
ck('unblock b1 removed a row',       ($d1['removed'] ?? 0) >= 1 && empty($d1['still']), true);
$d2 = hm_blocks_delete($db, (string)$b2['id']);
ck('unblock b2 removed a row',       ($d2['removed'] ?? 0) >= 1 && empty($d2['still']), true);
$restored = hm_timeline_slots($db, $D, 30, 30);
ck('unblock restores 08:00–15:30', in_array('08:00',$restored,true) && in_array('12:00',$restored,true) && in_array('15:30',$restored,true), true);
ck('unblock restores 17:00',       in_array('17:00',$restored,true), true);
ck('unblock: full day available (07:00..20:30 = 28 slots)', count($restored), 28);
// Deleting an unknown / non-block id is a harmless no-op (never a false success).
$dn = hm_blocks_delete($db, 'no-such-block');
ck('delete missing → no-op',        ($dn['removed'] ?? 0) === 0 && empty($dn['still']), true);
// And it never touched bookings: the day's blocks are gone but the table exists.
ck('no admin_blocked rows in bookings', (int)$db->query("SELECT COUNT(*) FROM bookings WHERE status='admin_blocked'")->fetchColumn(), 0);

echo "\n" . ($fail ? "FAIL: $fail failed, $pass passed\n" : "PASS: all $pass checks\n");
exit($fail ? 1 : 0);
