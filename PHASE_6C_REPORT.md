# Phase 6C — Customer Self-Service Portal

**Goal:** Let authenticated portal customers act on their own booking — reschedule,
request cancellation, update contact details, upload additional documents/photos,
and track booking progress — **without** schema changes, **without** disturbing the
admin workflows, and **on top of** the Phase 6A authentication and Phase 6B RLS
isolation layers.

**Status:** ✅ Implemented + tested. No schema change, no migration, no breaking
change. Phase 6D not started.

**Date:** 2026-06-17
**Branch:** `phase-5a-customer-portal`

---

## 1. What shipped

| Goal | Where | How |
|---|---|---|
| **Reschedule bookings** | `PortalSelfService.reschedule()` + 予約内容 view | Changes move date/time via the existing `BookingService.updateBooking` path. |
| **Request cancellation** | `PortalSelfService.requestCancellation()` + 予約内容 view | Records a **request** (notes marker + audit) — does **not** change DB status; admin still performs the actual cancel. |
| **Update contact details** | `PortalSelfService.updateContact()` + 予約内容 view | Updates phone/name only. **Email is immutable** (auth identity + RLS WITH CHECK). |
| **Upload additional documents** | `PortalDocs.uploadAttachment()` + ドキュメント view | New customer upload confined to the booking's `attachments/` sub-tree; reuses the existing `media` bucket. |
| **Upload additional photos** | *(already existed — Phase 5E `PortalPhotos`)* | Reused unchanged. |
| **Track booking progress** | New 進捗 view + `PortalSelfService.progressSteps()` | Read-only 4-step tracker (受付→確認中→確定→完了) derived from status, plus the existing timeline. |

### Files

| File | Change |
|---|---|
| `js/portal/portalSelfService.js` | **New** module → `window.PortalSelfService` (reschedule / updateContact / requestCancellation / progressSteps + eligibility predicates). |
| `js/portal/portalDocs.js` | **Extended** (additive): `uploadAttachment()`, `removeAttachment()`, `_inAttachScope()`, `ATTACH_SECTION`, `ATTACH_MAX_BYTES`. Existing read/download API untouched. |
| `portal.html` | Script tag; new 進捗 nav item + view; reschedule/contact/cancel panels in 予約内容; document-upload control; self-service CSS; action handlers + toast. |
| `tests/portalSelfService.test.js` | **New** — 25 deterministic unit tests (Playwright + stubs, offline). |
| `package.json` | Added `test:portal`; included it in `test:all`. |

---

## 2. Preservation guarantees (the Phase 6C rules)

### Schema preserved — zero DB changes
Every write reuses `BookingService.updateBooking`, which already packs non-column
fields (`from`/`to`/`service`/`time`/`items`/`workers`) into `bookings.notes`. No new
column, table, status value, or migration was introduced.
- **Reschedule** → patches `date` (a real column) and `time` (notes extra).
- **Contact** → patches `customer_name` / `customer_phone` (real columns).
- **Cancellation request** → appends a `【キャンセル希望】…` marker to the user notes;
  no new status. The progress/booking UI derives a "申請中" state from that marker
  client-side.
- **Documents** → reuses the `media` bucket under the existing
  `customer-documents/<bookingId>/attachments/` prefix.

### Admin workflows preserved
- Admin reads/writes bookings as role `anon`; none of those policies or paths changed.
- **Cancellation is a request, not an action** — the DB status is untouched, so the
  admin's confirm/complete/cancel workflow and the `autoStatusRules` automation keep
  full control of the real transition. The admin sees the request via the notes
  marker **and** the audit-log entry.
- Reschedule/contact updates flow through the same single-row update the admin uses;
  no other field is disturbed (`updateBooking` merges a minimal patch).

### Phase 6A authentication preserved
- No change to `portalAuth.js` / `portalSupabaseAuth.js`. The actor for audit
  entries is resolved from the verified session via `PortalAuth.getSession()`.
- All actions operate on `PortalAuth.getCurrentBooking()` — the booking resolved from
  the **verified** email, never a client-supplied id.

### Phase 6B RLS isolation preserved
- Every write is an **UPDATE on the customer's own row**. The 6B policy
  `bookings_auth_update_own` enforces `lower(customer_email)=lower(auth.email())` in
  both `USING` and `WITH CHECK`.
- **Email is never updated.** `updateContact` only ever patches `phone`/`name` and
  defensively `delete`s `email`/`id`/`createdAt` from the patch. This is essential:
  changing `customer_email` would violate the `WITH CHECK` predicate (the row would
  no longer match `auth.email()`) and is the user's own login identity. A test asserts
  the patch never contains `email` even when an attacker passes one.
- Audit writes use INSERT only — matching the 6B `audit_auth_insert` policy
  (customers can append, never read the trail).
- Document upload/delete are confined to the booking's own `attachments/` sub-tree
  (storage stays app-enforced + private + signed URLs, consistent with the 6B stance
  that storage isolation remains app-level). Path-traversal and cross-booking paths
  are rejected (tested).

### No breaking changes
- `PortalDocs` additions are new exports; its existing `list`/`getDownloadUrl`
  contract is unchanged, so the current documents view keeps working.
- New UI is additive (one nav item, panels appended to an existing view). Existing
  views (overview, messages, photos, reviews, support) are untouched.
