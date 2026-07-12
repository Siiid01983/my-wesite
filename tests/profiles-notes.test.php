<?php
// Phase 1 verification: notes parsing in hm-api/_profiles.php (pure logic, no DB).
// Run: php tests/profiles-notes.test.php
declare(strict_types=1);
require_once __DIR__ . '/../hm-api/_profiles.php';

$fail = 0; $pass = 0;
function chk(string $label, $got, $want) {
  global $fail, $pass; $ok = ($got === $want); $ok ? $pass++ : $fail++;
  printf("  [%s] %-38s got=%-14s want=%-14s\n", $ok ? 'ok' : 'XX', $label,
    var_export($got, true), var_export($want, true));
}

$notes = "お客様メモ\n[HM_EXTRAS]\nref:HM-12345\nservice:単身引越し\ntime:午前（9:00〜12:00）\nfrom:新宿\nto:渋谷\nlocmode:dual";

echo "ref extraction\n";
chk('ref from packed notes', hm_profile_ref_from_notes($notes), 'HM-12345');
chk('ref missing → null',    hm_profile_ref_from_notes("no extras here"), null);
chk('ref empty → null',      hm_profile_ref_from_notes(''), null);
chk('ref null → null',       hm_profile_ref_from_notes(null), null);

echo "service extraction\n";
chk('service from notes',    hm_profile_service_from_notes($notes), '単身引越し');
chk('service missing → null',hm_profile_service_from_notes("[HM_EXTRAS]\nref:HM-9"), null);
chk('service empty → null',  hm_profile_service_from_notes(''), null);

echo "\n" . ($fail ? "FAIL: $fail failed, $pass passed\n" : "PASS: all $pass checks\n");
exit($fail ? 1 : 0);
