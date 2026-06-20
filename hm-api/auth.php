<?php
// ════════════════════════════════════════════════════════════════════════════
//  auth.php — customer portal login (POST JSON)
//
//  Verifies Email + Booking Reference SERVER-SIDE against the bookings table.
//  Body:    { email, reference }
//  Returns: { ok:true, booking } | { ok:false, error:'invalid' }
//
//  A generic 'invalid' is returned for both "ref not found" and "email mismatch"
//  so the endpoint never discloses whether a reference exists (anti-enumeration).
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_ratelimit.php';
hm_cors();
hm_require_api_key();
hm_rate_limit('auth', 10, 60);   // portal login: max 10 attempts / IP / minute

$p     = hm_body();
$email = strtolower(trim((string)($p['email'] ?? '')));
$ref   = trim((string)($p['reference'] ?? ''));

// Strict input validation (required fields + RFC-ish email format).
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || $ref === '') {
  hm_log_write('error.log', ['type' => 'invalid_request', 'endpoint' => 'auth',
    'reason' => 'bad_email_or_ref', 'fp' => hm_client_fingerprint()]);
  hm_json(['ok' => false, 'data' => null, 'error' => 'invalid'], 400);
}

try {
  $st = hm_db()->prepare('SELECT * FROM bookings WHERE notes LIKE ? ORDER BY created_at DESC LIMIT 1');
  $st->execute(['%ref:' . $ref . '%']);
  $row = $st->fetch();

  if (!$row || strtolower(trim((string)($row['customer_email'] ?? ''))) !== $email) {
    hm_log_auth_fail('portal_login');
    hm_json(['ok' => false, 'data' => null, 'error' => 'invalid']);
  }

  if (isset($row['items']) && is_string($row['items'])) {
    $d = json_decode($row['items'], true);
    if ($d !== null || $row['items'] === 'null') $row['items'] = $d;
  }
  // `booking` kept top-level for portalAuth.js; data/error added for the standard envelope.
  hm_json(['ok' => true, 'booking' => $row, 'data' => ['booking' => $row], 'error' => null]);
} catch (Throwable $e) {
  hm_log_error('auth failed', ['err' => $e->getMessage()]);
  hm_json(['ok' => false, 'data' => null, 'error' => 'server'], 500);
}
