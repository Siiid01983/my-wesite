<?php
// ════════════════════════════════════════════════════════════════════════════
//  _intervals.php — hourly (time-interval) scheduling helpers  [REVIEW DRAFT]
//
//  Overlap rule (half-open [start,end)):
//      existing.start_at < new.end_at  AND  existing.end_at > new.start_at
//  Full DATETIMEs → the date is inherent (no separate date filter needed).
//
//  ATOMICITY (why a plain count()+INSERT is wrong): concurrent reservations can
//  both read "0 conflicts" and both write → double-book. Here hm_iv_reserve()
//  runs in a transaction and SELECT … FOR UPDATE over the target DAY first, so
//  reservations for the same day serialize. Cancelled rows and the booking's own
//  row are excluded (the latter makes reschedule idempotent).
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);

// Accept ISO 8601 ("2026-07-20T09:30" / "...:00Z" / "... 09:30:00") → MySQL
// DATETIME "Y-m-d H:i:s". Returns null if unparseable.
function hm_iv_normalize(?string $iso): ?string {
  $s = trim((string)$iso);
  if ($s === '') return null;
  try {
    $dt = new DateTime($s);
  } catch (Throwable $e) {
    return null;
  }
  return $dt->format('Y-m-d H:i:s');
}

// Day bounds (local) for the FOR UPDATE lock.
function hm_iv_day_bounds(string $mysqlDateTime): array {
  $day = substr($mysqlDateTime, 0, 10);
  return [$day . ' 00:00:00', $day . ' 23:59:59'];
}

// Atomically reserve/reschedule [start,end) for a booking.
//   ['ok'=>true, 'start'=>..., 'end'=>...]
//   ['conflict'=>true, 'with'=>id]
//   ['error'=>message]
function hm_iv_reserve(PDO $db, string $bookingId, ?string $startIso, ?string $endIso): array {
  $start = hm_iv_normalize($startIso);
  $end   = hm_iv_normalize($endIso);
  if ($start === null || $end === null) return ['error' => 'invalid start/end'];
  if ($start >= $end)                   return ['error' => 'end must be after start'];

  [$dayStart, $dayEnd] = hm_iv_day_bounds($start);
  if (substr($end, 0, 10) !== substr($start, 0, 10)) {
    return ['error' => 'start and end must be on the same day'];
  }

  $ownTx = !$db->inTransaction();
  if ($ownTx) $db->beginTransaction();
  try {
    // Lock the day's scheduled rows so concurrent reservers serialize.
    $lock = $db->prepare(
      "SELECT id, customer_name, start_at, end_at FROM bookings
        WHERE start_at >= ? AND start_at <= ?
          AND status NOT IN ('キャンセル','cancelled')
          AND start_at IS NOT NULL AND end_at IS NOT NULL
          AND id <> ?
        FOR UPDATE"
    );
    $lock->execute([$dayStart, $dayEnd, $bookingId]);

    foreach ($lock as $row) {
      // overlap: existing.start < new.end AND existing.end > new.start
      if ((string)$row['start_at'] < $end && (string)$row['end_at'] > $start) {
        if ($ownTx) $db->rollBack();
        return [
          'conflict'  => true,
          'with'      => (string)$row['id'],
          'with_name' => (string)($row['customer_name'] ?? ''),
        ];
      }
    }

    $up = $db->prepare('UPDATE bookings SET start_at = ?, end_at = ? WHERE id = ?');
    $up->execute([$start, $end, $bookingId]);

    if ($ownTx) $db->commit();
    return ['ok' => true, 'start' => $start, 'end' => $end];
  } catch (Throwable $e) {
    if ($ownTx && $db->inTransaction()) $db->rollBack();
    throw $e;
  }
}

// Free a booking's interval (cancel / un-schedule).
function hm_iv_release(PDO $db, string $bookingId): void {
  $st = $db->prepare('UPDATE bookings SET start_at = NULL, end_at = NULL WHERE id = ?');
  $st->execute([$bookingId]);
}

// Read a day's scheduled intervals (for availability / grid rendering).
function hm_iv_day(PDO $db, string $date): array {
  [$dayStart, $dayEnd] = hm_iv_day_bounds($date . ' 00:00:00');
  $st = $db->prepare(
    "SELECT id, customer_name, status, start_at, end_at FROM bookings
      WHERE start_at >= ? AND start_at <= ?
        AND status NOT IN ('キャンセル','cancelled')
        AND start_at IS NOT NULL AND end_at IS NOT NULL
      ORDER BY start_at ASC"
  );
  $st->execute([$dayStart, $dayEnd]);
  return $st->fetchAll(PDO::FETCH_ASSOC);
}
