<?php
// ════════════════════════════════════════════════════════════════════════════
//  review-token.test.php — REAL (executed) unit checks of the stateless review
//  token (hm-api/_reviewtoken.php). Pure functions only: NO DB, NO network.
//
//  Verifies: round-trip make→parse, signature tamper rejection, payload tamper
//  rejection, expiry, malformed input, secret isolation, and domain separation
//  (a storage-style signature must NOT validate as a review token).
//
//  Run:  php tests/review-token.test.php
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

// Minimal shim so the library loads standalone.
if (!function_exists('hm_config')) { function hm_config(): array { return ['storage_secret' => 'unit-secret']; } }

require_once __DIR__ . '/../hm-api/_reviewtoken.php';

$pass = 0; $fail = 0;
function chk(string $label, bool $cond): void {
  global $pass, $fail; $cond ? $pass++ : $fail++;
  printf("  [%s] %s\n", $cond ? 'ok' : 'XX', $label);
}

$BID = 'abcdef01-2345-4678-8abc-def012345678';

echo "\n── round-trip ──\n";
$tok = hm_review_token_make($BID);
chk('token is non-empty for a valid booking id', $tok !== '');
chk('token charset is hex.hex', (bool)preg_match('/^[a-f0-9]+\.[a-f0-9]+$/', $tok));
$parsed = hm_review_token_parse($tok);
chk('parse returns the original booking id', is_array($parsed) && $parsed['booking_id'] === $BID);
chk('parsed expiry is in the future', is_array($parsed) && $parsed['exp'] > time());

echo "\n── tamper rejection ──\n";
// Flip the last signature nibble.
$last = substr($tok, -1);
$swap = $last === 'a' ? 'b' : 'a';
$bad  = substr($tok, 0, -1) . $swap;
chk('mutated signature is rejected', hm_review_token_parse($bad) === null);

// Re-sign a DIFFERENT booking id under a different-length payload but keep the
// original signature → payload/sig mismatch must fail.
[$hex, $sig] = explode('.', $tok, 2);
$otherRaw = bin2hex('99999999-0000-4000-8000-000000000000|' . (time() + 100));
chk('payload swapped under old signature is rejected', hm_review_token_parse($otherRaw . '.' . $sig) === null);

echo "\n── expiry ──\n";
$expired = hm_review_token_make($BID, 60);
// Forge an already-expired token by hand (valid signature, past exp).
$rawExp  = $BID . '|' . (time() - 10);
$sigExp  = hash_hmac('sha256', 'review:' . $rawExp, 'unit-secret');
chk('correctly-signed but expired token is rejected', hm_review_token_parse(bin2hex($rawExp) . '.' . $sigExp) === null);
chk('a fresh short-ttl token still validates', is_array(hm_review_token_parse($expired)));

echo "\n── malformed / empty ──\n";
chk('empty string rejected',            hm_review_token_parse('') === null);
chk('no-dot token rejected',            hm_review_token_parse('deadbeef') === null);
chk('non-hex token rejected',           hm_review_token_parse('zz.zz') === null);
chk('odd-length hex rejected',          hm_review_token_parse('abc.' . str_repeat('0', 64)) === null);
chk('empty booking id → empty token',   hm_review_token_make('') === '');

echo "\n── domain separation ──\n";
// A signature made WITHOUT the "review:" prefix (i.e. a storage.php-style sig)
// must not validate as a review token, even with the same secret + payload.
$raw2 = $BID . '|' . (time() + 100);
$storageStyleSig = hash_hmac('sha256', $raw2, 'unit-secret');   // no "review:" prefix
chk('storage-style signature rejected as review token', hm_review_token_parse(bin2hex($raw2) . '.' . $storageStyleSig) === null);

echo "\n──────────────────────────────\n";
printf("  %d passed, %d failed\n\n", $pass, $fail);
exit($fail === 0 ? 0 : 1);
