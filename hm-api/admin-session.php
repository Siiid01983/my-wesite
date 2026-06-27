<?php
// ════════════════════════════════════════════════════════════════════════════
//  admin-session.php — report the current admin session / token validity.
//
//  POST or GET (X-API-KEY). Reads the HMAC admin token (header X-ADMIN-TOKEN)
//  and/or the PHP session cookie and returns whether the caller is an
//  authenticated admin, plus their public identity. Used by the SPA to confirm a
//  restored session is still valid (e.g. after reload) without re-login.
//
//  NOTE: this replaces the legacy "login against admin_pass_hash" behaviour.
//  Login is now admin-login.php (MySQL admin_users). rest.php enforcement uses
//  hm_require_admin() in _lib.php and does NOT call this endpoint, so the change
//  is backward compatible.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_admin_users.php';
hm_cors();
header('Access-Control-Allow-Credentials: true');
hm_require_api_key();

try {
  $tok   = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  $pl    = (is_string($tok) && $tok !== '') ? hm_admin_token_verify($tok) : null;
  // Revocation-aware: signature + role + account still active and not logged out
  // (shared check with rest.php / admin-users.php via hm_admin_token_account_valid).
  $valid = $pl !== null && ($pl['role'] ?? '') === 'admin' && hm_admin_token_account_valid($pl);

  $user = null;
  if ($valid && !empty($pl['uid'])) {
    $u = hm_admin_user_by_id((string)$pl['uid']);
    if ($u) $user = hm_admin_user_public($u);
  }

  // PHP-session identity (when the cookie is present) — secondary signal.
  $sess = hm_admin_session_user();

  hm_ok([
    'valid'    => $valid,
    'enforced' => hm_admin_auth_enabled(),
    'user'     => $user,
    'session'  => $sess ? ['email' => $sess['email'], 'role' => $sess['role']] : null,
  ]);
} catch (Throwable $e) {
  hm_log_error('admin-session failed', ['err' => $e->getMessage()]);
  hm_err(hm_safe_msg('Request failed', $e), 500);
}
