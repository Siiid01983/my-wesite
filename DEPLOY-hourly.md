# 🚀 Hourly Scheduling — Deployment Checklist

Built from commit `bb97927` (`feat/hourly-scheduling-wire`).

**Golden rule:** the code is deploy-order-safe (it stays dormant until *both* the migration and the flag are done), so you can't break the live site by doing these out of order. The recommended order below is just the cleanest.

## ☑️ Step 0 — Back up first
In cPanel → phpMyAdmin, select the `hello_moving` database → **Export** → Go. Save the `.sql` dump before touching anything.

---

## ☑️ Step 1 — Upload / replace files on the server

Replace these at the **same paths** on your server (via cPanel File Manager or FTP). Paths are relative to your web root.

**Required for activation:**
| # | Server path | Action |
|---|---|---|
| 1 | `hm-api/_intervals.php` | **NEW file** — upload |
| 2 | `hm-api/availability.php` | Replace |
| 3 | `hm-api/create-booking.php` | Replace |
| 4 | `hm-api/rest.php` | Replace |
| 5 | `js/services/apiAdapter.js` | Replace |

**Also in the commit (upload for consistency; not needed for dual-write to work):**
| # | Server path | Action |
|---|---|---|
| 6 | `hm-api/migrations/hourly/booking-slot.hourly.php` | Replace *(only used once you point the app at the hourly admin endpoint — batch 3)* |
| 7 | `hm-api/_config.example.php` | Replace *(documentation only — safe but optional)* |
| 8 | `hm-api/migrations/hourly/_intervals.php` | **DELETE if present** *(the file moved to `hm-api/_intervals.php`; remove the stale copy)* |

**Admin hourly block management (optional — the "時間帯ブロック" interval editor):**
| # | Server path | Action |
|---|---|---|
| 9  | `hm-api/block-interval.php` | **NEW file** — upload *(admin add/remove arbitrary-range blocks; gated by `hourly_enabled`)* |
| 10 | `js/modules/calendar/intervalEditor.js` | **NEW file** — upload *(the admin modal UI)* |
| 11 | `admin.html` | Replace *(adds one `<script>` include for the module)* |

> These three power the admin's per-date interval editor. They're inert until hourly is active (`block-interval.php` returns `409 hourly_disabled`), so they're safe to upload anytime.

**Client-Request booking model (optional — pending requests + admin confirm/reject):**
| # | Server path | Action |
|---|---|---|
| 12 | `hm-api/confirm-request.php` | **NEW file** — upload *(admin confirm→confirmed / reject→rejected; overlap-checked)* |
| 13 | `hm-api/create-booking.php` | Replace *(already listed as #3 — this adds preferred_start_1/2 + pending-request handling)* |
| 14 | `hm-api/rest.php` | Replace *(already #4 — adds preferred_start_1/2 to the allowlist)* |
| 15 | `js/services/apiAdapter.js` | Replace *(already #5 — preferred_start_1/2 passthrough + rejected↔却下)* |

> These are gated by `hourly_enabled` **and** the `002` migration (below). Dormant until both are done; safe to upload anytime.

> ⚠️ **Do NOT upload `hm-api/_config.php`.** The commit never touches it. Uploading your local copy would overwrite the server's real DB password with the placeholder. You'll edit the server's `_config.php` directly in Step 3.

---

## ☑️ Step 2 — Run the migration in phpMyAdmin

phpMyAdmin → select `hello_moving` DB → **SQL** tab → paste and **Go**:

```sql
-- Add nullable interval columns + indexes
ALTER TABLE bookings
  ADD COLUMN start_at DATETIME NULL AFTER booking_date,
  ADD COLUMN end_at   DATETIME NULL AFTER start_at,
  ADD KEY bookings_start_at_idx (start_at),
  ADD KEY bookings_end_at_idx   (end_at);

-- Backfill start_at/end_at from existing bands (booking_slots)
--   am 09–12 · pm 12–15 · ev 15–18 · nt 18–21
UPDATE bookings b
JOIN booking_slots s ON s.booking_id = b.id
SET
  b.start_at = STR_TO_DATE(
    CONCAT(SUBSTRING(b.booking_date, 1, 10), ' ',
      CASE s.time_band
        WHEN 'am' THEN '09:00:00' WHEN 'pm' THEN '12:00:00'
        WHEN 'ev' THEN '15:00:00' WHEN 'nt' THEN '18:00:00'
      END), '%Y-%m-%d %H:%i:%s'),
  b.end_at = STR_TO_DATE(
    CONCAT(SUBSTRING(b.booking_date, 1, 10), ' ',
      CASE s.time_band
        WHEN 'am' THEN '12:00:00' WHEN 'pm' THEN '15:00:00'
        WHEN 'ev' THEN '18:00:00' WHEN 'nt' THEN '21:00:00'
      END), '%Y-%m-%d %H:%i:%s')
WHERE b.start_at IS NULL
  AND s.time_band IN ('am','pm','ev','nt')
  AND s.status = 'reserved'
  AND b.booking_date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';
```

**Optional sanity check** (run after, to see coverage):
```sql
SELECT SUM(start_at IS NOT NULL) AS scheduled,
       SUM(start_at IS NULL)     AS unscheduled
FROM bookings;
```

> Re-running the `ALTER TABLE` a second time errors with *"Duplicate column name 'start_at'"* — that just means it already applied. Safe to ignore.

**Then, for the Client-Request model, run `002_client_request.sql`** (same SQL tab):

```sql
ALTER TABLE bookings
  ADD COLUMN preferred_start_1 DATETIME NULL AFTER end_at,
  ADD COLUMN preferred_start_2 DATETIME NULL AFTER preferred_start_1;
```

> `status` already exists + is indexed — no change. Run **both** 001 and 002 before flipping `hourly_enabled`; the code probes for each column independently, so a partial run stays dormant rather than erroring.

---

## ☑️ Step 3 — Flip the flag in the server's `hm-api/_config.php`

Edit `hm-api/_config.php` **directly on the server** (cPanel File Manager → Edit). Add this line anywhere inside the `return [ ... ];` array — e.g. right after the `slot_lock_enabled` line:

```php
  // Hourly interval scheduling — turn ON only after 001 migration has run.
  'hourly_enabled' => true,
```

Save. That's it — the gate is `hourly_enabled` **AND** the `start_at` column existing, so it goes live the moment both are true.

---

## ☑️ Step 4 — Verify
1. Load your booking calendar / submit a test booking — should work exactly as before (band UI unchanged).
2. Hit `https://hello-moving.com/hm-api/availability.php?date=YYYY-MM-DD` (with your `X-API-KEY`) — the JSON response should now include an `"intervals": [...]` array alongside `"bands"`.
3. New test bookings should populate `start_at`/`end_at` in the `bookings` table (check in phpMyAdmin).

**Rollback:** set `'hourly_enabled' => false` in `_config.php` — instant, no redeploy. The columns can stay; they're harmless when the flag is off.
