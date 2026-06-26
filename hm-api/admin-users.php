<?php
// ════════════════════════════════════════════════════════════════════════════
//  admin-users.php — admin account management + password operations.
//
//  All actions authorize via the HMAC admin token (header X-ADMIN-TOKEN), minted
//  by admin-login.php and re-checked for revocation by hm_admin_require_token().
//  Account-mutating actions additionally require role 'admin' (managers cannot
//  manage accounts). Shares the data layer in _admin_users.php — no duplicated
//  logic with admin-login.php.
//
//  POST JSON { action, ... }:
//    list_users                                            (token)
//    create_user      { name, email, password, role }      (token, admin)  Create
//    update_user      { id, name?, email?, role?, active? } (token, admin)  Edit / Disable
//    reset_password   { id, new }                           (token, admin)  Reset → forces change
//    delete_user      { id }                                (token, admin)  Delete
//    change_password  { current, new }                      (token; own account)
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_admin_users.php';
require_once __DIR__ . '/_ratelimit.php';
hm_cors();
header('Access-Control-Allow-Credentials: true');
hm_require_api_key();
hm_rate_limit('admin_api', 90, 60);

$p      = hm_body(true);
$action = (string)($p['action'] ?? '');

try {
  // ── CHANGE OWN PASSWORD (any authenticated admin/manager) ────────────────────
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

  // ── LIST (any authenticated admin/manager) ───────────────────────────────────
  if ($action === 'list_users') {
    hm_admin_require_token();
    hm_ok(['users' => hm_admin_users_all()]);
  }

  // ── CREATE ───────────────────────────────────────────────────────────────────
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

  // ── EDIT / DISABLE (active flag) ─────────────────────────────────────────────
  if ($action === 'update_user') {
    $pl = hm_admin_require_token();
    hm_admin_require_manage_role($pl);
    $id = (string)($p['id'] ?? '');
    $target = hm_admin_user_by_id($id);
    if (!$target) hm_err('Account not found', 404, 'not_found');
    $patch = [];
    foreach (['name', 'email', 'role', 'active'] as $k) if (array_key_exists($k, $p)) $patch[$k] = $p[$k];
    // Guard: never demote/deactivate the last active admin.
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

  // ── RESET PASSWORD (admin-initiated → forces change on next login) ───────────
  if ($action === 'reset_password') {
    $pl = hm_admin_require_token();
    hm_admin_require_manage_role($pl);
    $id  = (string)($p['id'] ?? '');
    $new = (string)($p['new'] ?? '');
    if (!hm_admin_user_by_id($id)) hm_err('Account not found', 404, 'not_found');
    if (strlen($new) < 8) hm_err('Password too short', 400, 'weak');
    hm_admin_set_password($id, $new, true);
    hm_ok(['reset' => true]);
  }

  // ── DELETE ───────────────────────────────────────────────────────────────────
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
  hm_log_error('admin-users failed', ['action' => $action, 'err' => $e->getMessage()]);
  hm_err(hm_safe_msg('Request failed', $e), 500);
}
