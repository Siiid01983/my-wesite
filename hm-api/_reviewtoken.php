<?php
// ════════════════════════════════════════════════════════════════════════════
//  _reviewtoken.php — stateless single-use review-link token
//
//  A completed booking generates a review link containing an OPAQUE token. The
//  token carries ONLY the booking id + an expiry, HMAC-signed with the server's
//  storage_secret (domain-separated with a "review:" prefix so it can never be
//  confused with a storage.php file signature). NOTHING sensitive is in the URL:
//  no email, name, address, or admin data — just an internal booking id that is
//  unusable without the matching signature.
//
//  Format:  <hex(bookingId "|" exp)> "." <hex hmac-sha256>
//           → charset [a-f0-9.], safe in a URL, tamper-evident.
//
//  SINGLE-USE is NOT tracked here (no DB table). The caller (review.php) enforces
//  it by refusing to insert a second review for a booking that already has one —
//  the existing reviews.booking_reference is the natural idempotency key.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

// Default validity: 30 days after the move completes.
if (!defined('HM_REVIEW_TOKEN_TTL')) define('HM_REVIEW_TOKEN_TTL', 30 * 24 * 60 * 60);

function hm_review_token_secret(): string {
  $cfg = function_exists('hm_config') ? hm_config() : [];
  return (string)($cfg['storage_secret'] ?? 'change-me');
}

// Mint a signed token for a booking id. Never returns an empty string for a
// non-empty booking id.
function hm_review_token_make(string $bookingId, ?int $ttlSeconds = null): string {
  $bookingId = trim($bookingId);
  if ($bookingId === '') return '';
  $ttl = $ttlSeconds !== null ? max(60, $ttlSeconds) : HM_REVIEW_TOKEN_TTL;
  $raw = $bookingId . '|' . (time() + $ttl);
  $sig = hash_hmac('sha256', 'review:' . $raw, hm_review_token_secret());
  return bin2hex($raw) . '.' . $sig;
}

// Verify a token. Returns ['booking_id'=>string, 'exp'=>int] on success, or null
// for a malformed / tampered / expired token. Constant-time signature compare.
function hm_review_token_parse(string $token): ?array {
  $token = trim($token);
  if ($token === '' || substr_count($token, '.') !== 1) return null;
  [$hex, $sig] = explode('.', $token, 2);
  if ($hex === '' || $sig === '' || !ctype_xdigit($hex) || !ctype_xdigit($sig)) return null;
  if (strlen($hex) % 2 !== 0) return null;
  $raw = @hex2bin($hex);
  if ($raw === false || strpos($raw, '|') === false) return null;
  $expected = hash_hmac('sha256', 'review:' . $raw, hm_review_token_secret());
  if (!hash_equals($expected, $sig)) return null;
  [$bookingId, $expStr] = explode('|', $raw, 2);
  $exp = (int)$expStr;
  if ($bookingId === '' || $exp <= 0 || $exp < time()) return null;   // empty / expired
  return ['booking_id' => $bookingId, 'exp' => $exp];
}
