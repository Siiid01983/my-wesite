<?php
// ════════════════════════════════════════════════════════════════════════════
//  service-images-mapping.test.php — runtime unit test for the service-image
//  canonical slug mapping (hm-api/_svcimg_slug.php).
//
//  DB-free: exercises the exact shared resolvers used by BOTH service-image
//  endpoints, so it runs anywhere PHP does (no PDO/MySQL needed). Guards
//  requirement: the six public cards always resolve deterministically, legacy
//  and non-canonical rows are handled safely, and no row is ever "lost".
//
//  Run:  php tests/service-images-mapping.test.php   →  exit 0 on pass, 1 on fail
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/../hm-api/_svcimg_slug.php';

$fail = 0; $pass = 0;
function check(string $label, $got, $want) {
  global $fail, $pass;
  if ($got === $want) { $pass++; echo "  ok   $label\n"; }
  else { $fail++; echo "  FAIL $label — got " . var_export($got, true) . ", want " . var_export($want, true) . "\n"; }
}

echo "── svcimg_norm_slug ──\n";
foreach (['sameday','single','couple','student','disposal','furniture'] as $s) {
  check("canonical '$s'", svcimg_norm_slug($s), $s);
}
check("legacy alias 'emergency' → sameday", svcimg_norm_slug('emergency'), 'sameday');
check("upper 'EMERGENCY' → sameday",        svcimg_norm_slug('EMERGENCY'), 'sameday');
check("whitespace '  single  ' → single",    svcimg_norm_slug('  single  '), 'single');
check("mixed case 'Couple' → couple",        svcimg_norm_slug('Couple'), 'couple');
check("unknown 'bogus' → ''",                svcimg_norm_slug('bogus'), '');
check("empty '' → ''",                       svcimg_norm_slug(''), '');

echo "── svcimg_canon_slug (STRICT: public feed) ──\n";
check("category canonical",           svcimg_canon_slug(['category' => 'disposal', 'title' => '不用品']), 'disposal');
check("category empty → title fallback", svcimg_canon_slug(['category' => '', 'title' => 'student']), 'student');
check("category alias 'emergency'",   svcimg_canon_slug(['category' => 'emergency']), 'sameday');
check("both non-canonical → ''",      svcimg_canon_slug(['category' => 'promo', 'title' => 'Spring Sale']), '');
check("missing keys → ''",            svcimg_canon_slug([]), '');
check("category wins over title",     svcimg_canon_slug(['category' => 'single', 'title' => 'couple']), 'single');

echo "── svcimg_resolve_slug (LENIENT: admin list, never drops a row) ──\n";
check("canonical category",           svcimg_resolve_slug(['category' => 'furniture']), 'furniture');
check("title fallback",               svcimg_resolve_slug(['category' => '', 'title' => 'couple']), 'couple');
check("non-canonical kept as raw lc", svcimg_resolve_slug(['category' => 'Promo', 'title' => 'x']), 'promo');
check("non-canonical, no title",      svcimg_resolve_slug(['category' => 'legacy-cat']), 'legacy-cat');
check("empty row → ''",               svcimg_resolve_slug([]), '');

echo "── determinism (pure: same input ⇒ same output) ──\n";
$row = ['category' => 'Emergency', 'title' => 'z'];
check("resolve_slug stable x3",
  [svcimg_resolve_slug($row), svcimg_resolve_slug($row), svcimg_resolve_slug($row)],
  ['sameday','sameday','sameday']);

echo "── all six canonical cards map 1:1 (no collisions) ──\n";
$seen = [];
foreach (['sameday','single','couple','student','disposal','furniture'] as $s) {
  $seen[$s] = svcimg_canon_slug(['category' => $s]);
}
check("6 distinct canonical slugs", count(array_unique($seen)), 6);
check("SVCIMG_SLUGS constant intact", SVCIMG_SLUGS, ['sameday','single','couple','student','disposal','furniture']);

echo "\n" . ($fail === 0 ? "PASS" : "FAIL") . " — $pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
