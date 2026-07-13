# Patch: `availability.php` — also return busy intervals  (batch 2, REVIEW)

**Goal (dual-read):** keep returning the 4 band states (the website still reads
them) AND add an `intervals` array of the day's real busy time ranges, so the app
and the new grid can render true hourly occupancy. Purely additive.

**Prerequisite:** `001_bookings_hourly.sql` applied, and `_intervals.php` deployed
to `hm-api/` (move it out of `migrations/hourly/` on deploy, or `require` it by path).

## Change

Near the top, after the other `require_once` lines:

```php
require_once __DIR__ . '/_intervals.php';
```

Then replace the final success response (currently):

```php
  hm_json(['ok' => true, 'date' => $date, 'bands' => $bands]);
```

with:

```php
  // HOURLY (batch 2): busy intervals for the date alongside the band states.
  // Each item: { id, customer_name, status, start_at, end_at }. admin_blocked
  // rows (see block-slot patch) appear here too, so blocks show as busy.
  $intervals = hm_iv_day(hm_db(), $date);
  hm_json(['ok' => true, 'date' => $date, 'bands' => $bands, 'intervals' => $intervals]);
```

## Response shape (new)
```json
{
  "ok": true,
  "date": "2026-07-20",
  "bands": { "am": "available", "pm": "reserved", "ev": "available", "nt": "available" },
  "intervals": [
    { "id": "…", "customer_name": "山田", "status": "確定",
      "start_at": "2026-07-20 09:30:00", "end_at": "2026-07-20 11:30:00" }
  ]
}
```

## Notes
- `bands` stays for back-compat; consumers migrate to `intervals` at their own pace.
- `hm_iv_day` already excludes cancelled rows and NULL-interval (flexible) bookings.
- No write, no lock — this endpoint stays strictly read-only.
