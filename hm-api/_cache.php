<?php
// ════════════════════════════════════════════════════════════════════════════
//  _cache.php — lightweight file-based response cache (best-effort)
//
//  Stores JSON snapshots under cache_dir (default hm-api/_cache). Used by the
//  read-heavy admin endpoints (bookings list, dashboard stats) to spare MySQL.
//  Never throws: a cache miss / FS error simply falls through to a live query.
//
//  Usage:
//    $hit = hm_cache_get('admin_stats', 60);   // null = miss/stale
//    if ($hit !== null) hm_ok($hit);
//    ... compute $fresh ...
//    hm_cache_set('admin_stats', $fresh);
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';

function hm_cache_dir(): string {
  $cfg = function_exists('hm_config') ? hm_config() : [];
  $dir = (string)($cfg['cache_dir'] ?? (__DIR__ . '/_cache'));
  if (!is_dir($dir)) @mkdir($dir, 0775, true);
  return $dir;
}

function hm_cache_enabled(): bool {
  $cfg = function_exists('hm_config') ? hm_config() : [];
  return ($cfg['cache_enabled'] ?? true) !== false;
}

function hm_cache_path(string $key): string {
  return hm_cache_dir() . '/' . preg_replace('/[^A-Za-z0-9._-]/', '_', $key) . '.json';
}

// Returns the cached array when present and younger than $ttl seconds, else null.
function hm_cache_get(string $key, int $ttl) {
  if (!hm_cache_enabled() || $ttl <= 0) return null;
  $f = hm_cache_path($key);
  if (!is_file($f)) return null;
  if ((time() - (int)@filemtime($f)) >= $ttl) return null;
  $raw = @file_get_contents($f);
  if ($raw === false || $raw === '') return null;
  $j = json_decode($raw, true);
  return is_array($j) ? $j : null;
}

function hm_cache_set(string $key, $value): void {
  if (!hm_cache_enabled()) return;
  $line = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  if ($line === false) return;
  @file_put_contents(hm_cache_path($key), $line, LOCK_EX);
}

// Drop one key, or (null) every cached snapshot. Called after writes so the next
// read repopulates from MySQL instead of serving stale rows.
function hm_cache_clear(?string $key = null): void {
  if ($key !== null) { @unlink(hm_cache_path($key)); return; }
  foreach (glob(hm_cache_dir() . '/*.json') ?: [] as $f) @unlink($f);
}

// Invalidate every snapshot that depends on a table's rows.
function hm_cache_invalidate_table(string $table): void {
  $map = [
    'bookings' => ['admin_stats'],            // + admin_bookings_* handled below
    'services' => ['admin_stats'],
    'reviews'  => ['admin_stats'],
  ];
  foreach ($map[$table] ?? [] as $k) hm_cache_clear($k);
  if ($table === 'bookings') {
    foreach (glob(hm_cache_dir() . '/admin_bookings_*.json') ?: [] as $f) @unlink($f);
  }
}
