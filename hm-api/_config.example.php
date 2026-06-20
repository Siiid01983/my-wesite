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

  // ── CORS: the browser origin allowed to call this API ─────────────────────
  //   Production example: 'https://www.dzsecurity.com'
  //   Local dev          : 'http://localhost:5050'
  //   Multiple allowed   : comma-separate, e.g. 'https://a.com,http://localhost:5050'
  'allowed_origin' => '*',

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
