# Slot-Locking — Controlled Production Validation Procedure

> **Status:** PROCEDURE (not executed). `SLOT_LOCK_ENABLED` remains **OFF**.
> The flag is enabled **only** inside the controlled window below, and made
> **permanent only after 10/10 checks pass** (§8 readiness score).
> Reversible, windowed, on a far-future test date. No customer data touched.

---

## 0. Preconditions & who-does-what

| Capability | Owner | Notes |
|---|---|---|
| Toggle flag in `hm-api/_config.php` | **You** (cPanel File Manager) | server-side file; effective per-request |
| OPcache reset | **You / driver** | cPanel "Restart PHP", or the driver via `slot-preflight.php?reset=1` |
| SQL checks (phpMyAdmin) | **You** | the DB-state verifications below |
| HTTP matrix (create/dup/edit) | **Driver** (`tests/slot-safe-drive.sh`) | never writes unless locking is proven active |
| API key `HM_KEY` | public (`env.js`) | `f42b…` |
| `admin_setup_token` `HM_TOKEN` | **You** (server secret) | required by `slot-preflight.php` |

**Already deployed & inert (flag OFF):** `create-booking.php` (Slice 1), `rest.php` hooks (Slice 2), `booking_slots` table, `hm-api/slot-preflight.php`.

**Golden rule:** a test booking is **never** written until the preflight proves
`slot_lock_enabled=true` + fresh code + `booking_slots` present (Gate 1), and a
single probe flips `am → reserved` (Gate 2). Otherwise the driver **aborts** and
the flag is reverted.

---

## 1. Test parameters

| Field | Value |
|---|---|
| Test date | `2026-09-01` (far future) |
| Test band | 午前 → canonical `am` |
| Test email tag | `slot-validation@hello-moving.com` |
| Booking A | `2026-09-01` / 午前 |
| Booking B | `2026-09-01` / 午前 (duplicate) |

**Pre-test gate (must pass):**
```sql
SELECT * FROM bookings      WHERE booking_date='2026-09-01';  -- EXPECT 0
SELECT * FROM booking_slots WHERE booking_date='2026-09-01';  -- EXPECT 0
```
Abort if either is non-empty.

---

## 2. Safe-enable sequence (do this to open the window)

1. **You:** set `'slot_lock_enabled' => true` in `hm-api/_config.php`; cPanel → **Restart PHP**.
2. **Driver Gate 1 — preflight (no writes):**
   ```
   GET /hm-api/slot-preflight.php?token=<HM_TOKEN>&reset=1   # reset opcache
   GET /hm-api/slot-preflight.php?token=<HM_TOKEN>           # read fresh state
   ```
   Require: `slot_lock_enabled:true`, `booking_slots_table:true`, `code_build:"phase2-slice2"`.
   **If any is false → ABORT, revert flag, zero bookings written.**
3. **Driver Gate 2 — single probe:** create one `am` booking; `availability.php?date=2026-09-01` must flip `am → reserved`, else abort + cancel probe.

Run gates 1–2 (probe-only):
```bash
HM_KEY='f42b73f2e834faf3bba6665cf89bf9883b26747d0313cb0a5cc126285d0251a6' \
HM_TOKEN='<admin_setup_token>' bash tests/slot-safe-drive.sh
```

---

## 3. Step 2 — Create Booking A  (expect HTTP 200)

```bash
curl -s -w '\n[HTTP %{http_code}]\n' -X POST https://hello-moving.com/hm-api/rest.php \
  -H "X-API-KEY: $HM_KEY" -H "Content-Type: application/json" --data-binary '{
    "table":"bookings","action":"insert","returning":true,
    "values":{"customer_name":"SLOT VAL A — DELETE ME","customer_email":"slot-validation@hello-moving.com",
      "customer_phone":"09000000000","booking_date":"2026-09-01","status":"pending",
      "notes":"\n[HM_EXTRAS]\ntime:午前（9:00〜12:00）\n"}}'
```
- **Expected:** `200`, `{ok:true,data:[{id:"<A>"…}]}` → record `<A>`.
- **[C1]** booking A row created. **[C2]** one `booking_slots` row `(2026-09-01, am, 0, <A>)`.

```sql
SELECT id,status FROM bookings WHERE booking_date='2026-09-01';                 -- 1 row (A, pending)
SELECT booking_date,time_band,slot_index,booking_id,status FROM booking_slots
  WHERE booking_date='2026-09-01';                                              -- 1 row: am/0/<A>/reserved
```

---

## 4. Step 3 — Attempt Booking B  (expect HTTP 409 `slot_taken`)

Re-run the **exact** create with a different name (`SLOT VAL B — DELETE ME`), same date+band.
- **Expected:** `409` → `{ok:false,error:"slot_taken"}`.

**[C3]** B returns 409. **[C4]** only ONE booking. **[C5]** only ONE active lock. **[C6]** no orphans. **[C7]** rollback correct.
```sql
-- [C4] only one booking on the date
SELECT COUNT(*) FROM bookings WHERE booking_date='2026-09-01';                  -- EXPECT 1

-- [C5] exactly one active lock for (date, am)
SELECT COUNT(*) FROM booking_slots WHERE booking_date='2026-09-01' AND time_band='am';  -- EXPECT 1

-- [C6] no orphan slots (every slot maps to a live, non-cancelled booking)
SELECT bs.* FROM booking_slots bs
  LEFT JOIN bookings b ON bs.booking_id=b.id
  WHERE bs.booking_date='2026-09-01'
    AND (b.id IS NULL OR b.status IN ('cancelled','キャンセル'));               -- EXPECT 0 rows

-- [C7] rollback: B left no partial booking and no extra slot row
SELECT COUNT(*) FROM bookings      WHERE booking_date='2026-09-01';            -- EXPECT 1 (unchanged)
SELECT COUNT(*) FROM booking_slots WHERE booking_date='2026-09-01';            -- EXPECT 1 (unchanged)
```

