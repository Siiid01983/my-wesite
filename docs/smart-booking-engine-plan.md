# Smart Booking Engine — Implementation Plan

> **Status:** DRAFT — awaiting review. **Documentation only.**
> No production code, database, or API changes have been made.
>
> **Guiding priority:** Reliability > Features. No breaking changes. Maintain production stability.
> **Scope discipline:** Evolve the existing Hello Moving architecture (static HTML/CSS/JS + PHP `hm-api/` + MySQL). **No** React/SPA, **no** rewrite, **no** new database architecture.

## Document map

| § | Section | Purpose |
|---|---|---|
| 1 | Goal | What we're building |
| 2 | Current-State Facts | What we build on (grounded in real code) |
| 3 | Booking State Machine | AVAILABLE/RESERVED/CONFIRMED/COMPLETED/CANCELLED, reconciled |
| **4** | **Data Model & Schema** → **4.1 Schema Design** | The `booking_slots` table + locking mechanism |
| **5** | **Phase 0** | First, zero-risk build step |
| **6** | **Migration Strategy** | Capacity source-of-truth stages + future capacity>1 |
| 7 | `availability.php` Contract | Read-only availability API |
| 8 | Later Phases (1–4) | Locking on write, UI upgrade, hardening |
| 9 | Risk & Rollback | Safety posture |
| 10 | Locked Decisions | Confirmed choices |
| **11** | **Open Items For Review** | What needs sign-off before code |

---

## 1. Goal

Build a robust **Smart Booking Engine** on top of the existing MySQL + `hm-api/` infrastructure that adds **true server-side slot locking** — a booking slot cannot be double-booked, and validation happens **inside `hm-api` before records are inserted** — while keeping all current booking, admin, and portal functionality intact.

---

## 2. Current-State Facts (what we are building on)

Grounded in the actual code as of this plan:

| Area | Current reality | Source | Implication |
|---|---|---|---|
| **Bookings table** | `bookings(id, customer_name/email/phone, booking_date VARCHAR(40), service_id, status VARCHAR(20) DEFAULT 'pending', notes TEXT, items JSON, created_at, updated_at)`. Time band + from/to/service are **packed inside `notes`** (`[HM_EXTRAS]` block: `time:午前（9:00〜12:00）`), not a column. | `hm-api/schema.mysql.sql:42`, `bookingService.js` `_packNotes` | A queryable slot key requires a **dedicated table**, not a `notes` parse at query time. |
| **Statuses** | DB stores English `pending / checking / confirmed / completed / cancelled`; admin UI maps to `新規 / 確認中 / 確定 / 完了 / キャンセル`. | `js/services/apiAdapter.js:125-129` | The new state machine **layers over** these; existing values are **not renamed**. |
| **Availability** | `calendar_availability(date UNIQUE, status)` = **day-level only**. Per-day capacity (`hm_capacity` = `{max, limited}`) is computed **client-side in localStorage**; the server cannot currently compute availability. | `hm-api/schema.mysql.sql:63`, `calendarService.js`, `admin-bookings.js` | `availability.php` needs a **server-readable** capacity source (see §6). |
| **Two booking write paths** | Public → `create-booking.php` (validated insert). Admin (`quickBookSlot` / `openAdd`) → `Adapter.addBooking` → **`rest.php` generic insert**. | `hm-api/create-booking.php`, `js/services/apiAdapter.js:389-394`, `js/lib/apiClient.js` | Locking must be enforced at **both** paths via a shared server-side layer. |
| **DB engine** | InnoDB, PDO with `ERRMODE_EXCEPTION`, `EMULATE_PREPARES=false`. | `hm-api/_db.php` | ✅ Transactions and `SELECT … FOR UPDATE` are available — real locking is feasible. |
| **Shared helpers** | `_lib.php`: `hm_json/hm_ok/hm_err`, `hm_body`, `hm_uuid4`, `hm_require_api_key`, `hm_require_admin`, `hm_rate_limit`, `hm_cache_*`, `hm_log_*`. Standard envelope `{ ok, data, error }`. | `hm-api/_lib.php` | New endpoints reuse existing plumbing → consistent and low-risk. |
| **FK style** | Existing tables use **logical** references (no foreign keys), e.g. `communications.booking_id`, `inbox_messages.booking_id`. | `hm-api/schema.mysql.sql` | `booking_slots.booking_id` stays a logical ref (no FK) to match house style. |

