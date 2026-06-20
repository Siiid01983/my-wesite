<?php
// ════════════════════════════════════════════════════════════════════════════
//  admin/stats.php — admin dashboard statistics (GET)  <API_BASE>/admin/stats.php
//
//  Read-only aggregate counts for the admin dashboard. File-cached for 60s
//  (hm_cache) so a busy dashboard does not re-aggregate MySQL on every poll.
//  Returns the standard { data, error } envelope; data.cached flags a cache hit.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/../_db.php';
require_once __DIR__ . '/../_cache.php';
require_once __DIR__ . '/../_log.php';
require_once __DIR__ . '/../_ratelimit.php';
hm_cors();
hm_require_api_key();
hm_rate_limit('admin_stats', 20, 60);   // general tier (per-endpoint bucket)

$TTL = 60;   // seconds (within the 30–120s window)

$hit = hm_cache_get('admin_stats', $TTL);
if ($hit !== null) { $hit['cached'] = true; hm_ok($hit); }

try {
  $db = hm_db();
  $one = fn(string $sql) => (int)($db->query($sql)->fetch()['c'] ?? 0);

  $byStatus = [];
  foreach ($db->query('SELECT status, COUNT(*) c FROM bookings GROUP BY status') as $r) {
    $byStatus[(string)$r['status']] = (int)$r['c'];
  }

  $stats = [
    'total_bookings'  => $one('SELECT COUNT(*) c FROM bookings'),
    'today_bookings'  => $one('SELECT COUNT(*) c FROM bookings WHERE DATE(created_at) = CURDATE()'),
    'by_status'       => $byStatus,
    'pending'         => $byStatus['pending'] ?? 0,
    'services_total'  => $one('SELECT COUNT(*) c FROM services'),
    'services_active' => $one('SELECT COUNT(*) c FROM services WHERE active = 1'),
    'reviews_total'   => $one('SELECT COUNT(*) c FROM reviews'),
    'reviews_pending' => $one('SELECT COUNT(*) c FROM reviews WHERE approved = 0'),
    'generated_at'    => date('c'),
    'cached'          => false,
  ];

  hm_cache_set('admin_stats', $stats);
  hm_ok($stats);
} catch (Throwable $e) {
  hm_log_error('admin/stats failed', ['err' => $e->getMessage()]);
  hm_err('Stats query failed', 500, 'stats');
}