---

## 5. Step 5 — Admin edit: move A 午前 → 午後 (lock-move)

```bash
curl -s -w '\n[HTTP %{http_code}]\n' -X POST https://hello-moving.com/hm-api/rest.php \
  -H "X-API-KEY: $HM_KEY" -H "Content-Type: application/json" --data-binary '{
    "table":"bookings","action":"update",
    "values":{"notes":"\n[HM_EXTRAS]\ntime:午後（12:00〜15:00）\n"},
    "filters":[{"col":"id","op":"eq","val":"<A>"}]}'
```
- **Expected:** `200`.

**[C8]** old `am` lock released + new `pm` lock reserved. **[C9]** no duplicate locks.
```sql
-- [C8] am freed, pm held, still exactly one lock for A
SELECT time_band FROM booking_slots WHERE booking_id='<A>';                     -- EXPECT single row: pm
SELECT COUNT(*) FROM booking_slots WHERE booking_date='2026-09-01' AND time_band='am';  -- EXPECT 0

-- [C9] no duplicate locks for this booking
SELECT COUNT(*) FROM booking_slots WHERE booking_id='<A>';                      -- EXPECT 1
```
*(Negative control, optional: reschedule onto an occupied band → expect `409`, old lock intact.)*

---

## 6. Step 6 — Admin delete A (release)

> Delete via `rest.php` is **staff-gated** → send the admin session token:
> `-H "Authorization: Bearer <ADMIN_TOKEN>"`. (Or use the cancel path:
> `action:update, values:{status:"cancelled"}` with just `HM_KEY`, then SQL-delete.)

```bash
curl -s -w '\n[HTTP %{http_code}]\n' -X POST https://hello-moving.com/hm-api/rest.php \
  -H "X-API-KEY: $HM_KEY" -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" --data-binary '{
    "table":"bookings","action":"delete","filters":[{"col":"id","op":"eq","val":"<A>"}]}'
```
- **Expected:** `200`.

**[C10]** booking removed + slot released + table clean.
```sql
SELECT COUNT(*) FROM bookings      WHERE id='<A>';                              -- EXPECT 0
SELECT COUNT(*) FROM booking_slots WHERE booking_id='<A>';                      -- EXPECT 0
SELECT COUNT(*) FROM booking_slots WHERE booking_date='2026-09-01';            -- EXPECT 0
```

---

## 7. Close window + cleanup

1. **You:** revert `slot_lock_enabled => false` in `_config.php` (confirm a duplicate create now returns `200`, i.e. locking inactive).
2. Cleanup (scoped to date + test email — cannot touch customer data):
   ```sql
   DELETE bs FROM booking_slots bs JOIN bookings b ON bs.booking_id=b.id
     WHERE b.booking_date='2026-09-01' AND b.customer_email='slot-validation@hello-moving.com';
   DELETE FROM booking_slots WHERE booking_date='2026-09-01';
   DELETE FROM bookings      WHERE booking_date='2026-09-01' AND customer_email='slot-validation@hello-moving.com';
   DELETE FROM inbox_messages WHERE email='slot-validation@hello-moving.com' OR subject LIKE '%SLOT VAL%';
   -- verify net-zero
   SELECT COUNT(*) FROM bookings WHERE booking_date='2026-09-01';       -- EXPECT 0
   SELECT COUNT(*) FROM booking_slots WHERE booking_date='2026-09-01';  -- EXPECT 0
   ```

---

## 8. Final report template (fill on execution)

| # | Check | Expected | Result | Pass? |
|---|---|---|---|---|
| C1 | Booking A create | HTTP 200 + row | | ☐ |
| C2 | A slot reserved | 1 row am/0/A | | ☐ |
| C3 | Booking B blocked | HTTP 409 slot_taken | | ☐ |
| C4 | Only one booking | bookings=1 | | ☐ |
| C5 | One active lock | am count=1 | | ☐ |
| C6 | No orphan slots | 0 orphans | | ☐ |
| C7 | Rollback correct | counts unchanged | | ☐ |
| C8 | Lock-move on edit | am→0, pm→1 | | ☐ |
| C9 | No duplicate locks | A locks=1 | | ☐ |
| C10 | Delete releases | booking=0, slots=0 | | ☐ |

**Database state (paste query outputs):**
```
bookings@date:        ___
booking_slots@date:   ___
orphan check:         ___
net-zero after clean: ___
```

**Readiness score = (checks passed) / 10.**
- **10/10 → GO** — safe to enable `slot_lock_enabled` permanently.
- **< 10/10 → NO-GO** — keep flag OFF; file defects; do not enable.

**Passed checks:** ___  **Failed checks:** ___  **Score:** __/10  **Verdict:** GO / NO-GO

---

## 9. Guardrails
- Flag is **global** while ON — keep the window short, low-traffic, monitored; instant rollback = flip flag OFF.
- The public create path (`create-booking.php`) also emits a LINE ping + inbox row — using `rest.php` for the matrix (as above) avoids that noise.
- Do **not** make the flag permanent until **10/10**.

*Procedure only — nothing executed; `SLOT_LOCK_ENABLED` remains OFF.*
