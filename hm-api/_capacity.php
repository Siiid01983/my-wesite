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
        reason       VARCHAR(120) NOT NULL DEFAULT '',   -- closure reason (e.g. Holiday)
        updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (booking_date, time_band)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    // Additive: add `reason` to a table created before this column existed. Wrapped
    // so a duplicate-column error (already present) is a harmless no-op.
    try { $db->exec("ALTER TABLE slot_capacity ADD COLUMN reason VARCHAR(120) NOT NULL DEFAULT ''"); } catch (Throwable $e) { /* column exists */ }
  }

  /**
   * Effective capacity + closed state for a (date, band):
   *   date override → per-band default ('*') → fallback {capacity:1, closed:false}.
   * Safe if the table doesn't exist yet (→ fallback), so this is inert pre-migration.
   * @return array{capacity:int, closed:bool, source:string}
   */
  function hm_cap_effective(PDO $db, string $date, string $band): array {
    try {
      $st = $db->prepare('SELECT capacity, is_closed, reason FROM slot_capacity WHERE booking_date = ? AND time_band = ? LIMIT 1');
      $st->execute([$date, $band]);
      $row = $st->fetch(PDO::FETCH_ASSOC);
      $source = 'override';
      if (!$row) {
        $st->execute([HM_CAP_DEFAULT, $band]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        $source = 'default';
      }
      if ($row) {
        return ['capacity' => max(0, (int)$row['capacity']), 'closed' => (bool)(int)$row['is_closed'],
                'reason' => (string)($row['reason'] ?? ''), 'source' => $source];
      }
    } catch (Throwable $e) {
      // table missing / query error → fall through to the back-compat default.
    }
    return ['capacity' => 1, 'closed' => false, 'reason' => '', 'source' => 'fallback'];
  }

  /** Reserved slot count for a (date, band) — every booking_slots row counts.
   *  $excludeBookingId (optional) omits a booking's OWN reservation from the tally
   *  so re-confirming a booking that already holds its slot isn't mis-counted. */
  function hm_cap_count(PDO $db, string $date, string $band, string $excludeBookingId = ''): int {
    if ($excludeBookingId !== '') {
      $st = $db->prepare('SELECT COUNT(*) FROM booking_slots WHERE booking_date = ? AND time_band = ? AND booking_id <> ?');
      $st->execute([$date, $band, $excludeBookingId]);
    } else {
      $st = $db->prepare('SELECT COUNT(*) FROM booking_slots WHERE booking_date = ? AND time_band = ?');
      $st->execute([$date, $band]);
    }
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
      'reason' => $eff['closed'] ? (string)($eff['reason'] ?? '') : '',
    ];
  }

  /** All four bands' status for a date → { am:{…}, pm:{…}, ev:{…}, nt:{…} }. */
  function hm_cap_day(PDO $db, string $date): array {
    $out = [];
    foreach (HM_CAP_BANDS as $b) $out[$b] = hm_cap_status($db, $date, $b);
    return $out;
  }

  /**
   * FULL-DAY closure state: a date is "closed" only when EVERY band is closed
   * (the state written by the close-day admin action). Reason = the first non-empty
   * band reason. Safe pre-migration (→ {closed:false}). This is the day-level view
   * the calendar and the create-time guard use.
   * @return array{closed:bool, reason:string}
   */
  function hm_cap_day_closed(PDO $db, string $date): array {
    $reason = '';
    foreach (HM_CAP_BANDS as $b) {
      $eff = hm_cap_effective($db, $date, $b);
      if (empty($eff['closed'])) return ['closed' => false, 'reason' => ''];
      if ($reason === '' && !empty($eff['reason'])) $reason = (string)$eff['reason'];
    }
    return ['closed' => true, 'reason' => $reason];
  }

  /**
   * SINGLE SOURCE OF TRUTH for pre-CONFIRM validation of a (date, band). Every
   * confirm path funnels through here — Ops (booking-status.php), Admin
   * (rest.php bookings update→confirmed), and Reschedule (reschedule.php) — so the
   * business rules and the error taxonomy live in exactly one place. Non-mutating
   * (validation only; the atomic reserve stays where it already is).
   *
   * Built from the same primitives availability.php uses (hm_cap_day_closed /
   * hm_cap_effective / hm_cap_count), so no rule is duplicated. $band null/'' = a
   * flexible / 時間指定なし booking → only the whole-day rule applies. $bookingId
   * (optional) excludes the booking's OWN reservation from the capacity tally.
   *
   * @return array{ok:bool, reason?:string, detail?:string}
   *   ok=true                              → may be confirmed
   *   reason='day_closed'|'band_closed'    → closure (detail = the stored reason)
   *   reason='slot_taken'                  → band capacity exhausted
   */
  function hm_cap_confirm_check(PDO $db, string $date, ?string $band, string $bookingId = ''): array {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) return ['ok' => true];   // undated → nothing to enforce
    // 1) whole-day closure (all bands closed)
    $dc = hm_cap_day_closed($db, $date);
    if (!empty($dc['closed'])) return ['ok' => false, 'reason' => 'day_closed', 'detail' => (string)($dc['reason'] ?? '')];
    // 2) band-level closure / capacity — only when the booking carries a band
    if ($band !== null && $band !== '' && in_array($band, HM_CAP_BANDS, true)) {
      $eff = hm_cap_effective($db, $date, $band);
      if (!empty($eff['closed'])) return ['ok' => false, 'reason' => 'band_closed', 'detail' => (string)($eff['reason'] ?? '')];
      $remaining = (int)$eff['capacity'] - hm_cap_count($db, $date, $band, $bookingId);
      if ($remaining <= 0) return ['ok' => false, 'reason' => 'slot_taken', 'detail' => ''];
    }
    return ['ok' => true];
  }

  /**
   * Fully-closed days in [from, to] → { 'YYYY-MM-DD' => reason, … }. Candidate
   * dates are specific-date rows flagged closed (what close-day writes); each is
   * re-checked with hm_cap_day_closed so PARTIAL band closures are excluded — only
   * whole-day closures paint red on the calendar. Bounded by the caller's range.
   * Safe if the table doesn't exist yet (→ []).
   */
  function hm_cap_closed_range(PDO $db, string $from, string $to): array {
    $out = [];
    try {
      $st = $db->prepare(
        "SELECT DISTINCT booking_date FROM slot_capacity
         WHERE is_closed = 1 AND booking_date <> ? AND booking_date BETWEEN ? AND ?"
      );
      $st->execute([HM_CAP_DEFAULT, $from, $to]);
      foreach ($st as $r) {
        $d  = (string)($r['booking_date'] ?? '');
        if ($d === '') continue;
        $dc = hm_cap_day_closed($db, $d);
        if ($dc['closed']) $out[$d] = $dc['reason'];
      }
    } catch (Throwable $e) {
      // table missing / query error → no closed days
    }
    return $out;
  }

  /**
   * PURE status derivation for a single (capacity, used, closed) triple — the exact
   * rule hm_cap_status() applies, factored out so it is DB-free and unit-testable
   * (and reused by hm_cap_month). closed wins; else full when nothing remains; else
   * limited when some slot is used and the remainder is at/under the low-water mark
   * (2 when capacity>=4, else 1); else available. reason surfaces only when closed.
   * @return array{status:string,capacity:int,used:int,remaining:int,closed:bool,reason:string}
   */
  function hm_cap_state(int $capacity, int $used, bool $closed, string $reason = ''): array {
    $cap = max(0, $capacity);
    $u   = max(0, $used);
    $remaining = max(0, $cap - $u);
    $lowMark = $cap >= 4 ? 2 : 1;
    $status = $closed ? 'closed'
            : ($remaining <= 0 ? 'full'
            : ($u > 0 && $remaining <= $lowMark ? 'limited' : 'available'));
    return [
      'status' => $status, 'capacity' => $cap, 'used' => $u,
      'remaining' => $remaining, 'closed' => $closed,
      'reason' => $closed ? $reason : '',
    ];
  }

  /**
   * Per-band status for EVERY day in [from, to] — the read behind the slot-aware
   * admin month calendar. Same per-band shape + semantics as hm_cap_status(), but
   * computed in just TWO queries for the whole range (one slot_capacity read for
   * overrides + per-band defaults, one grouped booking_slots read for used counts)
   * so a month render doesn't fan out into 8×N round-trips.
   *
   * @return array<string, array<string, array{status:string,capacity:int,used:int,
   *   remaining:int,closed:bool,reason:string}>>  — { 'YYYY-MM-DD' => { am:{…}, … } }
   * Safe pre-migration: a missing slot_capacity / booking_slots table yields the
   * back-compat default for every day (capacity 1, open, 0 used).
   */
  function hm_cap_month(PDO $db, string $from, string $to): array {
    // Enumerate the days (inclusive). Invalid input → empty result.
    try {
      $start = new DateTimeImmutable($from);
      $end   = new DateTimeImmutable($to);
    } catch (Throwable $e) { return []; }
    if ($end < $start) { $t = $start; $start = $end; $end = $t; }
    $days = [];
    for ($d = $start; $d <= $end; $d = $d->modify('+1 day')) $days[] = $d->format('Y-m-d');

    $fromD = $days[0] ?? $from;
    $toD   = $days[count($days) - 1] ?? $to;

    // Per-band defaults (date='*') + per-(date,band) overrides in one read.
    $defaults = [];
    foreach (HM_CAP_BANDS as $b) $defaults[$b] = ['capacity' => 1, 'closed' => false, 'reason' => ''];
    $override = [];   // $override[date][band] = ['capacity','closed','reason']
    try {
      $st = $db->prepare(
        "SELECT booking_date, time_band, capacity, is_closed, reason FROM slot_capacity
         WHERE booking_date = ? OR (booking_date BETWEEN ? AND ?)"
      );
      $st->execute([HM_CAP_DEFAULT, $fromD, $toD]);
      foreach ($st as $r) {
        $bn = (string)($r['time_band'] ?? '');
        if (!in_array($bn, HM_CAP_BANDS, true)) continue;
        $row = ['capacity' => max(0, (int)$r['capacity']), 'closed' => (bool)(int)$r['is_closed'], 'reason' => (string)($r['reason'] ?? '')];
        $bd = (string)($r['booking_date'] ?? '');
        if ($bd === HM_CAP_DEFAULT) $defaults[$bn] = $row;
        else                        $override[$bd][$bn] = $row;
      }
    } catch (Throwable $e) { /* table missing → all defaults (capacity 1, open) */ }

    // Reserved counts per (date, band) in one grouped read.
    $used = [];   // $used[date][band] = int
    try {
      $st = $db->prepare(
        "SELECT booking_date, time_band, COUNT(*) c FROM booking_slots
         WHERE booking_date BETWEEN ? AND ? GROUP BY booking_date, time_band"
      );
      $st->execute([$fromD, $toD]);
      foreach ($st as $r) $used[(string)($r['booking_date'] ?? '')][(string)($r['time_band'] ?? '')] = (int)$r['c'];
    } catch (Throwable $e) { /* no booking_slots → zero used everywhere */ }

    $out = [];
    foreach ($days as $day) {
      $bands = [];
      foreach (HM_CAP_BANDS as $b) {
        $eff = $override[$day][$b] ?? $defaults[$b];   // date override → default → cap1/open
        $bands[$b] = hm_cap_state((int)$eff['capacity'], (int)($used[$day][$b] ?? 0), (bool)$eff['closed'], (string)($eff['reason'] ?? ''));
      }
      $out[$day] = $bands;
    }
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

  /** Upsert a capacity/closed setting. $date = 'YYYY-MM-DD' or HM_CAP_DEFAULT ('*').
   *  $reason: closure reason to store when closing; null keeps the current reason,
   *  and reopening (closed=false) clears it. */
  function hm_cap_set(PDO $db, string $date, string $band, ?int $capacity, ?bool $closed, ?string $reason = null): void {
    hm_cap_ensure_table($db);
    $cur = hm_cap_effective($db, $date, $band);
    $cap = $capacity !== null ? max(0, $capacity) : (int)$cur['capacity'];
    $cl  = $closed   !== null ? ($closed ? 1 : 0)  : ($cur['closed'] ? 1 : 0);
    // Reason: set on close; cleared on reopen; otherwise preserved.
    $rsn = ($closed === false) ? ''
         : ($reason !== null ? mb_substr($reason, 0, 120) : (string)($cur['reason'] ?? ''));
    $st = $db->prepare(
      'INSERT INTO slot_capacity (booking_date, time_band, capacity, is_closed, reason)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE capacity = VALUES(capacity), is_closed = VALUES(is_closed), reason = VALUES(reason)'
    );
    $st->execute([$date, $band, $cap, $cl, $rsn]);
  }
}
