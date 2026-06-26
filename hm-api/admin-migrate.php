<?php
// ════════════════════════════════════════════════════════════════════════════
//  admin-migrate.php — one-time migration + seed for MySQL admin authentication.
//
//  Creates the admin_users table (from admin_users.schema.sql) and seeds the
//  first admin account, then SELF-LOCKS (no-op once an active admin exists).
//
//  RUN — preferred (cPanel → Terminal / SSH):
//      php hm-api/admin-migrate.php
//
//  RUN — over HTTP (only if you have no shell): set 'admin_setup_token' in
//  _config.php to a long random string, then visit ONCE:
//      https://<host>/hm-api/admin-migrate.php?token=<admin_setup_token>
//  It refuses to run over HTTP without a matching token, and refuses entirely
//  once any admin exists. DELETE the token from _config.php afterwards.
//
//  SEED PASSWORD SOURCE (first match wins):
//    1. _config.php 'admin_seed_password'  (recommended; remove after running)
//    2. legacy _config.php 'admin_pass_hash' (migrates the existing password
//       1:1 — the admin keeps typing the same password they use today)
//    3. a generated strong password, PRINTED ONCE (account flagged must_change)
//
//  ROLLBACK: see ADMIN_AUTH_MIGRATION.md.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_admin_users.php';

$isCli = (PHP_SAPI === 'cli');

// ── Output helpers (text for CLI, JSON for HTTP) ──────────────────────────────
function mig_out(array $payload, bool $isCli, int $httpStatus = 200): void {
  if ($isCli) {
    foreach ($payload as $k => $v) {
      if (is_bool($v)) $v = $v ? 'true' : 'false';
      fwrite(STDOUT, str_pad($k, 16) . ' : ' . (is_scalar($v) ? (string)$v : json_encode($v)) . PHP_EOL);
    }
  } else {
    http_response_code($httpStatus);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
  }
  exit;
}

// ── Access control for the HTTP path ──────────────────────────────────────────
// CLI is implicitly trusted (shell access). Over HTTP: rate-limit, then require a
// constant-time match against a long, operator-set one-time token. Anonymous /
// token-less requests get a 403 and never touch the database.
if (!$isCli) {
  require_once __DIR__ . '/_ratelimit.php';
  hm_rate_limit('admin_migrate', 5, 60);   // throttle setup-token guessing
  $cfg   = hm_config();
  $setup = (string)($cfg['admin_setup_token'] ?? '');
  $sent  = (string)($_GET['token'] ?? '');
  if ($setup === '' || !hash_equals($setup, $sent)) {
    mig_out(['ok' => false, 'error' => 'forbidden — set admin_setup_token in _config.php and pass ?token='], false, 403);
  }
}

try {
  // 1. Create the table (idempotent — schema uses CREATE TABLE IF NOT EXISTS).
  $schemaPath = __DIR__ . '/admin_users.schema.sql';
  if (!is_file($schemaPath)) mig_out(['ok' => false, 'error' => 'schema file missing'], $isCli, 500);
  $sql = (string)file_get_contents($schemaPath);
  hm_db()->exec($sql);

  // 2. Self-lock if already provisioned.
  if (hm_admin_count_active_admins() > 0) {
    mig_out(['ok' => true, 'status' => 'already_provisioned',
             'message' => 'admin_users already has an active admin — nothing to do',
             'users' => count(hm_admin_users_all())], $isCli);
  }

  // 3. Resolve the seed account.
  $cfg   = hm_config();
  $email = strtolower(trim((string)($cfg['admin_seed_email'] ?? 'admin@hello-moving.com')));
  $name  = (string)($cfg['admin_seed_name'] ?? 'Admin');

  $generated   = null;
  $mustChange  = false;
  $legacyHash  = (string)($cfg['admin_pass_hash'] ?? '');
  $seedPass    = (string)($cfg['admin_seed_password'] ?? '');

  if ($seedPass !== '') {
    $hash = password_hash($seedPass, PASSWORD_DEFAULT);
  } elseif ($legacyHash !== '' && strpos($legacyHash, '$') === 0) {
    $hash = $legacyHash;                       // migrate existing password as-is
  } else {
    $generated  = bin2hex(random_bytes(9));    // 18-char temp password
    $hash       = password_hash($generated, PASSWORD_DEFAULT);
    $mustChange = true;
  }

  $id = hm_uuid4();
  $st = hm_db()->prepare(
    'INSERT INTO admin_users (id, email, name, pass_hash, role, active, must_change_password)
     VALUES (?, ?, ?, ?, "admin", 1, ?)'
  );
  $st->execute([$id, $email, $name, $hash, $mustChange ? 1 : 0]);

  mig_out(array_filter([
    'ok'              => true,
    'status'          => 'seeded',
    'email'           => $email,
    'role'            => 'admin',
    'password_source' => $seedPass !== '' ? 'admin_seed_password'
                        : ($legacyHash !== '' ? 'legacy_admin_pass_hash' : 'generated'),
    'temp_password'   => $generated,           // present ONLY when generated
    'must_change'     => $mustChange,
    'next'            => 'Set admin_auth_enabled=>true in _config.php, then remove admin_seed_password/admin_setup_token.',
  ], fn($v) => $v !== null), $isCli);

} catch (Throwable $e) {
  hm_log_error('admin-migrate failed', ['err' => $e->getMessage()]);
  mig_out(['ok' => false, 'error' => hm_debug() ? $e->getMessage() : 'migration failed'], $isCli, 500);
}
