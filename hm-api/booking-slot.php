<?php
// ════════════════════════════════════════════════════════════════════════════
//  booking-slot.php — Admin slot reserve / release for a booking (Curama flow)
//
//  Gives the admin app a SLOT-AWARE way to confirm and reschedule bookings on
//  top of the SAME booking_slots table the customer flow uses. It wraps the
//  existing _slots.php primitives (hm_slot_reserve / hm_slot_release); it does
//  NOT touch rest.php, create-booking.php, availability.php or block-slot.php.
//
//  Collision is the DB UNIQUE(booking_date, time_band, slot_index) constraint —
//  reserving a band already held by another booking (or an admin block) fails
//  with 409 slot_taken. This is enforced here regardless of slot_lock_enabled
//  (that flag only gates the customer create-booking path).
//
//  ── Auth (dual gate, mirrors block-slot.php) ────────────────────────────────
//    1. Admin session token (header X-ADMIN-TOKEN), verified inline.
//    2. Fallback: admin_setup_token in _config.php as ?token= (cPanel/manual).
//    CLI is always trusted.
//
//  ── Actions (JSON body / GET / POST) ────────────────────────────────────────
//    reserve  { booking_id, date:YYYY-MM-DD, band:am|pm|ev|nt }
//        Atomic: release the booking's current slots, reserve the target band,
//        and sync bookings.booking_date. Idempotent for the same booking; a
//        band held by ANOTHER booking → 409. Used for CONFIRM and RESCHEDULE.
//    release  { booking_id }
//        Free every slot the booking holds (cancel / un-confirm).
//
//  ── Response ────────────────────────────────────────────────────────────────
//    { ok:true, action:"reserved",  booking_id, date, band }
//    { ok:true, action:"released",  booking_id, released:n }
//    { ok:false, error:"slot_taken", date, band }   HTTP 409
//    { ok:false, error:"..." }                       HTTP 4xx/5xx
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_slots.php';

$isCli = (PHP_SAPI === 'cli');

function bsx_out(array $payload, bool $isCli, int $status = 200): void {
  if ($isCli) {
    fwrite(STDOUT, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    exit;
  }
  hm_json($payload, $status);
}

const HM_BS_BANDS = ['am', 'pm', 'ev', 'nt'];
// A representative time per band so hm_slot_reserve() derives the right band id
// (hm_slot_band_id maps 8–12→am, 12–15→pm, 15–18→ev, 18–21→nt).
const HM_BS_BAND_TIME = ['am' => '09:00', 'pm' => '13:00', 'ev' => '16:00', 'nt' => '19:00'];

// ── Params from JSON body / GET / POST ───────────────────────────────────────
$body = [];
if (!$isCli) {
  $raw = file_get_contents('php://input');
  if ($raw !== '' && $raw !== false) {
    $j = json_decode($raw, true);
    if (is_array($j)) $body = $j;
  }
}
$param = function (string $k) use ($body) {
  if (isset($_GET[$k]))            return $_GET[$k];
  if (isset($_POST[$k]))           return $_POST[$k];
  if (array_key_exists($k, $body)) return $body[$k];
  return null;
};

// ── HTTP guards ──────────────────────────────────────────────────────────────
if (!$isCli) {
  require_once __DIR__ . '/_ratelimit.php';
  hm_cors();
  hm_require_api_key();
  hm_rate_limit('booking_slot', 30, 60);
}

// ── Dual auth gate (mirror block-slot.php) ───────────────────────────────────
if (!$isCli) {
  $authed = false;
  $tok = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  if (is_string($tok) && $tok !== '') {
    $pl = hm_admin_token_verify($tok);
    if ($pl !== null && ($pl['role'] ?? '') === 'admin' && hm_admin_token_account_valid($pl)) {
      $authed = true;
    }
  }
  if (!$authed) {
    $setup = (string)(hm_config()['admin_setup_token'] ?? '');
    $sent  = (string)($param('token') ?? '');
    if ($setup !== '' && hash_equals($setup, $sent)) $authed = true;
  }
  if (!$authed) {
    if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('booking_slot');
    bsx_out(['ok' => false, 'error' => 'forbidden — admin session (X-ADMIN-TOKEN) or ?token=<admin_setup_token> required'], false, 403);
  }
}

// ── Validate action + booking_id ─────────────────────────────────────────────
$action = strtolower(trim((string)($param('action') ?? '')));
if (!in_array($action, ['reserve', 'release'], true)) {
  bsx_out(['ok' => false, 'error' => "invalid action — use 'reserve' or 'release'"], $isCli, 400);
}
$bookingId = trim((string)($param('booking_id') ?? ''));
if ($bookingId === '') {
  bsx_out(['ok' => false, 'error' => 'booking_id required'], $isCli, 400);
}

try {
  $db = hm_db();
  hm_slot_ensure_table($db);

  // ── release ────────────────────────────────────────────────────────────────
  if ($action === 'release') {
    $n = hm_slot_release($db, $bookingId);
    bsx_out(['ok' => true, 'action' => 'released', 'booking_id' => $bookingId, 'released' => $n], $isCli);
  }

  // ── reserve (confirm / reschedule) — validate date + band ────────────────────
  $date = trim((string)($param('date') ?? ''));
  $parsed = DateTime::createFromFormat('!Y-m-d', $date);
  $de = DateTime::getLastErrors();
  $validDate = $parsed instanceof DateTime
    && $parsed->format('Y-m-d') === $date
    && (($de['warning_count'] ?? 0) === 0)
    && (($de['error_count'] ?? 0) === 0);
  if (!$validDate) {
    bsx_out(['ok' => false, 'error' => 'invalid date — expected YYYY-MM-DD'], $isCli, 400);
  }

  $band = strtolower(trim((string)($param('band') ?? '')));
  if (!in_array($band, HM_BS_BANDS, true)) {
    bsx_out(['ok' => false, 'error' => 'invalid band — use am|pm|ev|nt'], $isCli, 400);
  }
  $repTime = HM_BS_BAND_TIME[$band];

  // Atomic: free this booking's current slots, grab the target band, sync date.
  // Releasing our OWN slots first makes re-confirm / same-band idempotent; a
  // collision can then only come from ANOTHER booking (or an admin block).
  $db->beginTransaction();
  try {
    hm_slot_release($db, $bookingId);
    $res = hm_slot_reserve($db, $date, $repTime, $bookingId);
    if (!empty($res['conflict'])) {
      $db->rollBack();
      bsx_out(['ok' => false, 'error' => 'slot_taken', 'date' => $date, 'band' => $band], $isCli, 409);
    }
    $up = $db->prepare('UPDATE bookings SET booking_date = ? WHERE id = ?');
    $up->execute([$date, $bookingId]);
    $db->commit();
  } catch (Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    throw $e;
  }

  bsx_out(['ok' => true, 'action' => 'reserved', 'booking_id' => $bookingId, 'date' => $date, 'band' => $band], $isCli);

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) {
    hm_log_error('booking-slot failed', ['err' => $e->getMessage(), 'action' => $action ?? '', 'booking' => $bookingId ?? '']);
  }
  bsx_out(['ok' => false, 'error' => hm_safe_msg('Request failed', $e)], $isCli, 500);
}
