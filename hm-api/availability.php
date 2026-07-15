<?php
// ════════════════════════════════════════════════════════════════════════════
//  availability.php — Smart Booking Engine, Phase 1 (STRICTLY READ-ONLY)
//
//  Real-time slot availability for a single date, derived solely from the
//  booking_slots table (Phase 0). Capacity = 1 per band: a slot row exists →
//  that band is "reserved"; otherwise "available".
//
//  GET /hm-api/availability.php?date=YYYY-MM-DD
//    → { "ok":true, "date":"2026-07-20",
//        "bands": { "am":"available","pm":"reserved","ev":"available","nt":"available" } }
//
//  READ-ONLY GUARANTEE: this endpoint performs a single SELECT and NOTHING else.
//  It never writes, reserves, or releases slots; it does not touch bookings,
//  create-booking.php, rest.php, admin/portal UI, booking statuses, the flag
//  SLOT_LOCK_ENABLED, or the booking_slots schema.
//
//  Conventions mirror get-booking.php: CORS, optional api-key gate, rate limit,
//  prepared statements, and hm_safe_msg() so SQL errors are never exposed.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_intervals.php';   // hourly: busy-interval reader (gated, dormant until hm_iv_active)
require_once __DIR__ . '/_capacity.php';    // per-band capacity status (inert until configured)
require_once __DIR__ . '/_ratelimit.php';
hm_cors();
hm_require_api_key();
hm_rate_limit('general', 30, 60);   // public read: max 30 / IP / minute

// ── Method guard: read-only endpoint accepts GET only ────────────────────────
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET') {
  hm_json(['ok' => false, 'error' => 'method not allowed — use GET'], 405);
}

// ── Canonical bands (order preserved in output) ──────────────────────────────
const HM_AVAIL_BANDS = ['am', 'pm', 'ev', 'nt'];

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

// ── Read availability (single parameterised SELECT; existence = reserved) ─────
try {
  $bands = array_fill_keys(HM_AVAIL_BANDS, 'available');

  $st = hm_db()->prepare('SELECT DISTINCT time_band FROM booking_slots WHERE booking_date = ?');
  $st->execute([$date]);
  foreach ($st as $row) {
    $band = (string)($row['time_band'] ?? '');
    if (array_key_exists($band, $bands)) $bands[$band] = 'reserved';   // ignore any non-canonical values
  }

  // HOURLY (dual-read, additive): when hourly is live (flag ON + migration run),
  // also return the day's real busy time ranges alongside the 4 band states. The
  // website keeps reading `bands`; the app/grid migrate to `intervals` at their
  // own pace. Dormant otherwise → response is byte-for-byte identical to before.
  // Wrapped defensively so an interval-read hiccup can never break availability.
  $intervals = [];
  $hourly = false;   // Client-Request / hourly mode signal for the booking overlay.
  $capacity = null;  // per-band capacity status (Morning/Afternoon/Evening/Night).
  try {
    $db = hm_db();
    $hourly = hm_iv_active($db);
    if ($hourly) $intervals = hm_iv_day($db, $date);
  } catch (Throwable $ie) {
    hm_log_error('availability intervals read failed (non-fatal)', ['err' => $ie->getMessage(), 'date' => $date]);
  }
  // Capacity block (additive): { am:{status,capacity,used,remaining,closed}, … }.
  // Inert when unconfigured (every band resolves to capacity 1 / open). Defensive
  // so a capacity-read hiccup never breaks the availability endpoint.
  try {
    $capacity = hm_cap_day(hm_db(), $date);
  } catch (Throwable $ce) {
    hm_log_error('availability capacity read failed (non-fatal)', ['err' => $ce->getMessage(), 'date' => $date]);
  }

  hm_json(['ok' => true, 'date' => $date, 'bands' => $bands, 'intervals' => $intervals, 'hourly' => $hourly, 'capacity' => $capacity]);
} catch (Throwable $e) {
  hm_log_error('availability failed', ['err' => $e->getMessage(), 'date' => $date]);
  hm_json(['ok' => false, 'error' => hm_safe_msg('Request failed', $e)], 500);
}
