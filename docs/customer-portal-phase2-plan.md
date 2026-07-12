# Customer Portal Phase 2 — Implementation Plan

> **Status:** PLAN. No code written; no production changes. Additive-only.
> **Everything new sits behind `CUSTOMER_PORTAL_V2_ENABLED`** — OFF ⇒ the current portal is byte-for-byte unchanged.
> **Context:** forward-looking (no Curama migration; `bookings` is near-empty — no backfill work). Phase 1 profile endpoints are deployed. **Messaging already exists** and is reused, not rebuilt.
> **Guardrails:** no changes to Booking Engine, slot-lock, `create-booking.php`, or the existing booking flow. Mobile-first (equal-or-better than desktop).

---

## 0. What already exists (build on it — don't duplicate)

| Need | Already have | Phase 2 use |
|---|---|---|
| Profile summary data | `GET customer-profile.php?email=&reference=` (Phase 1, live) | Section 1 |
| Booking history (paginated, newest-first) | `GET customer-bookings.php?email=&reference=&page=&per=` (Phase 1, live) | Section 2 |
| Full booking record (from/to/service/time via notes) | `GET get-booking.php?ref=` | Section 3 |
| Customer↔admin messaging | `chat.php?action=list|send` on **`inbox_messages`** (`thread_id='chat:<bookingId>'`) + `js/portal/chat.js` + `チャット` nav | Section 5 (surface/enhance) |
| Session + host page + card/badge styles | `PortalAuth` (`hm_portal_sess`), `portal.html` (`.dcard`, `.p-nav-item`, timeline) | all sections |

**Net-new required:** the V2 UI layer (one JS module + styles + a small `portal.html` hook), a client flag, and — for Section 4 only — a `customer-rebook.php` endpoint (from the approved Phase-1 design). **No new database tables.**

---

## Deliverable 1 — Portal UI implementation plan (Sections 1–6)

All V2 UI lives in a **new** `js/portal/portalV2.js` that renders into the existing `#content`/`overview` view **only when `window.CUSTOMER_PORTAL_V2_ENABLED === true`**. Reuses `.dcard`, badges, `.p-nav-item`, timeline styles. Ownership is the current session's `email` + a stored `reference` (from `PortalAuth.getSession()`), passed to the Phase-1 endpoints.

- **§1 Summary card** — top of `overview`. Fields: Customer Name, Email, Total Bookings, Last Moving Date, Current Active Booking Status — sourced from `customer-profile.php` (`name/email/total_bookings/last_booking_date/current_status`). Japanese-minimalist, mobile-first (full-width stacked ≤768px), matches `.dcard` language.
- **§2 「ご利用履歴」** — paginated, newest-first, from `customer-bookings.php`. **Responsive: table on desktop, stacked cards on mobile.** Columns: Booking Reference, Moving Date, Service Type, Status, Created Date. **Status badge map** (endpoint returns raw DB status → UI maps): `pending→新規`, `confirmed→確定`, `completed→完了`, `cancelled→キャンセル` (+`checking→確認中`). Pager calls `?page=`.
- **§3 Booking details modal** — opened from a history row's Reference. `get-booking.php?ref=` → unpack notes → show Reference, Customer Info, From/To Address, Moving Date, Time Band, Service Type, Notes, and a client-side **Status Timeline** (same technique the current dashboard already uses). Curama-order-details styling.
- **§4 Rebook 「同じ内容で再予約」** — button per history row. Clones service/from/to/inventory from the source booking, prefills the **existing** quote/booking form (via the current post-booking `sessionStorage` handoff), customer picks a **new date**, creates a **new** booking draft. **Original booking untouched.** Uses `customer-rebook.php` (Deliverable 2) — the Booking Engine/slot-lock run unchanged (a rebook is just another booking).
- **§5 「メッセージ」** — **reuse `chat.php` + `js/portal/chat.js`**. V2 surfaces the existing thread (history, new-message form, attachments) and adds an **unread-count badge** (count inbound unread rows in the thread via `chat.php?action=list`). No new backend.
- **§6 Flag** — `CUSTOMER_PORTAL_V2_ENABLED`; see Deliverable 4/5.

---

## Deliverable 2 — Required API endpoints

| Endpoint | Status | Section | Notes |
|---|---|---|---|
| `GET customer-profile.php` | **exists** (Phase 1) | §1 | ownership-verified |
| `GET customer-bookings.php` | **exists** (Phase 1) | §2 | paginated, newest-first |
| `GET get-booking.php?ref=` | **exists** | §3 | full row; client unpacks notes |
| `chat.php?action=list|send` | **exists** | §5 | on `inbox_messages`; **this IS the "messages.php"** |
| `POST customer-rebook.php` | **NEW** (design ready) | §4 | verify ownership of customer + source_ref → clone details → new booking via existing pipeline → return new `ref`. Does not modify the source. |

