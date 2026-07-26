<?php
// ════════════════════════════════════════════════════════════════════════════
//  _windows.php — allow-list availability windows (hourly timeline scheduler)
//
//  MODEL (allow-list): the admin draws AVAILABLE working periods on an hourly
//  timeline; those periods live in `availability_windows` as [start_at, end_at)
//  ranges. A customer's bookable start times are the `step`-minute marks INSIDE a
//  window such that [start, start+duration) fits the window AND does not overlap a
//  busy interval (existing bookings + admin blocks, read via _intervals.php).
//
//  This is the inverse of the band/capacity and block-list models — "nothing is
//  bookable unless the admin opened it." Reserving a chosen slot goes through the
//  SAME atomic hm_iv_reserve() as everything else, so overlap/double-book
//  protection is shared and there is a single conflict authority.
//
//  ── ACTIVATION GATE (hm_timeline_active) ────────────────────────────────────
//  The timeline read/write paths in the LIVE endpoints activate ONLY when:
//    1. 'timeline_enabled' is truthy in hm-api/_config.php (operator flips it), AND
//    2. bookings.start_at exists (migrations/hourly/001 ran — interval columns).
//  The availability_windows table is ensured on demand. Deploy-order-safe and
//  dormant by default, mirroring hm_iv_active / hm_blocks_enabled / capacity.
//  Side-effect-free: including this file only DEFINES functions.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

require_once __DIR__ . '/_intervals.php';   // hm_bookings_has_interval_cols, hm_iv_day, hm_iv_normalize
require_once __DIR__ . '/_slots.php';       // hm_slot_uuid
require_once __DIR__ . '/_closedays.php';   // hm_day_is_closed — whole-day closures suppress all windows

if (!defined('HM_WINDOWS_BUILD')) define('HM_WINDOWS_BUILD', 'timeline-windows-1');

