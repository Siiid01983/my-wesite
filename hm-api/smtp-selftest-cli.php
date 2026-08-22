<?php
// ════════════════════════════════════════════════════════════════════════════
//  smtp-selftest-cli.php — CLI-ONLY direct SMTP connect/auth diagnostic.
//
//  Loads hm-api/_config.php and runs the SAME transport the app uses
//  (hm_smtp_selftest in _smtp.php): DNS → connect → STARTTLS/implicit-TLS →
//  AUTH → (optional) test send. It needs NO HTTP request, NO X-API-KEY, and NO
//  admin token — it talks to the mail server directly and prints the EXACT SMTP
//  error message + code on failure.
//
//  It NEVER prints smtp_pass (the selftest result carries host/port/secure/user
//  only). Refuses to run over HTTP so it can never leak diagnostics publicly.
//
//  USAGE (from the cPanel account shell / SSH / cron):
//    php hm-api/smtp-selftest-cli.php                 # connect + AUTH only
//    php hm-api/smtp-selftest-cli.php you@example.com # + send a real test email
//
//  EXIT CODE: 0 on success, 1 on any failure (handy for scripts/cron).
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

// Hard CLI guard — never expose this over the web.
if (PHP_SAPI !== 'cli') {
  http_response_code(403);
  header('Content-Type: text/plain; charset=utf-8');
  echo "Forbidden: run this from the command line (php hm-api/smtp-selftest-cli.php).\n";
  exit(1);
}

$cfgPath  = __DIR__ . '/_config.php';
$smtpPath = __DIR__ . '/_smtp.php';

if (!is_file($cfgPath))  { fwrite(STDERR, "Missing $cfgPath\n");  exit(1); }
if (!is_file($smtpPath)) { fwrite(STDERR, "Missing $smtpPath\n"); exit(1); }

$cfg = require $cfgPath;              // _config.php returns the config array
require_once $smtpPath;

if (!function_exists('hm_smtp_selftest')) {
  fwrite(STDERR, "hm_smtp_selftest() not found — is _smtp.php the deployed version?\n");
  exit(1);
}

$sendTo = $argv[1] ?? null;          // optional recipient → performs a real send
$res    = hm_smtp_selftest($cfg, $sendTo);

// Pretty-print the full result (never contains the password).
echo json_encode($res, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), PHP_EOL;

// On failure, also surface the exact error + code on their own lines so it is
// unmissable in terminal output / logs.
if (empty($res['ok'])) {
  fwrite(STDERR, 'SMTP FAILED  code=' . ($res['code'] ?? 'unknown')
               . '  error=' . ($res['error'] ?? 'unknown') . PHP_EOL);
  exit(1);
}
fwrite(STDERR, 'SMTP OK' . (isset($res['data']['send']) ? ' (test email sent)' : '') . PHP_EOL);
exit(0);
