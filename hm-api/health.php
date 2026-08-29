<?php
// ════════════════════════════════════════════════════════════════════════════
//  health.php — lightweight liveness + readiness probe.
//
//  Reached at:  <API_BASE>/health.php     (GET only; any other verb → 405)
//
//  Purpose: a dependency-free endpoint for uptime monitors, load-balancer
//  probes, and quick manual "is the API + DB up?" checks — WITHOUT an admin
//  token. It reuses the hardened hm_db() connector, so:
//     • DB reachable      → HTTP 200  { ok:true,  db:true,  ts:… }
//     • DB unreachable     → HTTP 503  (hm_db() emits {ok:false,db:false,error}
//                                       and exits before we reach the 200 below)
//     • query failed       → HTTP 503  { ok:false, db:false, ts:… }
//
//  Deliberately leaks NOTHING sensitive: no credentials, no PHP version, no
//  schema, no error internals — only booleans + a timestamp. Not API-key gated
//  so external monitors work with a bare request; rate-limited to deter abuse.
//
//  NOTE: no frontend code depends on this file; it is an additive ops endpoint.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_ratelimit.php';

hm_cors();                                  // CORS + OPTIONS + access log
hm_rate_limit('health', 120, 60);           // 120 req / min / IP

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
  header('Allow: GET');
  health_json(['ok' => false, 'error' => 'Method Not Allowed'], 405);
}

// Readiness = DB reachable. hm_db() itself returns 503 (and exits) on a
// connection/driver/credentials failure, so reaching past it means "connected".
$db = false;
try {
  hm_db()->query('SELECT 1');
  $db = true;
} catch (Throwable $e) {
  hm_log_error('health: DB query failed', ['err' => $e->getMessage()]);   // full detail → server log only
  $db = false;
}

health_json(['ok' => $db, 'db' => $db, 'ts' => gmdate('c')], $db ? 200 : 503);

function health_json(array $payload, int $status = 200): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}
