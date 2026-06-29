<?php
// Shared helpers for all Hello Moving API endpoints.
declare(strict_types=1);

require_once __DIR__ . '/_log.php';   // structured logging (defines hm_log_* + hm_client_ip)

// Production posture: never render PHP warnings/notices/fatals into the HTTP
// response — they can leak filesystem paths, SQL, and internal table names.
// Errors are still written to the log files by the handlers below. Set
// 'debug' => true in _config.php to surface details in JSON error fields.
@ini_set('display_errors', '0');
@ini_set('log_errors', '1');

// True only when _config.php explicitly opts into debug. Safe to call before the
// DB is configured (uses the non-fatal hm_has_config probe).
function hm_debug(): bool {
  if (!hm_has_config()) return false;
  $cfg = @require __DIR__ . '/_config.php';
  return is_array($cfg) && !empty($cfg['debug']);
}

// Return the real exception message only in debug; otherwise a generic string.
// Always pair with an hm_log_* call so the detail is captured server-side.
function hm_safe_msg(string $generic, Throwable $e): string {
  return hm_debug() ? $e->getMessage() : $generic;
}

function hm_config(): array {
  static $cfg = null;
  if ($cfg === null) {
    $path = __DIR__ . '/_config.php';
    if (!is_file($path)) {
      http_response_code(500);
      header('Content-Type: application/json; charset=utf-8');
      echo json_encode(['error' => ['message' => 'API not configured: copy _config.example.php to _config.php']]);
      exit;
    }
    $cfg = require $path;
  }
  return $cfg;
}

// Non-fatal config probe. Returns true only when _config.php exists, returns an
// array, and carries the minimum DB credentials + an api_key. Lets index.php
// answer a health check (and _db.php fail gracefully) instead of hard-exiting
// when the server is not configured yet.
function hm_has_config(): bool {
  $path = __DIR__ . '/_config.php';
  if (!is_file($path)) return false;
  $cfg = @require $path;
  if (!is_array($cfg)) return false;
  foreach (['db_host', 'db_name', 'db_user'] as $k) {
    if (!array_key_exists($k, $cfg) || $cfg[$k] === '') return false;
  }
  return array_key_exists('api_key', $cfg);   // present (may be '' to disable the gate)
}

// Emit CORS headers + handle OPTIONS preflight. Call at the top of every endpoint.
function hm_cors(): void {
  $cfg = hm_config();
  $allowed = array_map('trim', explode(',', (string)($cfg['allowed_origin'] ?? '*')));
  $origin  = $_SERVER['HTTP_ORIGIN'] ?? '';

  if (in_array('*', $allowed, true)) {
    header('Access-Control-Allow-Origin: *');
  } elseif ($origin && in_array($origin, $allowed, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
  } elseif (!empty($allowed)) {
    header('Access-Control-Allow-Origin: ' . $allowed[0]);
  }
  header('Access-Control-Allow-Headers: authorization, x-client-info, apikey, x-api-key, content-type');
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  header('Access-Control-Max-Age: 86400');

  if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
  }

  // Access log — runs once per real (non-preflight) request, for every endpoint.
  hm_log_access();
}

// API-key gate. Enforced ONLY when 'api_key' is set in _config.php (empty = off).
// The browser must send the matching key as the X-API-KEY header (window.API_KEY).
// NOTE: a client-shipped key is not secret — it deters casual/cross-origin abuse
// alongside CORS, it is NOT user authentication. Call AFTER hm_cors() so the
// OPTIONS preflight is answered before the key is checked.
function hm_require_api_key(): void {
  $expected = (string)(hm_config()['api_key'] ?? '');
  if ($expected === '') return;                       // gate disabled
  $sent = $_SERVER['HTTP_X_API_KEY'] ?? '';
  if (!is_string($sent) || $sent === '' || !hash_equals($expected, $sent)) {
    hm_log_auth_fail('bad_api_key');
    hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'Unauthorized', 'code' => 'api_key']], 401);
  }
}

