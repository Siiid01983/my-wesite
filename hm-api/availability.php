<?php
// ════════════════════════════════════════════════════════════════════════════
//  availability.php — TIMELINE availability for a single date (STRICTLY READ-ONLY)
//
//  Returns ONLY hourly/timeline information — no bands, no capacity, no
//  Morning/Afternoon/Evening/Night:
//    • intervals — busy time ranges (existing bookings + admin blocks; start_at/end_at)
//    • windows   — the admin's drawn availability windows for the date
//    • slots     — bookable start times inside the windows, minus busy intervals
//
//  GET /hm-api/availability.php?date=YYYY-MM-DD
//    → { ok, date, timeline, windows:[…], slots:["09:00",…], intervals:[…],
//        default_duration }
//
//  READ-ONLY GUARANTEE: reads only; never writes/reserves. Conventions mirror
//  get-booking.php: CORS, api-key gate, rate limit, hm_safe_msg() on errors.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_intervals.php';   // busy-interval reader (start_at/end_at)
require_once __DIR__ . '/_windows.php';      // timeline: allow-list windows + slot generation
require_once __DIR__ . '/_ratelimit.php';
hm_cors();
hm_require_api_key();
hm_rate_limit('general', 30, 60);   // public read: max 30 / IP / minute

// ── Method guard: read-only endpoint accepts GET only ────────────────────────
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET') {
  hm_json(['ok' => false, 'error' => 'method not allowed — use GET'], 405);
}


// ── Validate the date: strict YYYY-MM-DD AND a real calendar date ────────────
$date = trim((string)($_GET['date'] ?? ''));
if ($date === '') {
  hm_json(['ok' => false, 'error' => 'date required — format YYYY-MM-DD'], 400);
}
$parsed = DateTime::createFromFormat('!Y-m-d', $date);
$errors = DateTime::getLastErrors();
$validDate = $parsed instanceof DateTime
  && $parsed->format('Y-m-d') === $date
  && (($errors['warning_count'] ?? 0) === 0)
  && (($errors['error_count'] ?? 0) === 0);
if (!$validDate) {
  hm_json(['ok' => false, 'error' => 'invalid date — expected YYYY-MM-DD'], 400);
}

// ── TIMELINE-ONLY availability: busy intervals + admin windows + bookable slots ─
//  No bands, no capacity, no Morning/Afternoon/Evening/Night. The customer receives
//  only real hourly information: the day's busy time ranges (`intervals`) and the
//  bookable start times (`slots`) generated from the admin's availability `windows`.
try {
  $db = hm_db();

  // Busy time ranges (existing bookings + admin blocks). PUBLIC endpoint: expose
  // ONLY the [start_at,end_at] range — never customer names, statuses or block
  // reasons — so nothing about who booked or why a slot is blocked ever leaks.
  $intervals = [];
  try {
    foreach (hm_iv_day($db, $date) as $iv) {          // real customer bookings
      $intervals[] = ['start_at' => (string)($iv['start_at'] ?? ''), 'end_at' => (string)($iv['end_at'] ?? '')];
    }
    foreach (hm_blocks_day($db, $date) as $bk) {      // admin availability blocks (separate table)
      $intervals[] = ['start_at' => (string)($bk['start_at'] ?? ''), 'end_at' => (string)($bk['end_at'] ?? '')];
    }
  }
  catch (Throwable $ie) { hm_log_error('availability intervals read failed (non-fatal)', ['err' => $ie->getMessage(), 'date' => $date]); }

  // Effective availability windows (admin-drawn OR the default business-hours window
  // when none is drawn) and the bookable start times inside them. The SERVER is the
  // single source of truth: it generates the free start times for EVERY allowed
  // duration (windows − existing bookings − admin blocks) so the customer picker only
  // DISPLAYS them and never runs a second engine. A CLOSED day returns no
  // windows/slots and closed:true — the customer sees "unavailable"; the internal
  // reason is NEVER exposed on this public endpoint.
  $timeline = false; $windows = []; $slots = []; $closed = false;
  $durations = hm_timeline_durations();
  $defaultDur = hm_timeline_default_duration();
  $slotsByDur = [];
  try {
    $timeline = hm_timeline_active($db);
    if ($timeline) {
      $closed  = hm_day_is_closed($db, $date);
      $windows = hm_windows_day_effective($db, $date);
      foreach ($durations as $d) {
        $slotsByDur[(string)$d] = hm_timeline_slots($db, $date, (int)$d);
      }
      $slots = $slotsByDur[(string)$defaultDur] ?? hm_timeline_slots($db, $date, $defaultDur);
    }
  } catch (Throwable $we) {
    hm_log_error('availability timeline read failed (non-fatal)', ['err' => $we->getMessage(), 'date' => $date]);
  }

  hm_json(['ok' => true, 'date' => $date, 'timeline' => $timeline, 'closed' => $closed,
           'windows' => $windows, 'slots' => $slots, 'slots_by_duration' => $slotsByDur,
           'intervals' => $intervals, 'durations' => $durations,
           'default_duration' => $defaultDur]);
} catch (Throwable $e) {
  hm_log_error('availability failed', ['err' => $e->getMessage(), 'date' => $date]);
  hm_json(['ok' => false, 'error' => hm_safe_msg('Request failed', $e)], 500);
}
