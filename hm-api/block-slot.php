<?php
// ════════════════════════════════════════════════════════════════════════════
//  block-slot.php — Manual Calendar Blocking (admin) for the Smart Booking Engine
//
//  Lets an admin mark a specific (date, band) as UNAVAILABLE by writing an
//  `admin_blocked` row into the SAME booking_slots table used by customer
//  reservations. Because availability.php reports ANY booking_slots row on a
//  band as "reserved", and create-booking.php's hm_slot_reserve() INSERT hits
//  the UNIQUE(booking_date,time_band,slot_index) key, a blocked band is treated
//  EXACTLY like a confirmed customer booking — no changes to availability.php,
//  create-booking.php, or _slots.php are needed.
//
//  ── Enforcement note ────────────────────────────────────────────────────────
//  Booking-time enforcement (a customer being turned away) only bites when the
//  server flag `slot_lock_enabled` is ON. With it OFF, a block still SHOWS as
//  reserved via availability.php but is not enforced at create time.
//
//  ── Auth (dual gate) ────────────────────────────────────────────────────────
//  1. Admin session token (header X-ADMIN-TOKEN) — verified inline (signature +
//     role=admin + account-valid). This works even when admin_auth_enabled is
//     OFF, so a logged-in admin's SPA request authenticates. (hm_require_admin()
//     itself can't be used here: it EXITS on failure and no-ops when disabled,
//     neither of which allows a fallback.)
//  2. Fallback: admin_setup_token in _config.php, passed as ?token= — for
//     cPanel/CLI/manual triggering with no admin session.
//  CLI is always trusted (run via cPanel Terminal).
//
//  ── Actions ─────────────────────────────────────────────────────────────────
//    block   : INSERT an admin_blocked row for (date, band). Idempotent. If a
//              REAL customer reservation already holds the slot → 409, no change.
//    unblock : DELETE only rows WHERE status='admin_blocked' for (date, band).
//              NEVER touches customer bookings (status guard).
//    list    : (GET) report which bands are admin_blocked on a date.
//
//  ── Request ─────────────────────────────────────────────────────────────────
//    GET or POST params (querystring, form, or JSON body):
//      action = block | unblock | list
//      date   = YYYY-MM-DD
//      band   = am | pm | ev | nt   (a JP label / time is normalised too)
//      token  = <admin_setup_token>  (only for the fallback gate)
//
//  ── Response ────────────────────────────────────────────────────────────────
//    { "ok":true, "action":"blocked", "date":"2026-07-20", "band":"pm" }
//    { "ok":true, "action":"unblocked", "date":"...", "band":"...", "removed":1 }
//    { "ok":true, "action":"list", "date":"...", "blocked":["pm","ev"] }
//    { "ok":false, "error":"..." }  (+ HTTP 4xx/5xx)
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_slots.php';

$isCli = (PHP_SAPI === 'cli');

