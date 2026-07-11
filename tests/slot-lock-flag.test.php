<?php
// Phase 2 verification: SLOT_LOCK_ENABLED defaults OFF and toggles correctly.
// Pure logic — no DB. Run: php tests/slot-lock-flag.test.php
declare(strict_types=1);

// Stub hm_config() to read a mutable global so we can exercise both branches.
$GLOBALS['__cfg'] = [];
if (!function_exists('hm_config')) {
  function hm_config(): array { return $GLOBALS['__cfg'] ?? []; }
}
require_once __DIR__ . '/../hm-api/_slots.php';

$fail = 0; $pass = 0;
function chk(string $l, $g, $w) {
  global $fail, $pass; $ok = ($g === $w); $ok ? $pass++ : $fail++;
  printf("  [%s] %-34s got=%-5s want=%-5s\n", $ok ? 'ok' : 'XX', $l, var_export($g, true), var_export($w, true));
}

$GLOBALS['__cfg'] = [];                             chk('key absent → OFF',  hm_slot_lock_enabled(), false);
$GLOBALS['__cfg'] = ['slot_lock_enabled' => false]; chk('false → OFF',       hm_slot_lock_enabled(), false);
$GLOBALS['__cfg'] = ['slot_lock_enabled' => 0];     chk('0 → OFF',           hm_slot_lock_enabled(), false);
$GLOBALS['__cfg'] = ['slot_lock_enabled' => ''];    chk("'' → OFF",          hm_slot_lock_enabled(), false);
$GLOBALS['__cfg'] = ['slot_lock_enabled' => true];  chk('true → ON',         hm_slot_lock_enabled(), true);
$GLOBALS['__cfg'] = ['slot_lock_enabled' => '1'];   chk("'1' → ON",          hm_slot_lock_enabled(), true);
$GLOBALS['__cfg'] = ['slot_lock_enabled' => 1];     chk('1 → ON',            hm_slot_lock_enabled(), true);

echo "\n" . ($fail ? "FAIL: $fail failed, $pass passed\n" : "PASS: all $pass checks (default is OFF)\n");
exit($fail ? 1 : 0);
