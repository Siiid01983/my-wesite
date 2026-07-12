<?php
// ════════════════════════════════════════════════════════════════════════════
//  backfill-customer-profiles.php — Customer Profile System, Phase 1 migration
//
//  Non-destructive + idempotent. Two additive things:
//    1. CREATE TABLE IF NOT EXISTS customer_profiles.
//    2. Build/refresh one profile per distinct customer_email in `bookings`
//       (total_bookings / first_booking_date / last_booking_date + name/phone),
//       computed via the lazy-compute service layer (_profiles.php).
//
//  DRY-RUN BY DEFAULT — reports what it would do, writes nothing. Pass ?apply=1
//  (HTTP) or `apply` (CLI) to write. The table is ensured in both modes.
//  Never touches bookings / booking_slots / any existing table.
//
//  RUN (CLI):   php hm-api/backfill-customer-profiles.php           # dry-run
//               php hm-api/backfill-customer-profiles.php apply      # write
//  RUN (HTTP):  …/backfill-customer-profiles.php?token=<t>          # dry-run
//               …/backfill-customer-profiles.php?token=<t>&apply=1  # write
//  Requires 'admin_setup_token' in _config.php over HTTP. Safe to re-run.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';
require_once __DIR__ . '/_profiles.php';

$isCli = (PHP_SAPI === 'cli');

function bcp_out(array $payload, bool $isCli, int $status = 200): void {
  if ($isCli) {
    fwrite(STDOUT, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL);
  } else {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  }
  exit;
}

// ── Access control: CLI trusted; HTTP requires the one-time setup token ───────
$apply = false;
if ($isCli) {
  $apply = in_array('apply', array_slice($argv, 1), true);
} else {
  require_once __DIR__ . '/_ratelimit.php';
  hm_rate_limit('backfill_profiles', 5, 60);
  $setup = (string)(hm_config()['admin_setup_token'] ?? '');
  $sent  = (string)($_GET['token'] ?? '');
  if ($setup === '' || !hash_equals($setup, $sent)) {
    bcp_out(['ok' => false, 'error' => 'forbidden — set admin_setup_token in _config.php and pass ?token='], false, 403);
  }
  $apply = (($_GET['apply'] ?? '') === '1');
}

try {
  $db = hm_db();
  hm_profile_ensure_table($db);

  if (!$db->query("SHOW TABLES LIKE 'bookings'")->fetch()) {
    bcp_out(['ok' => false, 'error' => "bookings table not found — run schema.mysql.sql first"], $isCli, 500);
  }

  // Distinct, non-empty, lower-cased customer emails from bookings.
  $emails = $db->query(
    "SELECT DISTINCT LOWER(TRIM(customer_email)) AS email
     FROM bookings
     WHERE customer_email IS NOT NULL AND TRIM(customer_email) <> ''"
  )->fetchAll(PDO::FETCH_COLUMN);

  $scanned = count($emails);
  $written = 0;
  $sample  = [];

  foreach ($emails as $email) {
    $s = hm_profile_compute_stats($db, $email);
    if ($apply) { hm_profile_upsert($db, $email, $s); $written++; }
    if (count($sample) < 10) {
      $sample[] = ['email' => $email, 'total' => $s['total_bookings'],
                   'first' => $s['first_booking_date'], 'last' => $s['last_booking_date']];
    }
  }

  bcp_out([
    'ok'            => true,
    'mode'          => $apply ? 'apply' : 'dry-run',
    'table'         => 'customer_profiles (ensured)',
    'emails_found'  => $scanned,
    'profiles_written' => $apply ? $written : null,
    'would_write'   => $apply ? null : $scanned,
    'sample'        => $sample,
    'note'          => $apply
      ? 'Backfill applied. Idempotent — re-running upserts the same rows (safe).'
      : 'DRY-RUN only — no rows written. Review sample, then re-run with apply.',
  ], $isCli);

} catch (Throwable $e) {
  if (function_exists('hm_log_error')) hm_log_error('backfill-customer-profiles failed', ['err' => $e->getMessage()]);
  bcp_out(['ok' => false, 'error' => 'backfill failed: ' . $e->getMessage()], $isCli, 500);
}
