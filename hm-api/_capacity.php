<?php
// ════════════════════════════════════════════════════════════════════════════
//  _capacity.php — capacity-based slot scheduling engine (Morning/Afternoon/
//  Evening/Night, configurable capacity per band)
//
//  Replaces the "hard block = 1 booking per band" model with a CONFIGURABLE
//  capacity per (date, band). Reservations live in the SAME booking_slots table
//  (slot_index 0..capacity-1; the UNIQUE(booking_date,time_band,slot_index) key
//  is the hard backstop against a race double-booking a slot_index). A booking
//  fails ONLY when the band is closed or its capacity is exhausted.
//
//  ── Capacity resolution (slot_capacity table) ───────────────────────────────
//    per-(date,band) override row   → wins
//    per-band DEFAULT row (date='*') → fallback
//    no row at all                   → capacity 1, open   (⇐ preserves the exact
//                                      pre-capacity behavior; the engine is inert
//                                      until an admin configures it)
//
//  Side-effect-free: including this file only DEFINES functions. Callers pass PDO.
//  Reuses hm_slot_uuid() / band ids from _slots.php.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_slots.php';   // hm_slot_uuid(), band model

if (!defined('HM_CAPACITY_BUILD')) define('HM_CAPACITY_BUILD', 'capacity-engine-1');
if (!defined('HM_CAP_BANDS'))   define('HM_CAP_BANDS', ['am', 'pm', 'ev', 'nt']);
if (!defined('HM_CAP_DEFAULT')) define('HM_CAP_DEFAULT', '*');   // sentinel booking_date for per-band defaults

