<?php
// ════════════════════════════════════════════════════════════════════════════
//  _admin_users.php — shared helpers for MySQL-backed admin authentication.
//
//  Included by admin-login.php and admin-migrate.php. NOT callable directly
//  (denied by .htaccess). Provides: the admin_users data layer (lookup / list /
//  create / update / password ops), the secure PHP session bootstrap, and the
//  token-based authorization guard reused for management actions.
//
//  Auth model (HYBRID — see ADMIN_AUTH_MIGRATION.md):
//    • Credentials live in MySQL admin_users (password_hash / password_verify).
//    • On login admin-login.php starts a PHP session AND mints the existing
//      HMAC admin token (hm_admin_token_sign in _lib.php). rest.php keeps using
//      that token via hm_require_admin() — unchanged.
//    • Management actions (list/create/update/delete users) are authorized by a
//      valid admin token (header X-ADMIN-TOKEN, role 'admin') — header-based so
//      it works cross-origin exactly like the existing rest.php gate.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_db.php';   // pulls in _lib.php (token sign/verify, hm_config, hm_uuid4)

const HM_ADMIN_ROLES = ['admin', 'manager'];

// ── Table presence / provisioning ────────────────────────────────────────────
// True when the admin_users table exists. Cached per-request.
function hm_admin_users_table_exists(): bool {
  static $exists = null;
  if ($exists !== null) return $exists;
  try {
    $st = hm_db()->query("SHOW TABLES LIKE 'admin_users'");
    $exists = $st !== false && $st->fetch() !== false;
  } catch (Throwable $e) {
    $exists = false;
  }
  return $exists;
}

// True when the table exists AND holds at least one active admin-role account.
// Used by hm_admin_auth_enabled() so enforcement can switch fully onto MySQL
// (the legacy single-hash in _config.php is no longer required).
function hm_admin_users_provisioned(): bool {
  if (!hm_admin_users_table_exists()) return false;
  try {
    $st = hm_db()->query("SELECT COUNT(*) AS c FROM admin_users WHERE active=1 AND role='admin'");
    return (int)($st->fetch()['c'] ?? 0) > 0;
  } catch (Throwable $e) {
    return false;
  }
}

// ── Lookups ───────────────────────────────────────────────────────────────────
function hm_admin_user_by_email(string $email): ?array {
  $email = strtolower(trim($email));
  if ($email === '') return null;
  $st = hm_db()->prepare('SELECT * FROM admin_users WHERE email = ? LIMIT 1');
  $st->execute([$email]);
  $row = $st->fetch();
  return $row ?: null;
}

function hm_admin_user_by_id(string $id): ?array {
  if ($id === '') return null;
  $st = hm_db()->prepare('SELECT * FROM admin_users WHERE id = ? LIMIT 1');
  $st->execute([$id]);
  $row = $st->fetch();
  return $row ?: null;
}

function hm_admin_users_all(): array {
  $st = hm_db()->query('SELECT * FROM admin_users ORDER BY created_at ASC');
  return array_map('hm_admin_user_public', $st->fetchAll());
}

// Strip secrets; shape for the client. Mirrors the localStorage staff shape the
// admin UI already consumes (id/name/email/role/active/lastLogin).
function hm_admin_user_public(array $row): array {
  return [
    'id'         => (string)$row['id'],
    'name'       => (string)($row['name'] ?? ''),
    'email'      => (string)($row['email'] ?? ''),
    'role'       => (string)($row['role'] ?? 'admin'),
    'active'     => (bool)(int)($row['active'] ?? 0),
    'mustChange' => (bool)(int)($row['must_change_password'] ?? 0),
    'lastLogin'  => $row['last_login'] ?? null,
    'createdAt'  => $row['created_at'] ?? null,
  ];
}