// ── Output helper (CLI → stdout, HTTP → JSON response) ───────────────────────
function bs_out(array $payload, bool $isCli, int $status = 200): void {
  if ($isCli) {
    fwrite(STDOUT, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    exit;
  }
  hm_json($payload, $status);
}

// ── Canonical bands ──────────────────────────────────────────────────────────
const HM_BLOCK_BANDS = ['am', 'pm', 'ev', 'nt'];

// ── Read params from GET, POST, or a JSON body (in that precedence) ──────────
$body = [];
if (!$isCli) {
  $raw = file_get_contents('php://input');
  if ($raw !== '' && $raw !== false) {
    $j = json_decode($raw, true);
    if (is_array($j)) $body = $j;
  }
}
$argMap = [];
if ($isCli) {
  // CLI usage:  php block-slot.php <action> <date> <band>
  //   e.g.      php block-slot.php block 2026-07-20 pm
  $a = array_slice($argv, 1);
  if (isset($a[0])) $argMap['action'] = $a[0];
  if (isset($a[1])) $argMap['date']   = $a[1];
  if (isset($a[2])) $argMap['band']   = $a[2];
}
$param = function (string $k) use ($body, $argMap) {
  if (array_key_exists($k, $argMap))       return $argMap[$k];
  if (isset($_GET[$k]))                     return $_GET[$k];
  if (isset($_POST[$k]))                    return $_POST[$k];
  if (array_key_exists($k, $body))          return $body[$k];
  return null;
};

// ── HTTP guards: CORS, api-key, rate limit (CLI is trusted / local) ──────────
if (!$isCli) {
  require_once __DIR__ . '/_ratelimit.php';
  hm_cors();
  hm_require_api_key();
  hm_rate_limit('block_slot', 30, 60);   // admin action: max 30 / IP / minute
}

// ── Dual auth gate ───────────────────────────────────────────────────────────
if (!$isCli) {
  $authed = false;

  // (1) Admin session token — real inline verification (works even when the
  //     global admin_auth_enabled switch is OFF).
  $tok = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  if (is_string($tok) && $tok !== '') {
    $pl = hm_admin_token_verify($tok);
    if ($pl !== null && ($pl['role'] ?? '') === 'admin' && hm_admin_token_account_valid($pl)) {
      $authed = true;
    }
  }

  // (2) Fallback: admin_setup_token from _config.php (cPanel/manual trigger).
  if (!$authed) {
    $setup = (string)(hm_config()['admin_setup_token'] ?? '');
    $sent  = (string)($param('token') ?? '');
    if ($setup !== '' && hash_equals($setup, $sent)) $authed = true;
  }

  if (!$authed) {
    if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('block_slot');
    bs_out(['ok' => false, 'error' => 'forbidden — admin session (X-ADMIN-TOKEN) or ?token=<admin_setup_token> required'], false, 403);
  }
}

// ── Validate action ──────────────────────────────────────────────────────────
$action = strtolower(trim((string)($param('action') ?? '')));
if (!in_array($action, ['block', 'unblock', 'list'], true)) {
  bs_out(['ok' => false, 'error' => "invalid action — use 'block', 'unblock', or 'list'"], $isCli, 400);
}

// ── Validate date: strict YYYY-MM-DD AND a real calendar date ────────────────
$date = trim((string)($param('date') ?? ''));
$parsed = DateTime::createFromFormat('!Y-m-d', $date);
$de = DateTime::getLastErrors();
$validDate = $parsed instanceof DateTime
  && $parsed->format('Y-m-d') === $date
  && (($de['warning_count'] ?? 0) === 0)
  && (($de['error_count'] ?? 0) === 0);
if (!$validDate) {
  bs_out(['ok' => false, 'error' => 'invalid date — expected YYYY-MM-DD'], $isCli, 400);
}

try {
  $db = hm_db();
  hm_slot_ensure_table($db);   // idempotent (CREATE IF NOT EXISTS) — safe pre-backfill

  // ── list: report admin_blocked bands for the date (read-only) ──────────────
  if ($action === 'list') {
    $st = $db->prepare("SELECT time_band FROM booking_slots WHERE booking_date = ? AND status = 'admin_blocked'");
    $st->execute([$date]);
    $blocked = [];
    foreach ($st as $r) {
      $b = (string)($r['time_band'] ?? '');
      if (in_array($b, HM_BLOCK_BANDS, true)) $blocked[] = $b;
    }
    bs_out(['ok' => true, 'action' => 'list', 'date' => $date, 'blocked' => $blocked], $isCli);
  }

  // block / unblock need a band — validate + normalise to a canonical id.
  $rawBand = trim((string)($param('band') ?? ''));
  $band = strtolower($rawBand);
  if (!in_array($band, HM_BLOCK_BANDS, true)) {
    $norm = hm_slot_band_id($rawBand);   // accept a JP label / time string too
    if ($norm !== null && in_array($norm, HM_BLOCK_BANDS, true)) {
      $band = $norm;
    } else {
      bs_out(['ok' => false, 'error' => "invalid band — use one of am, pm, ev, nt"], $isCli, 400);
    }
  }

  if ($action === 'block') {
    // Deterministic, self-documenting synthetic booking_id (<=36 chars, CHAR(36)).
    $blockId = 'BLOCK_' . $date . '_' . $band;   // e.g. BLOCK_2026-07-20_pm (19)
    try {
      $ins = $db->prepare(
        'INSERT INTO booking_slots (id, booking_date, time_band, slot_index, booking_id, status)
         VALUES (?,?,?,0,?,?)'
      );
      $ins->execute([hm_slot_uuid(), $date, $band, $blockId, 'admin_blocked']);
      bs_out(['ok' => true, 'action' => 'blocked', 'date' => $date, 'band' => $band], $isCli);
    } catch (PDOException $e) {
      if (($e->errorInfo[0] ?? '') !== '23000') throw $e;   // non-collision error → bubble up
      // UNIQUE collision: the slot is already held. Distinguish an existing block
      // (idempotent success) from a real customer reservation (refuse).
      $q = $db->prepare('SELECT status FROM booking_slots WHERE booking_date = ? AND time_band = ? AND slot_index = 0 LIMIT 1');
      $q->execute([$date, $band]);
      $existing = (string)($q->fetchColumn() ?: '');
      if ($existing === 'admin_blocked') {
        bs_out(['ok' => true, 'action' => 'blocked', 'date' => $date, 'band' => $band, 'already' => true], $isCli);
      }
      bs_out(['ok' => false, 'error' => 'slot_already_reserved — a customer booking holds this slot; not overwritten', 'date' => $date, 'band' => $band], $isCli, 409);
    }
  }

  // action === 'unblock' — status guard makes this safe against real bookings.
  $del = $db->prepare("DELETE FROM booking_slots WHERE booking_date = ? AND time_band = ? AND slot_index = 0 AND status = 'admin_blocked'");
  $del->execute([$date, $band]);
  bs_out(['ok' => true, 'action' => 'unblocked', 'date' => $date, 'band' => $band, 'removed' => $del->rowCount()], $isCli);

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) hm_log_error('block-slot failed', ['err' => $e->getMessage(), 'date' => $date ?? '', 'action' => $action ?? '']);
  bs_out(['ok' => false, 'error' => hm_safe_msg('Request failed', $e)], $isCli, 500);
}
