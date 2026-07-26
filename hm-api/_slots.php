<?php
// ════════════════════════════════════════════════════════════════════════════
//  _slots.php — UUID helper + legacy band PARSER (migration-only)
//
//  The band/booking_slots SCHEDULING ENGINE has been removed (timeline final
//  migration). What remains here is intentionally NOT a scheduler:
//    • hm_slot_uuid()            — UUID v4 helper used by availability_windows and
//                                  admin blocks (the interval engine's row ids).
//    • hm_slot_band_id() / …_from_notes() — read a LEGACY booking's stored band
//                                  (午前/午後/夕方/夜間) so the ONE-TIME
//                                  migrate-bookings-to-timeline.php can convert old
//                                  band rows into start_at/end_at intervals. These
//                                  are a data-conversion tool, never a live path.
//
//  There is no booking_slots table, no hm_slot_reserve, no capacity — availability
//  is served ONLY by availability_windows + booking intervals (_windows.php /
//  _intervals.php). Including this file only defines functions.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

if (!defined('HM_SLOTS_BUILD')) define('HM_SLOTS_BUILD', 'timeline-uuid-parser-1');

if (!function_exists('hm_slot_uuid')) {

  /** UUID v4 — reuses hm_uuid4() if loaded, else a local fallback (test-safe). */
  function hm_slot_uuid(): string {
    if (function_exists('hm_uuid4')) return hm_uuid4();
    $d = random_bytes(16);
    $d[6] = chr((ord($d[6]) & 0x0f) | 0x40);
    $d[8] = chr((ord($d[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($d), 4));
  }

  // ── Legacy band parser — used ONLY by migrate-bookings-to-timeline.php ────────
  //  Maps a pre-timeline booking's stored time value to its old band so the row can
  //  be converted to an interval. NOT referenced by any live scheduling endpoint.

  /** Extract the packed `time:` value from a booking's notes [HM_EXTRAS] block. */
  function hm_slot_time_from_notes(?string $notes): ?string {
    $n = (string)$notes;
    if ($n === '') return null;
    if (preg_match('/^time:\s*(.+)$/m', $n, $m)) return trim($m[1]);
    return null;
  }

  /** Legacy time value → canonical band id ('am'|'pm'|'ev'|'nt') or null. */
  function hm_slot_band_id(?string $time): ?string {
    $t = trim((string)$time);
    if ($t === '') return null;
    if (strpos($t, '午前') !== false) return 'am';
    if (strpos($t, '午後') !== false) return 'pm';
    if (strpos($t, '夕方') !== false) return 'ev';
    if (strpos($t, '夜間') !== false) return 'nt';
    if (strpos($t, '時間指定なし') !== false) return null;
    if (preg_match('/(\d{1,2})\s*[:：時]/u', $t, $m)) {
      $h = (int)$m[1];
      if ($h >= 8  && $h < 12) return 'am';
      if ($h >= 12 && $h < 15) return 'pm';
      if ($h >= 15 && $h < 18) return 'ev';
      if ($h >= 18)            return 'nt';
      return null;
    }
    return null;
  }

  /** Convenience: canonical band id parsed straight from a booking's notes. */
  function hm_slot_band_from_notes(?string $notes): ?string {
    return hm_slot_band_id(hm_slot_time_from_notes($notes));
  }
}