---

## 3. Booking State Machine (reconciled — no renames)

The requested states span **two layers**, not a single column:

```
SLOT layer      (new booking_slots table):   AVAILABLE  ⇄  RESERVED
BOOKING layer   (existing status column):    pending / checking → confirmed → completed
                                             (any) → cancelled
```

| Requested state | Realized as | Slot effect |
|---|---|---|
| **AVAILABLE** | no active slot row for `(date, band)` | bookable |
| **RESERVED**  | booking `pending` / `checking` (新規 / 確認中) | slot row held (UNIQUE lock) |
| **CONFIRMED** | booking `confirmed` (確定) | slot stays held |
| **COMPLETED** | booking `completed` (完了) | held; date is past → irrelevant to future availability |
| **CANCELLED** | booking `cancelled` (キャンセル) | slot row **released** → back to AVAILABLE |

**Transitions**

```
AVAILABLE --book--> RESERVED --confirm--> CONFIRMED --complete--> COMPLETED
    ^                   |                     |
    |                   v                     v
    +------ CANCELLED <--+---------------------+   (release slot row)
```

A slot row exists while the booking status ∈ `{pending, checking, confirmed, completed}` and is **deleted on cancel**. Rescheduling = release old `(date, band)` + reserve new, in one transaction.

**Canonical lock unit = time BAND** (`午前 / 午後 / 夕方 / 夜間`), because public bookings are already band-based; the admin hourly (08:00–18:00) timeline is a **display mapping into bands** (e.g. 09:00 → 午前). `時間指定なし` / band-less bookings do **not** hard-lock a band (day-level rules still apply) — this preserves legacy and flexible bookings.

---

## 4. Data Model & Schema

### 4.1 Schema Design

A new table, populated atomically inside a transaction. The **DB `UNIQUE` constraint is the actual lock** — race-proof regardless of which code path inserts. Additive only; `bookings` and `calendar_availability` are untouched.

```sql
CREATE TABLE IF NOT EXISTS booking_slots (
  id           CHAR(36)    NOT NULL,
  booking_date VARCHAR(40) NOT NULL,
  time_band    VARCHAR(60) NOT NULL,
  slot_index   INT         NOT NULL DEFAULT 0,   -- 0..(capacity-1); always 0 while capacity = 1
  booking_id   CHAR(36)    NOT NULL,             -- logical ref to bookings.id (no FK, house style)
  status       VARCHAR(20) NOT NULL DEFAULT 'reserved',
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY slot_unique (booking_date, time_band, slot_index),
  KEY slot_date_idx (booking_date),
  KEY slot_booking_idx (booking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**Why `slot_index` exists now even though capacity is 1:** it makes the exact same table support capacity > 1 later **without a migration**. Today the reserve logic always writes `slot_index = 0`, so `UNIQUE(booking_date, time_band, slot_index)` enforces **exactly one** booking per `(date, band)`. Tomorrow, capacity `N` lets `slot_index` range `0..N-1` and the same UNIQUE prevents overbooking beyond `N` (see §6 Future Upgrade Note).

**Single-truck worked example (capacity = 1):**

| Date | Band | Status |
|---|---|---|
| 2026-07-15 | 午前 | RESERVED |
| 2026-07-15 | 午後 | AVAILABLE |
| 2026-07-15 | 夕方 | AVAILABLE |
| 2026-07-15 | 夜間 | AVAILABLE |

Once a customer books `2026-07-15 / 午前`, no other customer can book `2026-07-15 / 午前` until it is cancelled or changed.

### 4.2 Locking Mechanism

Shared helper `hm-api/_slots.php`, called by **every** write path:

```
-- Reserve (capacity = 1, current):
BEGIN
  INSERT INTO booking_slots (id, booking_date, time_band, slot_index=0, booking_id, status='reserved')
    -- SQLSTATE 23000 (duplicate) => slot already taken
  <allow the booking insert>
