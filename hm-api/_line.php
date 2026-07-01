<?php
// ════════════════════════════════════════════════════════════════════════════
//  _line.php — shared server-side LINE Messaging API push helper.
//
//  Used by create-booking.php (automatic new-booking alert on the public flow)
//  and callable from any other server endpoint that needs to push to LINE.
//  Reuses the token/recipient in _config.php (same secret as line-push.php).
//
//  Fire-and-forget by design: hm_line_push() NEVER throws and swallows all
//  transport/HTTP errors (logging them), so a LINE outage can never break a
//  booking insert or any other caller's happy path.
//
//  Depends on hm_config() (_lib.php) and hm_log_error() (_log.php) — both are
//  already loaded by the endpoints that include this file.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

if (!function_exists('hm_line_enabled')) {
  // True only when the master switch is on AND a token + recipient are present.
  function hm_line_enabled(): bool {
    $cfg = hm_config();
    return !empty($cfg['line_enabled'])
        && trim((string)($cfg['line_channel_token'] ?? '')) !== ''
        && trim((string)($cfg['line_push_to'] ?? '')) !== '';
  }
}

if (!function_exists('hm_line_push')) {
  // Push a text message via LINE Messaging API. Returns true on HTTP 2xx.
  // Never throws; all failures are logged and return false.
  function hm_line_push(string $message, ?string $to = null): bool {
    $cfg = hm_config();
    if (empty($cfg['line_enabled'])) return false;
    $token = trim((string)($cfg['line_channel_token'] ?? ''));
    $to    = trim((string)($to ?? '')) ?: trim((string)($cfg['line_push_to'] ?? ''));
    if ($token === '' || $to === '' || $message === '') return false;
    if (mb_strlen($message) > 5000) $message = mb_substr($message, 0, 4997) . '…';

    $payload = json_encode([
      'to'       => $to,
      'messages' => [['type' => 'text', 'text' => $message]],
    ], JSON_UNESCAPED_UNICODE);
    $headers = ['Content-Type: application/json', 'Authorization: Bearer ' . $token];

    try {
      if (function_exists('curl_init')) {
        $ch = curl_init('https://api.line.me/v2/bot/message/push');
        curl_setopt_array($ch, [
          CURLOPT_POST           => true,
          CURLOPT_POSTFIELDS     => $payload,
          CURLOPT_HTTPHEADER     => $headers,
          CURLOPT_RETURNTRANSFER => true,
          CURLOPT_TIMEOUT        => 8,
          CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        $res  = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        if ($res === false) { hm_log_error('LINE push transport failed', ['err' => $err]); return false; }
      } else {
        // Fallback for hosts without php-curl.
        $ctx = stream_context_create(['http' => [
          'method'        => 'POST',
          'header'        => implode("\r\n", $headers),
          'content'       => $payload,
          'timeout'       => 8,
          'ignore_errors' => true,
        ]]);
        $res  = @file_get_contents('https://api.line.me/v2/bot/message/push', false, $ctx);
        $code = 0;
        if (isset($http_response_header) && is_array($http_response_header)) {
          foreach ($http_response_header as $h) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) { $code = (int)$m[1]; }
          }
        }
        if ($res === false) { hm_log_error('LINE push transport failed', ['err' => 'stream request failed']); return false; }
      }

      if ($code < 200 || $code >= 300) {
        hm_log_error('LINE push rejected', ['code' => $code, 'body' => substr((string)$res, 0, 300)]);
        return false;
      }
      return true;
    } catch (Throwable $e) {
      hm_log_error('LINE push exception', ['err' => $e->getMessage()]);
      return false;
    }
  }
}
