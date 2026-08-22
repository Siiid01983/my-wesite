<?php
// ════════════════════════════════════════════════════════════════════════════
//  _telegram.php — shared server-side Telegram Bot push helper (admin notifications).
//
//  Sends a message via the official Telegram Bot API:
//      POST https://api.telegram.org/bot<TOKEN>/sendMessage   { chat_id, text }
//
//  The SOLE admin notification channel: used by contact-chat.php, create-booking.php,
//  contact.php, chat.php and inbox-poll.php to alert the admin. It replaced the former
//  LINE integration, which has been fully retired (helper, push endpoint, and admin UI
//  all removed).
//
//  SECURITY / ROBUSTNESS:
//    • The bot token is a SERVER SECRET (telegram_bot_token in _config.php). It is
//      NEVER returned to the client and NEVER logged — the send URL (which embeds
//      the token) is never logged either; only the HTTP status + Telegram's own
//      error `description` are logged on failure.
//    • Messages are sent as PLAIN TEXT (no parse_mode) so customer-supplied content
//      cannot inject Markdown/HTML formatting or entities — no escaping pitfalls.
//    • Fire-and-forget by design: hm_telegram_send() NEVER throws and swallows all
//      transport/HTTP errors (logging safe diagnostics), so a Telegram outage can
//      never break a Contact Chat request. Bounded connect/read timeouts.
//
//  Depends on hm_config() (_lib.php) and hm_log_error() (_log.php) — already loaded
//  by the endpoints that include this file.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

if (!function_exists('hm_telegram_enabled')) {
  // True only when the master switch is on AND a bot token + chat id are present.
  function hm_telegram_enabled(): bool {
    $cfg = hm_config();
    return !empty($cfg['telegram_enabled'])
        && trim((string)($cfg['telegram_bot_token'] ?? '')) !== ''
        && trim((string)($cfg['telegram_chat_id'] ?? '')) !== '';
  }
}

if (!function_exists('hm_telegram_send')) {
  // Push a plain-text message via the Telegram Bot API. Returns true on HTTP 2xx.
  // Never throws; all failures are logged (WITHOUT the token/URL) and return false.
  function hm_telegram_send(string $message, ?string $chatId = null): bool {
    $cfg = hm_config();
    if (empty($cfg['telegram_enabled'])) return false;
    $token  = trim((string)($cfg['telegram_bot_token'] ?? ''));
    $chatId = trim((string)($chatId ?? '')) ?: trim((string)($cfg['telegram_chat_id'] ?? ''));
    if ($token === '' || $chatId === '' || $message === '') return false;

    // Telegram hard limit is 4096 chars; trim defensively.
    if (mb_strlen($message) > 4000) $message = mb_substr($message, 0, 3997) . '…';

    $url     = 'https://api.telegram.org/bot' . $token . '/sendMessage';
    $payload = json_encode([
      'chat_id'                  => $chatId,
      'text'                     => $message,          // plain text — no parse_mode
      'disable_web_page_preview' => true,
    ], JSON_UNESCAPED_UNICODE);
    $headers = ['Content-Type: application/json'];

    try {
      if (function_exists('curl_init')) {
        $ch = curl_init($url);
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
        // Note: $err is a connection-level message (no token); the token lives only
        // in $url, which is never logged.
        if ($res === false) { hm_log_error('Telegram send transport failed', ['err' => $err]); return false; }
      } else {
        // Fallback for hosts without php-curl.
        $ctx = stream_context_create(['http' => [
          'method'        => 'POST',
          'header'        => implode("\r\n", $headers),
          'content'       => $payload,
          'timeout'       => 8,
          'ignore_errors' => true,
        ]]);
        $res  = @file_get_contents($url, false, $ctx);
        $code = 0;
        if (isset($http_response_header) && is_array($http_response_header)) {
          foreach ($http_response_header as $h) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) { $code = (int)$m[1]; }
          }
        }
        if ($res === false) { hm_log_error('Telegram send transport failed', ['err' => 'stream request failed']); return false; }
      }

      if ($code < 200 || $code >= 300) {
        // Log ONLY the HTTP status + Telegram's own error description — never the
        // token or the URL.
        $desc = '';
        $j = json_decode((string)$res, true);
        if (is_array($j) && isset($j['description'])) $desc = (string)$j['description'];
        hm_log_error('Telegram send rejected', ['code' => $code, 'description' => mb_substr($desc, 0, 300)]);
        return false;
      }
      return true;
    } catch (Throwable $e) {
      hm_log_error('Telegram send exception', ['err' => $e->getMessage()]);
      return false;
    }
  }
}
