<?php
// ════════════════════════════════════════════════════════════════════════════
//  Hello Moving API — configuration
//
//  SETUP:
//    1. Copy this file to  _config.php   (same folder)
//    2. Fill in the MySQL database / user / password you created in
//       cPanel → MySQL Databases.
//    3. Set ALLOWED_ORIGIN to the exact origin your site is served from
//       (scheme + host, no trailing slash). Use '*' only for quick testing.
//
//  SECURITY: _config.php is denied to the public by .htaccess. Never commit
//  the real _config.php to git (it is gitignored).
// ════════════════════════════════════════════════════════════════════════════

return [
  // ── MySQL connection (from cPanel → MySQL Databases) ──────────────────────
  'db_host' => 'localhost',
  'db_name' => 'cpaneluser_hellomoving',   // e.g. dzsec_hellomoving
  'db_user' => 'cpaneluser_hmapp',
  'db_pass' => 'CHANGE_ME_STRONG_PASSWORD',
  'db_charset' => 'utf8mb4',

  // ── CORS: the browser origin(s) allowed to call this API ──────────────────
  //   Production: list BOTH canonical hosts so apex and www both work.
  //   Local dev : add 'http://localhost:5050'
  //   Multiple allowed   : comma-separate (hm_cors reflects the matching origin)
  'allowed_origin' => 'https://hello-moving.com,https://www.hello-moving.com',

  // ── API key gate ──────────────────────────────────────────────────────────
  //   When non-empty, guarded endpoints require header  X-API-KEY: <this>.
  //   The browser sends it via window.API_KEY, so the API_KEY GitHub secret /
  //   js/config/env.js must match EXACTLY. Set to '' to disable. (A client-side
  //   key is a bot/abuse deterrent alongside CORS, not user authentication.)
  'api_key' => '',

  // ── Debug ─────────────────────────────────────────────────────────────────
  //   false (default / production): internal exception messages (SQL errors,
  //   table names, file paths) are NEVER returned to the client — endpoints
  //   answer with a generic "Request failed" and the detail goes to the logs.
  //   true (local dev only): surface the real message in JSON error fields.
  'debug' => false,

  // ── Monitoring & logging (metrics.php / _log.php) ─────────────────────────
  //   Structured JSON logs are written to this directory (access/error/bookings).
  //   Default: hm-api/logs (protected by .htaccess). Logs auto-rotate at 5 MB.
  'log_dir' => __DIR__ . '/logs',

  // ── Response cache (admin/stats.php, admin/bookings.php) ──────────────────
  //   Lightweight file cache for read-heavy admin endpoints. Set false to bypass.
  'cache_enabled' => true,
  'cache_dir'     => __DIR__ . '/_cache',

  // ── Rate limiting / abuse blocking (_ratelimit.php) ───────────────────────
  //   IP-based sliding window. Public endpoints set their own tighter limits
  //   (auth 10/min, booking 15/min, email 20/min); these are the defaults +
  //   the repeat-offender block policy. Set rate_limit_enabled=false to disable.
  'rate_limit_enabled'         => true,
  'rate_limit_max'             => 120,   // default hits allowed per window
  'rate_limit_window'          => 60,    // window length, seconds
  'rate_limit_block_threshold' => 3,     // window violations before a hard block
  'rate_limit_block_minutes'   => 15,    // block duration once threshold hit
  'rate_limit_dir'             => __DIR__ . '/_cache/rl',

  // ── Storage (file uploads: portal photos/documents, media library) ────────
  //   Absolute path to a writable directory OUTSIDE web root is safest.
  //   Default keeps uploads under this folder; protected by .htaccess.
  'storage_dir'  => __DIR__ . '/_uploads',
  // Secret used to sign short-lived "signed URLs" for private files.
  'storage_secret' => 'CHANGE_ME_RANDOM_64_CHARS',

  // ── Email (send-email.php) ────────────────────────────────────────────────
  //   'mail'   → use PHP mail() (works out-of-the-box on most cPanel hosts)
  //   'smtp'   → use SMTP (fill smtp_* below; needs PHPMailer in api/vendor or
  //              cPanel's sendmail). 'mail' is the simplest default.
  'mail_mode'  => 'mail',
  'mail_from_booking' => 'booking@hello-moving.com',
  'mail_from_support' => 'support@hello-moving.com',
  'mail_from_contact' => 'contact@hello-moving.com',
  'smtp_host'  => 'mail.dzsecurity.com',
  'smtp_port'  => 587,
  'smtp_user'  => 'booking@hello-moving.com',
  'smtp_pass'  => '',
  'smtp_secure'=> 'tls',
];
