<?php
// PDO MySQL connection (singleton).
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';

function hm_db(): PDO {
  static $pdo = null;
  if ($pdo === null) {
    // Bootstrap safety: never fatal on a missing/incomplete config — answer with
    // the health-style {ok:false, db:false, error} shape so callers degrade
    // gracefully instead of throwing a 500 with a stack trace.
    if (!hm_has_config()) {
      hm_log_error('DB not configured');
      hm_json(['ok' => false, 'db' => false, 'error' => 'DB not configured'], 503);
    }
    $c = hm_config();
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s',
      $c['db_host'], $c['db_name'], $c['db_charset'] ?? 'utf8mb4');
    try {
      $pdo = new PDO($dsn, $c['db_user'], $c['db_pass'], [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
      ]);
      // Pin the MySQL session timezone to JST so NOW() / CURRENT_TIMESTAMP defaults
      // agree with the PHP layer (date_default_timezone_set in _lib.php) and the
      // JST-aware client parsing. Offset form ('+09:00') is used because named
      // zones ('Asia/Tokyo') require the mysql tz tables, which shared hosting
      // often omits. Best-effort: never fail the connection over this.
      try { $pdo->exec("SET time_zone = '+09:00'"); } catch (Throwable $tzE) { /* keep server default */ }
    } catch (Throwable $e) {
      hm_log_error('DB connection failed', ['err' => $e->getMessage()]);
      hm_json(['ok' => false, 'db' => false, 'error' => 'DB connection failed'], 503);
    }
  }
  return $pdo;
}
