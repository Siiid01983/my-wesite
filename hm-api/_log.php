<?php
// ════════════════════════════════════════════════════════════════════════════
//  _log.php — structured file logging (best-effort; NEVER throws / blocks a request)
//  Writes newline-delimited JSON to hm-api/logs/{access,error,bookings}.log
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

function hm_log_dir(): string {
  $cfg = function_exists('hm_config') ? hm_config() : [];
  $dir = (string)($cfg['log_dir'] ?? (__DIR__ . '/logs'));
  if (!is_dir($dir)) @mkdir($dir, 0775, true);
  return $dir;
}

function hm_client_ip(): string {
  foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'] as $k) {
    if (!empty($_SERVER[$k])) return trim(explode(',', (string)$_SERVER[$k])[0]);
  }
  return '0.0.0.0';
}

// Request fingerprint = short hash of IP + User-Agent (basic abuse correlation).
function hm_client_fingerprint(): string {
  $ua = (string)($_SERVER['HTTP_USER_AGENT'] ?? '');
  return substr(hash('sha256', hm_client_ip() . '|' . $ua), 0, 16);
}

function hm_log_write(string $file, array $entry): void {
  try {
    $entry = ['ts' => date('c'), 'ip' => hm_client_ip()] + $entry;
    $line  = json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($line === false) return;
    $path = hm_log_dir() . '/' . $file;
    // Cheap size-based rotation (keep one backup) so logs can't fill the disk.
    if (is_file($path) && @filesize($path) > 5 * 1024 * 1024) @rename($path, $path . '.1');
    @file_put_contents($path, $line . "\n", FILE_APPEND | LOCK_EX);
  } catch (Throwable $e) { /* logging must never break the request */ }
}

function hm_log_access(): void {
  hm_log_write('access.log', [
    'type'   => 'access',
    'method' => (string)($_SERVER['REQUEST_METHOD'] ?? ''),
    'path'   => (string)($_SERVER['REQUEST_URI'] ?? ''),
    'fp'     => hm_client_fingerprint(),
    'ua'     => substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200),
  ]);
}

function hm_log_error(string $message, array $ctx = []): void {
  hm_log_write('error.log', ['type' => 'error', 'message' => $message] + $ctx);
}

function hm_log_auth_fail(string $reason = 'bad_api_key'): void {
  hm_log_write('error.log', [
    'type'   => 'auth_fail',
    'reason' => $reason,
    'fp'     => hm_client_fingerprint(),
    'path'   => (string)($_SERVER['REQUEST_URI'] ?? ''),
  ]);
}

function hm_log_booking(string $id, array $ctx = []): void {
  hm_log_write('bookings.log', ['type' => 'booking_created', 'id' => $id] + $ctx);
}
