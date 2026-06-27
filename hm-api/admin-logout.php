<?php
// ════════════════════════════════════════════════════════════════════════════
//  admin-logout.php — destroy the admin PHP session.
//
//  POST (X-API-KEY). Clears $_SESSION and expires the hm_admin_sid cookie, AND
//  server-side revokes every outstanding HMAC token for the account (sets the
//  tokens_valid_after cutoff) so the stateless token can no longer authorize
//  admin writes from any other tab/device after logout — closing the "logout in
//  one place, token still works elsewhere until expiry" gap. The client also
//  drops the token from sessionStorage (js/core/auth.js Auth.logout).
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_admin_users.php';
hm_cors();
header('Access-Control-Allow-Credentials: true');
hm_require_api_key();

try {
  // Revoke all tokens for the calling account (best-effort — a missing/expired
  // token simply means there is nothing to revoke beyond the PHP session).
  $tok = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  $pl  = (is_string($tok) && $tok !== '') ? hm_admin_token_verify($tok) : null;
  if ($pl && !empty($pl['uid'])) hm_admin_revoke_tokens((string)$pl['uid']);

  hm_admin_session_destroy();
  hm_ok(['loggedOut' => true]);
} catch (Throwable $e) {
  hm_log_error('admin-logout failed', ['err' => $e->getMessage()]);
  hm_err(hm_safe_msg('Request failed', $e), 500);
}
