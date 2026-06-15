# Phase 5F — Customer Estimate Approval — Report

**Status:** ✅ Complete and validated (21/21 checks pass)
**Date:** 2026-06-16
**Scope:** "Approve Estimate" action in the customer portal (`portal.html`).
No booking-schema change, no CRM/admin workflow change.

---

## Goal

Let a customer approve the estimate on their **own** booking. The action
transitions the booking status from a pre-approval state ("Quote Sent") to an
approved state ("Quote Approved").

---

## Status mapping (schema-preserving)

The booking schema already uses a fixed status vocabulary
(`pending / checking / confirmed / completed / cancelled`, surfaced in Japanese as
`新規 / 確認中 / 確定 / 完了 / キャンセル`). Phase 5F **reuses** these — it adds **no
new status value** and **no new column**:

| Concept in the task | Existing status used | DB value |
|---|---|---|
| **Quote Sent** (awaiting approval) | `新規` or `確認中` | `pending` / `checking` |
| **Quote Approved** | `確定` | `confirmed` |

So "Approve Estimate" performs `確認中 / 新規 → 確定` (`checking/pending → confirmed`).

---

## What was built

| File | Change |
|---|---|
| `bookingService.js` | **+ `approveEstimate(id)`** — mirrors the existing `cancelBooking`: a **targeted single-column** update (`status:'confirmed'`, `updated_at`) on the booking row, guarded to pre-approval states, dispatching a `booking:approved` event. Returns `{ ok, from, to, booking }` or `{ ok:false, reason }`. |
| `js/portal/portalApproval.js` | **New.** `window.PortalApproval` — `canApprove(booking)`, `approve(bookingId)`; on success writes an audit entry to the shared `hm_audit_log`. |
| `portal.html` | New **Approve Estimate** bar in the dashboard overview (shown only when approvable), approval CSS, `handleApprove()` + delegated click handler, `portalApproval.js` include. |
| `approval_test.mjs` | **New.** 21-check Playwright validation. |
| `PHASE_5F_APPROVAL_SYSTEM_REPORT.md` | This report. |

---

## How it works

1. **Button** — on the dashboard, when the booking is in a pre-approval state
   (`新規` / `確認中`), an **お見積もりを承認（Approve Estimate）** bar renders below the
   status cards. For already-approved/finished/cancelled bookings it does not
   appear.
2. **On click** — after a confirm dialog, `PortalApproval.approve()` calls
   `BookingService.approveEstimate()`, which issues a targeted Supabase update
   setting `status = 'confirmed'`. The dashboard re-renders: the bar disappears,
   the 見積もりステータス card shows **確定済み**, and a success note is shown.

---

## Preservation guarantees (per the rules)

- **Preserve booking schema** — only the existing `confirmed` value is written;
  the update touches exactly two fields (`status`, `updated_at`) — verified by
  test ("targeted update only touches status + updated_at"). No column added, no
  enum extended.
- **Preserve CRM workflows** — approval goes through the established
  `BookingService` update path (same mechanism as `cancelBooking`); no
  CRM/quote/admin code was modified. A guard makes the action idempotent
  (already-approved bookings are refused), so it can't regress an admin-set state.
- **Preserve admin operations** — the status write lands in the `bookings` table,
  so the admin panel sees it through its existing Supabase Realtime/sync. No admin
  file was touched.

---

## Validation

Run (dev server on `:5050` required):

```bash
node serve.js          # in one shell
node approval_test.mjs # in another
```

**Result: `21 passed, 0 failed`.** Coverage of the required checks:

- **Status changes correctly** — `approve()` returns `from:'確認中' → to:'確定'`;
  the DB write maps to the existing `confirmed` value; the update is targeted
  (`status` + `updated_at` only) against the `bookings` table by DB id. A guard
  refuses an already-approved booking.
- **Admin panel sees the update** — the status is persisted to the `bookings`
  table via Supabase (the channel the admin already reads through Realtime/sync),
  **and** an audit entry is appended to the shared `hm_audit_log` that surfaces in
  the admin **監査ログ** view.
- **Audit entry created** — an entry is written with `entity:'quote'`,
  `action:'update'`, `actor:'customer:…'`, and a detail recording the transition
  to `確定`.
- Plus: `canApprove` logic across all five statuses, the UI invariant (button
  shown **iff** the booking is pre-approval), and mobile responsiveness.

---

## Notes / out of scope

- The audit entry is written to the same-origin `hm_audit_log` key that the admin
  `AuditLog` module reads, so it appears in 監査ログ alongside admin actions, tagged
  with a `customer:` actor. No server-side audit table was added (none exists for
  this purpose; staying schema-neutral per the rules).
- No Supabase Edge Function, migration, or admin module was modified.
