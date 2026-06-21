<?php
// ════════════════════════════════════════════════════════════════════════════
//  create-booking.php — public booking form submit (POST JSON)
//
//  Body: a booking row already shaped by the client (customer_name,
//        customer_email, customer_phone, booking_date, service_id, status,
//        notes [HM-ref + from/to/service packed], items, created_at).
//  Returns: { ok:true, id } | { ok:false, error }
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_cache.php';
require_once __DIR__ . '/_ratelimit.php';
hm_cors();
hm_require_api_key();
hm_rate_limit('booking', 5, 60);   // public submit: max 5 / IP / minute

$p = hm_body(true);
$ALLOWED = ['customer_name','customer_email','customer_phone','booking_date','service_id','status','notes','items','created_at'];

$data = [];
foreach ($ALLOWED as $c) {
  if (!array_key_exists($c, $p)) continue;
  $data[$c] = ($c === 'items') ? json_encode($p[$c], JSON_UNESCAPED_UNICODE) : $p[$c];
}

// ── Validate required fields (go-live hardening) ─────────────────────────────
//  NOTE: service_id is intentionally NOT range/numeric-checked — the public form
//  always sends service_id=null and packs the chosen service into `notes`
//  (bookingService._packNotes). The column is VARCHAR; numeric validation would
//  reject every legitimate booking.
$name  = trim((string)($data['customer_name']  ?? ''));
$name  = preg_replace('/\s+/u', ' ', $name);   // normalize internal whitespace
$email = trim((string)($data['customer_email'] ?? ''));
$phone = trim((string)($data['customer_phone'] ?? ''));
$bdate = trim((string)($data['booking_date']   ?? ''));
$bts   = $bdate === '' ? false : strtotime($bdate);
$errs  = [];
if ($name === '')                                            $errs[] = 'name required';
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) $errs[] = 'valid email required';
if (strlen(preg_replace('/\D/', '', $phone)) < 8)            $errs[] = 'valid phone required';
if ($bdate === '' || $bts === false)                         $errs[] = 'valid booking_date required';
// Reject clearly-past dates (anti-tampering). 1-day grace avoids timezone
// false-positives for legitimate same-day bookings (server TZ vs client JST).
elseif ($bts < strtotime('today') - 86400)                   $errs[] = 'booking_date must not be in the past';
if ($errs) {
  hm_log_write('error.log', ['type' => 'invalid_request', 'endpoint' => 'create-booking',
    'errors' => $errs, 'fp' => hm_client_fingerprint()]);
  hm_json(['ok' => false, 'data' => null, 'error' => implode('; ', $errs)], 400);
}

// Store normalized values; cap lengths + strip control chars (anti-abuse defense
// in depth). Output is HTML-escaped at render time, so legitimate input is NOT
// HTML-stripped here — \n and \t are preserved for multi-line notes.
$data['customer_name']  = $name;
$data['customer_email'] = $email;
$data['customer_phone'] = $phone;
$CAPS = ['customer_name'=>200,'customer_email'=>254,'customer_phone'=>40,'booking_date'=>40,'status'=>40,'notes'=>5000];
foreach ($CAPS as $col => $max) {
  if (!isset($data[$col]) || !is_string($data[$col])) continue;
  $data[$col] = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', $data[$col]);
  if (mb_strlen($data[$col]) > $max) $data[$col] = mb_substr($data[$col], 0, $max);
}

// items (if ever sent): must be a JSON array of bounded size — re-encode from the
// raw decoded payload so only well-formed data is stored. The BA overlay packs
// items into `notes`, so this is defensive for future callers.
if (array_key_exists('items', $data)) {
  $items = (isset($p['items']) && is_array($p['items'])) ? $p['items'] : [];
  if (count($items) > 100) $items = array_slice($items, 0, 100);
  $enc = json_encode($items, JSON_UNESCAPED_UNICODE);
  $data['items'] = (is_string($enc) && strlen($enc) <= 20000) ? $enc : '[]';
}

$data['id'] = hm_uuid4();
if (empty($data['status'])) $data['status'] = 'pending';

try {
  $keys = array_keys($data);
  $ph   = implode(',', array_fill(0, count($keys), '?'));
  $sql  = 'INSERT INTO bookings (' . implode(',', array_map(fn($c) => "`$c`", $keys)) . ") VALUES ($ph)";
  $st = hm_db()->prepare($sql);
  $st->execute(array_values($data));
  hm_log_booking($data['id'], ['email' => (string)($data['customer_email'] ?? ''), 'date' => (string)($data['booking_date'] ?? '')]);
  hm_cache_invalidate_table('bookings');   // dashboard stats / lists pick this up
  // `id` kept top-level for back-compat; data/error added for the standard envelope.
  hm_json(['ok' => true, 'id' => $data['id'], 'data' => ['id' => $data['id']], 'error' => null]);
} catch (Throwable $e) {
  hm_log_error('create-booking failed', ['err' => $e->getMessage()]);
  hm_json(['ok' => false, 'data' => null, 'error' => hm_safe_msg('Request failed', $e)], 500);
}
