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
  // Max accepted upload size in bytes (server-enforced by storage.php). Keep this
  // <= the PHP upload_max_filesize / post_max_size set in hm-api/.user.ini.
  'upload_max_bytes' => 15 * 1024 * 1024,   // 15 MB
  // Allowed upload MIME types — validated from the actual file bytes, not the
  // client-declared type. Covers portal photos, documents, and the media library.
  'upload_allowed_mime' => [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],

  // ── Admin authorization (rest.php admin-only operations) ──────────────────
  //   Server-side admin session: protects DELETE on any table + writes to the
  //   admin-only tables (hm_data, services, calendar_availability, inbox_messages)
  //   with a signed token from admin-session.php. Customer/portal writes
  //   (bookings/reviews/communications/audit_log) stay on the API key.
  //
  //   SAFE BY DEFAULT: 'admin_auth_enabled' => false means rest.php behaves
  //   exactly as before (API-key only). Provision the two secrets below, confirm
  //   admins obtain a token, THEN flip the flag. Rollback = set it back to false
  //   (one line, no redeploy).
  'admin_auth_enabled' => false,
  //   bcrypt hash of the admin password. Generate on the server with:
  //     php -r "echo password_hash('YOUR_ADMIN_PASSWORD', PASSWORD_DEFAULT), PHP_EOL;"
  //   LEGACY single-account path. With the MySQL admin_users table (see below)
  //   this is OPTIONAL — leave '' once admin_users is seeded. If present, it is
  //   used as the seed password during migration (admin keeps the same password).
  'admin_pass_hash' => '',
  //   HMAC signing key for admin session tokens. 64+ random chars; keep secret.
  //   REQUIRED for server-side admin auth (token sign/verify). Generate with:
  //     php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
  'admin_session_secret' => '',
  //   Admin token lifetime in seconds (default 12h). Min 300.
  'admin_session_ttl' => 12 * 60 * 60,

  // ── MySQL admin accounts (admin_users table — admin-login.php) ────────────
  //   The admin login now verifies against the admin_users table with
  //   password_hash()/password_verify() (multiple accounts, roles admin|manager),
  //   replacing the browser-localStorage credential store. Provision with:
  //     php hm-api/admin-migrate.php
  //   These keys configure the FIRST seeded admin (used once, then removable):
  'admin_seed_email'    => 'admin@hello-moving.com',
  'admin_seed_name'     => 'Admin',
  //   Plaintext password for the seed admin. Set, run admin-migrate.php, then
  //   DELETE this line. If omitted, the migrator reuses admin_pass_hash (above)
  //   or prints a generated temporary password (flagged must-change).
  'admin_seed_password' => '',
  //   One-time token to allow running admin-migrate.php over HTTP when you have
  //   no shell. Set a long random value, run it once, then DELETE this line.
  //   Leave '' to require CLI (php hm-api/admin-migrate.php) only.
  'admin_setup_token'   => '',

  // ── Hourly scheduling (interval start_at/end_at instead of fixed bands) ───
  //   Master switch for the interval scheduler in the LIVE customer endpoints
  //   (create-booking dual-write + availability `intervals`). SAFE BY DEFAULT:
  //   absent/false → those paths stay dormant and behave exactly as before.
  //   ⚠ ORDER: run hm-api/migrations/hourly/001_bookings_hourly.sql (cPanel →
  //   phpMyAdmin, back up first) so bookings.start_at/end_at exist, THEN set this
  //   to true. Belt-and-suspenders: the code also probes for the column, so a
  //   wrong order (flag on, migration not yet run) still stays dormant, not broken.
  //   Rollback = set back to false (one line, no redeploy). Mirrors
  //   slot_lock_enabled / line_enabled / imap_enabled.
  'hourly_enabled' => false,

  // ── Email (send-email.php) ────────────────────────────────────────────────
  //   'mail'   → use PHP mail() (works out-of-the-box on most cPanel hosts)
  //   'smtp'   → authenticated SMTP via hm-api/_smtp.php (native socket client —
  //              NO Composer/PHPMailer needed; PHPMailer is used only if you drop
  //              it into hm-api/vendor/). In 'smtp' mode a send NEVER silently
  //              falls back to mail(): any connect/auth/send failure is returned
  //              and logged to logs/error.log.
  //   Verify SMTP without sending real mail (admin-token + API key required):
  //     GET <API_BASE>/send-email.php?action=selftest          (connect+auth)
  //     GET <API_BASE>/send-email.php?action=selftest&send=1    (+ test email to smtp_user)
  'mail_mode'  => 'mail',
  'mail_from_booking' => 'booking@hello-moving.com',
  'mail_from_support' => 'support@hello-moving.com',
  'mail_from_contact' => 'contact@hello-moving.com',
  //   smtp_secure:  'tls' → STARTTLS on port 587 (recommended)
  //                 'ssl' → implicit TLS on port 465
  //                 ''    → no encryption on port 25 (not recommended)
  //   ⚠ GOTCHA: smtp_pass MUST be filled before switching mail_mode → 'smtp'.
  //     While mail_mode is 'mail' these SMTP creds are never read, so a blank
  //     smtp_pass is harmless. Flip to 'smtp' with a blank password and every
  //     send (incl. admin Inbox 返信 replies) fails auth → 'smtp_error'.
  //     Also note smtp_user (booking@) may differ from the From account chosen
  //     per-send (e.g. contact@ for Inbox replies); deliver() discloses that via
  //     a Sender: header, but the smtp_user mailbox's password is what auths.
  'smtp_host'  => 'mail.dzsecurity.com',
  'smtp_port'  => 587,
  'smtp_user'  => 'booking@hello-moving.com',
  'smtp_pass'  => '',        // ← fill this BEFORE setting mail_mode => 'smtp'
  'smtp_secure'=> 'tls',
  //   Optional SMTP tuning (safe to omit — defaults shown):
  'smtp_timeout' => 15,        // socket connect/read timeout, seconds
  // 'smtp_helo'  => 'hello-moving.com',  // EHLO hostname (defaults to server name)

  // ── LINE Messaging API (server-side push notifications) ───────────────────
  //  Used by hm-api/line-push.php to call POST https://api.line.me/v2/bot/message/push.
  //  Create a *Messaging API* channel in the LINE Developers console, then:
  //    line_channel_token : long-lived Channel Access Token (SECRET — keep it
  //                         here on the server only, NEVER in client JS or git).
  //    line_channel_id    : the channel's Channel ID (reference/logging only).
  //    line_push_to       : default recipient — a userId, or a group/room ID the
  //                         bot belongs to. The recipient must have added the
  //                         official account (you get the userId from a webhook
  //                         event, or the group/room ID from a join event).
  //    line_enabled       : master switch — leave false until the token + a
  //                         recipient are set, then flip to true.
  //  NOTE: replaces the retired LINE Notify path (notify-api.line.me was shut
  //  down March 2025). The Channel Access Token is a server secret by design.
  'line_channel_id'    => '',
  'line_channel_token' => '',
  'line_push_to'       => '',
  'line_enabled'       => false,

  // ── IMAP inbound polling (Email Center Phase 2 — hm-api/inbox-poll.php) ────
  //  Self-hosted IMAP only (no third-party inbound provider). A cron job runs
  //  inbox-poll.php, which logs into each mailbox over IMAPS, imports new mail
  //  into inbox_messages (dedup by Message-ID, incremental by UID watermark).
  //  Requires the PHP `imap` extension on the server.
  //    imap_host   : Dovecot host. ⚠ On shared cPanel, php-imap (c-client) sends
  //                 NO SNI, so the server returns its DEFAULT certificate — the
  //                 server's own FQDN (e.g. CN=<server>.dzsecurity.net), NOT the
  //                 mail.<domain> you dialed → TLS "hostname mismatch". PRODUCTION-
  //                 SAFE FIX: set imap_host to that certificate hostname (the shared
  //                 server FQDN). It is the SAME mail server (same IP + mailboxes),
  //                 the cert then validates, and full TLS verification is preserved.
  //                 Find it via:  openssl s_client -connect mail.<domain>:993 </dev/null | openssl x509 -noout -subject
  //    imap_port   : 993 (implicit SSL/TLS — recommended).
  //    imap_secure : 'ssl' (implicit TLS, port 993) | 'tls' (STARTTLS, port 143).
  //    imap_novalidate_cert : LAST RESORT only — skips certificate validation
  //                 (TLS stays ENCRYPTED, but no CA/hostname check → weaker). Prefer
  //                 the imap_host fix above. Default false.
  //    imap_accounts: one entry PER company mailbox. `pass` is a SERVER SECRET —
  //                 set it in _config.php (gitignored), never here / in client JS.
  //                 `user` stays the full email even when imap_host is the server FQDN.
  //    imap_enabled : master switch — leave false until passwords are set.
  //    imap_poll_token : optional one-time token to allow triggering inbox-poll.php
  //                 over HTTP when there is no cron/shell (CLI needs no token).
  'imap_enabled'         => false,
  //  Set this to the server's certificate hostname if 'mail.<domain>' mismatches
  //  (see the note above). On this host the cert CN is makemake-shared.dzsecurity.net.
  'imap_host'            => 'mail.hello-moving.com',
  'imap_port'            => 993,
  'imap_secure'          => 'ssl',
  'imap_novalidate_cert' => false,
  'imap_poll_token'      => '',
  'imap_accounts' => [
    ['mailbox' => 'booking@hello-moving.com', 'user' => 'booking@hello-moving.com', 'pass' => ''],
    ['mailbox' => 'support@hello-moving.com', 'user' => 'support@hello-moving.com', 'pass' => ''],
    ['mailbox' => 'contact@hello-moving.com', 'user' => 'contact@hello-moving.com', 'pass' => ''],
  ],
];
