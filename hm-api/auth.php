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
hm_cors();
hm_require_api_key();

$p     = hm_body();
$email = strtolower(trim((string)($p['email'] ?? '')));
$ref   = trim((string)($p['reference'] ?? ''));

if ($email === '' || strpos($email, '@') === false || $ref === '') {
  hm_json(['ok' => false, 'error' => 'invalid'], 400);
}

try {
  $st = hm_db()->prepare('SELECT * FROM bookings WHERE notes LIKE ? ORDER BY created_at DESC LIMIT 1');
  $st->execute(['%ref:' . $ref . '%']);
  $row = $st->fetch();

  if (!$row || strtolower(trim((string)($row['customer_email'] ?? ''))) !== $email) {
    hm_json(['ok' => false, 'error' => 'invalid']);
  }

  if (isset($row['items']) && is_string($row['items'])) {
    $d = json_decode($row['items'], true);
    if ($d !== null || $row['items'] === 'null') $row['items'] = $d;
  }
  hm_json(['ok' => true, 'booking' => $row]);
} catch (Throwable $e) {
  hm_json(['ok' => false, 'error' => 'server'], 500);
}