// ── Admin session (server-side authorization for rest.php admin-only ops) ─────
// Stateless HMAC-signed token: base64url(JSON payload) . hex(HMAC-SHA256). No
// server-side session store needed. Minted by admin-login.php after a
// password_verify() against the admin_users table; verified here on each request.
// Although the token itself is stateless, revocation (account disabled/deleted,
// or an explicit logout) is enforced per-request by hm_admin_token_account_valid()
// so a single config of admin_auth_enabled gates every admin-only write.
function hm_admin_secret(): string { return (string)(hm_config()['admin_session_secret'] ?? ''); }
function hm_admin_hash():   string { return (string)(hm_config()['admin_pass_hash'] ?? ''); }

// Enforcement is OFF unless explicitly enabled AND the token signing secret is
// provisioned (without it, tokens cannot be verified). Credentials may come from
// the legacy single hash (admin_pass_hash) OR the admin_users table — either one
// satisfies the gate. Safe-by-default: a half-configured server behaves like the
// prior API-key-only model.
function hm_admin_auth_enabled(): bool {
  $c = hm_config();
  if (empty($c['admin_auth_enabled']) || hm_admin_secret() === '') return false;
  if (hm_admin_hash() !== '') return true;                       // legacy single-hash path
  // MySQL admin_users path — only when those helpers are loaded (admin-login.php).
  if (function_exists('hm_admin_users_provisioned')) return hm_admin_users_provisioned();
  // _admin_users.php not loaded (e.g. rest.php): the flag+secret are an explicit
  // opt-in by the operator, so honour enforcement.
  return true;
}

function hm_admin_token_sign(array $payload): string {
  $body = rtrim(strtr(base64_encode(json_encode($payload)), '+/', '-_'), '=');
  $sig  = hash_hmac('sha256', $body, hm_admin_secret());
  return $body . '.' . $sig;
}

// Returns the payload array on a valid, unexpired token; null otherwise.
function hm_admin_token_verify(string $token): ?array {
  $secret = hm_admin_secret();
  if ($secret === '' || strpos($token, '.') === false) return null;
  [$body, $sig] = explode('.', $token, 2);
  $expected = hash_hmac('sha256', $body, $secret);
  if (!hash_equals($expected, $sig)) return null;           // constant-time
  $json = base64_decode(strtr($body, '-_', '+/'), true);
  if ($json === false) return null;
  $p = json_decode($json, true);
  if (!is_array($p) || ($p['exp'] ?? 0) < time()) return null;
  return $p;
}

// Revocation check for an already signature-verified token payload. Returns true
// when the account named by the token's `uid` still EXISTS, is ACTIVE, and has
// not invalidated its tokens via logout (`tokens_valid_after`). This is what makes
// the stateless token revocable: it closes the "deleted / deactivated / logged-out
// admin keeps a working token until it expires" gap for EVERY admin gate, including
// rest.php (previously only the management endpoints re-checked the account).
//
//   • Legacy tokens with no `uid` (e.g. the old admin-session.php single-hash
//     path) are accepted — there is no account to revoke against.
//   • Fail-open on a transient DB error: a momentary database hiccup must not lock
//     legitimate admins out, and writes need the DB anyway. A SUCCESSFUL lookup
//     that finds the account missing/inactive/revoked fails closed (returns false).
//   • Backward compatible: SELECT * tolerates installs whose admin_users table has
//     not yet gained the tokens_valid_after column (that signal is simply absent).
function hm_admin_token_account_valid(array $payload): bool {
  $uid = (string)($payload['uid'] ?? '');
  if ($uid === '') return true;                       // legacy token, not account-bound
  if (!function_exists('hm_db')) return true;
  try {
    $st = hm_db()->prepare('SELECT * FROM admin_users WHERE id = ? LIMIT 1');
    $st->execute([$uid]);
    $row = $st->fetch();
  } catch (Throwable $e) {
    return true;                                       // DB hiccup — do not lock admins out
  }
  if (!$row) return false;                             // account deleted
  if (!(int)($row['active'] ?? 0)) return false;       // account disabled
  // Logout / forced-revocation cutoff (epoch seconds). A token minted strictly
  // before the cutoff is dead. NULL/absent column ⇒ no revocation in effect.
  $cut = isset($row['tokens_valid_after']) && $row['tokens_valid_after'] !== null
       ? (int)$row['tokens_valid_after'] : 0;
  if ($cut > 0 && (int)($payload['iat'] ?? 0) < $cut) return false;
  return true;
}

