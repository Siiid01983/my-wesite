<?php
// Shared helpers for all Hello Moving API endpoints.
declare(strict_types=1);

require_once __DIR__ . '/_log.php';   // structured logging (defines hm_log_* + hm_client_ip)

function hm_config(): array {
  static $cfg = null;
  if ($cfg === null) {
    $path = __DIR__ . '/_config.php';
    if (!is_file($path)) {
      http_response_code(500);
      header('Content-Type: application/json; charset=utf-8');
      echo json_encode(['error' => ['message' => 'API not configured: copy _config.example.php to _config.php']]);
      exit;
    }
    $cfg = require $path;
  }
  return $cfg;
}

// Emit CORS headers + handle OPTIONS preflight. Call at the top of every endpoint.
function hm_cors(): void {
  $cfg = hm_config();
  $allowed = array_map('trim', explode(',', (string)($cfg['allowed_origin'] ?? '*')));
  $origin  = $_SERVER['HTTP_ORIGIN'] ?? '';

  if (in_array('*', $allowed, true)) {
    header('Access-Control-Allow-Origin: *');
  } elseif ($origin && in_array($origin, $allowed, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
  } elseif (!empty($allowed)) {
    header('Access-Control-Allow-Origin: ' . $allowed[0]);
  }
  header('Access-Control-Allow-Headers: authorization, x-client-info, apikey, x-api-key, content-type');
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  header('Access-Control-Max-Age: 86400');

  if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
  }

  // Access log — runs once per real (non-preflight) request, for every endpoint.
  hm_log_access();
}

// API-key gate. Enforced ONLY when 'api_key' is set in _config.php (empty = off).
// The browser must send the matching key as the X-API-KEY header (window.API_KEY).
// NOTE: a client-shipped key is not secret — it deters casual/cross-origin abuse
// alongside CORS, it is NOT user authentication. Call AFTER hm_cors() so the
// OPTIONS preflight is answered before the key is checked.
function hm_require_api_key(): void {
  $expected = (string)(hm_config()['api_key'] ?? '');
  if ($expected === '') return;                       // gate disabled
  $sent = $_SERVER['HTTP_X_API_KEY'] ?? '';
  if (!is_string($sent) || $sent === '' || !hash_equals($expected, $sent)) {
    hm_log_auth_fail('bad_api_key');
    hm_json(['data' => null, 'error' => ['message' => 'Unauthorized', 'code' => 'api_key']], 401);
  }
}

function hm_json($data, int $status = 200): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

// { data, error } envelope: { data, error }
function hm_ok($data): void { hm_json(['data' => $data, 'error' => null], 200); }
function hm_err(string $message, int $status = 400, ?string $code = null): void {
  hm_json(['data' => null, 'error' => ['message' => $message, 'code' => $code]], $status);
}

function hm_body(): array {
  $raw = file_get_contents('php://input');
  if ($raw === '' || $raw === false) return [];
  $j = json_decode($raw, true);
  return is_array($j) ? $j : [];
}

function hm_uuid4(): string {
  $d = random_bytes(16);
  $d[6] = chr((ord($d[6]) & 0x0f) | 0x40);
  $d[8] = chr((ord($d[8]) & 0x3f) | 0x80);
  return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($d), 4));
}