COMMIT
on 23000  -> ROLLBACK -> HTTP 409 { ok:false, data:null, error:'slot_taken' }
```

```
-- Reserve (capacity > 1, future — same helper, gated by config):
BEGIN
  SELECT slot_index FROM booking_slots
    WHERE booking_date=? AND time_band=? FOR UPDATE;        -- lock the band's rows
  pick lowest free slot_index in 0..capacity-1
  if none free -> ROLLBACK -> 409 'slot_full'
  INSERT ...; <allow booking>; COMMIT
```

Helper surface:

- `hm_slot_reserve($date, $band, $bookingId)` → `true | throws/409`.
- `hm_slot_release($bookingId)` → deletes the slot row(s) for a booking (cancel / reschedule).
- `hm_slot_counts($date)` → `{ band => reservedCount }` for `availability.php`.
- **Band normalization** lives here: maps hourly labels (`09:00〜10:00`) and packed `notes` band labels onto the canonical band; returns "no band" for `時間指定なし` / unparseable → caller **skips** slot locking (backward compat).

**Backstop:** even if a future code path forgets the helper, the **`UNIQUE` constraint** still rejects a colliding slot insert. The helper is the ergonomic path; the constraint is the guarantee.

---

## 5. Phase 0 — Foundations (zero behavior change, first to ship)

The safe, additive first step. Nothing reads or writes the new table yet, so the live booking system is unaffected.

**Deliverables**
1. `hm-api/booking_slots.schema.sql` + idempotent `CREATE TABLE` (from §4.1) — additive; no existing table altered.
2. `hm-api/_slots.php` — band normalization + `hm_slot_reserve / hm_slot_release / hm_slot_counts` (from §4.2). **Not yet wired** into any endpoint.
3. Capacity **bridge** into `hm_data` KV (Stage B, temporary — see §6) so the server has a value to read in later phases.
4. `hm-api/backfill-slots.php` — one-time, idempotent: populate `booking_slots` from existing **active** bookings (parse band from `notes`; skip band-less / `時間指定なし`).

**Exit criteria (verify before Phase 1)**
- New table present; existing booking / admin / portal flows **byte-for-byte unchanged**.
- `_slots.php` unit-tested for band normalization (hourly → band, packed notes → band, `時間指定なし` → none).
- Backfill is re-runnable without creating duplicates (idempotent on `(booking_date, time_band, slot_index)`).

**Rollback:** drop the new table + delete the two new files. Nothing else references them.

---

## 6. Migration Strategy

### 6.1 Capacity source of truth (three stages — the middle one is **temporary**)

`availability.php` and the reserve logic both need a server-readable capacity value. Today the only source is **client-side localStorage** (`hm_capacity`), which the server cannot read.

```
Stage A (today):     localStorage hm_capacity           (client-only — server blind)
Stage B (bridge):    hm_data KV  (server-readable)       ⟵ TEMPORARY MIGRATION SUPPORT ONLY
Stage C (permanent): dedicated server config             (permanent source of truth)
```

- **Stage B is not the permanent source of truth.** Mirroring capacity into the `hm_data` KV table is a **transitional bridge** so `availability.php` has something authoritative to read during rollout, reusing existing CMS KV plumbing with zero new tables.
- **Stage C** migrates the source of truth to a dedicated, purpose-built server location (e.g. a small `booking_config` row/table, or capacity resolved directly by the engine), after which the `hm_data` mirror and any client→server capacity write are **removed**. Tracked as a Phase 4 / future clean-up item so the bridge does not silently become permanent.
- Current capacity value everywhere = **1 per band** (single vehicle).

### 6.2 Data backfill

Existing active bookings are migrated into `booking_slots` once, via the idempotent `backfill-slots.php` (Phase 0, §5). Band-less / `時間指定なし` bookings are intentionally **not** given a hard slot lock.

### 6.3 Future Upgrade Note

```
Current architecture assumes:
  1 vehicle
  1 booking per time band

