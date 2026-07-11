# Slice 2 — Controlled Production Validation Runbook

> **Status:** PLAN / RUNBOOK — for later execution. Nothing here has been run.
> **Rules honored:** flag NOT enabled, nothing deployed, no customer data modified.
> **Method:** reversible, windowed validation on the **production** MySQL using a
> far-future throwaway date (`2026-09-01`) and a tagged test identity.

---

## 0. What you're validating & where the code actually is

| Path | Code location | On production now? |
|---|---|---|
| Public create (`create-booking.php`) — reserve | **Slice 1**, on `main` | ✅ **deployed** (flag OFF, inert) |
| Admin/generic (`rest.php`) — insert / reschedule / delete | **Slice 2**, on `feature/smart-booking-slice-2` | ❌ **NOT deployed** |

### ⚠️ Prerequisite P1 — deploy Slice 2 to production with the flag OFF
The `rest.php` hooks (steps 4–6) **cannot be validated until Slice 2 is on production.**
Before the window: merge `feature/smart-booking-slice-2` → `main` and let CI deploy.
With `slot_lock_enabled` absent/OFF this is **inert** (byte-for-byte identical prod
behaviour — already proven for Slice 1's deploy). This deploy is a separate,
explicitly-approved action — **not** part of this planning step.

### ⚠️ Prerequisite P2 — the flag is GLOBAL, not test-scoped
Enabling `slot_lock_enabled` turns locking on for **every** booking during the
window, not just `2026-09-01`. Therefore the window must be:
- **short** (minutes), in a **low-traffic** period,
- **monitored**, with **instant rollback** (flip the flag back → OFF),
- understood: a real customer booking during the window is also lock-checked
  (it only 409s if it genuinely collides on the same date+band — the intended
  behaviour — but keep the window tiny to bound any surprise).

### ⚠️ Prerequisite P3 — side effects of the PUBLIC path (steps 2–3)
`create-booking.php` success also **fires a LINE push** and **inserts an
`inbox_messages` row** (admin Inbox). Expect a couple of test LINE pings and
inbox rows; **both are cleaned up / acknowledged** below. The `rest.php` path
(steps 4–6) has **no** such side effects. If LINE noise is unwanted, temporarily
set `line_enabled=false` in `_config.php` for the window (optional).

### Access needed to execute
- **DB console** (cPanel → phpMyAdmin, or SSH `mysql`) for the SQL checks.
- **Server file edit** of `hm-api/_config.php` (cPanel File Manager / SSH) to toggle the flag — this is a config edit, effective immediately per-request; **not** a code deploy.
- **API key** = `window.API_KEY` from `https://hello-moving.com/js/config/env.js` (referred to below as `$KEY`).
- **Admin session token** (`$ADMIN` — from `admin-login.php`) *only* if you run the hard-DELETE variant in step 6 (delete is staff-gated; the cancel variant needs only `$KEY`).

---

## 1. Test identity & parameters (scoping = safety)

| Field | Value |
|---|---|
| Test date | `2026-09-01` (far future; verified empty in §2) |
| Test band | 午前 → canonical `am` |
| Packed notes (drives the band) | `…\n[HM_EXTRAS]\ntime:午前（9:00〜12:00）\n…` |
| Test email (unique tag) | `slot-validation@hello-moving.com` |
| Test name tag | `SLOT VALIDATION — DELETE ME` |

Every test row is identifiable by **`booking_date='2026-09-01'` AND
`customer_email='slot-validation@hello-moving.com'`** → cleanup can never match
real customer rows.

---

## 2. Pre-test safety checks (MUST pass before the window)

```sql
-- (a) Test date must be clear of bookings
SELECT * FROM bookings WHERE booking_date = '2026-09-01';
-- EXPECT: 0 rows

-- (b) Test date must be clear of slots
SELECT * FROM booking_slots WHERE booking_date = '2026-09-01';
-- EXPECT: 0 rows

-- (c) Baseline totals — snapshot to prove NET-ZERO after cleanup
SELECT
  (SELECT COUNT(*) FROM bookings)       AS bookings_before,
  (SELECT COUNT(*) FROM booking_slots)  AS slots_before,
  (SELECT COUNT(*) FROM inbox_messages) AS inbox_before;
-- RECORD these three numbers.
```
**Abort** if (a) or (b) is non-zero — pick a different date; do not proceed.

---

## 3. Open the window — enable the flag (server config edit)

In `hm-api/_config.php`, add to the returned config array:
```php
'slot_lock_enabled' => true,
```
Save. Effective immediately (PHP reads config per request). **Start a timer.**
Keep this browser tab / SSH session open for the instant revert (§9).

Quick confirm the flag is live (public path now reserves): proceed to §4.

---

## 4. Step 2 — Create first booking (PUBLIC path, `create-booking.php`)

```bash
KEY=<paste window.API_KEY>
curl -s -w '\n[HTTP %{http_code}]\n' -X POST \
  "https://hello-moving.com/hm-api/create-booking.php" \
  -H "X-API-KEY: $KEY" -H "Content-Type: application/json" \
  -d '{
    "customer_name":"SLOT VALIDATION — DELETE ME",
    "customer_email":"slot-validation@hello-moving.com",
    "customer_phone":"09000000000",
    "booking_date":"2026-09-01",
    "service_id":null,
    "status":"pending",
    "notes":"SLOT VALIDATION TEST\n[HM_EXTRAS]\nref:SLOT-TEST\ntime:午前（9:00〜12:00）\nlocmode:single\nfrom:TEST-ADDRESS",
    "items":[],
    "created_at":"2026-09-01T00:00:00Z"
  }'
```
**Expected:** `200` → `{"ok":true,"id":"<uuid-A>", ...}`  → **record `<uuid-A>`**.

**Verify (SQL):**
```sql
SELECT id, customer_name, booking_date, status
FROM bookings WHERE booking_date='2026-09-01';
-- EXPECT: exactly 1 row (uuid-A)

SELECT booking_date, time_band, slot_index, booking_id
FROM booking_slots WHERE booking_date='2026-09-01';
-- EXPECT: exactly 1 row → (2026-09-01, 'am', 0, <uuid-A>)
```

---

## 5. Step 3 — Duplicate submit (PUBLIC path) → 409

Re-run the **exact** curl from §4.
**Expected:** `409` → `{"ok":false,"data":null,"error":"slot_taken"}`.

**Verify (SQL) — nothing was added:**
```sql
SELECT COUNT(*) FROM bookings      WHERE booking_date='2026-09-01';  -- EXPECT: 1
SELECT COUNT(*) FROM booking_slots WHERE booking_date='2026-09-01';  -- EXPECT: 1
```

---

## 6. Step 4 — Admin/generic INSERT (`rest.php`) same slot → 409

```bash
curl -s -w '\n[HTTP %{http_code}]\n' -X POST \
  "https://hello-moving.com/hm-api/rest.php" \
  -H "X-API-KEY: $KEY" -H "Content-Type: application/json" \
  -d '{
    "table":"bookings","action":"insert","returning":true,
    "values":{
      "customer_name":"SLOT VALIDATION ADMIN — DELETE ME",
      "customer_email":"slot-validation@hello-moving.com",
      "customer_phone":"09000000000",
      "booking_date":"2026-09-01",
      "status":"pending",
      "notes":"[HM_EXTRAS]\ntime:午前（9:00〜12:00）\n"
    }
  }'
```
**Expected:** `409` (`am` on `2026-09-01` already held by uuid-A).
**Verify:** counts unchanged (bookings=1, slots=1 on the date).

---

## 7. Step 5 — Reschedule ONTO an occupied slot → 409 (lock-move)

**7a. Create a second booking on a *different* band (午後 → `pm`) via `rest.php`:**
```bash
curl -s -w '\n[HTTP %{http_code}]\n' -X POST \
  "https://hello-moving.com/hm-api/rest.php" \
  -H "X-API-KEY: $KEY" -H "Content-Type: application/json" \
  -d '{
    "table":"bookings","action":"insert","returning":true,
    "values":{
      "customer_name":"SLOT VALIDATION PM — DELETE ME",
      "customer_email":"slot-validation@hello-moving.com",
      "customer_phone":"09000000000",
      "booking_date":"2026-09-01",
      "status":"pending",
      "notes":"[HM_EXTRAS]\ntime:午後（12:00〜15:00）\n"
    }
  }'
```
**Expected:** `200` → record `<uuid-B>`. Now: `am`=uuid-A, `pm`=uuid-B.

**7b. Try to move uuid-B (pm) onto the occupied `am`:**
```bash
curl -s -w '\n[HTTP %{http_code}]\n' -X POST \
  "https://hello-moving.com/hm-api/rest.php" \
  -H "X-API-KEY: $KEY" -H "Content-Type: application/json" \
  -d '{
    "table":"bookings","action":"update",
    "values":{"notes":"[HM_EXTRAS]\ntime:午前（9:00〜12:00）\n"},
    "filters":[{"col":"id","op":"eq","val":"<uuid-B>"}]
  }'
```
**Expected:** `409 slot_taken`.
**Verify (SQL) — rollback held, no stale/double:**
```sql
SELECT booking_id, time_band FROM booking_slots
WHERE booking_date='2026-09-01' ORDER BY time_band;
-- EXPECT: (uuid-A, 'am') AND (uuid-B, 'pm')  — uuid-B STILL on pm, am unchanged
SELECT COUNT(*) FROM booking_slots WHERE booking_date='2026-09-01';  -- EXPECT: 2
```

**7c. (positive control) Move uuid-B to a *free* band (夕方 → `ev`):**
```bash
# same as 7b but notes time:夕方（15:00〜18:00） → EXPECT 200
```
**Verify:** uuid-B slot row now `ev`; `pm` released; `am` still uuid-A. (3 distinct bands never coexist for B — release-then-reserve.)

---

## 8. Step 6 — Lifecycle release (cancel, and/or delete)

**8a. Cancel via UPDATE (needs only `$KEY`) — releases the slot:**
```bash
curl -s -w '\n[HTTP %{http_code}]\n' -X POST \
  "https://hello-moving.com/hm-api/rest.php" \
  -H "X-API-KEY: $KEY" -H "Content-Type: application/json" \
  -d '{
    "table":"bookings","action":"update",
    "values":{"status":"cancelled"},
    "filters":[{"col":"id","op":"eq","val":"<uuid-A>"}]
  }'
```
**Expected:** `200`.
**Verify:** the `am` slot is gone:
```sql
SELECT * FROM booking_slots WHERE booking_date='2026-09-01' AND time_band='am';
-- EXPECT: 0 rows  (am released → now bookable again)
```

**8b. (optional) Hard DELETE variant — releases slot; needs `$ADMIN` (delete is staff-gated):**
```bash
curl -s -w '\n[HTTP %{http_code}]\n' -X POST \
  "https://hello-moving.com/hm-api/rest.php" \
  -H "X-API-KEY: $KEY" -H "Authorization: Bearer $ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"table":"bookings","action":"delete",
       "filters":[{"col":"id","op":"eq","val":"<uuid-B>"}]}'
```
**Verify:** uuid-B removed AND its slot released (delete-orphan prevention):
```sql
SELECT * FROM booking_slots WHERE booking_id='<uuid-B>';   -- EXPECT: 0 rows
```

---

## 9. Step 7 — Availability transitions (`availability.php`)

Run at the right moments to see `am` flip. Read-only.
```bash
curl -s -H "X-API-KEY: $KEY" "https://hello-moving.com/hm-api/availability.php?date=2026-09-01"
```
| When | Expected `am` |
|---|---|
| Before §4 (and after full cleanup) | `available` |
| After §4 (uuid-A reserved am) | `reserved` |
| After §8a (am cancelled/released) | `available` |

---

## 10. CLOSE THE WINDOW — revert the flag (do this FIRST, before cleanup)

In `hm-api/_config.php`, set back to **OFF** — either remove the key or:
```php
'slot_lock_enabled' => false,
```
Save. **Stop the timer.** Confirm OFF by re-running a duplicate create (§5 curl)
→ it should now return `200`/normal (locking inactive) rather than `409`.
(You may then delete that extra confirm row in cleanup.)

---

## 11. Cleanup — remove ALL test records (scoped; cannot touch real data)

```sql
-- 1) Release any test slots (scoped by our test bookings, then belt-and-suspenders by date)
DELETE bs FROM booking_slots bs
  JOIN bookings b ON bs.booking_id = b.id
  WHERE b.booking_date='2026-09-01'
    AND b.customer_email='slot-validation@hello-moving.com';
DELETE FROM booking_slots WHERE booking_date='2026-09-01';

-- 2) Remove test bookings (scoped by date AND test email — never customer rows)
DELETE FROM bookings
  WHERE booking_date='2026-09-01'
    AND customer_email='slot-validation@hello-moving.com';

-- 3) Remove the inbox rows the PUBLIC path created (step 2/3 side effect)
DELETE FROM inbox_messages
  WHERE email='slot-validation@hello-moving.com'
     OR subject LIKE '%SLOT VALIDATION%';
```

**Verify clean (all must be 0 / net-zero):**
```sql
SELECT * FROM booking_slots WHERE booking_date='2026-09-01';   -- EXPECT: 0 rows
SELECT * FROM bookings      WHERE booking_date='2026-09-01';   -- EXPECT: 0 rows

-- Net-zero vs the §2 baseline snapshot
SELECT
  (SELECT COUNT(*) FROM bookings)       AS bookings_after,
  (SELECT COUNT(*) FROM booking_slots)  AS slots_after,
  (SELECT COUNT(*) FROM inbox_messages) AS inbox_after;
-- EXPECT: bookings_after == bookings_before, slots_after == slots_before,
--         inbox_after == inbox_before
```

---

## 12. Rollback / if something goes wrong

| Situation | Action |
|---|---|
| **Anything unexpected during the window** | **Revert the flag to OFF first** (§10) — instantly returns create-booking/rest.php to original behaviour. Then investigate. |
| A test step errors or leaves partial rows | Run the §11 cleanup (idempotent, date+email-scoped). Re-verify §11 checks. |
| A `409` where you expected `200` (positive control) | Confirm the target band is actually free (`SELECT … booking_slots WHERE booking_date='2026-09-01'`); a stale test slot from a prior aborted run is the usual cause → §11 cleanup, retry. |
| DB row/transaction appears stuck | `SELECT * FROM information_schema.INNODB_TRX;` / `SHOW PROCESSLIST;` — single-row test, InnoDB auto-resolves; kill only a clearly-hung *test* query. |
| Real customer booking 409s during the window | Expected only on a genuine same date+band collision (correct behaviour). If in doubt, revert flag (§10); the booking retries normally under the old path. |
| Cleanup uncertainty | The `DELETE`s are **scoped to `booking_date='2026-09-01'`** (verified empty pre-test) **and** the test email — they are structurally incapable of matching customer data. |

---

## 13. No-customer-data-affected — confirmation logic

1. **Pre-flight gate:** §2 proves `2026-09-01` has **0** bookings and **0** slots before we touch anything — so every row on that date during the test is provably ours.
2. **Unique tag:** all writes carry `customer_email='slot-validation@hello-moving.com'` and a `SLOT VALIDATION — DELETE ME` name.
3. **Scoped mutations only:** every test `DELETE`/`UPDATE` is filtered by that date and/or a specific recorded `uuid`. No unfiltered or broad statements. (`rest.php` itself refuses filter-less UPDATE/DELETE.)
4. **Net-zero proof:** the §2 vs §11 `COUNT(*)` snapshots for `bookings`, `booking_slots`, and `inbox_messages` must be **equal** — a numeric guarantee that production returned to its exact prior state.
5. **Flag-off default:** the window is the only time locking is active; §10 restores OFF, and its absence is re-confirmed.
6. **Reversibility:** Slice 2's own delete/cancel release paths mean even the test slots self-clean on cancel/delete; §11 is the belt-and-suspenders.

---

## 14. Execution checklist (tick in order)
- [ ] P1: Slice 2 merged to `main` + deployed, flag still OFF (separate approval).
- [ ] §2 pre-test checks pass (date empty; baseline snapshot recorded).
- [ ] §3 flag → ON (timer started).
- [ ] §4 create → `200` + 1 booking + 1 `am` slot.
- [ ] §5 duplicate → `409`, counts unchanged.
- [ ] §6 rest.php insert → `409`.
- [ ] §7 reschedule onto `am` → `409` (old lock intact); free-band move → `200`.
- [ ] §8 cancel/delete → slot released.
- [ ] §9 availability shows available → reserved → available.
- [ ] §10 flag → OFF (timer stopped; OFF re-confirmed).
- [ ] §11 cleanup + net-zero verified.

*Planning only — not executed. Flag remains OFF; nothing deployed.*
