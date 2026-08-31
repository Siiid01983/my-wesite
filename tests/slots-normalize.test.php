<?php
// Phase 0 verification: canonical band normalization in hm-api/_slots.php.
// Pure-logic test — no DB. Run: php tests/slots-normalize.test.php
declare(strict_types=1);
require_once __DIR__ . '/../hm-api/_slots.php';

$fail = 0; $pass = 0;
function chk(string $label, $got, $want) {
  global $fail, $pass;
  $ok = ($got === $want);
  $ok ? $pass++ : $fail++;
  printf("  [%s] %-46s got=%-6s want=%-6s\n", $ok ? 'ok' : 'XX', $label,
    var_export($got, true), var_export($want, true));
}

echo "band ID from time value\n";
chk("午前 label",        hm_slot_band_id('午前（9:00〜12:00）'),  'am');
chk("午後 label",        hm_slot_band_id('午後（12:00〜15:00）'), 'pm');
chk("夕方 label",        hm_slot_band_id('夕方（15:00〜18:00）'), 'ev');
chk("夜間 label",        hm_slot_band_id('夜間（18:00〜21:00）'), 'nt');
chk("時間指定なし → null", hm_slot_band_id('時間指定なし'),        null);
chk("empty → null",      hm_slot_band_id(''),                     null);
chk("null → null",       hm_slot_band_id(null),                   null);
chk("custom label w/ 午前", hm_slot_band_id('午前ゆっくり便'),     'am');

echo "band ID from admin hourly slots\n";
chk("08:00〜09:00 → am",  hm_slot_band_id('08:00〜09:00'), 'am');
chk("09:00〜10:00 → am",  hm_slot_band_id('09:00〜10:00'), 'am');
chk("11:00〜12:00 → am",  hm_slot_band_id('11:00〜12:00'), 'am');
chk("12:00〜13:00 → pm",  hm_slot_band_id('12:00〜13:00'), 'pm');
chk("14:00〜15:00 → pm",  hm_slot_band_id('14:00〜15:00'), 'pm');
chk("15:00〜16:00 → ev",  hm_slot_band_id('15:00〜16:00'), 'ev');
chk("17:00〜18:00 → ev",  hm_slot_band_id('17:00〜18:00'), 'ev');
chk("18:00〜19:00 → nt",  hm_slot_band_id('18:00〜19:00'), 'nt');
chk("9時 → am",           hm_slot_band_id('9時'),          'am');
chk("garbage → null",    hm_slot_band_id('あいうえお'),    null);

echo "band ID from packed notes\n";
$notes = "お客様メモ\n[HM_EXTRAS]\nref:HM-1\nfrom:新宿\nto:渋谷\nservice:単身引越し\ntime:午後（12:00〜15:00）\nlocmode:dual";
chk("notes → pm",         hm_slot_band_from_notes($notes),                'pm');
chk("notes no time → null", hm_slot_band_from_notes("just a note\nno extras"), null);
chk("notes empty → null", hm_slot_band_from_notes(''),                    null);

// (band-label round-trip removed: hm_slot_band_label() was deleted in the dead
//  booking_slots band-engine refactor (3bec781). Only the legacy band-ID parsers
//  above survive — still used by migrate-bookings-to-timeline.php to read a legacy
//  booking's stored band — so this file keeps their coverage. No production code
//  references the removed label helper.)

echo "\n" . ($fail ? "FAIL: $fail failed, $pass passed\n" : "PASS: all $pass checks\n");
exit($fail ? 1 : 0);
