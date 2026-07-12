# Customer Profile System — Design

> **Status:** DESIGN ONLY. No code, no DB changes, no production changes made.
> **Gated on:** (1) 409 validation reaching **10/10**, and (2) your approval of this design.
> **Guardrails honored:** additive only · no changes to the Booking Engine, slot-lock, or admin workflows · reuse the existing PortalAuth session · MySQL + `hm-api/` (no Supabase/external backend) · backward-compatible.

---

## 0. Grounding (what already exists — we build on it)

| Existing piece | Reuse |
|---|---|
| `bookings` table (`customer_email`, `booking_date`, `service_id`, `status`, `notes`[HM_EXTRAS], …) | source of truth for history + profile stats |
| `get-booking.php?email=<e>` → `BookingService.getBookingsByEmail` | Phase 2 history list (already returns a customer's bookings, newest-first) |
| `hm-api/auth.php` (verifies email+reference against bookings) | the ownership-verification primitive we reuse per request |
| `PortalAuth` (`hm_portal_sess` token) + `portal.html` | session + host page for the new UI sections |
| `_lib.php` (`hm_json/hm_ok/hm_err`, `hm_body`, `hm_uuid4`, `hm_require_api_key`, `hm_rate_limit`) | endpoint plumbing + envelope `{ok,data,error}` |
| `_config.example.php`, migrate/backfill script pattern | schema + migration |

**Note on "Price":** `bookings` has **no price column**. Price is not stored per booking today (it's derived from pricing config). Phase 2's "Price (if available)" will therefore show a value only if we later add a `price` column or resolve it from pricing config — flagged as an open item (§7), not assumed.

---

## 1. Database schema (Deliverable 1)

New table only — `bookings` is untouched.

```sql
CREATE TABLE IF NOT EXISTS customer_profiles (
  id                  CHAR(36)     NOT NULL,
  customer_email      VARCHAR(255) NOT NULL,
  customer_name       TEXT,
  customer_phone      VARCHAR(60),
  total_bookings      INT          NOT NULL DEFAULT 0,
  first_booking_date  VARCHAR(40),
  last_booking_date   VARCHAR(40),
  notes               TEXT,
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY customer_email_unique (customer_email),
  KEY profile_last_booking_idx (last_booking_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```
- `customer_email` normalized to **lower-case** on write (matches `getBookingsByEmail`'s `LOWER(...)`).
- Logical link to `bookings` via email (no FK — matches house style).

### 1.1 Auto-create / auto-update — three options (recommend hybrid)

"Create a profile when a booking is created" + "update stats after every booking" **without modifying Booking Engine logic**:

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. DB triggers (real-time)** | `AFTER INSERT/UPDATE/DELETE ON bookings` → upsert profile, recompute `total_bookings` (count non-cancelled), `first/last_booking_date` (MIN/MAX), name/phone (latest). | Zero PHP change → truly additive; always in sync. | Requires `TRIGGER` privilege (some cPanel plans restrict it). |
| **B. Lazy compute-on-read** | `customer-profile.php` recomputes stats from `bookings` on each read; stored columns are a cache. | No trigger; always accurate; simplest rollback. | Stored stats can lag until read/reconciled. |
| **C. Reconciliation script** | `customer-profile-sync.php` (cron/backfill) recomputes all profiles. | Backfills history; no trigger. | Not real-time. |

**Recommended hybrid:** **B (authoritative on read) + C (periodic + one-time backfill)**, with **A as an optional upgrade** if trigger privilege exists. This keeps the Booking Engine 100% untouched (no `create-booking.php`/`rest.php` edits) and the profile always correct because reads recompute. Trigger DDL is provided but optional.

*(Trigger DDL, recompute SQL, and the sync script are specified in Appendix A.)*

---

## 2. API design (Deliverable 2)

Three new read/act endpoints under `hm-api/`, JSON, standard `{ok,data,error}` envelope, `hm_require_api_key` + `hm_rate_limit`, prepared statements, `hm_safe_msg` (never leak SQL).

### Ownership model (the security core — see §6)
The portal session token is **client-side** and not server-verifiable per request. So every endpoint re-verifies ownership the same way `auth.php` does: the caller must present a valid **`email` + `reference`** pair, which the endpoint checks against `bookings` server-side before returning **only that email's** data. No email → no data; wrong pair → generic 404 (anti-enumeration).

### 2.1 `GET /hm-api/customer-profile.php?email=<e>&reference=<HM-xxx>`
Verify (email,reference) → 200 `{ ok:true, data:{ email, name, phone, total_bookings, first_booking_date, last_booking_date, favorite_service, current_status } }`.
`favorite_service` = mode of `service` across the customer's bookings; `current_status` = status of the most recent active booking. (Phase 4 dashboard card consumes this.)

### 2.2 `GET /hm-api/customer-bookings.php?email=<e>&reference=<HM-xxx>&page=<n>&per=<10>`
Verify → 200 `{ ok:true, data:{ items:[ {ref, date, service, status, price?} ], page, per, total } }`. Newest-first; server-side pagination (`LIMIT/OFFSET`). (Phase 2 history consumes this. This is a superset of the existing `get-booking.php?email=` with pagination + shaping.)

### 2.3 `POST /hm-api/customer-rebook.php`
Body `{ email, reference, source_ref, new_date }`. Verify ownership of **both** the customer and `source_ref` → load the source booking → copy `service`, `from/to` addresses, inventory `items`, `locmode` from its `[HM_EXTRAS]` → build a NEW booking row with `booking_date = new_date` → **delegate creation to the existing booking pipeline** (calls the current create path; does **not** reimplement or modify it) → return the new `{ref}`. The Booking Engine + slot-lock apply unchanged (a rebook is just another booking).

---

## 3. Portal UI (Deliverable 3) — additive sections in `portal.html`

All additive; existing dashboard/cards/timeline untouched. Visual style reuses `.dcard`, `.panel`, badges, and the portal grid.

- **Phase 4 — Summary card** (top of dashboard): 「これまでのご利用」 with **総利用回数 / 最終利用日 / よく使うサービス / 現在の予約状況**, sourced from `customer-profile.php`.
- **Phase 2 — 「ご利用履歴」 section**: table/list of past bookings (Booking Reference · Moving Date · Service · Status · Price if available), **newest-first**, **paginated** (client controls calling `customer-bookings.php?page=`). Reuses existing status-badge styles.
- **Phase 3 — 「同じ内容で再予約」 button** on each history row: calls `customer-rebook.php`'s pre-fill (copies service/addresses/inventory) and hands off to the **existing** booking form (via the current `sessionStorage` handoff pattern used by the post-booking CTA) so the customer only picks a **new date**. No change to the booking form logic itself.
- Behind a small UI flag (`window.HM_CUSTOMER_PROFILE`) so it can ship dark and be enabled per-rollout.

---

## 4. Migration strategy (Deliverable 4)

Staged, each step independently deployable + reversible:
1. **M1 — schema:** `customer_profiles.schema.sql` + idempotent `CREATE TABLE IF NOT EXISTS`. Additive; nothing reads it yet.
2. **M2 — backfill:** `customer-profile-backfill.php` (token-gated, idempotent, dry-run default — same pattern as `backfill-slots.php`): builds one profile per distinct `customer_email` in `bookings`, computing `total_bookings`/`first`/`last`/name/phone.
3. **M3 — read endpoints:** deploy `customer-profile.php` + `customer-bookings.php` (read-only; no writes). Verify via `curl`.
4. **M4 — UI (flagged OFF):** add the portal sections behind `HM_CUSTOMER_PROFILE`; enable after read endpoints verified.
5. **M5 — rebook:** deploy `customer-rebook.php`; wire the button.
6. **M6 — (optional) triggers/sync:** install trigger *or* schedule the reconciliation script.

---

## 5. Rollback strategy (Deliverable 5)

- **Per stage, reversible:** M6 → `DROP TRIGGER`/unschedule; M5/M3 → delete endpoint files; M4 → flip `HM_CUSTOMER_PROFILE` off; M2 → data-only (safe to re-run/clear); M1 → `DROP TABLE customer_profiles`.
- **No booking impact ever:** `bookings` is never altered; the Booking Engine has no dependency on `customer_profiles`, so any rollback leaves bookings/portal fully functional.
- **Graceful degradation:** if a `customer-*` endpoint is unreachable, the portal falls back to the existing `get-booking.php`-based view (history still works via the current path).

---

## 6. Security review (Deliverable 6)

- **Ownership on every request:** each endpoint re-verifies `(email, reference)` against `bookings` server-side before returning data, scoped to that `email` only (reuses `auth.php`'s proven check). A caller cannot read another customer's data without possessing a valid email+reference pair for them.
- **No enumeration / no leak:** generic 404 for both "not found" and "mismatch" (as `auth.php` does); responses contain only the authenticated customer's rows; `hm_safe_msg` hides SQL.
- **Rate limiting + api-key gate** on all three endpoints; prepared statements throughout.
- **Rebook authorization:** validates ownership of both the customer **and** `source_ref` before copying anything; the new booking runs through the unchanged pipeline (slot-lock still applies).
- **⚠ Known limitation (must acknowledge):** the portal session token (`hm_portal_sess`) is **client-side and not server-verifiable per request** — this is the same Phase 6A "app-layer RLS only" gap noted across the project. The email+reference re-verification is the pragmatic enforcement within the current auth model; a **future** hardening is a signed/server-verified session so endpoints don't need the reference each call. Flagged as an open item, not silently assumed solved.

---

## 7. Decisions (confirmed) & remaining open items

**Confirmed:**
1. **Profile statistics — Hybrid, lazy-compute first.** Start with **Option B** (authoritative compute-on-read; stored columns as cache) + **C** (reconciliation/backfill). **No DB trigger initially** — trigger optimization (Option A) may be added later as a real-time upgrade. Booking Engine stays 100% untouched.
2. **Prices — excluded for now.** `bookings` has no per-booking price; the history/UI will **omit price** (no `price` column added, no derivation) until a pricing model is decided later.
3. **Ownership — existing auth + email/reference re-verification.** Every `customer-*` request re-verifies `(email, reference)` against `bookings` server-side (reusing `auth.php`), scoping data to that email. The client-side-session limitation is documented (§6) and deferred as future hardening.

**Still open (minor, resolve at Phase 3):**
4. **Rebook handoff target** — reuse the existing booking-form/BA-overlay handoff (keeps the booking flow unmodified — recommended) vs. a portal-local mini-form.

---

## 8. Phase → deliverable map & gating
| Phase | Work | Ships in |
|---|---|---|
| P1 Foundation | `customer_profiles` + backfill + (opt) trigger | M1–M2, M6 |
| P2 History | `customer-bookings.php` + portal 「ご利用履歴」 | M3, M4 |
| P3 Rebooking | `customer-rebook.php` + button | M5 |
| P4 Dashboard | summary card from `customer-profile.php` | M3, M4 |
| P5 Endpoints | the 3 `.php` endpoints | M3, M5 |

**Gate:** implementation of any of the above begins only after (1) 409 validation = **10/10** and (2) sign-off on this design + the §7 open items.

---

*Appendix A (trigger DDL, recompute SQL, sync/backfill script specs) to be attached on approval. Design only — nothing built, no DB or production changes, `slot_lock_enabled` untouched.*
