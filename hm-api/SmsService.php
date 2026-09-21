<?php
// ════════════════════════════════════════════════════════════════════════════
//  SmsService.php — OPTIONAL manual-SMS CONTENT BUILDER (no sending)
//
//  SMS is an EXPERIMENTAL, secondary convenience. Email + Chat remain primary.
//  There is NO server-side SMS transport, NO provider, NO credentials, NO delivery
//  log — the website never sends an SMS. This class only BUILDS the message text
//  and normalizes the stored phone number, from TRUSTED server-side records; a
//  staff member sends it manually from their own phone (native SMS composer).
//
//  Content contract — every SMS carries: Company + Customer name + Booking ref +
//  the Direct Chat Link built by EmailService::chatUrl(). No address / price /
//  payment / email is ever placed in the body or the URL.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

class SmsService {

  const COMPANY = 'ハローMoving';

  // ── Intent → short Japanese reason line (the ONLY per-intent difference) ─────
  public static function reasonLine(string $intent): string {
    switch ($intent) {
      case 'estimate':          return 'お見積もりをご案内しました。';
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
  //  name comes from the bookings row; link from EmailService::chatUrl(). The
  //  booking reference is INTENTIONALLY NOT shown in the body — it lives only
  //  inside the chat link ($link), which identifies the customer's conversation.
  //  Layout (all intents share it):
  //     ハローMoving
  //     {name} 様
  //     {reason}
  //     チャットをご確認ください。
  //     {link}
  //  $ref is kept in the signature for callers but is deliberately unused here.
  public static function render(string $intent, string $name, string $ref, string $link): string {
    $reason = self::reasonLine($intent);
    $name   = trim($name) !== '' ? trim($name) : 'お客様';
    $lines  = [
      self::COMPANY,
      $name . ' 様',
      $reason,
      'チャットをご確認ください。',
      $link,
    ];
    // Drop an empty reason defensively (unknown intent should be rejected upstream).
    $lines = array_values(array_filter($lines, fn($l) => $l !== ''));
    return implode("\n", $lines);
  }

  // ── Phone normalization (Japan-first) → E.164-ish, or '' when unusable ───────
  //  Server-side ONLY; the browser never supplies a number. Accepts common stored
  //  formats (090-1234-5678, +81 90…, 0081…) and rejects anything too short. The
  //  normalized value is what the sms: URI recipient is prefilled with.
  public static function normalizePhone(string $raw): string {
    $raw = trim($raw);
    if ($raw === '') return '';
    $plus   = (strpos($raw, '+') === 0);
    $digits = preg_replace('/\D/', '', $raw);
    if ($digits === '') return '';

    if ($plus) {
      $e164 = '+' . $digits;                       // already international
    } elseif (strpos($digits, '0081') === 0) {
      $e164 = '+81' . substr($digits, 4);
    } elseif (strpos($digits, '81') === 0 && strlen($digits) >= 11) {
      $e164 = '+' . $digits;                       // 81XXXXXXXXXX
    } elseif ($digits[0] === '0') {
      $e164 = '+81' . substr($digits, 1);          // domestic 0XX… → +81XX…
    } else {
      return '';                                   // ambiguous — refuse rather than guess a country
    }

    $len = strlen(preg_replace('/\D/', '', $e164));
    if ($len < 10 || $len > 15) return '';         // E.164 sanity bounds
    return $e164;
  }

  // UTF-8 character count — mbstring when available (cPanel prod), else a portable
  // fallback so the helper never fatals.
  private static function ulen(string $s): int {
    if (function_exists('mb_strlen')) return mb_strlen($s, 'UTF-8');
    return (int)preg_match_all('/./us', $s);
  }

  // UCS-2 segment estimate (JP text is UCS-2: 70 / 67-per-part). Advisory only —
  // shown to staff so they know a long message is multi-part; nothing is sent.
  public static function segmentsUcs2(string $text): int {
    $len = self::ulen($text);
    if ($len <= 70) return 1;
    return (int)ceil($len / 67);
  }
}
