<?php
// ════════════════════════════════════════════════════════════════════════════
//  _blocks.php — Availability BLOCKS engine (a distinct entity from bookings)
//
//  An availability block is an admin-drawn "unavailable" time range. It lives in
//  its OWN table `availability_blocks` — NEVER in `bookings`. This is the whole
//  point of the split:
//    • A block is part of the AVAILABILITY layer, not the reservation layer.
//    • It removes matching start times from slot generation and refuses
//      overlapping customer bookings (conflict detection), exactly like a real
//      booking would — but it consumes NO booking id, sends NO email, creates NO
//      chat row, and appears in NO booking / customer / history list, because it
//      is simply not a bookings row.
//
//  Architecture:
//      availability_windows  (open periods)
//            +  availability_blocks (closed ranges)   ← this file
//            ↓  available slots           (hm_windows_busy_ranges unions both)
//            ↓  customer books
//            ↓  bookings                  (real customer reservations ONLY)
//
//  Overlap rule (half-open [start,end)):
//      existing.start_at < new.end_at  AND  existing.end_at > new.start_at
//  — identical to _intervals.php so the two layers never disagree.
//
//  Side-effect-free: including this file only DEFINES functions. Reuses
//  hm_slot_uuid() from _slots.php for row ids.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_slots.php';   // hm_slot_uuid()

if (!defined('HM_BLOCKS_BUILD')) define('HM_BLOCKS_BUILD', 'availability-blocks-1');

