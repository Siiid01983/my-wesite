# Phase 5B — Customer Dashboard — Report

**Status:** ✅ Complete and validated
**Date:** 2026-06-15
**Scope:** Customer Dashboard inside `portal.html`. No new pages, no schema changes.

---

## Goal

Build the Customer Dashboard inside `portal.html` — a card-based overview of the
authenticated customer's booking, driven entirely by the existing `bookings` table.

---

## What was built

The portal's **ダッシュボード** (overview) view was upgraded from a single info
panel to a five-card dashboard plus a status timeline. All changes are contained
to `portal.html` (CSS + the `overview()` render function and its helpers).

### Dashboard cards

| Card | Label (JP) | Source field(s) | Derivation |
|---|---|---|---|
| **Booking Status** | 予約ステータス | `status` | Status badge (確定/完了 → green) + booking reference |
| **Move Date** | 引越し日 | `booking_date`, `time` | Formatted Japanese date (with weekday) + time band |
| **Assigned Staff** | 担当スタッフ | `workers` (from `notes` extras) | `N名 体制`; falls back to「割り当て準備中」when unset |
| **Quote Status** | 見積もりステータス | `status` | Derived: 新規/確認中 → 確認中, 確定/完了 → 確定済み, キャンセル → キャンセル |
| **Latest Updates** | 最新の更新 | `created_at`, `status` | Status timeline (newest first), current step highlighted |

### Data source

- Reads only the existing `bookings` table via the already-shipped
  `BookingService.getBookingById()` → `_rowToBooking()` mapper.
- No new tables, columns, RLS, or schema changes. The "quote" and "assigned
  staff" cards are **derived** from existing booking fields — no separate quote
  table is touched.

### Design

- Responsive card grid: `repeat(auto-fit, minmax(232px, 1fr))`; Latest Updates
  spans full width. Collapses to a single column ≤560px.
- Matches the established Hello Moving palette (navy/ink), Noto Serif/Sans JP,
  hover-lift cards, monochrome line icons.

---

## Validation results

Automated run against live Supabase (22 real bookings):

**`node dashboard_test.mjs`**

| Check | Result |
|---|---|
| Correct booking loads (`HM-20260613-DASR`, テスト 太郎) | ✅ |
| Customer sees **only their own** booking (session bound to one reference) | ✅ |
| All 5 dashboard cards render (`予約ステータス / 引越し日 / 担当スタッフ / 見積もりステータス / 最新の更新`) | ✅ |
| Latest-Updates timeline renders | ✅ |
| Mobile responsive — single column, drawer burger visible, main margin 0 @375px | ✅ |

**`node portal_test.mjs`** (Phase 5A security suite — regression check)

| Check | Result |
|---|---|
| Login loads / Supabase client ready | ✅ |
| Invalid reference blocked | ✅ |
| Valid reference + wrong email blocked | ✅ |
| Login → portal redirect | ✅ |
| Session persists after refresh | ✅ |
| Portal blocked after logout | ✅ |

No regressions. Access control (email + reference verification, per-fetch
re-verification) is unchanged from Phase 5A — customers can only ever load the
single booking their session is bound to.

---

## Rules honoured

- ❌ Did **not** modify `admin.html`
- ❌ Did **not** modify `websiteManagement.html` / WMC
- ✅ Preserved Supabase structure (no schema / RLS / migration changes)
- ✅ Preserved existing booking schema (read-only via existing mapper)

---

## Files

| File | Change |
|---|---|
| `portal.html` | Dashboard card CSS, `overview()` rewritten as 5-card dashboard + timeline, helper fns (`quoteStatus`, `staffDisplay`, `buildTimeline`, `fmtDateTime`, icons), sidebar label → ダッシュボード, mobile breakpoint for cards |
| `dashboard_test.mjs` | New Playwright validation for the five cards + responsiveness |
| `PHASE_5B_DASHBOARD_REPORT.md` | This report |

No other files were touched.
