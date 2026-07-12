# BA Overlay Prefill API — Design Proposal

> **Status:** PROPOSAL. Nothing implemented. Design only.
> **Goal:** let Customer Portal **Rebook** prefill the existing BA booking overlay with **Service, From Address, To Address, Notes, Inventory** — so a returning customer only picks a new date and submits.
> **Hard constraints honored:** no Booking Engine changes · no `create-booking.php` changes · no slot-lock changes · no pricing changes · no validation changes. **UI-state prefill only** — the existing submit path, validation, pricing, and slot-lock all run **unchanged**.

---

## 0. Why this is needed (current state)

The live overlay exposes only `window.openBookingApp(serviceName)`, which deep-links the **service**. The overlay's state object `baState` is **module-scoped** (`var baState` inside the overlay IIFE, `index.html:3049`) — not reachable externally — and the legacy `hm_booking`/`BS` form is **dead** ("do NOT revive"). So today Rebook (Step 4) can carry `from/to/notes/inventory` in `sessionStorage['hm_rebook_prefill']` but **cannot apply** them. This proposal adds a **single, additive, read-in prefill surface** on the overlay.

Observed `baState` fields (to confirm against `baBlankState()` at build time): `service, serviceId, fromAddr, fromFloor, fromEv, toAddr, toFloor, toEv, notes, furniture[], disposal[], name, email, phone`.

---

## 1. Proposed API shape

A **new, optional, backward-compatible** prefill entry — two equivalent options; **Option A recommended**.

### Option A (recommended) — dedicated public method
```js
// Exposed alongside window.openBookingApp / window.closeBookingApp,
// from INSIDE the overlay IIFE (the only place with baState access).
window.baPrefill = function (payload) { … };   // populates baState + DOM, no submit
```
Caller (rebook-receiver.js):
```js
window.openBookingApp(payload.service);   // existing — opens + service deep-link
window.baPrefill(payload);                // new — fills the rest
```

### Option B — extend the existing entry (one call)
```js
window.openBookingApp(serviceName, prefill /* optional */);
// prefill === undefined ⇒ byte-for-byte current behavior (backward compatible)
```

### Payload (matches the Rebook `hm_rebook_prefill` object + baState)
```jsonc
{
  "service":  "単身引越し",           // already handled by openBookingApp
  "fromAddr": "東京都新宿区…",
  "fromFloor": "3", "fromEv": "有",   // optional
  "toAddr":   "東京都渋谷区…",
  "toFloor":  "2", "toEv":  "無",     // optional
  "notes":    "エレベーターなし",
  "furniture": ["sofa","bed","fridge"],   // inventory → baState.furniture[] values
  "disposal":  ["old-sofa"]               // inventory → baState.disposal[] values
}
```

### What `baPrefill` does (and does NOT)
- **Does:** set `baState.fromAddr/toAddr/floors/ev/notes/furniture/disposal`, then reflect into the DOM the overlay already owns — from/to drawer inputs, `#ba-notes` textarea, and the `furniture[]`/`disposal[]` checkboxes — and refresh the review row rendering the overlay already uses.
- **Does NOT:** submit, call `BookingService.createBooking`, touch `create-booking.php`, compute pricing, run or alter validation, or set the **date** (customer must choose a new one). Existing submit-time validation runs unchanged against the prefilled fields.

**Inventory mapping caveat (call out at build):** `furniture[]`/`disposal[]` are checkbox **value** sets; the source booking's inventory must map to those exact option values (from `hm_booking_config`). Unknown/renamed items are skipped (never error). If the source has no structured inventory, `furniture/disposal` are simply omitted.

---

## 2. Data flow diagram