if (!function_exists('hm_blocks_ensure_table')) {

  /** Append " FOR UPDATE" only on engines that support it (MySQL); SQLite omits. */
  function hm_blk_for_update(PDO $db): string {
    try { return $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' ? '' : ' FOR UPDATE'; }
    catch (Throwable $e) { return ''; }
  }

  /**
   * CREATE TABLE IF NOT EXISTS availability_blocks (idempotent; matches the
   * migrations/timeline/002 migration). Portable across MySQL (prod) and SQLite
   * (tests): no inline KEY clauses — indexes are added separately, best-effort.
   */
  function hm_blocks_ensure_table(PDO $db): void {
    $db->exec(
      "CREATE TABLE IF NOT EXISTS availability_blocks (
        id          CHAR(36)     NOT NULL,
        block_date  DATE         NOT NULL,
        start_at    DATETIME     NOT NULL,
        end_at      DATETIME     NOT NULL,
        reason      VARCHAR(200) NOT NULL DEFAULT '',
        memo        TEXT         NULL,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      )"
    );
    // Best-effort indexes (MySQL lacks CREATE INDEX IF NOT EXISTS → swallow dupes).
    foreach ([
      "CREATE INDEX availability_blocks_start_idx ON availability_blocks (start_at)",
      "CREATE INDEX availability_blocks_date_idx  ON availability_blocks (block_date)",
    ] as $sql) { try { $db->exec($sql); } catch (Throwable $e) { /* exists */ } }
  }

  /** Normalise any parseable datetime → 'Y-m-d H:i:s', or null. */
  function hm_blocks_dt_normalize(?string $s): ?string {
    $s = trim((string)$s);
    if ($s === '') return null;
    try { $dt = new DateTime($s); } catch (Throwable $e) { return null; }
    return $dt->format('Y-m-d H:i:s');
  }

  /** "YYYY-MM-DD HH:MM[:SS]" → minutes since local midnight, or null. */
  function hm_blk_min(?string $dt): ?int {
    $s = trim((string)$dt);
    if ($s !== '' && preg_match('/(\d{2}):(\d{2})(?::\d{2})?\s*$/', $s, $m)) {
      return ((int)$m[1]) * 60 + (int)$m[2];
    }
    return null;
  }

  // ── Reads (all safe if the table is missing → empty / null) ─────────────────

  /** All blocks overlapping the day $date ('YYYY-MM-DD'), ordered by start.
   *  Shape: [{id,reason,memo,start_at,end_at}] — matches the range endpoint. */
  function hm_blocks_day(PDO $db, string $date): array {
    try {
      $st = $db->prepare(
        "SELECT id, reason, memo, start_at, end_at FROM availability_blocks
          WHERE start_at < ? AND end_at > ?
          ORDER BY start_at ASC"
      );
      $st->execute([$date . ' 23:59:59', $date . ' 00:00:00']);
      return $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable $e) { return []; }
  }

  /** All blocks overlapping [$fromDt, $toDt], ordered by start (admin range view). */
  function hm_blocks_between(PDO $db, string $fromDt, string $toDt): array {
    try {
      $st = $db->prepare(
        "SELECT id, reason, memo, start_at, end_at FROM availability_blocks
          WHERE start_at < ? AND end_at > ?
          ORDER BY start_at ASC"
      );
      $st->execute([$toDt, $fromDt]);
      return $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable $e) { return []; }
  }

  /** Block ranges for a date as [startMin,endMin] pairs — busy input for slot-gen. */
  function hm_blocks_ranges(PDO $db, string $date): array {
    $out = [];
    foreach (hm_blocks_day($db, $date) as $b) {
      $a = hm_blk_min((string)$b['start_at']); $z = hm_blk_min((string)$b['end_at']);
      if ($a !== null && $z !== null) $out[] = [$a, $z];
    }
    return $out;
  }

  /**
   * First block overlapping [$start,$end), excluding $excludeId. Returns the row or
   * null. Half-open overlap. Use $lock=true INSIDE a transaction to serialize a
   * concurrent customer reservation against block creation (SELECT … FOR UPDATE).
   */
  function hm_blocks_overlap(PDO $db, string $start, string $end, string $excludeId = '', bool $lock = false): ?array {
    $s = hm_blocks_dt_normalize($start); $e = hm_blocks_dt_normalize($end);
    if ($s === null || $e === null || $s >= $e) return null;
    try {
      $st = $db->prepare(
        "SELECT id, reason, start_at, end_at FROM availability_blocks
          WHERE start_at < ? AND end_at > ? AND id <> ?
          ORDER BY start_at ASC LIMIT 1" . ($lock ? hm_blk_for_update($db) : '')
      );
      $st->execute([$e, $s, $excludeId]);
      return $st->fetch(PDO::FETCH_ASSOC) ?: null;
    } catch (Throwable $ex) { return null; }   // table missing → no conflict
  }

  /** Conflict predicate for hm_iv_reserve (locked, inside the reserve tx). */
  function hm_blocks_overlap_locked(PDO $db, string $start, string $end, string $excludeId = ''): ?array {
    return hm_blocks_overlap($db, $start, $end, $excludeId, true);
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  /**
   * Atomically create a block for [$start,$end). Refuses to overlap EITHER a real
   * booking (non-cancelled interval row) OR another block — so a block never hides
   * an existing reservation and blocks never stack. Runs in a transaction; locks
   * the day's bookings THEN blocks (consistent order with hm_iv_reserve → no
   * deadlock). Returns:
   *   ['ok'=>true, 'id'=>…, 'start'=>…, 'end'=>…]
   *   ['conflict'=>true, 'with'=>id, 'with_name'=>name]   (real booking or block)
   *   ['error'=>message]
   */
  function hm_blocks_add(PDO $db, string $start, string $end, string $reason = '', string $memo = ''): array {
    $s = hm_blocks_dt_normalize($start); $e = hm_blocks_dt_normalize($end);
    if ($s === null || $e === null) return ['error' => 'invalid start/end'];
    if ($s >= $e)                   return ['error' => 'end must be after start'];
    if (substr($s, 0, 10) !== substr($e, 0, 10)) return ['error' => 'start and end must be on the same day'];

    hm_blocks_ensure_table($db);
    $date = substr($s, 0, 10);
    $dayStart = $date . ' 00:00:00'; $dayEnd = $date . ' 23:59:59';
    $fu = hm_blk_for_update($db);

    $ownTx = !$db->inTransaction();
    if ($ownTx) $db->beginTransaction();
    try {
      // 1) Lock + scan the day's REAL bookings — a block cannot cover a reservation.
      try {
        $lb = $db->prepare(
          "SELECT id, customer_name, start_at, end_at FROM bookings
            WHERE start_at >= ? AND start_at <= ?
              AND status NOT IN ('キャンセル','cancelled')
              AND start_at IS NOT NULL AND end_at IS NOT NULL" . $fu
        );
        $lb->execute([$dayStart, $dayEnd]);
        foreach ($lb as $row) {
          if ((string)$row['start_at'] < $e && (string)$row['end_at'] > $s) {
            if ($ownTx) $db->rollBack();
            return ['conflict' => true, 'with' => (string)$row['id'],
                    'with_name' => (string)($row['customer_name'] ?? '')];
          }
        }
      } catch (Throwable $be) { /* interval cols missing → no bookings to clash */ }

      // 2) Lock + scan other blocks — blocks must not stack.
      $lx = $db->prepare(
        "SELECT id, reason, start_at, end_at FROM availability_blocks
          WHERE start_at < ? AND end_at > ?" . $fu
      );
      $lx->execute([$dayEnd, $dayStart]);
      foreach ($lx as $row) {
        if ((string)$row['start_at'] < $e && (string)$row['end_at'] > $s) {
          if ($ownTx) $db->rollBack();
          return ['conflict' => true, 'with' => (string)$row['id'],
                  'with_name' => (string)($row['reason'] ?? '')];
        }
      }

      // 3) Insert the block.
      $id = hm_slot_uuid();
      $ins = $db->prepare(
        "INSERT INTO availability_blocks (id, block_date, start_at, end_at, reason, memo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, " . ($fu === '' ? "CURRENT_TIMESTAMP" : "NOW()") . ")"
      );
      $ins->execute([$id, $date, $s, $e, $reason, ($memo !== '' ? $memo : null)]);

      if ($ownTx) $db->commit();
      return ['ok' => true, 'id' => $id, 'start' => $s, 'end' => $e];
    } catch (Throwable $ex) {
      if ($ownTx && $db->inTransaction()) $db->rollBack();
      throw $ex;
    }
  }

  /**
   * Delete a block by id and VERIFY it is gone (never a false success, so a block
   * can't stay alive after an "unblocked" response). Returns:
   *   ['removed'=>count, 'still'=>bool]
   */
  function hm_blocks_delete(PDO $db, string $id): array {
    try {
      $del = $db->prepare("DELETE FROM availability_blocks WHERE id = ?");
      $del->execute([$id]);
      $removed = $del->rowCount();
      $chk = $db->prepare("SELECT 1 FROM availability_blocks WHERE id = ?");
      $chk->execute([$id]);
      return ['removed' => $removed, 'still' => (bool)$chk->fetch()];
    } catch (Throwable $e) {
      return ['removed' => 0, 'still' => false];   // table missing → nothing to remove
    }
  }
}
