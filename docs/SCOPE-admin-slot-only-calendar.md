# SCOPE — Admin Slot-Only Availability UI Redesign

Branch: `feat/admin-slot-only-calendar` · Base: `main` · Status: **SCOPE / not implemented**

> This document is a scope + design plan only. No production code is changed on this
> branch yet. Implementation begins after sign-off on the Open Decisions below.

---

## 1. Goal

Make admin availability management **slot-based only** (Morning / Afternoon / Evening /
Night), and retire the day-level ○△× "Calendar Block" UI as a *management* tool. The
booking engine already runs on `slot_capacity`; this aligns the admin UI to that reality
so admins stop managing a day-level abstraction that no longer maps 1:1 to how bookings
are actually gated.

### Non-goals (explicitly out of scope)
- No change to the booking engine, `slot-capacity.php` write actions, `availability.php`,
  `create-booking.php`, `booking-status.php`, or `reschedule.php` **contracts**.
- No change to the public customer booking flow or the Ops calendar (already slot/DnD).
- `calendar_availability` stays as the display-only marketing/stats cache (per prior decision).
- No removal of Google Calendar sync.

---

## 2. Current state (what exists today)

| Surface | File(s) | Role |
|---|---|---|
| `#view-calendar` — ○△× month grid | `admin.html:1085-1121`, `js/modules/calendar/calendar.js`, `CalendarService` in `admin-bookings.js:11-147` | Day-level open/close. Click = `close-day`/`reopen-day` (engine-backed). △ = informational booking-count threshold. Hosts bulk day-select + `#gcalPanel`. **This is the "old Calendar Block".** |
| `#view-capacity` — day count model | `admin.html:1161-1195`, `js/modules/capacity/capacity.js` | Legacy `{max, limited}` per-day count thresholds → drives the △/× *display* heuristic. Not the engine's authority. |
| `#view-capacity` — 時間帯別キャパシティ | `js/modules/capacity/slotCapacity.js` | **The real slot model.** Per-band Open/Closed + capacity ± + used/remaining, single date + optional date range, all via `slot-capacity.php`. Engine-backed, already production. |

The redesign **promotes `slotCapacity.js`'s model into a month view** and **demotes the
○△× grid** to a read-only status display (or removes it), so managing availability means
managing slots.

---

## 3. Target design

**One availability view** driven by slots:

1. **Slot-aware month calendar.** Each day cell shows a compact 4-band strip
   (AM/PM/EV/NT) coloured by state: open · limited · full · closed. Day is "fully closed"
   only when all four bands are closed (matches `hm_cap_day_closed`).
2. **Click a day → per-band editor** (the existing `slotCapacity.js` table: toggle
   open/close per band, capacity ±, whole-day close/reopen, optional multi-day range).
   Reused as-is — it's already the single source of truth.
3. **Bulk / multi-day** stays (already supported by `close-day`/`reopen-day` `to=` range).
4. **Legend/PDF/print** updated to slot semantics.
5. **○△× retired as a control**; optionally kept as a tiny per-day roll-up glyph for
   at-a-glance scanning (derived from band states, not clickable/authoritative).

### Backend addition (additive, backward compatible — the only new endpoint work)
`slot-capacity.php` currently reads a **single** date (`action=get`) or **fully-closed**
days in a range (`action=closed-days`). A slot-aware month grid needs **per-band status
for every day of the visible month** (to colour partial closures). Add one read action:

- `action=month-status&from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ ok, days: { 'YYYY-MM-DD':
  { am:{status,capacity,used,remaining,closed}, pm:{…}, ev:{…}, nt:{…} } } }`, span-capped
  like `closed-days` (≤366d). Read-only, no write-path change, no contract break to
  existing actions. (Alternative: reuse `closed-days` + N per-day `get` calls — rejected:
  N fetches per month is slow and still misses partial-closure colouring.)

---

## 4. File-by-file change plan

