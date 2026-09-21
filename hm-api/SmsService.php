<?php
// ════════════════════════════════════════════════════════════════════════════
//  SmsService.php — provider-agnostic OPTIONAL customer SMS (attention only)
//
//  SMS is a SECONDARY attention notification. Email + Chat remain primary. This
//  service NEVER contacts a provider on its own and NEVER throws — every path
//  returns a plain result array so a caller can treat SMS as strictly best-effort
//  and isolate its failure from the primary operation (booking / reschedule / chat).
//
//  Clean adapter boundary — the transport is chosen by config and can be swapped
//  for any future provider WITHOUT touching callers:
//     sms_transport = 'off'  (default) → no send; returns code 'sms_disabled'
//     sms_transport = 'log'            → dry-run; logs a MASKED line, no network
//     <future>                         → not implemented → code 'no_provider'
//  Tests (and a future provider module) may inject a transport via setTransport().
//  Provider credentials live ONLY in _config.php (server-side) — never surfaced
//  to JavaScript, never logged.
//
//  Content contract — every SMS carries: Company + Customer name + Booking ref +
//  the Direct Chat Link built by EmailService::chatUrl(). No address / price /
//  payment / email is ever placed in the body or the URL.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

class SmsService {

  const COMPANY = 'Hello Moving';

  // Optional dependency-injected transport (callable(string $phone, string $body): array).
  // Used by tests and by a future real provider adapter. Null → config-selected.
  private static $transportOverride = null;

  /** @param callable|null $fn function(string $phone, string $body): array{ok:bool,...} */
  public static function setTransport(?callable $fn): void { self::$transportOverride = $fn; }

  // ── Intent → short Japanese reason line (the ONLY per-intent difference) ─────
  public static function reasonLine(string $intent): string {
    switch ($intent) {
      case 'booking_confirmed': return 'ご予約ありがとうございます。';
      case 'reschedule':        return 'ご予約日時が変更されました。';
      case 'staff_message':     return '新しいメッセージがあります。';
      default:                  return '';
    }
  }

  public static function isValidIntent(string $intent): bool {
    return self::reasonLine($intent) !== '';
  }

  // ── Render one SMS body from TRUSTED, server-resolved values ─────────────────
  //  name / ref come from the bookings row; link from EmailService::chatUrl().
  //  Layout (all three intents share it):
  //     Hello Moving
  //     {name} 様
  //     {reason}
  //     予約番号: {ref}
  //     チャットをご確認ください。
  //     {link}
  public static function render(string $intent, string $name, string $ref, string $link): string {
    $reason = self::reasonLine($intent);
    $name   = trim($name) !== '' ? trim($name) : 'お客様';
    $lines  = [
      self::COMPANY,
      $name . ' 様',
      $reason,
      '予約番号: ' . $ref,
      'チャットをご確認ください。',
      $link,
    ];
    // Drop an empty reason defensively (unknown intent should be rejected upstream).
    $lines = array_values(array_filter($lines, fn($l) => $l !== ''));
    return implode("\n", $lines);
  }

  // ── Phone normalization (Japan-first) → E.164-ish, or '' when unusable ───────
  //  Server-side ONLY; the browser never supplies a number. Accepts common stored
  //  formats (090-1234-5678, +81 90…, 0081…) and rejects anything too short.
  public static function normalizePhone(string $raw): string {
    $raw = trim($raw);
    if ($raw === '') return '';
    $plus   = (strpos($raw, '+') === 0);
    $digits = preg_replace('/\D/', '', $raw);
    if ($digits === '') return '';

    if ($plus) {
      // Already international (assume caller stored a valid country code).
      $e164 = '+' . $digits;
    } elseif (strpos($digits, '0081') === 0) {
      $e164 = '+81' . substr($digits, 4);
    } elseif (strpos($digits, '81') === 0 && strlen($digits) >= 11) {
      $e164 = '+' . $digits;                       // 81XXXXXXXXXX
    } elseif ($digits[0] === '0') {
      $e164 = '+81' . substr($digits, 1);          // domestic 0XX… → +81XX…
    } else {
      return '';                                   // ambiguous — refuse rather than guess a country
    }

    $len = strlen(preg_replace('/\D/', '', $e164)); // digit count incl. country code
    if ($len < 10 || $len > 15) return '';          // E.164 sanity bounds
    return $e164;
  }

  // Mask a phone for logs — keep only the last 4 digits.
  public static function maskPhone(string $phone): string {
    $d = preg_replace('/\D/', '', $phone);
    if ($d === '') return '****';
    return str_repeat('*', max(0, strlen($d) - 4)) . substr($d, -4);
  }

  // UTF-8 character count — uses mbstring when available (it is on the cPanel
  // production PHP), else a portable regex fallback so the helper never fatals.
  private static function ulen(string $s): int {
    if (function_exists('mb_strlen')) return mb_strlen($s, 'UTF-8');
    return (int)preg_match_all('/./us', $s);
  }

  // ── UCS-2 segment estimate (JP text is always UCS-2: 70 / 67-per-part) ───────
  public static function segmentsUcs2(string $text): int {
    $len = self::ulen($text);
    if ($len <= 70) return 1;
    return (int)ceil($len / 67);
  }

  // ── Dispatch to the configured transport. NEVER throws. ──────────────────────
  //  Returns: ['ok'=>bool, 'sent'=>bool, 'code'=>string, 'dry_run'?=>bool, 'error'?=>string]
  public static function send(array $cfg, string $phone, string $body): array {
    try {
      if (self::$transportOverride !== null) {
        $r = (self::$transportOverride)($phone, $body);
        return is_array($r) ? $r : ['ok' => false, 'sent' => false, 'code' => 'bad_transport'];
      }
      $mode = strtolower(trim((string)($cfg['sms_transport'] ?? 'off')));
      switch ($mode) {
        case 'off':
        case '':
          return ['ok' => false, 'sent' => false, 'code' => 'sms_disabled'];
        case 'log':
          // Dry-run: proves the whole pipeline without a provider. Logs a MASKED
          // line only — never the recipient number, never the body, never creds.
          if (function_exists('hm_log_write')) {
            hm_log_write('info.log', [
              'type' => 'sms_dryrun',
              'to'   => self::maskPhone($phone),
              'seg'  => self::segmentsUcs2($body),
              'len'  => self::ulen($body),
            ]);
          }
          return ['ok' => true, 'sent' => true, 'dry_run' => true, 'code' => 'logged'];
        default:
          // A provider name is configured but no adapter is wired yet. Soft-fail
          // so the primary operation is never affected.
          return ['ok' => false, 'sent' => false, 'code' => 'no_provider'];
      }
    } catch (Throwable $e) {
      return ['ok' => false, 'sent' => false, 'code' => 'exception', 'error' => $e->getMessage()];
    }
  }
}
