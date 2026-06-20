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
hm_cors();
hm_require_api_key();

$p = hm_body();
$ALLOWED = ['customer_name','customer_email','customer_phone','booking_date','service_id','status','notes','items','created_at'];

$data = [];
foreach ($ALLOWED as $c) {
  if (!array_key_exists($c, $p)) continue;
  $data[$c] = ($c === 'items') ? json_encode($p[$c], JSON_UNESCAPED_UNICODE) : $p[$c];
}
$data['id'] = hm_uuid4();
if (empty($data['status'])) $data['status'] = 'pending';

try {
  $keys = array_keys($data);
  $ph   = implode(',', array_fill(0, count($keys), '?'));
  $sql  = 'INSERT INTO bookings (' . implode(',', array_map(fn($c) => "`$c`", $keys)) . ") VALUES ($ph)";
  $st = hm_db()->prepare($sql);
  $st->execute(array_values($data));
  hm_json(['ok' => true, 'id' => $data['id']]);
} catch (Throwable $e) {
  hm_json(['ok' => false, 'error' => $e->getMessage()], 500);
}
