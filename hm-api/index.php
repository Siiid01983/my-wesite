<?php
// ════════════════════════════════════════════════════════════════════════════
//  Health check — GET <API_BASE>/index.php
//    config missing → { error: "API not configured ..." }   (from hm_config)
//    DB unreachable → { "ok": false, "db": false, "error": "..." }   HTTP 500
//    all good       → { "ok": true,  "db": true,  "time": "..." }
//
//  Builds its own PDO (not hm_db()) so a connection failure is reported as the
//  { ok:false, db:false, error } shape instead of hm_db()'s generic envelope.
//
//  ADMIN-GATED DIAGNOSTICS: when the request carries a valid admin token
//  (X-Admin-Token), the response additionally includes a `diag` block with the
//  PHP version and the extensions the SMTP path relies on. The public,
//  unauthenticated shape is unchanged — the version is never exposed to anon
//  callers (expose_php is Off on the host).
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';

// Soft admin check — mirrors hm_require_admin()'s verification but NEVER exits,
// so the health endpoint stays reachable for anonymous callers and only gains
// the diag block for an authenticated admin. (Independent of admin_auth_enabled:
// a validly signed, non-revoked admin token is sufficient.)
function hm_health_is_admin(): bool {
  $tok = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  if (!is_string($tok) || $tok === '') return false;
  $p = hm_admin_token_verify($tok);
  return $p !== null && ($p['role'] ?? '') === 'admin' && hm_admin_token_account_valid($p);
}

// Runtime diagnostics for an authenticated admin only. Confirms the PHP version
// and that the extensions the email/SMTP transport needs are loaded.
function hm_health_diag(): array {
  return [
    'php'     => PHP_VERSION,
    'php_id'  => PHP_VERSION_ID,
    'sapi'    => PHP_SAPI,
    'ext'     => [
      'openssl'   => extension_loaded('openssl'),    // SMTP STARTTLS / implicit TLS
      'mbstring'  => extension_loaded('mbstring'),    // mb_encode_mimeheader (subjects)
      'pdo_mysql' => extension_loaded('pdo_mysql'),   // DB
    ],
  ];
}

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
  $out = ['ok' => true, 'db' => true, 'time' => date('c')];
  if (hm_health_is_admin()) $out['diag'] = hm_health_diag();
  hm_json($out);
} catch (Throwable $e) {
  hm_log_error('healthcheck failed', ['err' => $e->getMessage()]);
  $out = ['ok' => false, 'db' => false, 'error' => hm_safe_msg('Request failed', $e)];
  if (hm_health_is_admin()) $out['diag'] = hm_health_diag();
  hm_json($out, 500);
}