```
Customer Portal (portal.html, PortalV2)
  予約詳細 modal ──[click 同じ内容で再予約]──▶ build payload
        (service, from, to, notes, furniture, disposal — NO ref/status/created/ids)
                    │
                    ▼  sessionStorage['hm_rebook_prefill'] = payload
             navigate → index.html
                    │
                    ▼
  index.html · js/rebook-receiver.js (additive, no-op if no payload)
     read + consume payload
        ├─▶ window.openBookingApp(payload.service)      // existing: open + service
        └─▶ window.baPrefill(payload)                    // NEW: fill from/to/notes/inventory
                    │
                    ▼
  BA overlay (baState + DOM populated) ── customer picks NEW date ──▶ submit
                    │
                    ▼
  EXISTING submit path (unchanged): validation → BookingService.createBooking
                    → create-booking.php / rest.php → slot-lock (all untouched)
```
No write occurs until the customer submits. The original booking is never modified.

---

## 3. Files impacted

| File | Change | Nature |
|---|---|---|
| `index.html` | **+** `baPrefill` (or optional `openBookingApp` param) inside the overlay IIFE, exposing `window.baPrefill`; reuses the overlay's existing setters (e.g. the drawer-save that already sets `baState.fromAddr`). ~20–35 additive lines. | **only locked-file change** — UI-state population, no booking logic |
| `js/rebook-receiver.js` | **+** one line: call `window.baPrefill(payload)` after `openBookingApp(service)`. Guarded by `typeof window.baPrefill === 'function'`. | additive |
| `js/portal/portalV2.js` | (optional) map the source booking's inventory into `furniture[]`/`disposal[]` in the rebook payload, if not already structured. | additive |
| **Untouched** | `create-booking.php`, `rest.php`, `bookingService.js` create path, slot-lock/`booking_slots`, pricing config, validation logic | — |

---

## 4. Rollback plan

- **Feature-gated by nature:** `baPrefill` only runs when the receiver finds a `hm_rebook_prefill` payload (which only exists when a portal rebook was initiated). No payload ⇒ zero effect on `index.html`.
- **Instant disable:** `CUSTOMER_PORTAL_V2_ENABLED=false` stops the portal ever writing a payload → `baPrefill` is never invoked.
- **Full removal:** delete the `baPrefill` block + its `window.baPrefill` exposure from `index.html`, and revert the one line in `rebook-receiver.js` (back to service-only). The overlay returns to exactly today's behavior.
- **No data/DB/booking-engine impact** — nothing persistent is created; prefill is transient UI state discarded on overlay close.

---

## 5. Arch-lock impact assessment

`tests/architecture-lock.test.js` (20 checks) guards: no Formspree; hero quote form stays removed; **single** booking pipeline; the runtime guard wraps `BookingService.createBooking` + sets lock flags; the guard does **not** override global `fetch`/`XHR`; service cards route into `openBookingApp()`; API origin consistency.

**Assessment — LOW risk:**
- `baPrefill` **does not** create a booking, call/wrap `BookingService.createBooking`, add Formspree, override `fetch`/`XHR`, or add a second booking entry — it fills the **existing** overlay via the sanctioned `openBookingApp` and `baState`.
- It **must not** reintroduce any `bk*`/hero-quote-form pattern (those are what arch-lock forbids); the implementation uses `baState` (the live overlay), never the dead legacy form.
- Precedent: the Step-4 `index.html` `<script>` include for `rebook-receiver.js` already passed arch-lock **20/20**.
- **Required gate:** run `npm run test:arch` after implementation; expect **20/20**. No new arch-lock assertion is needed (prefill is UI-only), though an optional guard ("`baPrefill` never calls createBooking/submit") could be added for durability.

---

## Open items to confirm at build (not decisions for this proposal)
1. Exact `baState` shape via `baBlankState()` (field names for floors/EV/inventory).
2. Inventory value-mapping between stored bookings and `hm_booking_config` `furniture[]`/`disposal[]` options.
3. Option A (`window.baPrefill`) vs Option B (optional `openBookingApp` param) — recommend A (leaves `openBookingApp` signature untouched).
4. Sign-off required: this edits the **locked** `index.html` booking overlay (additive, UI-only).

*Proposal only — no code, no overlay changes, no deployment.*
