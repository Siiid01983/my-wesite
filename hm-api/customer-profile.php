<?php
// ════════════════════════════════════════════════════════════════════════════
//  customer-profile.php — Customer Profile System, Phase 1 (READ-ONLY)
//
//  GET /hm-api/customer-profile.php?email=<e>&reference=<HM-xxx>
//
//  Ownership: the (email, reference) pair must match a booking (same server-side
//  check as auth.php); data is then scoped to that email only. Generic 'invalid'
//  for any mismatch (anti-enumeration). Stats are lazily computed from bookings.
//
//  → { ok:true, data:{ email, name, phone, total_bookings, first_booking_date,
//        last_booking_date, favorite_service, current_status }, error:null }
//
//  Never writes to bookings / booking_slots; only refreshes the profile cache.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_ratelimit.php';
require_once __DIR__ . '/_profiles.php';
hm_cors();
hm_require_api_key();
hm_rate_limit('general', 30, 60);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
  hm_json(['ok' => false, 'data' => null, 'error' => 'method not allowed — use GET'], 405);
}

$email = strtolower(trim((string)($_GET['email'] ?? '')));
$ref   = trim((string)($_GET['reference'] ?? ''));

if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || $ref === '') {
  hm_json(['ok' => false, 'data' => null, 'error' => 'invalid'], 400);
}

try {
  $db = hm_db();

  // Ownership gate — generic 'invalid' (no enumeration of emails/refs).
  if (!hm_profile_verify_owner($db, $email, $ref)) {
    if (function_exists('hm_log_auth_fail')) hm_log_auth_fail('customer_profile');
    hm_json(['ok' => false, 'data' => null, 'error' => 'invalid'], 404);
  }

  $p = hm_profile_get_or_refresh($db, $email);

  hm_json(['ok' => true, 'data' => [
    'email'              => $p['customer_email'] ?? $email,
    'name'               => $p['customer_name']  ?? '',
    'phone'              => $p['customer_phone'] ?? '',
    'total_bookings'     => (int)($p['total_bookings'] ?? 0),
    'first_booking_date' => $p['first_booking_date'] ?? null,
    'last_booking_date'  => $p['last_booking_date']  ?? null,
    'favorite_service'   => hm_profile_favorite_service($db, $email),
    'current_status'     => hm_profile_current_status($db, $email),
  ], 'error' => null]);

} catch (Throwable $e) {
  hm_log_error('customer-profile failed', ['err' => $e->getMessage()]);
  hm_json(['ok' => false, 'data' => null, 'error' => hm_safe_msg('Request failed', $e)], 500);
}
