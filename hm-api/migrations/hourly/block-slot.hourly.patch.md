# Patch: `block-slot.php` — block by interval  (batch 2, REVIEW)

**Goal:** let an admin block an arbitrary time RANGE (not just a band). The elegant
part: an interval block is just a `bookings` row with `status = 'admin_blocked'`
and `start_at`/`end_at` set. `hm_iv_reserve()` counts every non-cancelled row with
an interval as a potential conflict, so a block automatically prevents overlapping
bookings — no new table, and it shows up in `availability.php`'s `intervals`
(so the grid renders it as busy). Release = delete that row.

**Prerequisite:** `001_bookings_hourly.sql` applied; `_intervals.php` deployed.

## Option A (recommended): a small new endpoint, leave `block-slot.php` alone
Add `hm-api/block-interval.php` (a trimmed copy of `booking-slot.hourly.php`'s
auth/CORS/rate-limit header) with two actions:

```php
// action=block  { date, start_time, end_time }
//   Insert an admin_blocked interval; refuse if it overlaps a real booking (409).
$db = hm_db();
$start = hm_iv_normalize($param('start_time'));
$end   = hm_iv_normalize($param('end_time'));
if ($start === null || $end === null || $start >= $end) bx_out(['ok'=>false,'error'=>'invalid range'], 400);

$blockId = hm_uuid4();
$db->beginTransaction();
try {
  // Insert first, then reuse the overlap check to guard against real bookings.
  $ins = $db->prepare(
    "INSERT INTO bookings (id, customer_name, status, booking_date, start_at, end_at, created_at)
     VALUES (?,?, 'admin_blocked', ?, ?, ?, NOW())"
  );
  $ins->execute([$blockId, '（ブロック）', substr($start,0,10), $start, $end]);
  $res = hm_iv_reserve($db, $blockId, $start, $end);   // idempotent for self; conflict = real booking
  if (!empty($res['conflict'])) { $db->rollBack(); bx_out(['ok'=>false,'error'=>'slot_taken','with'=>$res['with']], 409); }
  $db->commit();
  bx_out(['ok'=>true,'action'=>'blocked','id'=>$blockId,'start'=>$start,'end'=>$end]);
} catch (Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }

// action=unblock { id }  →  DELETE FROM bookings WHERE id=? AND status='admin_blocked'
```

> Note: `hm_iv_reserve` excludes the row's own id, so inserting the block row then
> checking overlap correctly conflicts only with OTHER bookings. (Or check overlap
> BEFORE inserting — either order works inside the transaction.)

## Option B: leave block-slot.php band-based (no change)
Since bands are just fixed intervals, the existing band block (`admin_blocked` row
in `booking_slots`) keeps working for whole-band blocks. Only add Option A when you
need sub-band / arbitrary-range blocks. **This is the lower-risk default** — do
nothing until the hourly UI actually needs arbitrary-range blocking.

## Recommendation
Ship batches with **Option B** (no change) first; add **Option A** in the same wave
as the hourly website UI (batch 3), so blocks and bookings share one interval model.
