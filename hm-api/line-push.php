<?php
// ════════════════════════════════════════════════════════════════════════════
//  line-push.php — server-side LINE Messaging API push
//
//  Reached at:  <API_BASE>/line-push.php
//  Body (JSON): { message: string, to?: string, action?: "selftest" }
//
//  Sends POST https://api.line.me/v2/bot/message/push using the Channel Access
//  Token from _config.php. The token is a SERVER SECRET — it is never exposed to
//  the browser (the old LINE Notify path put the token in client localStorage;
//  that path is retired).
//
//  Auth: API-key gate + staff gate (admin/manager). The admin SPA already sends
//  X-ADMIN-TOKEN, so the existing notification flow keeps working; an anonymous
//  public-key caller is 401'd and can never spend the channel's push quota.
//
//  Config (_config.php):
//    line_enabled        bool    master switch
//    line_channel_token  string  Channel Access Token (secret)
//    line_push_to        string  default recipient (userId / group / room id)
//    line_channel_id     string  reference only (not required to send)
//
//  Response envelope: { ok, data, error }  (hm_ok / hm_err)
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_ratelimit.php';

hm_cors();
hm_require_api_key();
hm_rate_limit('line', 60, 60);     // 60 push calls / minute / IP — abuse guard
hm_require_staff_write();          // admin or manager only

$cfg       = hm_config();
$enabled   = !empty($cfg['line_enabled']);
$token     = trim((string)($cfg['line_channel_token'] ?? ''));
$defaultTo = trim((string)($cfg['line_push_to'] ?? ''));

if (!$enabled)      hm_err('LINE push is disabled — set line_enabled=true in _config.php', 503, 'line_disabled');
if ($token === '')  hm_err('LINE channel token not configured in _config.php',            503, 'line_no_token');

$req     = hm_body(true);
$action  = (string)($req['action'] ?? ($_GET['action'] ?? ''));
$message = trim((string)($req['message'] ?? ''));
$to      = trim((string)($req['to'] ?? '')) ?: $defaultTo;

if ($action === 'selftest' && $message === '') {
  $message = "\xF0\x9F\x94\x94 Hello Moving — LINE Messaging API テスト通知です。";
}
if ($message === '') hm_err('message is required', 400, 'no_message');
if ($to === '')      hm_err('No recipient — set line_push_to in _config.php or pass "to"', 400, 'no_recipient');

// LINE text message hard limit is 5000 chars.
if (mb_strlen($message) > 5000) $message = mb_substr($message, 0, 4997) . '…';

$payload = json_encode([
  'to'       => $to,
  'messages' => [['type' => 'text', 'text' => $message]],
], JSON_UNESCAPED_UNICODE);

$headers = [
  'Content-Type: application/json',
  'Authorization: Bearer ' . $token,
];

$resp = hm_line_post('https://api.line.me/v2/bot/message/push', $headers, $payload);

if (!$resp['ok']) {
  hm_log_error('LINE push transport failed', ['err' => $resp['err']]);
  hm_err('LINE request failed: ' . $resp['err'], 502, 'line_transport');
}
if ($resp['code'] < 200 || $resp['code'] >= 300) {
  $detail = json_decode((string)$resp['body'], true);
  $msg = (is_array($detail) && isset($detail['message'])) ? $detail['message'] : ('HTTP ' . $resp['code']);
  hm_log_error('LINE push rejected', ['code' => $resp['code'], 'body' => substr((string)$resp['body'], 0, 500)]);
  hm_err('LINE push rejected: ' . $msg, 502, 'line_http_' . $resp['code']);
}

// Never echo the recipient id or token back in full.
hm_ok(['sent' => true, 'status' => $resp['code'], 'to' => substr($to, 0, 5) . '…']);

// ── HTTP helper: prefer curl, fall back to a stream context ──────────────────
function hm_line_post(string $url, array $headers, string $body): array {
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_POST           => true,
      CURLOPT_POSTFIELDS     => $body,
      CURLOPT_HTTPHEADER     => $headers,
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_TIMEOUT        => 10,
      CURLOPT_CONNECTTIMEOUT => 8,
    ]);
    $res  = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    return ['ok' => $res !== false, 'code' => $code, 'body' => (string)$res, 'err' => $err];
  }
  // Fallback for hosts without php-curl.
  $ctx = stream_context_create(['http' => [
    'method'        => 'POST',
    'header'        => implode("\r\n", $headers),
    'content'       => $body,
    'timeout'       => 10,
    'ignore_errors' => true,
  ]]);
  $res  = @file_get_contents($url, false, $ctx);
  $code = 0;
  if (isset($http_response_header) && is_array($http_response_header)) {
    foreach ($http_response_header as $h) {
      if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) { $code = (int)$m[1]; }
    }
  }
  return ['ok' => $res !== false, 'code' => $code, 'body' => (string)$res, 'err' => $res === false ? 'request failed' : ''];
}
