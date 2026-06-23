<?php
// ════════════════════════════════════════════════════════════════════════════
//  admin-login.php — MySQL-backed admin authentication (hybrid session + token)
//
//  Replaces the browser localStorage credential store (hm_admin_creds / hm_staff)
//  with the admin_users table. On a successful login this endpoint:
//    1. password_verify()s the password against admin_users.pass_hash,
//    2. starts a hardened PHP session (hm_admin_session_set),
//    3. mints the EXISTING HMAC admin token (hm_admin_token_sign) so rest.php's
//       hm_require_admin() gate keeps working with no changes.
//
//  POST JSON  { action, ... }:
//    login                 { email, password }
//    logout                                              (destroys session)
//    verify                                  (X-ADMIN-TOKEN header)
//    change_password       { current, new }  (token; own account)
//    force_change_password { new }           (token; only when must_change)
//    list_users                              (token, role admin)
//    create_user           { name, email, password, role }   (token, role admin)
//    update_user           { id, name?, email?, role?, active? } (token, role admin)
//    reset_password        { id, new }       (token, role admin)  → forces must_change
//    delete_user           { id }            (token, role admin)
//
//  Envelope: { ok, data, error } (hm_ok / hm_err in _lib.php).
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_admin_users.php';
require_once __DIR__ . '/_ratelimit.php';
hm_cors();
// Allow the browser to send/receive the PHP session cookie cross-origin. Safe
// alongside the reflected (non-'*') Access-Control-Allow-Origin from hm_cors().
header('Access-Control-Allow-Credentials: true');
hm_require_api_key();
// General per-IP throttle for the whole endpoint (defence-in-depth on top of the
// stricter per-action limits below). Generous enough for the app's own bursts
// (login → list_users → staff render), tight enough to bound abuse.
hm_rate_limit('admin_api', 90, 60);

$p      = hm_body(true);
$action = (string)($p['action'] ?? 'login');

// Mint the existing HMAC admin token for a verified user. role:'admin' keeps the
// rest.php gate satisfied for both admin + manager (panel operators); the real
// account role travels in `urole` for management-permission checks.
function hm_admin_issue_token(array $user): array {
  $ttl = max(300, (int)(hm_config()['admin_session_ttl'] ?? 43200));
  $exp = time() + $ttl;
  $token = hm_admin_token_sign([
    'role'  => 'admin',
    'uid'   => (string)$user['id'],
    'urole' => (string)$user['role'],
    'iat'   => time(),
    'exp'   => $exp,
  ]);
  return ['token' => $token, 'exp' => $exp];
}