// ── Mutations ─────────────────────────────────────────────────────────────────
function hm_admin_user_create(string $name, string $email, string $password, string $role, bool $mustChange = false): array {
  $email = strtolower(trim($email));
  $role  = in_array($role, HM_ADMIN_ROLES, true) ? $role : 'manager';
  $id    = hm_uuid4();
  $hash  = password_hash($password, PASSWORD_DEFAULT);
  $st = hm_db()->prepare(
    'INSERT INTO admin_users (id, email, name, pass_hash, role, active, must_change_password)
     VALUES (?, ?, ?, ?, ?, 1, ?)'
  );
  $st->execute([$id, $email, trim($name), $hash, $role, $mustChange ? 1 : 0]);
  return hm_admin_user_public(hm_admin_user_by_id($id));
}

// Partial update of profile fields (never the password — use hm_admin_set_password).
function hm_admin_user_update(string $id, array $patch): bool {
  $sets = []; $params = [];
  if (array_key_exists('name', $patch))   { $sets[] = 'name = ?';   $params[] = trim((string)$patch['name']); }
  if (array_key_exists('email', $patch))  { $sets[] = 'email = ?';  $params[] = strtolower(trim((string)$patch['email'])); }
  if (array_key_exists('role', $patch))   {
    $role = in_array($patch['role'], HM_ADMIN_ROLES, true) ? $patch['role'] : 'manager';
    $sets[] = 'role = ?'; $params[] = $role;
  }
  if (array_key_exists('active', $patch)) { $sets[] = 'active = ?'; $params[] = $patch['active'] ? 1 : 0; }
  if (!$sets) return false;
  $params[] = $id;
  $st = hm_db()->prepare('UPDATE admin_users SET ' . implode(', ', $sets) . ' WHERE id = ?');
  $st->execute($params);
  return $st->rowCount() >= 0;
}

// Set a new password. $mustChange=true forces a change on next login (used by
// admin-initiated resets, so the target must pick their own password).
function hm_admin_set_password(string $id, string $password, bool $mustChange = false): bool {
  $hash = password_hash($password, PASSWORD_DEFAULT);
  $st = hm_db()->prepare('UPDATE admin_users SET pass_hash = ?, must_change_password = ?, reset_hash = NULL, reset_expires = NULL WHERE id = ?');
  $st->execute([$hash, $mustChange ? 1 : 0, $id]);
  return $st->rowCount() >= 0;
}

function hm_admin_user_delete(string $id): bool {
  $st = hm_db()->prepare('DELETE FROM admin_users WHERE id = ?');
  $st->execute([$id]);
  return $st->rowCount() > 0;
}

function hm_admin_touch_login(string $id): void {
  try {
    $st = hm_db()->prepare('UPDATE admin_users SET last_login = NOW() WHERE id = ?');
    $st->execute([$id]);
  } catch (Throwable $e) { /* non-fatal */ }
}

// Count active admin-role accounts (guards "don't delete/demote the last admin").
function hm_admin_count_active_admins(?string $excludeId = null): int {
  $sql = "SELECT COUNT(*) AS c FROM admin_users WHERE active=1 AND role='admin'";
  $params = [];
  if ($excludeId !== null) { $sql .= ' AND id <> ?'; $params[] = $excludeId; }
  $st = hm_db()->prepare($sql);
  $st->execute($params);
  return (int)($st->fetch()['c'] ?? 0);
}

// ── Secure PHP session ────────────────────────────────────────────────────────
// Starts a hardened session cookie:
//   • HttpOnly  — never readable by JS (no XSS session theft)
//   • Secure    — https only (set whenever the request is https)
//   • SameSite=Lax — CSRF-resistant; the admin API is same-origin in production
//     (deploy.js generates a same-origin API_BASE; enforced by tests/architecture-
//     lock.test.js), so Lax delivers the cookie on the app's own POSTs while
//     blocking cross-site delivery.
// Best-effort: a session that cannot start (rare host config) never blocks login
// because the HMAC token (header, not cookie) is the authorization workhorse.
function hm_admin_session_start(): void {
  if (session_status() === PHP_SESSION_ACTIVE) return;
  $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
  @session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'secure'   => $https,
    'httponly' => true,
    'samesite' => 'Lax',
  ]);
  @session_name('hm_admin_sid');
  @session_start();
}

