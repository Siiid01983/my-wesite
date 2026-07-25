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

  // Busy time ranges (existing bookings + admin blocks) — start_at/end_at.
  $intervals = [];
  try { $intervals = hm_iv_day($db, $date); }
  catch (Throwable $ie) { hm_log_error('availability intervals read failed (non-fatal)', ['err' => $ie->getMessage(), 'date' => $date]); }

  // Admin-drawn availability windows + the bookable start times inside them (minus
  // busy intervals) for the default duration. `timeline` stays true whenever the
  // engine is live; the client regenerates slots for other durations from windows.
  $timeline = false; $windows = []; $slots = [];
  try {
    $timeline = hm_timeline_active($db);
    if ($timeline) {
      $windows = hm_windows_day($db, $date);
      $slots   = hm_timeline_slots($db, $date, hm_timeline_default_duration());
    }
  } catch (Throwable $we) {
    hm_log_error('availability timeline read failed (non-fatal)', ['err' => $we->getMessage(), 'date' => $date]);
  }

  hm_json(['ok' => true, 'date' => $date, 'timeline' => $timeline, 'windows' => $windows,
           'slots' => $slots, 'intervals' => $intervals,
           'default_duration' => hm_timeline_default_duration()]);
} catch (Throwable $e) {
  hm_log_error('availability failed', ['err' => $e->getMessage(), 'date' => $date]);
  hm_json(['ok' => false, 'error' => hm_safe_msg('Request failed', $e)], 500);
}
