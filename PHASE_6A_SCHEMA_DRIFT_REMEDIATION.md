# Phase 6A.2 — Schema Drift Remediation Plan

**Goal:** Resolve the schema drift found in `PHASE_6A_LIVE_SCHEMA_AUDIT.md` for
**`bookings`** and **`reviews`** only.
**Constraint:** Analysis only — **no code, no database, no migrations, no SQL
executed.** Phase 6B not started.

> **Key escalation from 6A.1:** tracing every Supabase code path shows the drift
> breaks **admin writes**, not just the portal. The missing `bookings.updated_at`
> and `reviews.source` / `reviews.booking_reference` columns make **every
> UPDATE/INSERT that includes them fail with PostgREST `400` (PGRST204 "column …
> does not exist")**. Because the app updates `localStorage` optimistically and
> only `console.error`s the Supabase failure, the **UI looks fine while the
> database silently never changes** — a latent data-integrity bug independent of
> Phase 6A.

---

## 1. Code paths inspected (Supabase touch points only)

| Path | Table | Operation | Columns written |
|---|---|---|---|
| `bookingService.createBooking` → `_bookingToRow` | bookings | INSERT | customer_name, customer_email, customer_phone, booking_date, service_id, status, notes, created_at |
| `bookingService.updateBooking` | bookings | UPDATE | …above + **`updated_at`** |
| `bookingService.cancelBooking` | bookings | UPDATE | status, **`updated_at`** |
| `bookingService.approveEstimate` (portal approval) | bookings | UPDATE | status, **`updated_at`** |
| `Adapter.addBooking` → `bookingToSb` | bookings | INSERT | (same as createBooking — no updated_at) |
| `Adapter.updateBooking` | bookings | UPDATE | …fields + **`updated_at`** |
| `Adapter.deleteBooking` | bookings | DELETE by `id` | — |
| `statisticsService` (dashboard/BI) | bookings | SELECT explicit cols | `id,booking_date,service_id,status,customer_email,customer_name,created_at` |
| `Adapter.addReview` / `updateReview` → `reviewToSb` | reviews | UPSERT (`reference_id`) | reference_id, customer_name, rating, review_text, approved, published, headline, service, date_label, location, **`source`**, **`booking_reference`**, created_at |
| `portalReviews.submit` (Phase 5G) | reviews | INSERT | reference_id, customer_name, rating, review_text, approved, published, **`source`**, service, **`booking_reference`**, created_at |
| `contentLoader` (public site) | reviews | SELECT `*` `.eq(approved,true).eq(published,true)` | reads only existing cols |
| `review.html` public form | — | **localStorage only** (`hm_reviews`) — does **not** hit Supabase | n/a |

Confirmed **non-issues**: every SELECT (`statisticsService` explicit list,
`contentLoader`, `sbToReview` via `select *`) references only **live** columns,
so all reads succeed. The public review form never writes to Supabase, so it is
unaffected.

---

## 2. Bookings

### Expected schema (what the code assumes)
`id, created_at, customer_name, customer_email, customer_phone, booking_date,
service_id, status, notes` **+ `updated_at`** (written on every update).

### Live schema (confirmed 6A.1)
`id, created_at, customer_name, customer_email, customer_phone, booking_date,
service_id, status, notes` — **no `updated_at`** (and no `reference_id`,
`time_slot`, `move_*`, `service_type`, `phone`, `email`).

### Drift list
| Item | Type | Evidence |
|---|---|---|
| **`updated_at` used by code, absent in DB** | 🔴 Breaking write | `400 column bookings.updated_at does not exist`; appended by `bookingService.updateBooking/cancelBooking/approveEstimate` and `Adapter.updateBooking`. |
| `service_id` present but effectively vestigial | 🟢 Harmless | Always written `null`; read with fallback to `notes` (`extra.service`). No action. |
| `reference_id` (migration 002) absent | 🟢 Non-issue | HM-ref lives inside `notes` (`ref:…`); no code reads the column. |
| Repo migration `001` cols (`move_date`, `email`, `phone`, `service_type`, `move_from/to`, `time_slot`) absent | 🟢 Non-issue | Live code uses `customer_email`/`booking_date`/`service_id` + notes packing; migration `001/002` are stale. |

### Affected features
- **Portal estimate approval (Phase 5F):** `approveEstimate` UPDATE fails → status never moves to `confirmed` in Supabase (localStorage masks in the portal tab only).
- **Admin booking status management:** confirm / complete / cancel via `Adapter.updateBooking` fail to persist → changes revert on next `syncFromSupabase` (login) and never broadcast over Realtime.
- **Cancellation:** `cancelBooking` UPDATE fails to persist.
- Unaffected: public booking submission (INSERT, no `updated_at`), dashboard/BI reads.

### Safest fix
**Additive column add — `bookings.updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`**,
plus the `set_updated_at()` BEFORE UPDATE trigger already defined in migration
`001` (re-create it for this table). Rationale:
- Purely **additive**; restores the column the code already targets and the
  original migration intended. No code change, no data risk.
- `DEFAULT now()` means existing 22 rows need **no backfill** (optionally backfill
  `updated_at = created_at` for historical accuracy).
- Immediately unbreaks **all** UPDATE paths (portal + admin) at once.
- *Alternative (not preferred):* remove `updated_at` from the four write sites in
  code — avoids a schema change but touches multiple files, discards a useful
  audit field, and diverges further from the documented schema.

---

## 3. Reviews

### Expected schema (what the code assumes)
`id, customer_name, rating, review_text, approved, created_at, reference_id,
headline, service, date_label, location, published` **+ `source` + `booking_reference`**
(written by both admin `reviewToSb` and portal `portalReviews.submit`).

### Live schema (confirmed 6A.1)
`id, customer_name, rating, review_text, approved, created_at, reference_id,
headline, service, date_label, location, published` — **no `source`, no
`booking_reference`, no `booking_id`, no `customer_email`** (table currently 0 rows).

### Drift list
| Item | Type | Evidence |
|---|---|---|
| **`source` used by code, absent in DB** | 🔴 Breaking write | `400 column reviews.source does not exist`; written by `reviewToSb` (admin) and `portalReviews.submit` (portal). |
| **`booking_reference` used by code, absent in DB** | 🔴 Breaking write | `400 column reviews.booking_reference does not exist`; same two writers. Also the **only** intended review→booking link. |
| `booking_id` (migration 001 FK) absent | 🟡 Note | Not written by current code (writers use `booking_reference`); but its absence means there is **no** booking linkage column at all today. |
| No `customer_email` | 🟡 Phase-6A enabler gap | Direct email-scoped review RLS is impossible without a linkage column. |

### Affected features
- **Customer review submission (Phase 5G):** `portalReviews.submit` INSERT fails → customers cannot leave a review at all (portal shows a generic failure).
- **Admin review moderation:** `Adapter.addReview` and `updateReview` (including the **approve** toggle, which re-upserts the full `reviewToSb` row) fail to persist → approvals/edits never reach Supabase (localStorage masks in the admin tab).
- **Phase 6A review isolation (downstream):** the recommended RLS join on `booking_reference` cannot be created because the column doesn't exist.
- Unaffected: public-site testimonials (read path uses only existing cols); public `review.html` form (localStorage only).

### Safest fix
**Additive column adds — `reviews.source TEXT` and `reviews.booking_reference TEXT`**
(matching migration `002`’s intent). Rationale:
- Purely **additive**; restores exactly the columns both writers expect.
- Table is empty (0 rows) → **no backfill, zero data risk**.
- Unblocks admin moderation **and** portal submission in one change, and provides
  the `booking_reference` that Phase 6A review isolation needs.
- **Recommended optional add for the next phase:** `reviews.customer_email TEXT`,
  populated by the writers from the booking, to enable a simple
  `customer_email = auth.email()` RLS predicate instead of a fragile
  notes-parsing join. (Optional — not required to close the drift.)

---

## 4. Risk assessment

| Surface | Current state (pre-fix) | After the additive fixes | Risk of applying the fix |
|---|---|---|---|
| **Portal** | Estimate approval write fails; review submit fails (both silent/generic-error). | Both work; approval persists; reviews flow into moderation. | **Low** — additive columns; no portal code change. |
| **Admin** | Status changes & review approvals don’t persist to Supabase (revert on re-sync; no Realtime). | Changes persist and broadcast; statuses "stick" across refresh/devices. | **Low–positive** — behaviour becomes correct. Note: admins will now see updates persist that previously silently reverted (a fix, not a regression). |
| **CMS / WMC** | Uses `hm_data` / `services` / storage only — **does not touch `bookings` or `reviews`.** | No change. | **None.** |

Cross-cutting:
- The fixes are **schema-additive with safe defaults** (`updated_at DEFAULT now()`,
  nullable `TEXT` on an empty `reviews` table) → no locking/backfill concerns at
  this data volume (22 bookings, 0 reviews).
- These remediations are a **prerequisite** for Phase 6A RLS: review isolation
  needs `booking_reference` (or `customer_email`), and the approval path must work
  for an `authenticated` customer.
- Out of scope but noted for later: `services.icon` and the trimmed
  `calendar_availability` columns are additional drift **not** touched here
  (Phase 6A.2 is bookings/reviews only).

---

## 5. Recommended execution order (when remediation phase begins — not now)

1. **Re-confirm catalog truth** with `service_role` (Appendix A of 6A.1): list
   `bookings`/`reviews` columns so the adds are written `IF NOT EXISTS` against
   the real schema, and snapshot for rollback.
2. **Reviews first (empty table, zero risk):** add `source TEXT` and
   `booking_reference TEXT` (optionally `customer_email TEXT`). Verify in staging:
   admin add/approve persists; `portalReviews.submit` succeeds; public testimonials
   still render.
3. **Bookings next:** add `updated_at TIMESTAMPTZ DEFAULT now()` + the
   `set_updated_at` trigger (optionally backfill `updated_at = created_at`).
   Verify in staging: admin confirm/complete/cancel persists and survives a
   re-sync; portal estimate approval moves status to `確定`/`confirmed`; Realtime
   `bookings` UPDATE fires; dashboard/BI unchanged.
4. **Full regression** across portal, admin, and public site; confirm CMS
   untouched.
5. **Gate:** only after both tables verify green, proceed to the Phase 6A RLS
   work (which can then implement email/booking-scoped review isolation), then
   Phase 6B.

> Per the constraints, this plan deliberately stops at **column specifications**.
> No migration files or runnable SQL are produced in this phase.

---

## 6. Readiness score

| Dimension | Score | Basis |
|---|---|---|
| Drift identification completeness | 10/10 | All `bookings`/`reviews` Supabase paths traced; breaking columns confirmed by live `400`s. |
| Fix safety (additive, reversible) | 9/10 | Pure column adds with safe defaults on low/zero-volume tables; trivial rollback (`DROP COLUMN`). |
| Current live data-integrity health | 2/10 | Admin status changes & all review writes silently fail to persist today. |
| Blocking dependencies cleared for Phase 6A RLS | 7/10 | After fix, `booking_reference` (+ optional `customer_email`) and a working approval path unblock isolation. |
| Effort / blast radius | 9/10 | 2 tables, ≤3 columns + 1 trigger; no code change required for the safest path. |

### **Remediation-plan readiness: 88 / 100 — READY TO REMEDIATE (fixes not yet applied)**

- The plan is complete, the fixes are additive and low-risk, and the sequence is
  clear. **The live schema itself is currently NOT production-correct** (silent
  write failures) until these adds are applied.
- Recommended next step (separate, approved remediation phase): execute §5 in
  staging, starting with `reviews`. Do **not** begin Phase 6A RLS or Phase 6B
  until both tables verify green.

*Analysis only. No code, database, migrations, or SQL were modified or executed. Phase 6B not started.*