- Uploaded attachments automatically appear in the existing 添付ファイル section and
  Download Center (they live under the path `PortalDocs.list()` already scans).

---

## 3. Reuse of existing services/components

| Reused | For |
|---|---|
| `BookingService.updateBooking` | All three booking mutations (reschedule, contact, cancel-request). |
| `AuditService.record` | Audit trail for every action (admin-visible 監査ログ). |
| `PortalAuth.getCurrentBooking` / `getSession` | Booking resolution + actor labelling. |
| `PortalDocs` (existing bucket/path/scope helpers) | Document upload added inside the same module. |
| `PortalPhotos` (Phase 5E) | Photo upload — reused as-is, no change. |
| Existing portal CSS tokens + panel/skeleton patterns | New panels/stepper match the design system. |

No new dependency, bucket, table, or service was introduced.

---

## 4. UX summary

- **予約内容 (Booking):** below the read-only detail panels, a "予約の管理" section
  shows — gated by status — a **Reschedule** form (date + time, min=today), an
  **Update Contact** form (name + phone; email shown disabled with an explanatory
  hint), and a **Request Cancellation** form (optional reason). After a successful
  action the record refreshes in place and a toast confirms.
- **進捗 (Progress):** a horizontal 4-step tracker (受付 → 確認中 → 確定 → 完了)
  with the current step highlighted; cancelled bookings show a distinct banner; a
  cancellation request shows a "受付けました" notice. Includes the existing timeline.
- **ドキュメント (Documents):** an "書類をアップロード" control; uploads land in the
  customer's attachments folder and immediately appear in the list/Download Center.
- Eligibility: terminal bookings (完了/キャンセル) hide mutating actions; a pending
  cancellation request replaces the cancel form with a status notice and blocks a
  duplicate request.

---

## 5. Tests

`tests/portalSelfService.test.js` — **25 / 25 passing**, deterministic and offline
(Playwright loads the modules onto `about:blank` via `addScriptTag` and stubs
`BookingService` / `AuditService` / Supabase storage; no dev server needed).

```
node --test tests/portalSelfService.test.js   → tests 25 / pass 25 / fail 0
```

Coverage:
- **reschedule** — happy path (date+time, audit recorded), past-date rejected,
  malformed date rejected, terminal status rejected, time-omitted patch shape,
  `updateBooking`→null handling.
- **updateContact** — phone+name patched, **email never patched even when supplied**
  (RLS WITH CHECK guard), invalid phone, empty name, no-change, terminal lock.
- **requestCancellation** — note marker added with **no status change**, existing
  notes preserved (append not replace), duplicate blocked, terminal rejected, audit
  recorded.
- **progressSteps** — 新規/確定/完了 step mapping, キャンセル cancelled flag.
- **predicates** — `canReschedule`/`canCancel`/`canEditContact`/`hasCancellationRequest`.
- **PortalDocs** — attachment scope guard: own folder allowed; other booking, admin
  sections (estimates/contracts), and path-traversal all blocked; `removeAttachment`
  refuses out-of-scope without calling storage; in-scope delete works; upload
  no-booking / too-large guards.

Render verification (manual, during build): `portal.html` loaded with a stubbed
authenticated session rendered the reschedule/contact/cancel panels, the disabled
email field, the 4-step progress tracker (current = 確認中), and the document upload
control with **zero JS/console errors**.

> The existing `dataProvider.test.js` / `smoke.test.js` suites require the dev server
> on a fixed port and were not run here; the new suite is self-contained. (Note: on
> this machine `localhost` did not resolve to the dev server — `127.0.0.1:5050`
> did — which only affects server-based tests, not the new offline suite.)

---

## 6. Risks & notes

| # | Note | Severity | Mitigation |
|---|---|---|---|
| 1 | Cancellation request is detected via a notes marker (`【キャンセル希望】`), not a column. | Low | Intentional (no schema change). Admin sees both the marker and an audit entry; a future column is optional. Mirrors the existing notes-packing convention. |
| 2 | Reschedule/contact on a **confirmed** booking updates the row without forcing re-confirmation. | Low | Deliberate (minimal, non-breaking). The audit entry surfaces the change so admin can re-confirm if desired; status is never silently changed. |
| 3 | These writes depend on the Phase 6B `bookings_auth_update_own` policy being live in production. Until 6B is applied, an authenticated UPDATE is denied (per the 6B coupling). | Medium | Behaviour is correct under 6B; pre-6B, `BookingService.updateBooking` already errors visibly. Gated on the 6B deployment (see `PHASE_6B_EXECUTION_CHECKLIST.md`). |
| 4 | Document/photo isolation remains app-enforced (no object-level storage RLS) — unchanged 6B stance. | Medium (pre-existing) | Booking-scoped paths + signed URLs + scope guards (tested). Object-RLS remains a separate future hardening. |

---

## 7. What was NOT done

- ❌ No database/schema/migration change; no new table, column, status, or bucket.
- ❌ No change to admin, CMS/WMC, public site, `portalAuth.js`, or `bookingService.js`.
- ❌ No new external dependency.
- ❌ Phase 6D not started.

*Implementation + tests delivered. All new code is additive and reuses the existing
booking, audit, auth, and storage services; isolation is preserved by writing only to
the customer's own row and never mutating the auth-identity email.*
