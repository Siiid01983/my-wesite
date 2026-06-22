<?php
// ════════════════════════════════════════════════════════════════════════════
//  admin-session.php — server-side admin login → signed session token
//
//  POST JSON:
//    { action:'login',  password }   → { ok, data:{ token, exp, enforced } }
//    { action:'verify' } (X-ADMIN-TOKEN header) → { ok, data:{ valid, enforced } }
//
//  The token authorizes admin-only operations in rest.php (DELETE on any table +
//  writes to hm_data / services / calendar_availability / inbox_messages).
//
//  A token is minted whenever admin_pass_hash is provisioned and the password
//  verifies — INDEPENDENT of admin_auth_enabled — so admins already carry a
//  token before enforcement is switched on (zero-downtime cut-over). The
//  enabled flag only controls ENFORCEMENT (in rest.php).
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_ratelimit.php';
hm_cors();
hm_require_api_key();
hm_rate_limit('admin_session', 10, 60);   // 10 attempts / IP / minute

$p      = hm_body(true);
$action = (string)($p['action'] ?? 'login');

try {
  if ($action === 'login') {
    $hash = hm_admin_hash();
    if ($hash === '' || hm_admin_secret() === '') {
      // Not provisioned yet — tell the client so it simply skips token use.
      hm_json(['ok' => false, 'data' => null,
        'error' => ['message' => 'Admin auth not configured', 'code' => 'admin_auth_disabled']], 200);
    }
    $password = (string)($p['password'] ?? '');
    if ($password === '' || !password_verify($password, $hash)) {
      hm_log_auth_fail('admin_session');
      hm_err('Invalid credentials', 401, 'invalid');
    }
    $ttl = max(300, (int)(hm_config()['admin_session_ttl'] ?? 43200));
    $exp = time() + $ttl;
    $token = hm_admin_token_sign(['role' => 'admin', 'iat' => time(), 'exp' => $exp]);
    hm_ok(['token' => $token, 'exp' => $exp, 'enforced' => hm_admin_auth_enabled()]);
  }

  if ($action === 'verify') {
    $tok   = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
    $valid = is_string($tok) && $tok !== '' && hm_admin_token_verify($tok) !== null;
    hm_ok(['valid' => $valid, 'enforced' => hm_admin_auth_enabled()]);
  }

  hm_err('Unknown action', 400, 'bad_action');
} catch (Throwable $e) {
  hm_log_error('admin-session failed', ['err' => $e->getMessage()]);
  hm_err(hm_safe_msg('Request failed', $e), 500);
}
