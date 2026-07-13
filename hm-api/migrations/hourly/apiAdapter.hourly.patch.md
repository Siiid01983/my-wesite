# Patch: `js/services/apiAdapter.js` — surface `start_at` / `end_at`  (REVIEW)

**Goal:** the refactored mobile timeline (`mobileCalendar.js`) reads
`b.start_at` / `b.end_at` to size booking blocks by real duration. Those fields
must flow through the Adapter's DB→UI mapper. Without this, the timeline always
falls back to band-height blocks.

**File:** `js/services/apiAdapter.js` — `rowToBooking(r)` (≈ lines 206–224).

## READ side — apply now (safe)
Pass the raw DB DATETIME strings straight through. `rest.php` `select *` returns
these columns once `001_bookings_hourly.sql` is applied; before that, `r.start_at`
is `undefined` → `null`, so this is safe to ship **independently of the migration**
(the timeline just keeps using the band fallback until real values arrive).

Add two lines to the object returned by `rowToBooking`:

```js
      time:      extra.time    || '',
      createdAt: r.created_at  || new Date().toISOString(),
      start_at:  r.start_at    || null,   // ← add (raw "YYYY-MM-DD HH:MM:SS" or null)
      end_at:    r.end_at      || null,   // ← add
```

> Keep them as the **raw stored string** — do NOT reformat. `mobileCalendar.js`
> does `new Date(String(b.start_at).replace(' ', 'T'))`, and `_bookingCard` slices
> `HH:MM` from chars 11–16. Reformatting here would break both.

## WRITE side — defer until the migration + rest.php allowlist
Do **not** add `start_at`/`end_at` to `bookingToRow(b)` yet. That row is sent to
`rest.php` insert/update, whose `bookings` column allowlist does **not** include
these columns — they'd be dropped (or rejected). When you deploy the schema, also
add `'start_at','end_at'` to the `bookings` allowlist in `rest.php`, then this is
safe to add:

```js
// bookingToRow(b) — ONLY after 001 is applied AND rest.php allowlist updated:
      start_at: b.start_at || null,
      end_at:   b.end_at   || null,
```

## Consistency check (verified)
- Storage format `"YYYY-MM-DD HH:MM:SS"` → Adapter passes through → timeline
  `new Date(str.replace(' ','T'))` parses it, and `_intervalOf` reads
  `getHours()*60 + getMinutes()`. Matches `_intervals.php`'s stored format. ✓
- `null` start/end → timeline's `_intervalOf` band-fallback branch. ✓