// Record the authenticated admin into the PHP session.
function hm_admin_session_set(array $user): void {
  hm_admin_session_start();
  if (session_status() !== PHP_SESSION_ACTIVE) return;
  @session_regenerate_id(true);   // prevent fixation
  $_SESSION['admin'] = [
    'id'    => (string)$user['id'],
    'email' => (string)$user['email'],
    'role'  => (string)$user['role'],
    'ts'    => time(),
  ];
}

function hm_admin_session_user(): ?array {
  hm_admin_session_start();
  return (session_status() === PHP_SESSION_ACTIVE && !empty($_SESSION['admin'])) ? $_SESSION['admin'] : null;
}

// Destroy the PHP session completely (logout).
function hm_admin_session_destroy(): void {
  hm_admin_session_start();
  $_SESSION = [];
  if (ini_get('session.use_cookies')) {
    $p = session_get_cookie_params();
    @setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'] ?? '', (bool)$p['secure'], (bool)$p['httponly']);
  }
  @session_destroy();
}

// ── Token-based authorization for management actions ──────────────────────────
// Requires a valid HMAC admin token (X-ADMIN-TOKEN, role 'admin'). Returns the
// token payload {role, uid, urole, exp, iat}. 401s otherwise. This is the same
// signing key/verify path rest.php uses, so it works cross-origin without cookies.
function hm_admin_require_token(): array {
  $tok = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  $p   = (is_string($tok) && $tok !== '') ? hm_admin_token_verify($tok) : null;
  if (!$p || ($p['role'] ?? '') !== 'admin') {
    hm_log_auth_fail('admin_mgmt_token');
    hm_err('Admin authorization required', 401, 'admin_required');
  }
  // Revocation check (shared with rest.php's hm_require_admin via _lib.php): a
  // token that names a specific account (uid) is only honoured while that account
  // still EXISTS, is ACTIVE, and was not invalidated by a logout (tokens_valid_after).
  // Legacy tokens (no uid) skip this for rollback compatibility.
  if (!hm_admin_token_account_valid($p)) {
    hm_log_auth_fail('admin_token_revoked');
    hm_err('Admin authorization required', 401, 'admin_required');
  }
  // Re-read the CURRENT role so a just-demoted admin (admin→manager) immediately
  // loses manage rights — authoritative (DB), not the issued-at value.
  $uid = (string)($p['uid'] ?? '');
  if ($uid !== '') {
    $u = hm_admin_user_by_id($uid);
    if ($u) $p['urole'] = (string)$u['role'];
  }
  return $p;
}

// Invalidate EVERY outstanding token for an account (logout / forced sign-out).
// Sets the tokens_valid_after cutoff to "now" (epoch seconds) so any token whose
// `iat` predates this is rejected by hm_admin_token_account_valid(). Best-effort:
// non-fatal if the column is absent on an un-migrated install (run admin-migrate.php
// — hm_admin_ensure_columns() — to add it).
function hm_admin_revoke_tokens(string $id): void {
  if ($id === '') return;
  try {
    $st = hm_db()->prepare('UPDATE admin_users SET tokens_valid_after = ? WHERE id = ?');
    $st->execute([time(), $id]);
  } catch (Throwable $e) { /* column may not exist yet — non-fatal */ }
}

// Idempotent schema upgrade for installs created before a column existed. Called by
// admin-migrate.php. Adds tokens_valid_after (epoch-seconds logout/revocation
// cutoff) when missing; tolerant of MySQL versions without ADD COLUMN IF NOT EXISTS.
function hm_admin_ensure_columns(): void {
  try {
    $have = hm_db()->query("SHOW COLUMNS FROM admin_users LIKE 'tokens_valid_after'")->fetchAll();
    if (!$have) {
      hm_db()->exec('ALTER TABLE admin_users ADD COLUMN tokens_valid_after BIGINT UNSIGNED NULL DEFAULT NULL');
    }
  } catch (Throwable $e) {
    hm_log_error('admin schema ensure failed', ['err' => $e->getMessage()]);
  }
}

// Only role='admin' accounts (not 'manager') may manage other admin accounts.
function hm_admin_require_manage_role(array $tokenPayload): void {
  if (($tokenPayload['urole'] ?? 'admin') !== 'admin') {
    hm_err('Insufficient role', 403, 'forbidden');
  }
}
