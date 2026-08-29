<?php
// ════════════════════════════════════════════════════════════════════════════
//  ops-phase1-logic.test.php — REAL (executed) unit checks of the Phase-1
//  security-critical validators. Pure functions only: NO DB, NO network, NO
//  persistent data. Loads the side-effect-free _contact.php library and exercises
//  cc_clean_attachments() (attachment scoping / MIME / traversal / cap) and
//  cc_sign_url() (signature matches what storage.php `get` verifies).
//
//  Run:  php tests/ops-phase1-logic.test.php
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

// Minimal shims so the library loads standalone (these fns are only used by OTHER
// _contact.php functions we do not call here).
// mbstring shims — the production cPanel PHP has mbstring; a bare dev CLI may not.
// ASCII-safe fallbacks are sufficient for these deterministic checks.
if (!function_exists('mb_substr')) { function mb_substr($s, $start, $len = null) { return $len === null ? substr((string)$s, $start) : substr((string)$s, $start, $len); } }
if (!function_exists('mb_strlen')) { function mb_strlen($s) { return strlen((string)$s); } }
if (!function_exists('hm_uuid4')) { function hm_uuid4(): string { return '00000000-0000-4000-8000-000000000000'; } }
if (!function_exists('hm_config')) { function hm_config(): array { return ['storage_secret' => 'unit-secret']; } }
if (!function_exists('hm_cache_invalidate_table')) { function hm_cache_invalidate_table($t) {} }
if (!function_exists('hm_log_error')) { function hm_log_error($m, $c = []) {} }

require_once __DIR__ . '/../hm-api/_contact.php';

$pass = 0; $fail = 0;
function chk(string $label, bool $cond): void {
  global $pass, $fail; $cond ? $pass++ : $fail++;
  printf("  [%s] %s\n", $cond ? 'ok' : 'XX', $label);
}

$CODE = 'HM7K4P2';
$MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

echo "\n── cc_clean_attachments (item 3 upload validation) ──\n";

// 1. Valid image inside this conversation's folder is kept.
$r = cc_clean_attachments([['path' => "contact/$CODE/123-a.jpg", 'name' => 'a.jpg', 'mime' => 'image/jpeg', 'size' => 100]], $CODE, $MIME);
chk('valid image in contact/<CODE>/ kept', count($r) === 1 && $r[0]['path'] === "contact/$CODE/123-a.jpg");

// 2. Another conversation's folder is REJECTED (cross-conversation access blocked).
$r = cc_clean_attachments([['path' => "contact/HMZZZZZ/x.jpg", 'name' => 'x', 'mime' => 'image/jpeg']], $CODE, $MIME);
chk('other conversation folder rejected', count($r) === 0);

// 3. A booking folder path is rejected for a contact reply.
$r = cc_clean_attachments([['path' => "some-booking-id/x.jpg", 'name' => 'x', 'mime' => 'image/jpeg']], $CODE, $MIME);
chk('booking-folder path rejected for contact', count($r) === 0);

// 4. Path traversal is rejected.
$r = cc_clean_attachments([['path' => "contact/$CODE/../../etc/passwd", 'name' => 'p', 'mime' => 'image/jpeg']], $CODE, $MIME);
chk('path traversal (..) rejected', count($r) === 0);

// 5. Disallowed MIME is rejected.
$r = cc_clean_attachments([['path' => "contact/$CODE/x.exe", 'name' => 'x.exe', 'mime' => 'application/x-msdownload']], $CODE, $MIME);
chk('disallowed MIME rejected', count($r) === 0);

// 6. Empty MIME is allowed (validated from bytes at upload time by storage.php).
$r = cc_clean_attachments([['path' => "contact/$CODE/y.png", 'name' => 'y', 'mime' => '']], $CODE, $MIME);
chk('empty MIME allowed (storage.php validated bytes)', count($r) === 1);

// 7. Hard cap at 10 items.
$many = [];
for ($i = 0; $i < 25; $i++) $many[] = ['path' => "contact/$CODE/f$i.png", 'name' => "f$i", 'mime' => 'image/png'];
$r = cc_clean_attachments($many, $CODE, $MIME);
chk('10-attachment cap enforced', count($r) === 10);

// 8. Non-array input yields [].
chk('non-array input → []', cc_clean_attachments('not-an-array', $CODE, $MIME) === []);

// 9. Name truncated to 200 chars.
$r = cc_clean_attachments([['path' => "contact/$CODE/z.png", 'name' => str_repeat('n', 500), 'mime' => 'image/png']], $CODE, $MIME);
chk('name truncated to 200', count($r) === 1 && mb_strlen($r[0]['name']) === 200);

echo "\n── cc_sign_url (signature must match storage.php `get`) ──\n";
$secret = 'unit-secret';
$path   = "contact/$CODE/123-a.jpg";
$url    = cc_sign_url($path, $secret, 300);
parse_str((string)parse_url($url, PHP_URL_QUERY), $q);
// Reproduce EXACTLY what storage.php `get` computes: hash_hmac('sha256', "$bucket/$path:$exp", SECRET)
$expected = hash_hmac('sha256', 'chat/' . $path . ':' . ($q['exp'] ?? ''), $secret);
chk('URL targets storage.php get + chat bucket', ($q['action'] ?? '') === 'get' && ($q['bucket'] ?? '') === 'chat');
chk('signed path round-trips', ($q['path'] ?? '') === $path);
chk('HMAC signature matches storage.php get verification', hash_equals($expected, (string)($q['sig'] ?? '')));
chk('expiry is in the future (TTL applied)', (int)($q['exp'] ?? 0) > time());
// A tampered path must NOT verify against the issued signature.
$tampered = hash_hmac('sha256', 'chat/' . "contact/HMZZZZZ/steal.jpg" . ':' . ($q['exp'] ?? ''), $secret);
chk('different path yields a different signature (no reuse)', !hash_equals($tampered, (string)($q['sig'] ?? '')));

echo "\n──────────────────────────────────────────\n";
echo "ops-phase1-logic: $pass passed, $fail failed\n";
exit($fail > 0 ? 1 : 0);
