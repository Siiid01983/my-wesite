<?php
// ════════════════════════════════════════════════════════════════════════════
//  _slots.php — Smart Booking Engine slot layer (Phase 0)
//
//  Shared, side-effect-free helper for server-side slot locking. In Phase 0 it
//  is DEFINED but NOT WIRED into any request handler — create-booking.php,
//  rest.php, admin, and portal are untouched. Phase 2 calls hm_slot_reserve()
//  inside the booking-insert transaction; the DB UNIQUE constraint on
//  booking_slots(booking_date, time_band, slot_index) is the actual lock.
//
//  Canonical band model (Open Item #4): the lock key is a STABLE band ID
//  ('am'|'pm'|'ev'|'nt'), never the display label — so relabeling a slot in
//  hm_booking_config cannot orphan a lock. 時間指定なし / blank / unrecognised
//  time → NULL band → NOT slot-locked (day-level rules still apply).
//
//  Including this file only defines functions. Callers pass their own PDO.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

// Build marker — reported by slot-preflight.php so the safe-test driver can
// detect whether a fresh deploy actually took effect (vs stale OPcache bytecode).
if (!defined('HM_SLOTS_BUILD')) define('HM_SLOTS_BUILD', 'phase2-slice2');

if (!function_exists('hm_slot_band_id')) {

  /**
   * Normalize any stored time value to a canonical band ID, or NULL when the
   * booking should NOT hard-lock a band (flexible / unrecognised → skip lock).
   *
   * Handles BOTH representations that exist in production:
   *   - public band labels: '午前（9:00〜12:00）' '午後…' '夕方…' '夜間…' '時間指定なし'
   *   - admin hourly slots:  '09:00〜10:00', '9時', etc.
   * Keyword match wins (robust to custom labels that embed a band word); a
   * numeric first-hour fallback covers the hourly picks.
   *
   * Band → clock mapping: am = 08–11, pm = 12–14, ev = 15–17, nt = 18+.
   */
  function hm_slot_band_id(?string $time): ?string {
    $t = trim((string)$time);
    if ($t === '') return null;

    if (strpos($t, '午前') !== false) return 'am';
    if (strpos($t, '午後') !== false) return 'pm';
    if (strpos($t, '夕方') !== false) return 'ev';
    if (strpos($t, '夜間') !== false) return 'nt';
    if (strpos($t, '時間指定なし') !== false) return null;  // flexible → no hard lock

    // Numeric fallback: first hour in the string ("09:00〜10:00", "9時").
    if (preg_match('/(\d{1,2})\s*[:：時]/u', $t, $m)) {
      $h = (int)$m[1];
      if ($h >= 8  && $h < 12) return 'am';
      if ($h >= 12 && $h < 15) return 'pm';
      if ($h >= 15 && $h < 18) return 'ev';
      if ($h >= 18)            return 'nt';
      return null;                                             // pre-08:00 → flexible
    }
    return null;                                               // unrecognised → skip lock (back-compat)
  }

  /** Human label for a band ID (for UI/logs). Unknown → the id itself. */
  function hm_slot_band_label(?string $bandId): string {
    switch ($bandId) {
      case 'am': return '午前（9:00〜12:00）';
      case 'pm': return '午後（12:00〜15:00）';
      case 'ev': return '夕方（15:00〜18:00）';
      case 'nt': return '夜間（18:00〜21:00）';
      default:   return (string)$bandId;
    }
  }

  /** Extract the packed `time:` value from a booking's notes [HM_EXTRAS] block. */
  function hm_slot_time_from_notes(?string $notes): ?string {
    $n = (string)$notes;
    if ($n === '') return null;
    if (preg_match('/^time:\s*(.+)$/m', $n, $m)) return trim($m[1]);
    return null;
  }

  /** Convenience: canonical band ID parsed straight from a booking's notes. */
  function hm_slot_band_from_notes(?string $notes): ?string {
    return hm_slot_band_id(hm_slot_time_from_notes($notes));
  }

  /**
   * SLOT_LOCK_ENABLED feature flag. OFF by default: enforcement only activates
   * when 'slot_lock_enabled' is truthy in hm-api/_config.php. The key is ABSENT
   * today, so this returns false in production and every write path behaves
   * exactly as before. Enabling is a one-line config change the operator makes
   * (never written by this code) once all Phase 2 write paths are in place.
   */
  function hm_slot_lock_enabled(): bool {
    if (!function_exists('hm_config')) return false;
    $c = hm_config();
    return !empty($c['slot_lock_enabled']);
  }

  /** CREATE TABLE IF NOT EXISTS booking_slots (idempotent; matches schema file). */
  function hm_slot_ensure_table(PDO $db): void {
    $db->exec(
      "CREATE TABLE IF NOT EXISTS booking_slots (
        id           CHAR(36)    NOT NULL,
        booking_date VARCHAR(40) NOT NULL,
        time_band    VARCHAR(20) NOT NULL,
        slot_index   INT         NOT NULL DEFAULT 0,
        booking_id   CHAR(36)    NOT NULL,
        status       VARCHAR(20) NOT NULL DEFAULT 'reserved',
        created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY slot_unique (booking_date, time_band, slot_index),
        KEY slot_date_idx (booking_date),
        KEY slot_booking_idx (booking_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
  }

  /**
   * Reserve the slot for a booking. Capacity = 1 (slot_index 0). NOT wired in
   * Phase 0 — call from inside the booking-insert transaction in Phase 2.
   *
   * @return array {
   *   locked:bool, band:?string, reason?:string, conflict?:bool
   * }  locked=false with reason='no_band' → flexible booking, allow through.
   *      locked=false with conflict=true  → slot already taken → caller 409s.
   */
  function hm_slot_reserve(PDO $db, string $date, ?string $time, string $bookingId, int $capacity = 1): array {
    $band = hm_slot_band_id($time);
    if ($band === null) return ['locked' => false, 'band' => null, 'reason' => 'no_band'];

    // capacity == 1: single UNIQUE insert is the lock. (capacity > 1 is a future
    // branch: SELECT ... FOR UPDATE + lowest free slot_index < capacity.)
    try {
      $st = $db->prepare(
        'INSERT INTO booking_slots (id, booking_date, time_band, slot_index, booking_id, status)
         VALUES (?,?,?,?,?,?)'
      );
      $st->execute([hm_slot_uuid(), $date, $band, 0, $bookingId, 'reserved']);
      return ['locked' => true, 'band' => $band];
    } catch (PDOException $e) {
      if (($e->errorInfo[0] ?? '') === '23000') {          // duplicate key = slot taken
        return ['locked' => false, 'band' => $band, 'conflict' => true, 'reason' => 'slot_taken'];
      }
      throw $e;
    }
  }

  /** Release every slot row held by a booking (cancel / reschedule / delete). */
  function hm_slot_release(PDO $db, string $bookingId): int {
    $st = $db->prepare('DELETE FROM booking_slots WHERE booking_id = ?');
    $st->execute([$bookingId]);
    return $st->rowCount();
  }

  /** Reserved count per band for a date → { am:n, pm:n, ev:n, nt:n }. */
  function hm_slot_counts(PDO $db, string $date): array {
    $st = $db->prepare('SELECT time_band, COUNT(*) AS n FROM booking_slots WHERE booking_date = ? GROUP BY time_band');
    $st->execute([$date]);
    $out = [];
    foreach ($st as $r) $out[(string)$r['time_band']] = (int)$r['n'];
    return $out;
  }

  /** UUID v4 — reuses hm_uuid4() if loaded, else a local fallback (test-safe). */
  function hm_slot_uuid(): string {
    if (function_exists('hm_uuid4')) return hm_uuid4();
    $d = random_bytes(16);
    $d[6] = chr((ord($d[6]) & 0x0f) | 0x40);
    $d[8] = chr((ord($d[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($d), 4));
  }
}
