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

$p = hm_body();
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
$email = trim((string)($data['customer_email'] ?? ''));
$bdate = trim((string)($data['booking_date']   ?? ''));
$errs  = [];
if ($name === '')                                            $errs[] = 'name required';
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) $errs[] = 'valid email required';
if ($bdate === '' || strtotime($bdate) === false)            $errs[] = 'valid booking_date required';
if ($errs) {
  hm_log_write('error.log', ['type' => 'invalid_request', 'endpoint' => 'create-booking',
    'errors' => $errs, 'fp' => hm_client_fingerprint()]);
  hm_json(['ok' => false, 'error' => implode('; ', $errs)], 400);
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
  hm_json(['ok' => true, 'id' => $data['id']]);
} catch (Throwable $e) {
  hm_log_error('create-booking failed', ['err' => $e->getMessage()]);
  hm_json(['ok' => false, 'error' => $e->getMessage()], 500);
}