Future versions may replace this with:
  capacity > 1
  multiple vehicles
  vehicle assignment
```

Design consequences already baked in so a second truck (or fleet) does **not** require re-thinking the system from scratch:

- `booking_slots.slot_index` + `UNIQUE(booking_date, time_band, slot_index)` already express "N holds per band" — capacity 1 is just `N = 1`.
- `availability.php` already returns `capacity` / `reserved` / `remaining` per band — a UI reading it needs no shape change when capacity grows.
- The reserve helper has a documented capacity > 1 branch (`SELECT … FOR UPDATE` + lowest-free `slot_index`).
- A future `vehicle_id` / assignment column can be added to `booking_slots` **additively** (each `slot_index` → a vehicle) without touching `bookings`.

---

## 7. `availability.php` Contract (Phase 1 — read-only)

```
GET /hm-api/availability.php?date=YYYY-MM-DD
GET /hm-api/availability.php?from=YYYY-MM-DD&to=YYYY-MM-DD   (month prefetch; bounded range)
```

Response (standard envelope):

```json
{
  "ok": true,
  "data": {
    "date": "2026-07-15",
    "day_status": "available | limited | full",
    "bands": [
      { "band": "午前（9:00〜12:00）",  "status": "RESERVED",  "capacity": 1, "reserved": 1, "remaining": 0 },
      { "band": "午後（12:00〜15:00）", "status": "AVAILABLE", "capacity": 1, "reserved": 0, "remaining": 1 },
      { "band": "夕方（15:00〜18:00）", "status": "AVAILABLE", "capacity": 1, "reserved": 0, "remaining": 1 },
      { "band": "夜間（18:00〜21:00）", "status": "AVAILABLE", "capacity": 1, "reserved": 0, "remaining": 1 }
    ]
  },
  "error": null
}
```

Reads: `booking_slots` (reserved counts) + `calendar_availability` (manual day override → can force `full`) + capacity config (§6). **Read-only: cannot affect existing writes.** Same `hm_require_api_key` gate as other public reads; no admin auth required for GET.

---

## 8. Later Phases (1–4)

> Each phase is independently deployable + reversible. Phase 1 is zero-risk (read-only). Phase 2 is the only behavior change → feature-flagged + backward-compatible.

### Phase 1 — `availability.php` (read-only)
- Ship the endpoint per §7. Verify via `curl`; compare to `booking_slots` + day overrides. Cannot affect writes.

### Phase 2 — Server-side locking on write (sensitive core — feature-flagged)
- `create-booking.php`: wrap insert in a transaction; call `hm_slot_reserve()` before/with the insert; **409** on collision. **Backward-compatible skip** when band-less.
- `rest.php`: add a **bookings-insert hook** that delegates to `_slots.php` — covers the admin path with **no client-seam change**.
- Release on cancel: hook the status → `cancelled` update → `hm_slot_release()`.
- Feature flag `SLOT_LOCK_ENABLED` (server config) for instant rollback.
- **Verify:** concurrent double-book → exactly one 409; cancel frees the slot; legacy / band-less bookings unaffected.

### Phase 3 — Upgrade existing UI (not replace)
- `mobileCalendar.js` + admin month calendar: render **server-truth** slot states from `availability.php`, with **graceful fallback** to today's local logic if the endpoint is unreachable (reliability > features).
- `quickBookSlot` + public BA overlay: handle 409 gracefully ("that slot was just taken — pick another"). BA-overlay change is feature-flagged (locked booking surface — requires sign-off before editing `index.html`).

### Phase 4 — Hardening & rollout
- 409 monitoring / logging; concurrency + load test.
- **Stage C:** migrate capacity source of truth off the `hm_data` bridge; remove the temporary mirror.
- Arch-lock test additions (guard the new invariant); docs update.

---

## 9. Risk & Rollback

- **Additive-only DB:** new `booking_slots` table; `bookings` and `calendar_availability` are **untouched** → no migration risk, no breaking change.
- **Phases 0–1 are zero-risk** (new files + reads only). **Phase 2** is the only behavior change → gated by `SLOT_LOCK_ENABLED` + band-less skip → instant disable.
- **DB `UNIQUE`** is the backstop even if a code path forgets the helper.
- **Graceful degradation:** if `availability.php` is unreachable, the UI falls back to current local logic; bookings still work.
- **No** React/SPA, **no** schema replacement, **no** client-seam rewrite.

---

## 10. Locked Decisions (from review)

| Decision | Choice |
|---|---|
| Lock unit | **Time band** (午前/午後/夕方/夜間); hourly slots map into bands |
| Capacity (now) | **Exactly 1** per `(date, band)` — single vehicle / single crew |
| Capacity (schema) | **Forward-compatible for capacity > 1** via `slot_index` + UNIQUE (no future migration) |
| Admin write path | **Hook `rest.php`** server-side via shared `_slots.php` (no client change) |
| Capacity source | `hm_data` KV is a **temporary migration bridge only**; permanent source moves to a dedicated server config (Stage C) |
| Rollout | **Phase-by-phase with review**, starting at Phase 0 |
| Existing statuses | **Not renamed** — AVAILABLE/RESERVED are the new slot layer over them |

---

## 11. Open Items For Review

### 11.A — Sign-off gates

1. Confirm the `hm_data` capacity **bridge** (Stage B, §6) is acceptable as temporary support (Stage C removes it).
2. Confirm **Phase 0** (§5) may proceed — new `booking_slots` table + `_slots.php` helper + backfill — **without touching the current booking system**.
3. Later sign-off required before **Phase 3** edits to the **locked** public BA overlay (`index.html`).

### 11.B — Mandatory design findings (surfaced during deep review)

> **These are MANDATORY review items.** Each must be resolved and signed off *before* the phase that touches it ships. Phase 2 (server-side locking on write) **must not** be enabled until items 4–8 are decided; items 4 also gates the Phase 0 backfill (it fixes the slot key).

4. **Canonical Band IDs** — Admins can rename time-slot labels in `hm_booking_config`, so a lock keyed on the *display label* (`午前（9:00〜12:00）`) would orphan when the label changes, and Japanese full-width/whitespace variants risk false collisions or silent double-books under `utf8mb4` collation. **Decision required:** store a **stable band ID** (`am/pm/ev/nt` + `any`) as the lock key, with the display label held separately as a lookup; define one normalization rule + collation. *Gates: Phase 0 backfill (writes `time_band`), Phase 2.*
5. **Reschedule Lock Move** — Admin changes to a booking's date/band go through `rest.php` **UPDATE**, not INSERT. An insert-only lock hook would leave the *old* slot locked and the *new* slot unguarded. **Decision required:** the reschedule path must **release + reserve atomically** (single transaction). *Gates: Phase 2.*
6. **Direct Delete Orphans** — A `rest.php` **DELETE** of a booking (admin) removes the booking but leaves its `booking_slots` row → a permanent false lock. **Decision required:** delete hook to release the slot, plus a reconciliation pass as backstop. *Gates: Phase 2.*
7. **`create-booking.php` Flush Ordering** — That endpoint inserts, then `fastcgi_finish_request()`/flushes the success response to the client, **then** runs LINE + inbox work in a fire-and-forget tail. Slot reservation **must** sit inside the pre-flush transaction with the booking insert — never in the tail — or a success could be returned for a slot that was never actually secured. **Decision required:** confirm reserve-before-flush ordering. *Gates: Phase 2.*
8. **Double Submit / Idempotency** — A retried or double-tapped submit could attempt two reservations for the same intent. **Decision required:** idempotency key or a short dedupe window on the create paths. *Gates: Phase 2.*

---

*End of plan. No production code, database, or API changes have been made. Awaiting review.*
