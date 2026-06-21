<?php
// ════════════════════════════════════════════════════════════════════════════
//  Health check — GET <API_BASE>/index.php
//    config missing → { error: "API not configured ..." }   (from hm_config)
//    DB unreachable → { "ok": false, "db": false, "error": "..." }   HTTP 500
//    all good       → { "ok": true,  "db": true,  "time": "..." }
//
//  Builds its own PDO (not hm_db()) so a connection failure is reported as the
//  { ok:false, db:false, error } shape instead of hm_db()'s generic envelope.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';

// Health check stays reachable even when the server is not configured yet:
// answer {ok:false, db:false} instead of the generic "API not configured" exit.
if (!hm_has_config()) {
  header('Access-Control-Allow-Origin: *');
  hm_json(['ok' => false, 'db' => false, 'error' => 'DB not configured'], 503);
}

hm_cors();

try {
  $c   = hm_config();
  $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s',
    $c['db_host'], $c['db_name'], $c['db_charset'] ?? 'utf8mb4');
  $pdo = new PDO($dsn, $c['db_user'], $c['db_pass'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
  ]);
  $pdo->query('SELECT 1');
  hm_json(['ok' => true, 'db' => true, 'time' => date('c')]);
} catch (Throwable $e) {
  hm_log_error('healthcheck failed', ['err' => $e->getMessage()]);
  hm_json(['ok' => false, 'db' => false, 'error' => hm_safe_msg('Request failed', $e)], 500);
}