if (!function_exists('hm_cap_effective')) {

  /**
   * Master switch: 'capacity_enabled' truthy in _config.php. OFF by default →
   * create-booking keeps the exact capacity-1 slot-lock behavior. When ON, the
   * booking reserve uses hm_cap_reserve() (per-band configurable capacity). The
   * admin slot-capacity.php endpoint works regardless of this flag.
   */
  function hm_capacity_enabled(): bool {
    if (!function_exists('hm_config')) return false;
    return !empty(hm_config()['capacity_enabled']);
  }

  /** CREATE TABLE IF NOT EXISTS slot_capacity (idempotent; matches the migration). */
  function hm_cap_ensure_table(PDO $db): void {
    $db->exec(
      "CREATE TABLE IF NOT EXISTS slot_capacity (
        booking_date VARCHAR(40) NOT NULL,   -- 'YYYY-MM-DD' override, or '*' for the per-band default
        time_band    VARCHAR(20) NOT NULL,   -- am|pm|ev|nt
        capacity     INT         NOT NULL DEFAULT 1,
        is_closed    TINYINT(1)  NOT NULL DEFAULT 0,
        updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (booking_date, time_band)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
  }

  /**
   * Effective capacity + closed state for a (date, band):
   *   date override → per-band default ('*') → fallback {capacity:1, closed:false}.
   * Safe if the table doesn't exist yet (→ fallback), so this is inert pre-migration.
   * @return array{capacity:int, closed:bool, source:string}
   */
  function hm_cap_effective(PDO $db, string $date, string $band): array {
    try {
      $st = $db->prepare('SELECT capacity, is_closed FROM slot_capacity WHERE booking_date = ? AND time_band = ? LIMIT 1');
      $st->execute([$date, $band]);
      $row = $st->fetch(PDO::FETCH_ASSOC);
      $source = 'override';
      if (!$row) {
        $st->execute([HM_CAP_DEFAULT, $band]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        $source = 'default';
      }
      if ($row) {
        return ['capacity' => max(0, (int)$row['capacity']), 'closed' => (bool)(int)$row['is_closed'], 'source' => $source];
      }
    } catch (Throwable $e) {
      // table missing / query error → fall through to the back-compat default.
    }
    return ['capacity' => 1, 'closed' => false, 'source' => 'fallback'];
  }

  /** Reserved slot count for a (date, band) — every booking_slots row counts. */
  function hm_cap_count(PDO $db, string $date, string $band): int {
    $st = $db->prepare('SELECT COUNT(*) FROM booking_slots WHERE booking_date = ? AND time_band = ?');
    $st->execute([$date, $band]);
    return (int)$st->fetchColumn();
  }

  /**
   * Status for a (date, band): closed | full | limited | available (+ counts).
   * limited = remaining>0 and small (<=2 when capacity>=4, else <=1).
   */
  function hm_cap_status(PDO $db, string $date, string $band): array {
    $eff = hm_cap_effective($db, $date, $band);
    $cap = (int)$eff['capacity'];
    $used = hm_cap_count($db, $date, $band);
    $remaining = max(0, $cap - $used);
    $lowMark = $cap >= 4 ? 2 : 1;
    $status = $eff['closed'] ? 'closed'
            : ($remaining <= 0 ? 'full'
            : ($used > 0 && $remaining <= $lowMark ? 'limited' : 'available'));
    return [
      'status' => $status, 'capacity' => $cap, 'used' => $used,
      'remaining' => $remaining, 'closed' => $eff['closed'],
    ];
  }

  /** All four bands' status for a date → { am:{…}, pm:{…}, ev:{…}, nt:{…} }. */
  function hm_cap_day(PDO $db, string $date): array {
    $out = [];
    foreach (HM_CAP_BANDS as $b) $out[$b] = hm_cap_status($db, $date, $b);
    return $out;
  }

  /**
   * Capacity-aware reserve for (date, band): claim the lowest free slot_index in
   * [0, capacity). Runs in the caller's transaction if open, else its own; a
   * SELECT … FOR UPDATE serialises concurrent reservers and the UNIQUE key is the
   * final backstop.
   *
   * @return array one of:
   *   ['ok'=>true, 'slot_index'=>i, 'capacity'=>c, 'used'=>n]
   *   ['conflict'=>true, 'reason'=>'closed'|'full']
   */
  function hm_cap_reserve(PDO $db, string $date, string $band, string $bookingId): array {
    $eff = hm_cap_effective($db, $date, $band);
    if ($eff['closed'])       return ['conflict' => true, 'reason' => 'closed'];
    $cap = (int)$eff['capacity'];
    if ($cap <= 0)            return ['conflict' => true, 'reason' => 'full'];

    $ownTx = !$db->inTransaction();
    if ($ownTx) $db->beginTransaction();
    try {
      $q = $db->prepare('SELECT slot_index FROM booking_slots WHERE booking_date = ? AND time_band = ? FOR UPDATE');
      $q->execute([$date, $band]);
      $used = [];
      foreach ($q as $r) $used[(int)$r['slot_index']] = true;
      if (count($used) >= $cap) {
        if ($ownTx) $db->rollBack();
        return ['conflict' => true, 'reason' => 'full'];
      }
      $idx = 0;
      while (isset($used[$idx])) $idx++;

      $ins = $db->prepare(
        'INSERT INTO booking_slots (id, booking_date, time_band, slot_index, booking_id, status)
         VALUES (?,?,?,?,?,?)'
      );
      $ins->execute([hm_slot_uuid(), $date, $band, $idx, $bookingId, 'reserved']);

      if ($ownTx) $db->commit();
      return ['ok' => true, 'slot_index' => $idx, 'capacity' => $cap, 'used' => count($used) + 1];
    } catch (PDOException $e) {
      if ($ownTx && $db->inTransaction()) $db->rollBack();
      if (($e->errorInfo[0] ?? '') === '23000') return ['conflict' => true, 'reason' => 'full']; // race lost the index
      throw $e;
    } catch (Throwable $e) {
      if ($ownTx && $db->inTransaction()) $db->rollBack();
      throw $e;
    }
  }

  /** Upsert a capacity/closed setting. $date = 'YYYY-MM-DD' or HM_CAP_DEFAULT ('*'). */
  function hm_cap_set(PDO $db, string $date, string $band, ?int $capacity, ?bool $closed): void {
    hm_cap_ensure_table($db);
    $cur = hm_cap_effective($db, $date, $band);
    $cap = $capacity !== null ? max(0, $capacity) : (int)$cur['capacity'];
    $cl  = $closed   !== null ? ($closed ? 1 : 0)  : ($cur['closed'] ? 1 : 0);
    $st = $db->prepare(
      'INSERT INTO slot_capacity (booking_date, time_band, capacity, is_closed)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE capacity = VALUES(capacity), is_closed = VALUES(is_closed)'
    );
    $st->execute([$date, $band, $cap, $cl]);
  }
}
