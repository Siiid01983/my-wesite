<?php
// PDO MySQL connection (singleton).
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';

function hm_db(): PDO {
  static $pdo = null;
  if ($pdo === null) {
    $c = hm_config();
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s',
      $c['db_host'], $c['db_name'], $c['db_charset'] ?? 'utf8mb4');
    try {
      $pdo = new PDO($dsn, $c['db_user'], $c['db_pass'], [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
      ]);
    } catch (Throwable $e) {
      hm_err('Database connection failed', 500, 'db_connect');
    }
  }
  return $pdo;
}
