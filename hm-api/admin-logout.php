<?php
// ════════════════════════════════════════════════════════════════════════════
//  admin-logout.php — destroy the admin PHP session.
//
//  POST (X-API-KEY). Clears $_SESSION and expires the hm_admin_sid cookie. The
//  HMAC admin token is stateless, so the client also drops it from sessionStorage
//  (js/core/auth.js Auth.logout) and it lapses within admin_session_ttl.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_admin_users.php';
hm_cors();
header('Access-Control-Allow-Credentials: true');
hm_require_api_key();

try {
  hm_admin_session_destroy();
  hm_ok(['loggedOut' => true]);
} catch (Throwable $e) {
  hm_log_error('admin-logout failed', ['err' => $e->getMessage()]);
  hm_err(hm_safe_msg('Request failed', $e), 500);
}