if (!function_exists('hm_timeline_enabled')) {

  // ── Config / gate ───────────────────────────────────────────────────────────

  /** Legacy flag reader (retained for tooling/back-compat). The timeline no longer
   *  GATES on this — it is the sole scheduler. Absent → treated as on. */
  function hm_timeline_enabled(): bool {
    if (!function_exists('hm_config')) return true;
    $cfg = hm_config();
    // Only an EXPLICIT false disables; absence means "on" (bands are removed).
    if (array_key_exists('timeline_enabled', $cfg)) return !empty($cfg['timeline_enabled']);
    return true;
  }

  /**
   * The timeline is the SOLE scheduler (band + capacity engines removed). It is
   * ACTIVE whenever the bookings table has interval columns — which are ensured on
   * demand (hm_iv_ensure_cols) so a fresh deploy needs no operator migration and no
   * config flip. An explicit 'timeline_disabled' => true in _config.php is the only
   * kill-switch (emergency stop); the legacy 'timeline_enabled' flag no longer gates.
   */
  function hm_timeline_active(PDO $db): bool {
    if (function_exists('hm_config') && !empty(hm_config()['timeline_disabled'])) return false;
    hm_iv_ensure_cols($db);
    return hm_bookings_has_interval_cols($db);
  }

  /**
   * Default availability windows (minutes-since-midnight [start,end] pairs) applied
   * to any date the admin has NOT explicitly drawn windows for, so customers always
   * receive bookable start times out-of-the-box. Config: 'timeline_default_windows'
   * => [['09:00','18:00'], …]; default is a single 09:00–18:00 business-hours block.
   * An admin window drawn for a specific date OVERRIDES the default for that date;
   * a CLOSED day suppresses it entirely (handled in hm_windows_day_ranges).
   */
  function hm_timeline_default_windows(): array {
    $cfg = (function_exists('hm_config') ? hm_config() : []);
    $raw = $cfg['timeline_default_windows'] ?? [['09:00', '18:00']];
    $out = [];
    foreach ((array)$raw as $w) {
      if (!is_array($w)) continue;
      $a = hm_tl_min((string)($w[0] ?? '')); $b = hm_tl_min((string)($w[1] ?? ''));
      if ($a !== null && $b !== null && $b > $a) $out[] = [$a, $b];
    }
    return $out;
  }

  /** Does bookings.duration_min exist yet (timeline 001 migration)? Cached. */
  function hm_bookings_has_duration_col(PDO $db): bool {
    static $has = null;
    if ($has === null) {
      try {
        $q = $db->query("SHOW COLUMNS FROM bookings LIKE 'duration_min'");
        $has = (bool)($q && $q->fetch());
      } catch (Throwable $e) { $has = false; }
    }
    return $has;
  }

  /** Allowed reservation durations (minutes). Config may override; default set. */
  function hm_timeline_durations(): array {
    $d = (function_exists('hm_config') ? (hm_config()['timeline_durations'] ?? null) : null);
    if (is_array($d) && $d) {
      $out = [];
      foreach ($d as $v) { $v = (int)$v; if ($v > 0) $out[] = $v; }
      if ($out) return array_values(array_unique($out));
    }
    return [30, 60, 90, 120, 180];
  }

  /** Default reservation duration (minutes). Default 120 (2h). */
  function hm_timeline_default_duration(): int {
    $v = (int)(function_exists('hm_config') ? (hm_config()['timeline_default_duration'] ?? 0) : 0);
    return $v > 0 ? $v : 120;
  }

  /** Slot granularity (minutes) for both windows and generated start times. */
  function hm_timeline_step(): int {
    $v = (int)(function_exists('hm_config') ? (hm_config()['timeline_slot_step'] ?? 0) : 0);
    return $v > 0 ? $v : 30;
  }

  /** Business-day visual bounds ["07:00","22:00"] — for the grid, not enforcement. */
  function hm_timeline_day_bounds(): array {
    $cfg = (function_exists('hm_config') ? hm_config() : []);
    $s = (string)($cfg['timeline_day_start'] ?? '07:00');
    $e = (string)($cfg['timeline_day_end']   ?? '22:00');
    if (!preg_match('/^\d{2}:\d{2}$/', $s)) $s = '07:00';
    if (!preg_match('/^\d{2}:\d{2}$/', $e)) $e = '22:00';
    return [$s, $e];
  }

  // ── Pure time helpers (minutes-since-midnight) — unit-testable, no DB ────────

  /** "YYYY-MM-DD HH:MM[:SS]" | ISO → minutes since local midnight, or null. */
  function hm_tl_min(?string $dt): ?int {
    $s = trim((string)$dt);
    if ($s === '') return null;
    if (preg_match('/(\d{2}):(\d{2})(?::\d{2})?\s*$/', $s, $m)) {
      return ((int)$m[1]) * 60 + (int)$m[2];
    }
    return null;
  }

  /** Minutes since midnight → "HH:MM" (clamped 0..1440). */
  function hm_tl_hhmm(int $min): string {
    $min = max(0, min(1440, $min));
    return sprintf('%02d:%02d', intdiv($min, 60), $min % 60);
  }

  /** Snap a minute value to the nearest lower multiple of step. */
  function hm_tl_snap(int $min, int $step): int {
    if ($step <= 0) return $min;
    return intdiv($min, $step) * $step;
  }

  /**
   * Union a set of [startMin,endMin] ranges → non-overlapping, sorted, merged
   * (adjacent ranges touching at a boundary are merged). Pure.
   */
  function hm_tl_union(array $ranges): array {
    $clean = [];
    foreach ($ranges as $r) {
      $a = (int)($r[0] ?? 0); $b = (int)($r[1] ?? 0);
      if ($b > $a) $clean[] = [$a, $b];
    }
    if (!$clean) return [];
    usort($clean, fn($x, $y) => $x[0] <=> $y[0]);
    $out = [$clean[0]];
    for ($i = 1; $i < count($clean); $i++) {
      $last = &$out[count($out) - 1];
      if ($clean[$i][0] <= $last[1]) {                 // overlap or touch → merge
        if ($clean[$i][1] > $last[1]) $last[1] = $clean[$i][1];
      } else {
        $out[] = $clean[$i];
      }
      unset($last);
    }
    return $out;
  }

  /**
   * PURE slot generator. Given available windows and busy intervals (both as
   * [startMin,endMin] arrays), the reservation duration and step, return the
   * sorted list of bookable start times as "HH:MM" strings.
   *
   * A start S is bookable iff [S, S+duration] fits ENTIRELY inside one (unioned)
   * window AND [S, S+duration) overlaps NO busy interval.
   */
  function hm_tl_gen_slots(array $windows, array $busy, int $durationMin, int $stepMin): array {
    if ($durationMin <= 0 || $stepMin <= 0) return [];
    $wins = hm_tl_union($windows);
    $busy = hm_tl_union($busy);
    $slots = [];
    foreach ($wins as $w) {
      for ($s = $w[0]; $s + $durationMin <= $w[1]; $s += $stepMin) {
        $e = $s + $durationMin;
        $free = true;
        foreach ($busy as $b) {
          if ($s < $b[1] && $e > $b[0]) { $free = false; break; }   // half-open overlap
        }
        if ($free) $slots[] = hm_tl_hhmm($s);
      }
    }
    $slots = array_values(array_unique($slots));
    sort($slots);
    return $slots;
  }

  /** Is [startMin,startMin+dur] fully inside a window AND clear of busy? Pure. */
  function hm_tl_fits(array $windows, array $busy, int $startMin, int $durationMin): bool {
    $e = $startMin + $durationMin;
    $inWindow = false;
    foreach (hm_tl_union($windows) as $w) {
      if ($startMin >= $w[0] && $e <= $w[1]) { $inWindow = true; break; }
    }
    if (!$inWindow) return false;
    foreach (hm_tl_union($busy) as $b) {
      if ($startMin < $b[1] && $e > $b[0]) return false;
    }
    return true;
  }

  // ── Table + CRUD ────────────────────────────────────────────────────────────

  function hm_windows_ensure_table(PDO $db): void {
    // Portable across MySQL (prod) and SQLite (tests): no inline KEY clauses —
    // indexes are added separately (best-effort; MySQL lacks CREATE INDEX IF NOT
    // EXISTS, so a duplicate is swallowed). The migration SQL owns prod indexes.
    $db->exec(
      "CREATE TABLE IF NOT EXISTS availability_windows (
        id          CHAR(36)  NOT NULL,
        window_date DATE      NOT NULL,
        start_at    DATETIME  NOT NULL,
        end_at      DATETIME  NOT NULL,
        created_at  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      )"
    );
    foreach ([
      'CREATE INDEX IF NOT EXISTS availability_windows_date_idx ON availability_windows (window_date)',
      'CREATE INDEX IF NOT EXISTS availability_windows_start_at_idx ON availability_windows (start_at)',
    ] as $ix) {
      try { $db->exec($ix); } catch (Throwable $e) { /* index exists / older engine → ignore */ }
    }
  }

  /** List windows for a single date → [{id,start_at,end_at}, …] ordered by start. */
  function hm_windows_day(PDO $db, string $date): array {
    hm_windows_ensure_table($db);
    $st = $db->prepare(
      "SELECT id, start_at, end_at FROM availability_windows
        WHERE window_date = ? ORDER BY start_at ASC"
    );
    $st->execute([$date]);
    return $st->fetchAll(PDO::FETCH_ASSOC);
  }

  /** List windows across [from,to] (inclusive) for the week/month grid. */
  function hm_windows_range(PDO $db, string $from, string $to): array {
    hm_windows_ensure_table($db);
    $st = $db->prepare(
      "SELECT id, window_date, start_at, end_at FROM availability_windows
        WHERE window_date >= ? AND window_date <= ? ORDER BY start_at ASC"
    );
    $st->execute([$from, $to]);
    return $st->fetchAll(PDO::FETCH_ASSOC);
  }

  /**
   * Add a window [start,end) (same day, start<end, snapped to step).
   *   ['ok'=>true,'id'=>…,'start'=>…,'end'=>…]  |  ['error'=>msg]
   */
  function hm_windows_add(PDO $db, ?string $startIso, ?string $endIso): array {
    $start = hm_iv_normalize($startIso);
    $end   = hm_iv_normalize($endIso);
    if ($start === null || $end === null) return ['error' => 'invalid start/end'];
    if (substr($start, 0, 10) !== substr($end, 0, 10)) return ['error' => 'start and end must be the same day'];
    $step = hm_timeline_step();
    $sMin = hm_tl_snap((int)hm_tl_min($start), $step);
    $eMin = hm_tl_snap((int)hm_tl_min($end),   $step);
    if ($eMin <= $sMin) return ['error' => 'end must be after start'];
    $day  = substr($start, 0, 10);
    $start = $day . ' ' . hm_tl_hhmm($sMin) . ':00';
    $end   = $day . ' ' . hm_tl_hhmm($eMin) . ':00';

    hm_windows_ensure_table($db);
    $id = hm_slot_uuid();
    $ins = $db->prepare(
      "INSERT INTO availability_windows (id, window_date, start_at, end_at) VALUES (?,?,?,?)"
    );
    $ins->execute([$id, $day, $start, $end]);
    return ['ok' => true, 'id' => $id, 'window_date' => $day, 'start' => $start, 'end' => $end];
  }

  /** Move/resize a window by id. Same validation as add. */
  function hm_windows_update(PDO $db, string $id, ?string $startIso, ?string $endIso): array {
    $start = hm_iv_normalize($startIso);
    $end   = hm_iv_normalize($endIso);
    if ($start === null || $end === null) return ['error' => 'invalid start/end'];
    if (substr($start, 0, 10) !== substr($end, 0, 10)) return ['error' => 'start and end must be the same day'];
    $step = hm_timeline_step();
    $sMin = hm_tl_snap((int)hm_tl_min($start), $step);
    $eMin = hm_tl_snap((int)hm_tl_min($end),   $step);
    if ($eMin <= $sMin) return ['error' => 'end must be after start'];
    $day  = substr($start, 0, 10);
    $start = $day . ' ' . hm_tl_hhmm($sMin) . ':00';
    $end   = $day . ' ' . hm_tl_hhmm($eMin) . ':00';

    hm_windows_ensure_table($db);
    $up = $db->prepare(
      "UPDATE availability_windows SET window_date = ?, start_at = ?, end_at = ? WHERE id = ?"
    );
    $up->execute([$day, $start, $end, $id]);
    if ($up->rowCount() === 0) {
      // rowCount 0 can mean "no change" OR "not found"; disambiguate.
      $chk = $db->prepare("SELECT 1 FROM availability_windows WHERE id = ?");
      $chk->execute([$id]);
      if (!$chk->fetch()) return ['error' => 'not found'];
    }
    return ['ok' => true, 'id' => $id, 'window_date' => $day, 'start' => $start, 'end' => $end];
  }

  function hm_windows_delete(PDO $db, string $id): array {
    hm_windows_ensure_table($db);
    $del = $db->prepare("DELETE FROM availability_windows WHERE id = ?");
    $del->execute([$id]);
    return ['ok' => true, 'id' => $id, 'deleted' => $del->rowCount()];
  }

  // ── DB-backed slot reads (compose windows + busy intervals) ─────────────────

  /**
   * Effective windows for a date as [startMin,endMin] pairs (for the pure slot
   * generator). Resolution order:
   *   1. CLOSED day        → [] (no availability at all)
   *   2. explicit windows  → the admin's drawn windows for the date
   *   3. neither           → the configured default business-hours window(s)
   */
  function hm_windows_day_ranges(PDO $db, string $date): array {
    if (hm_day_is_closed($db, $date)) return [];
    $out = [];
    foreach (hm_windows_day($db, $date) as $w) {
      $a = hm_tl_min((string)$w['start_at']); $b = hm_tl_min((string)$w['end_at']);
      if ($a !== null && $b !== null) $out[] = [$a, $b];
    }
    if (!$out) $out = hm_timeline_default_windows();
    return $out;
  }

  /**
   * Effective windows as display rows [{id,start_at,end_at}] for the CUSTOMER
   * availability response — mirrors hm_windows_day_ranges (closed → []; default
   * business hours synthesized with an empty id when the admin drew none) so the
   * client slot generator and the server agree. Admin editing endpoints keep using
   * the raw hm_windows_day() so the admin only ever edits real, persisted windows.
   */
  function hm_windows_day_effective(PDO $db, string $date): array {
    if (hm_day_is_closed($db, $date)) return [];
    $rows = hm_windows_day($db, $date);
    if ($rows) return $rows;
    $out = [];
    foreach (hm_timeline_default_windows() as $r) {
      $out[] = [
        'id'       => '',
        'start_at' => $date . ' ' . hm_tl_hhmm($r[0]) . ':00',
        'end_at'   => $date . ' ' . hm_tl_hhmm($r[1]) . ':00',
        'default'  => true,
      ];
    }
    return $out;
  }

  /** Busy intervals for a date as [startMin,endMin] pairs (bookings + blocks). */
  function hm_windows_busy_ranges(PDO $db, string $date): array {
    $out = [];
    foreach (hm_iv_day($db, $date) as $b) {
      $a = hm_tl_min((string)$b['start_at']); $z = hm_tl_min((string)$b['end_at']);
      if ($a !== null && $z !== null) $out[] = [$a, $z];
    }
    return $out;
  }

  /** Public: bookable start times ("HH:MM") for a date + duration. */
  function hm_timeline_slots(PDO $db, string $date, int $durationMin, ?int $stepMin = null): array {
    $step = $stepMin ?? hm_timeline_step();
    return hm_tl_gen_slots(
      hm_windows_day_ranges($db, $date),
      hm_windows_busy_ranges($db, $date),
      $durationMin,
      $step
    );
  }

  /** Server-side backstop: does a chosen [start,start+duration] fit + stay free? */
  function hm_timeline_start_ok(PDO $db, string $date, string $startIso, int $durationMin): bool {
    $sMin = hm_tl_min($startIso);
    if ($sMin === null) return false;
    return hm_tl_fits(
      hm_windows_day_ranges($db, $date),
      hm_windows_busy_ranges($db, $date),
      $sMin,
      $durationMin
    );
  }
}