**Modified (core surface — needs sign-off per CLAUDE.md Core Rule):**
- `admin.html` — replace `#view-calendar` inner markup (○△× controls/legend) with the
  slot-aware month grid host + day-editor mount point. Keep `#gcalPanel`. Nav label may
  change カレンダー → 空き枠管理.
- `styles.css` (or a new `css/admin-slot-calendar.css`, **preferred** to avoid touching
  the locked `styles.css`) — band-strip cell styles.

**New:**
- `js/modules/calendar/slotCalendar.js` — the month grid renderer + day-click → mounts
  `SlotCapacity` editor for the clicked date; reads `month-status`.
- `css/admin-slot-calendar.css` — scoped styles (mirrors the self-injecting pattern).

**Refactored / demoted (not deleted — backward compat):**
- `js/modules/calendar/calendar.js` — ○△× `renderCalendar`/`calClick` retired from the
  interactive path; `printCalendar` re-pointed to slot semantics. Kept exported until the
  new view is verified, then dead paths removed in a final cleanup commit.
- `CalendarService` (admin-bookings.js) — `getAvailability`/`syncDayClosure` kept (still
  used by dashboards/stats); no longer the primary editor path.
- `js/modules/capacity/slotCapacity.js` — extract its per-band `_render`/`_post` so the
  new day-editor can reuse it without duplicating (small internal refactor; public
  `SlotCapacity.mount/reload` API preserved).

**Backend (additive only):**
- `hm-api/slot-capacity.php` — add `month-status` read action (+ `_capacity.php` helper
  `hm_cap_month(...)`). No change to existing actions.

**Tests (new):**
- `tests/slot-calendar.verify.js` — month grid derives correct day state from band data;
  fully-closed vs partial vs open; `month-status` shape.
- Extend `tests/architecture-lock.test.js` if we add a guard that the ○△× manual toggle
  is gone from admin.

---

## 5. Backward compatibility & risk

- **Engine untouched** → existing bookings, availability, confirm, reschedule all behave
  identically. Zero data migration.
- `slot_capacity` rows written by today's ○△× `close-day` are the SAME rows the new UI
  reads — existing closures carry over verbatim.
- The legacy `{max,limited}` day-count model stays for the △/× *display* heuristic and
  dashboard stats (not ripped out); we just stop presenting it as the management surface.
- **Primary risk:** editing `admin.html` (locked core surface) — mitigated by keeping the
  change confined to the `#view-calendar` block, new CSS/JS in new files, and a feature
  flag (`hm_admin_slot_ui`) to fall back to the ○△× grid during validation.

---

## 6. Phased implementation (each phase independently shippable)

1. **P1 — Backend read.** Add `month-status` action + `hm_cap_month` + test. (No UI.)
2. **P2 — Slot month grid (read-only).** New `slotCalendar.js` + CSS renders the band
   strip from `month-status`, behind `hm_admin_slot_ui` flag; ○△× still default.
3. **P3 — Day editor wiring.** Click day → mount `SlotCapacity` editor for that date.
4. **P4 — Promote + demote.** Flip the flag default; retire ○△× interactive path; update
   legend/PDF/print/nav label.
5. **P5 — Cleanup.** Remove dead ○△× manual-toggle code; arch-lock guard; docs.

---

## 7. Open decisions (need sign-off before P1)

- **D1. One view or two?** Merge `#view-calendar` + `#view-capacity` into a single
  「空き枠管理」view (recommended — one place for availability), or keep two nav entries.
- **D2. Keep ○△× as a non-clickable per-day roll-up glyph** for scanning (recommended),
  or remove all ○△× from admin entirely.
- **D3. Legacy `{max,limited}` day-count settings** — keep (drives display heuristic +
  stats; recommended) or retire the settings panel too.
- **D4. Feature flag** `hm_admin_slot_ui` for staged rollout (recommended) or hard cut-over.

---

## 8. Estimate

~5 focused commits (one per phase). Backend P1 is small and low-risk; the weight is P2–P4
(admin UI). No engine risk. PR stays reviewable because each phase is isolated and the
flag lets the old grid remain as an instant fallback until P4.
