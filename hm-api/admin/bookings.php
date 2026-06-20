<?php
// ════════════════════════════════════════════════════════════════════════════
//  admin/bookings.php — admin bookings list (GET)  <API_BASE>/admin/bookings.php
//
//  Query params:
//    ?status=pending     optional status filter
//    ?limit=200          1–1000, default 200 (newest first)
//
//  File-cached for 30s per (status,limit) key. Returns { data:[rows], error };
//  `items` JSON is decoded. The canonical write path stays rest.php — this is a
//  read-optimised convenience endpoint for the dashboard.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/../_db.php';
require_once __DIR__ . '/../_cache.php';
require_once __DIR__ . '/../_log.php';
hm_cors();
hm_require_api_key();

$TTL    = 30;   // seconds
$status = trim((string)($_GET['status'] ?? ''));
$limit  = (int)($_GET['limit'] ?? 200);
if ($limit < 1)    $limit = 1;
if ($limit > 1000) $limit = 1000;

$cacheKey = 'admin_bookings_' . ($status !== '' ? preg_replace('/[^A-Za-z0-9]/', '', $status) : 'all') . '_' . $limit;
$hit = hm_cache_get($cacheKey, $TTL);
if ($hit !== null) hm_ok($hit);

try {
  $db = hm_db();
  if ($status !== '') {
    $st = $db->prepare('SELECT * FROM bookings WHERE status = ? ORDER BY created_at DESC LIMIT ?');
    $st->bindValue(1, $status);
    $st->bindValue(2, $limit, PDO::PARAM_INT);
  } else {
    $st = $db->prepare('SELECT * FROM bookings ORDER BY created_at DESC LIMIT ?');
    $st->bindValue(1, $limit, PDO::PARAM_INT);
  }
  $st->execute();
  $rows = $st->fetchAll();

  foreach ($rows as &$r) {
    if (isset($r['items']) && is_string($r['items'])) {
      $d = json_decode($r['items'], true);
      if ($d !== null || $r['items'] === 'null') $r['items'] = $d;
    }
  }
  unset($r);

  hm_cache_set($cacheKey, $rows);
  hm_ok($rows);
} catch (Throwable $e) {
  hm_log_error('admin/bookings failed', ['err' => $e->getMessage()]);
  hm_err('Bookings query failed', 500, 'bookings');
}
