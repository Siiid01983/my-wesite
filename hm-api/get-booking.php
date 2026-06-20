<?php
// ════════════════════════════════════════════════════════════════════════════
//  get-booking.php — booking lookup for the customer portal (GET)
//
//  Query params (one of):
//    ?id=<uuid>         → single booking by primary key
//    ?ref=HM-XXXXXX     → single booking whose notes carry "ref:HM-XXXXXX"
//    ?email=<email>     → all bookings for a customer email (newest first)
//
//  Returns: { ok:true, data: row | row[] | null }
//  Returns RAW rows; the client (bookingService.js) unpacks notes.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_db.php';
hm_cors();

function decode_booking(?array $row): ?array {
  if (!$row) return null;
  if (isset($row['items']) && is_string($row['items'])) {
    $d = json_decode($row['items'], true);
    if ($d !== null || $row['items'] === 'null') $row['items'] = $d;
  }
  return $row;
}

$id    = trim((string)($_GET['id'] ?? ''));
$ref   = trim((string)($_GET['ref'] ?? ''));
$email = trim((string)($_GET['email'] ?? ''));
$db    = hm_db();

try {
  if ($id !== '') {
    $st = $db->prepare('SELECT * FROM bookings WHERE id = ? LIMIT 1');
    $st->execute([$id]);
    hm_json(['ok' => true, 'data' => decode_booking($st->fetch() ?: null)]);
  }
  if ($ref !== '') {
    $st = $db->prepare('SELECT * FROM bookings WHERE notes LIKE ? ORDER BY created_at DESC LIMIT 1');
    $st->execute(['%ref:' . $ref . '%']);
    hm_json(['ok' => true, 'data' => decode_booking($st->fetch() ?: null)]);
  }
  if ($email !== '') {
    $st = $db->prepare('SELECT * FROM bookings WHERE LOWER(customer_email) = ? ORDER BY created_at DESC');
    $st->execute([strtolower($email)]);
    hm_json(['ok' => true, 'data' => array_map('decode_booking', $st->fetchAll())]);
  }
  hm_json(['ok' => false, 'error' => 'id, ref or email required'], 400);
} catch (Throwable $e) {
  hm_json(['ok' => false, 'error' => $e->getMessage()], 500);
}