// Require a valid admin session for admin-only operations. A no-op while
// enforcement is disabled (the API-key gate already ran in the caller), so
// enabling/disabling is a pure config switch with no code change.
function hm_require_admin(): void {
  if (!hm_admin_auth_enabled()) return;
  $tok = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  $p   = (is_string($tok) && $tok !== '') ? hm_admin_token_verify($tok) : null;
  if (!$p || ($p['role'] ?? '') !== 'admin' || !hm_admin_token_account_valid($p)) {
    hm_log_auth_fail('admin_token');
    hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'Admin authorization required', 'code' => 'admin_required']], 401);
  }
}

// Strict content-write gate (RC-D). Requires a VALID, non-revoked staff session
// token (role admin OR manager) for writes to CMS/content tables — enforced even
// when admin_auth_enabled is OFF, so the page-served public API key alone can
// never mutate site content. A logged-in admin/manager's apiClient already sends
// X-ADMIN-TOKEN, so the CMS keeps working; anonymous public-key callers are 401'd.
// Fail-safe: if no signing secret is provisioned (tokens can't be verified at
// all), we DON'T hard-block every write — we defer to the standard gate so a
// mis-provisioned server can't brick content editing. (In production the secret
// is set, since admin login mints tokens, so enforcement is active.)
function hm_require_staff_write(): void {
  if (hm_admin_secret() === '') { hm_require_admin(); return; }   // can't verify → preserve prior behavior
  $tok  = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
  $p    = (is_string($tok) && $tok !== '') ? hm_admin_token_verify($tok) : null;
  $role = is_array($p) ? ($p['role'] ?? '') : '';
  if (!$p || ($role !== 'admin' && $role !== 'manager') || !hm_admin_token_account_valid($p)) {
    hm_log_auth_fail('content_write_token');
    hm_json(['ok' => false, 'data' => null, 'error' => ['message' => 'Admin authorization required for content writes', 'code' => 'admin_required']], 401);
  }
}

function hm_json($data, int $status = 200): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

// Standard envelope: { ok, data, error }. `ok` is additive — the frontend
// apiClient reads `data`/`error` and ignores `ok`, so this stays backward
// compatible. `error` is kept as an object {message, code} (apiClient reads
// error.message); a bare 401/429 below uses the same shape.
function hm_ok($data): void { hm_json(['ok' => true, 'data' => $data, 'error' => null], 200); }
function hm_err(string $message, int $status = 400, ?string $code = null): void {
  hm_json(['ok' => false, 'data' => null, 'error' => ['message' => $message, 'code' => $code]], $status);
}

// Parse the JSON request body. With $strict, a non-empty body that is not a
// valid JSON object/array is rejected with 400 (used by the data + booking
// endpoints). Lenient by default so form-style webhooks (receive-email) keep
// working when they post nothing or non-JSON.
function hm_body(bool $strict = false): array {
  if ($strict) {
    // Reject anything that isn't a JSON request (the data + booking endpoints
    // only ever receive application/json from apiClient.js / bookingService.js).
    // charset suffixes are tolerated. Multipart upload + the email webhook use
    // the lenient path and are intentionally exempt.
    $ct = (string)($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '');
    if (stripos($ct, 'application/json') === false) {
      hm_err('Unsupported Media Type', 415, 'bad_content_type');
    }
  }
  $raw = file_get_contents('php://input');
  if ($raw === '' || $raw === false) {
    if ($strict) hm_err('Invalid JSON body', 400, 'bad_json');
    return [];
  }
  $j = json_decode($raw, true);
  if (!is_array($j)) {
    if ($strict) hm_err('Invalid JSON body', 400, 'bad_json');
    return [];
  }
  return $j;
}

function hm_uuid4(): string {
  $d = random_bytes(16);
  $d[6] = chr((ord($d[6]) & 0x0f) | 0x40);
  $d[8] = chr((ord($d[8]) & 0x3f) | 0x80);
  return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($d), 4));
}
