<?php
// ════════════════════════════════════════════════════════════════════════════
//  diag-headers.php — TEMPORARY API-key delivery diagnostic (safe, read-only)
//
//  Answers ONE question: does the X-API-KEY the browser sends actually reach PHP,
//  and does it byte-match hm_config()['api_key']? It NEVER enforces the key (so it
//  can report even when the real gate would 401) and it MASKS every key value
//  (first4…last4 + length) so nothing sensitive is exposed. Delete after use.
//
//  Trigger it exactly as the app does — from the site's DevTools console:
//    fetch('/hm-api/diag-headers.php', { headers: { 'X-API-KEY': window.API_KEY } })
//      .then(r => r.json()).then(console.log)
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_config.php';
header('Content-Type: application/json; charset=utf-8');

function mask($v) {
  $v = (string)$v;
  $len = strlen($v);
  $trimLen = strlen(trim($v));
  return [
    'present'          => $v !== '',
    'length'           => $len,
    'length_trimmed'   => $trimLen,
    'has_edge_whitespace' => $len !== $trimLen,
    'masked'           => $len <= 8 ? str_repeat('*', $len) : substr($v, 0, 4) . str_repeat('*', $len - 8) . substr($v, -4),
    // Show trailing byte codes so a hidden \n (10) / \r (13) / space (32) is visible.
    'last_byte_codes'  => array_map('ord', str_split(substr($v, -3))),
  ];
}

$expected = (string)(function_exists('hm_config') ? (hm_config()['api_key'] ?? '') : '');

// Every place the key could arrive.
$fromServer   = $_SERVER['HTTP_X_API_KEY'] ?? '';
$fromRedirect = $_SERVER['REDIRECT_HTTP_X_API_KEY'] ?? '';
$fromGetAll   = '';
$getAllNames  = [];
if (function_exists('getallheaders')) {
  foreach (getallheaders() as $k => $v) {
    $getAllNames[] = $k;
    if (strcasecmp($k, 'X-API-KEY') === 0) $fromGetAll = $v;
  }
}
$fromApache = '';
if (function_exists('apache_request_headers')) {
  foreach (apache_request_headers() as $k => $v) {
    if (strcasecmp($k, 'X-API-KEY') === 0) $fromApache = $v;
  }
}

// Pick the first non-empty source, trimmed — this is what the FIX will use.
$resolved = '';
foreach ([$fromServer, $fromRedirect, $fromGetAll, $fromApache] as $c) {
  if (trim((string)$c) !== '') { $resolved = trim((string)$c); break; }
}

// Which HTTP_*-style keys did PHP get at all (names only, values masked below).
$httpKeys = [];
foreach ($_SERVER as $k => $v) {
  if (strpos($k, 'HTTP_') === 0 || strpos($k, 'REDIRECT_HTTP_') === 0) $httpKeys[] = $k;
}

echo json_encode([
  'ok' => true,
  'note' => 'API-key delivery diagnostic. Delete this file after use.',
  'expected_config_key' => mask($expected),
  'received' => [
    '$_SERVER[HTTP_X_API_KEY]'          => mask($fromServer),
    '$_SERVER[REDIRECT_HTTP_X_API_KEY]' => mask($fromRedirect),
    'getallheaders(X-API-KEY)'          => mask($fromGetAll),
    'apache_request_headers(X-API-KEY)' => mask($fromApache),
  ],
  'comparison' => [
    'raw_server_hash_equals'  => ($expected !== '' && hash_equals($expected, (string)$fromServer)),
    'resolved_hash_equals'    => ($expected !== '' && hash_equals(trim($expected), $resolved)),
    'trimmed_values_equal'    => (trim($expected) === $resolved && $resolved !== ''),
  ],
  'header_names_seen' => $getAllNames,
  'server_http_keys'  => $httpKeys,
  'php_sapi'          => PHP_SAPI,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
