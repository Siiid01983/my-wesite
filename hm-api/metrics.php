<?php
// ════════════════════════════════════════════════════════════════════════════
//  metrics.php — monitoring snapshot — GET <API_BASE>/metrics.php
//
//  Returns:
//    {
//      "status": "healthy" | "degraded",
//      "db": true|false,
//      "time": ISO-8601,
//      "uptime": seconds since first boot marker,
//      "requests_today": count of access.log entries dated today
//    }
//
//  Builds its own PDO (not hm_db(), which would exit with its own envelope on a
//  connection failure) so DB trouble is reported as "degraded" + db:false.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_log.php';
require_once __DIR__ . '/_ratelimit.php';
hm_cors();
hm_require_api_key();
hm_rate_limit('metrics', 20, 60);   // general tier

// Persistent boot marker — first request stamps it; uptime measures from there.
function hm_uptime_start(): int {
  $f = hm_log_dir() . '/.started';
  if (!is_file($f)) @file_put_contents($f, (string)time());
  $t = (int)@file_get_contents($f);
  return $t > 0 ? $t : time();
}

// Count today's requests from access.log (streamed line-by-line, memory-safe).
function hm_requests_today(): int {
  $f = hm_log_dir() . '/access.log';
  if (!is_file($f)) return 0;
  $needle = '"ts":"' . date('Y-m-d');
  $count  = 0;
  $fh = @fopen($f, 'r');
  if (!$fh) return 0;
  while (($line = fgets($fh)) !== false) if (strpos($line, $needle) !== false) $count++;
  fclose($fh);
  return $count;
}

$dbOk = false;
try {
  $c   = hm_config();
  $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s',
    $c['db_host'], $c['db_name'], $c['db_charset'] ?? 'utf8mb4');
  $pdo = new PDO($dsn, $c['db_user'], $c['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
  $pdo->query('SELECT 1');
  $dbOk = true;
} catch (Throwable $e) {
  hm_log_error('metrics: db check failed', ['err' => $e->getMessage()]);
}

hm_json([
  'status'         => $dbOk ? 'healthy' : 'degraded',
  'db'             => $dbOk,
  'time'           => date('c'),
  'uptime'         => max(0, time() - hm_uptime_start()),
  'requests_today' => hm_requests_today(),
], $dbOk ? 200 : 503);
