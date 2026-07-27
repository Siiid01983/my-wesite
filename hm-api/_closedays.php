<?php
// ════════════════════════════════════════════════════════════════════════════
//  _closedays.php — whole-day CLOSURES for the timeline scheduler
//
//  A closed day removes ALL availability (explicit windows AND the default
//  business-hours window) for that date: hm_windows_day_ranges() returns [] so no
//  bookable slots are generated and the customer simply sees "unavailable" — the
//  internal reason is NEVER exposed to customers, only to Admin + Ops.
//
//  Stored per date in `closed_days`:
//    day         DATE   (PK)  — the closed date (YYYY-MM-DD)
//    reason      TEXT         — Holiday / Staff vacation / Truck maintenance / …
//    closed_by   VARCHAR      — admin/staff identity that closed it
//    closed_at   DATETIME     — when it was closed
//
//  Side-effect-free include: defines functions only. Portable MySQL (prod) +
//  SQLite (tests): no inline KEY clauses; the table is ensured on demand.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

if (!function_exists('hm_closedays_ensure_table')) {

  function hm_closedays_ensure_table(PDO $db): void {
    $db->exec(
      "CREATE TABLE IF NOT EXISTS closed_days (
        day        DATE         NOT NULL,
        reason     TEXT         NULL,
        closed_by  VARCHAR(120) NULL,
        closed_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (day)
      )"
    );
  }

  /** Is this date fully closed? Cheap indexed PK lookup — intentionally uncached so
   *  a close/reopen in the same process is never served stale (correctness > a
   *  couple of PK reads per availability request). */
  function hm_day_is_closed(PDO $db, string $date): bool {
    try {
      hm_closedays_ensure_table($db);
      $st = $db->prepare("SELECT 1 FROM closed_days WHERE day = ?");
      $st->execute([$date]);
      return (bool)$st->fetch();
    } catch (Throwable $e) { return false; }
  }

  /** Closure detail for Admin/Ops (reason/closed_by/closed_at) or null if open. */
  function hm_day_close_info(PDO $db, string $date): ?array {
    try {
      hm_closedays_ensure_table($db);
      $st = $db->prepare("SELECT day, reason, closed_by, closed_at FROM closed_days WHERE day = ?");
      $st->execute([$date]);
      $row = $st->fetch(PDO::FETCH_ASSOC);
      return $row ?: null;
    } catch (Throwable $e) { return null; }
  }

  /** Closures across [from,to] inclusive → [{day,reason,closed_by,closed_at}, …]. */
  function hm_closedays_range(PDO $db, string $from, string $to): array {
    try {
      hm_closedays_ensure_table($db);
      $st = $db->prepare(
        "SELECT day, reason, closed_by, closed_at FROM closed_days
          WHERE day >= ? AND day <= ? ORDER BY day ASC"
      );
      $st->execute([$from, $to]);
      return $st->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) { return []; }
  }

  /** Close a whole day with a required reason (upsert). */
  function hm_day_close(PDO $db, string $date, string $reason, string $closedBy): array {
    $reason = trim($reason);
    if ($reason === '') return ['error' => 'reason required'];
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) return ['error' => 'invalid date'];
    hm_closedays_ensure_table($db);
    // Portable upsert: delete-then-insert (avoids MySQL/SQLite ON CONFLICT dialects).
    $db->prepare("DELETE FROM closed_days WHERE day = ?")->execute([$date]);
    $ins = $db->prepare(
      "INSERT INTO closed_days (day, reason, closed_by, closed_at) VALUES (?,?,?,?)"
    );
    $ins->execute([$date, $reason, ($closedBy !== '' ? $closedBy : 'admin'), date('Y-m-d H:i:s')]);
    return ['ok' => true, 'day' => $date, 'reason' => $reason, 'closed_by' => $closedBy];
  }

  /** Reopen a previously closed day — completely removes the closure record.
   *  Robust date match: `day = ?` handles the normal DATE value, and `day LIKE 'date%'`
   *  also removes any variant that carries a time component ('2026-08-15 00:00:00'),
   *  so a reopen can never leave a stale row behind. Returns the delete count and a
   *  post-delete `still_closed` check so callers can detect (and never mask) a failure. */
  function hm_day_reopen(PDO $db, string $date): array {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) return ['error' => 'invalid date'];
    hm_closedays_ensure_table($db);
    $del = $db->prepare("DELETE FROM closed_days WHERE day = ? OR day LIKE ?");
    $del->execute([$date, $date . '%']);
    return ['ok' => true, 'day' => $date, 'reopened' => $del->rowCount(),
            'still_closed' => hm_day_is_closed($db, $date)];
  }
}