try {
  // ── LOGIN ───────────────────────────────────────────────────────────────────
  if ($action === 'login') {
    hm_rate_limit('admin_login', 10, 60);   // 10 attempts / IP / minute

    if (hm_admin_secret() === '') {
      // Without the signing secret, tokens cannot be verified by rest.php or the
      // management actions — refuse rather than mint a dead token.
      hm_log_error('admin-login: admin_session_secret missing');
      hm_err('Admin auth misconfigured', 503, 'admin_secret_missing');
    }
    if (!hm_admin_users_table_exists()) {
      hm_err('Admin auth not provisioned', 503, 'admin_users_unprovisioned');
    }
    $email = strtolower(trim((string)($p['email'] ?? '')));
    $pass  = (string)($p['password'] ?? '');
    if ($email === '' || $pass === '') hm_err('Invalid credentials', 401, 'invalid');

    $user = hm_admin_user_by_email($email);
    // Always run a verify to keep timing uniform whether or not the email exists.
    $hash = $user['pass_hash'] ?? '$2y$10$0000000000000000000000000000000000000000000000000000z';
    $okPass = password_verify($pass, $hash);

    if (!$user || !$okPass || !(int)$user['active']) {
      hm_log_auth_fail('admin_login');
      hm_err('Invalid credentials', 401, 'invalid');
    }

    // Opportunistic rehash if the cost/algorithm changed.
    if (password_needs_rehash($user['pass_hash'], PASSWORD_DEFAULT)) {
      try { hm_admin_set_password((string)$user['id'], $pass, (bool)(int)$user['must_change']); } catch (Throwable $e) {}
    }

    hm_admin_touch_login((string)$user['id']);
    hm_admin_session_set($user);
    $tok = hm_admin_issue_token($user);

    hm_ok([
      'token'      => $tok['token'],
      'exp'        => $tok['exp'],
      'enforced'   => hm_admin_auth_enabled(),
      'mustChange' => (bool)(int)$user['must_change'],
      'user'       => hm_admin_user_public($user),
    ]);
  }

  // ── LOGOUT ──────────────────────────────────────────────────────────────────
  // Destroys the PHP session. The HMAC token is stateless (cannot be revoked
  // server-side without a denylist); the client drops it from sessionStorage and
  // it expires within admin_session_ttl. See ADMIN_AUTH_MIGRATION.md.
  if ($action === 'logout') {
    hm_admin_session_destroy();
    hm_ok(['loggedOut' => true]);
  }

  // ── VERIFY ──────────────────────────────────────────────────────────────────
  if ($action === 'verify') {
    $tok   = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
    $pl    = (is_string($tok) && $tok !== '') ? hm_admin_token_verify($tok) : null;
    $valid = $pl !== null && ($pl['role'] ?? '') === 'admin';
    hm_ok(['valid' => $valid, 'enforced' => hm_admin_auth_enabled()]);
  }

  // ── CHANGE OWN PASSWORD ──────────────────────────────────────────────────────
  if ($action === 'change_password') {
    hm_rate_limit('admin_pw', 10, 60);   // bound current-password guessing (even with a valid token)
    $pl   = hm_admin_require_token();
    $user = hm_admin_user_by_id((string)($pl['uid'] ?? ''));
    if (!$user) hm_err('Account not found', 404, 'not_found');
    $cur = (string)($p['current'] ?? '');
    $new = (string)($p['new'] ?? '');
    if (strlen($new) < 8) hm_err('Password too short', 400, 'weak');
    if (!password_verify($cur, $user['pass_hash'])) {
      hm_log_auth_fail('admin_change_pw');
      hm_err('Current password incorrect', 401, 'invalid');
    }
    hm_admin_set_password((string)$user['id'], $new, false);
    hm_ok(['changed' => true]);
  }

  // ── FORCED PASSWORD CHANGE (must_change gate) ────────────────────────────────
  if ($action === 'force_change_password') {
    $pl   = hm_admin_require_token();
    $user = hm_admin_user_by_id((string)($pl['uid'] ?? ''));
    if (!$user) hm_err('Account not found', 404, 'not_found');
    if (!(int)$user['must_change']) hm_err('Not permitted', 403, 'forbidden');
    $new = (string)($p['new'] ?? '');
    if (strlen($new) < 8) hm_err('Password too short', 400, 'weak');
    hm_admin_set_password((string)$user['id'], $new, false);
    hm_ok(['changed' => true]);
  }

  // ── USER MANAGEMENT (role 'admin' only) ──────────────────────────────────────
  if ($action === 'list_users') {
    hm_admin_require_token();
    hm_ok(['users' => hm_admin_users_all()]);
  }

  if ($action === 'create_user') {
    $pl = hm_admin_require_token();
    hm_admin_require_manage_role($pl);
    $name  = trim((string)($p['name'] ?? ''));
    $email = strtolower(trim((string)($p['email'] ?? '')));
    $pass  = (string)($p['password'] ?? '');
    $role  = (string)($p['role'] ?? 'manager');
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) hm_err('Invalid email', 400, 'bad_email');
    if (strlen($pass) < 8) hm_err('Password too short', 400, 'weak');
    if (hm_admin_user_by_email($email)) hm_err('Email already exists', 409, 'duplicate');
    $created = hm_admin_user_create($name, $email, $pass, $role, false);
    hm_ok(['user' => $created]);
  }

  if ($action === 'update_user') {
    $pl = hm_admin_require_token();
    hm_admin_require_manage_role($pl);
    $id = (string)($p['id'] ?? '');
    $target = hm_admin_user_by_id($id);
    if (!$target) hm_err('Account not found', 404, 'not_found');
    // Guard: never demote/deactivate the last active admin.
    $patch = [];
    foreach (['name', 'email', 'role', 'active'] as $k) if (array_key_exists($k, $p)) $patch[$k] = $p[$k];
    $willLosePrivilege = (isset($patch['role']) && $patch['role'] !== 'admin')
                      || (isset($patch['active']) && !$patch['active']);
    if ((int)$target['active'] && $target['role'] === 'admin' && $willLosePrivilege
        && hm_admin_count_active_admins($id) === 0) {
      hm_err('Cannot remove the last admin', 409, 'last_admin');
    }
    if (isset($patch['email']) && filter_var($patch['email'], FILTER_VALIDATE_EMAIL) === false) {
      hm_err('Invalid email', 400, 'bad_email');
    }
    hm_admin_user_update($id, $patch);
    hm_ok(['user' => hm_admin_user_public(hm_admin_user_by_id($id))]);
  }

  if ($action === 'reset_password') {
    $pl = hm_admin_require_token();
    hm_admin_require_manage_role($pl);
    $id  = (string)($p['id'] ?? '');
    $new = (string)($p['new'] ?? '');
    if (!hm_admin_user_by_id($id)) hm_err('Account not found', 404, 'not_found');
    if (strlen($new) < 8) hm_err('Password too short', 400, 'weak');
    // Admin-initiated reset forces the target to choose a new password next login.
    hm_admin_set_password($id, $new, true);
    hm_ok(['reset' => true]);
  }

  if ($action === 'delete_user') {
    $pl = hm_admin_require_token();
    hm_admin_require_manage_role($pl);
    $id = (string)($p['id'] ?? '');
    if ($id === (string)($pl['uid'] ?? '')) hm_err('Cannot delete your own account', 409, 'self_delete');
    $target = hm_admin_user_by_id($id);
    if (!$target) hm_err('Account not found', 404, 'not_found');
    if ((int)$target['active'] && $target['role'] === 'admin' && hm_admin_count_active_admins($id) === 0) {
      hm_err('Cannot delete the last admin', 409, 'last_admin');
    }
    hm_admin_user_delete($id);
    hm_ok(['deleted' => true]);
  }

  hm_err('Unknown action', 400, 'bad_action');
} catch (Throwable $e) {
  hm_log_error('admin-login failed', ['action' => $action, 'err' => $e->getMessage()]);
  hm_err(hm_safe_msg('Request failed', $e), 500);
}
