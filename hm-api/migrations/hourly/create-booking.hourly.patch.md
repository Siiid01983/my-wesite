# Patch: `create-booking.php` — dual-write `start_at` / `end_at`  (batch 2, REVIEW)

**Goal (transition/dual-write):** every new customer booking also populates the
interval columns, derived from its band — so the interval scheduler and the band
system stay consistent while the UI is still band-based. No behaviour change for
customers; the band lock (`hm_slot_reserve`) is untouched.

**Prerequisite:** `001_bookings_hourly.sql` already applied (the columns exist).
Apply this patch only AFTER the migration, or the INSERT will error on unknown
columns.

## Where
`create-booking.php`, just **after** line 103 (`$data['status'] = 'pending';`) and
**before** line 107 (`$keys = array_keys($data);`). Because the INSERT is built
dynamically from `$data`'s keys (line 107–109) and executed with
`array_values($data)` (line 133), injecting the two keys here is all that's needed
— no change to `$ALLOWED` and no change to the SQL.

`hm_slot_band_id()` and `hm_slot_time_from_notes()` are already available
(create-booking.php uses them at lines 119–120 via `_slots.php`).

## Insert this block

```php
// ── HOURLY dual-write (batch 2): mirror the requested band into start_at/end_at.
//    Band → fixed window: am 09–12 · pm 12–15 · ev 15–18 · nt 18–21.
//    Independent of slot_lock_enabled (we always populate the columns).
$__band = hm_slot_band_id(hm_slot_time_from_notes($data['notes'] ?? ''));
$__bandHours = [
  'am' => ['09:00', '12:00'], 'pm' => ['12:00', '15:00'],
  'ev' => ['15:00', '18:00'], 'nt' => ['18:00', '21:00'],
];
$__dateOnly = substr((string)($data['booking_date'] ?? ''), 0, 10);
if ($__band !== null && isset($__bandHours[$__band])
    && preg_match('/^\d{4}-\d{2}-\d{2}$/', $__dateOnly)) {
  $data['start_at'] = $__dateOnly . ' ' . $__bandHours[$__band][0] . ':00';
  $data['end_at']   = $__dateOnly . ' ' . $__bandHours[$__band][1] . ':00';
}
// (Bookings with no band / 時間指定なし leave start_at,end_at NULL = flexible.)
```

## Notes
- **Collision during transition:** while the website still books by band, the
  band `UNIQUE(date,band)` lock (already in place) IS the collision guard, and it
  is equivalent to interval overlap for band-aligned times. True arbitrary-interval
  collision only becomes reachable once the UI sends specific times (batch 3);
  at that point, add an `hm_iv_reserve()` call here (in the same transaction as
  the insert) and drop the band lock. Keep BOTH during dual-write.
- **Backfill** for existing rows is handled by `001_bookings_hourly.sql`.