**Section-5 `messages.php` specification (satisfied by the existing `chat.php`):**
```
GET  chat.php?action=list&booking=<bookingId>   (api-key; scoped to thread 'chat:<bookingId>')
       → { ok, data:{ messages:[ {id, direction:in|out, body, created_at, read, attachments[]} ], unread } }
POST chat.php?action=send   body:{ booking, body, attachments? }
       → { ok, data:{ id } }
```
Recommendation: **do not build a parallel `messages.php`** — reuse `chat.php`. If a name alias is desired, add a thin `messages.php` that `require`s `chat.php` logic (optional, cosmetic).

---

## Deliverable 3 — Required MySQL tables

**No new tables.** All reads/writes use existing tables:
- `customer_profiles` — exists (Phase 1).
- `bookings` — exists, **unchanged** (rebook inserts via the existing path).
- `inbox_messages` — exists; **it is the messaging store** (Section 5). The requested "inbox table schema proposal" is therefore already satisfied by `inbox_messages` (`id, thread_id, booking_id, direction/sender, body/body_text, is_read, created_at, …`); a chat room = all rows with `thread_id='chat:<bookingId>'`; **unread** = inbound rows where `is_read=0`.

---

## Deliverable 4 — File-by-file change list

| File | Change | Type |
|---|---|---|
| `js/portal/portalV2.js` | **NEW** — renders §1–§4 when flag ON; consumes profile/bookings/get-booking; wires rebook + details modal | additive |
| `css/portal-v2.css` | **NEW** — additive styles (summary card, history table/cards, details modal); reuses existing vars | additive |
| `portal.html` | **Minimal hook**: one `<script src="js/portal/portalV2.js">` + `<link>` + a guarded `if (window.CUSTOMER_PORTAL_V2_ENABLED) PortalV2.init(session)` call. No existing markup/logic changed. | additive (core file — sign-off) |
| `js/config/portalFlags.js` | **NEW** — sets `window.CUSTOMER_PORTAL_V2_ENABLED` (default **false**); committed, versioned kill switch | additive |
| `hm-api/customer-rebook.php` | **NEW** (Section-4 sub-phase) — rebook endpoint | additive |
| ~~`hm-api/messages.php`~~ | **not built** — V2 calls the existing `chat.php` directly | — |
| `sw.js` | add `portalV2.js` + `portal-v2.css` to PRECACHE | additive |

**Untouched (asserted):** `create-booking.php`, `rest.php`, `booking_slots`/slot-lock, `bookingService.js` create path, admin files, existing `portal.html` views.

---

## Deliverable 5 — Rollback plan

- **Instant kill switch:** `CUSTOMER_PORTAL_V2_ENABLED = false` → the V2 layer never initializes → **existing portal exactly as before**. First and safest rollback.
- **Full removal:** delete `portalV2.js` + `portal-v2.css`, revert the small `portal.html` hook, remove the flag line, drop `customer-rebook.php`.
- **No DB rollback needed** — no new tables/columns; `bookings`/`inbox_messages` untouched structurally.
- **Zero booking risk** — Booking Engine, slot-lock, and `create-booking.php` are never modified; rebook rides the existing pipeline, so disabling V2 can't affect bookings.

---

## Deliverable 6 — Deployment order

1. **Ship dark:** `portalV2.js` + `portal-v2.css` + `portal.html` hook + flag **OFF**. Deploy. **Verify the existing portal is unchanged** (flag off = no V2 code path).
2. **Read-only sections first:** enable the flag in a controlled session; verify **§1 summary**, **§2 history**, **§3 details** against a real/test booking (these only read Phase-1/`get-booking` endpoints — no writes).
3. **Messaging (§5):** surface the existing `chat.php` thread + unread badge under the flag; verify against a booking with messages.
4. **Rebook (§4):** deploy `customer-rebook.php`; wire the button; verify a rebook creates a **new** draft and leaves the source untouched (Booking Engine/slot-lock unchanged).
5. **Enable broadly** once §1–§5 verified; keep the flag as the standing kill switch.

---

## Decisions (resolved)
1. **Rebook prefill → existing BA-overlay handoff.** The portal writes the cloned booking data to `sessionStorage` and navigates to `index.html` (the booking form), which opens the BA overlay **prefilled** — the same handoff pattern already used by the post-booking CTA / `login.html?ref=`. The source booking is untouched, and the Booking Engine / slot-lock / `create-booking.php` stay unmodified (a rebook just enters the normal flow with a new date). **No portal-local booking form.**
2. **Endpoint ownership `reference` → available from the session (confirmed).** `PortalAuth.getSession()` returns `{ ref, email, name, token, … }` (`js/portal/portalAuth.js:128-131,193`), so V2 calls `customer-profile.php` / `customer-bookings.php` with the session's `email` + `ref` — **no re-login required**.
3. **Flag home → committed `js/config/portalFlags.js`, default `false`.** A versioned, default-safe kill switch (not deploy-injected-only); an optional env/deploy override can force it on per environment.
4. **Messaging → call `chat.php` directly (no `messages.php`).** V2 reuses the existing `chat.php?action=list|send` + `inbox_messages`; **no parallel endpoint or alias is built.**

---

*Plan only — nothing built or deployed. All new functionality will be additive and behind `CUSTOMER_PORTAL_V2_ENABLED`.*
