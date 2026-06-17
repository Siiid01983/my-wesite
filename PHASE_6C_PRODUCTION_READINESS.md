# Phase 6C — Final Production Readiness Verification

**Goal:** Verify the *actual* Phase 6C implementation against five production-safety
criteria and render a Ready / Not-Ready decision.

**Method:** Code-level trace of the shipped files against the live booking/storage/
audit paths and the migration set. No assertion is taken from the 6C report alone.

**Constraints honored:** Analysis only. No code/DB/migration change. Phase 6D not started.

**Date:** 2026-06-17
**Branch:** `phase-5a-customer-portal`

**Reviewed implementation:**
`js/portal/portalSelfService.js` · `js/portal/portalDocs.js` (extension) ·
`portal.html` (6C UI) · against `bookingService.js`, `auditService.js`, and the
`supabase/migrations/` set.

---

## 1. Headline

> # ⚠️ READY — CONDITIONAL (ship only inside the 6A.5 → 6B → 6C deploy chain)
>
> The 6C code is correct, additive, isolation-preserving, and introduces **no new
> migration, no schema change, and no admin/storage regression**. **However**, the
> verification premise *"no dependency on unapplied migrations except Phase 6B RLS"*
> is **not fully met**: every 6C booking mutation also depends on the **Phase 6A.5
> `bookings.updated_at` migration** (`20260617000002`), which is currently unapplied.
>
> 6C is therefore **not independently deployable**. It is production-ready **as the
> last step of the existing 6A.5 → 6B deployment chain** (which the
> `PHASE_6B_EXECUTION_CHECKLIST.md` already sequences). Deploying 6C code ahead of
> that chain makes the new self-service actions *appear but fail* (recoverably).

---

## 2. Criterion-by-criterion verdict

| # | Criterion | Verdict | Basis |
|---|---|---|---|
| 1 | No dependency on unapplied migrations **except 6B RLS** | ❌ **Not met** — one extra dep | Also needs **6A.5 `bookings.updated_at`** (§3). |
| 2 | No hidden schema assumptions | ✅ Met (one documented) | Only `updated_at` (6A.5) beyond base schema; notes-marker is convention-safe (§4). |
| 3 | No production-breaking paths | ✅ Met | Failures are caught + surfaced; UI is feature-gated; degrades, doesn't crash (§5). |
| 4 | No admin workflow regression | ✅ Met | No admin file touched; cancellation is a *request*; writes are own-row, fresh read-modify-write (§6). |
| 5 | No storage permission regression | ✅ Met (shared dep unverified) | 6C adds no storage policy/bucket; authenticated-role storage access is an inherited 6A/6B item, not a 6C regression (§7). |

---

## 3. Criterion 1 — Migration dependencies (the key finding)

All three booking mutations (`reschedule`, `updateContact`, `requestCancellation`)
call `BookingService.updateBooking`, which **unconditionally writes `updated_at`**:

```
bookingService.js:227  const { created_at, ...fields } = _bookingToRow(updated);
bookingService.js:228  const row = { ...fields, updated_at: updatedAt };
bookingService.js:229  await sb.from('bookings').update(row).eq('id', current._dbId);
```

`bookings.updated_at` is created by **`20260617000002_phase6a_bookings_drift.sql`**,
which is **untracked/unapplied** (confirmed `??` in git; never run on any DB per
`PHASE_6B_STAGING_VALIDATION_REPORT.md`). If absent, the UPDATE returns PostgREST
`400 PGRST204 ("column bookings.updated_at does not exist")` and the write throws.

**Therefore Phase 6C's production dependencies are:**

| Dependency | Migration / config | Needed for | If missing |
|---|---|---|---|
| `bookings.updated_at` | **6A.5** `20260617000002` (unapplied) | reschedule / contact / cancel-request persistence | UPDATE 400 → action fails (caught) |
| `bookings_auth_update_own` (UPDATE own) | **6B** `20260617000003` (unapplied) | authenticated customer UPDATE permitted | RLS denies UPDATE |
| `bookings_auth_select_own` (SELECT own) | **6B** `20260617000003` | `getCurrentBooking` / `getBookingById` re-resolve | already required by existing portal read |
| `audit_auth_insert` + grant | **6B** `20260617000003` | audit entries as `authenticated` | audit silently skipped (best-effort, §5) |
| Authenticated-role storage access on `media` | none (storage stays app-enforced) | document/photo upload | upload denied (shared with 5E, §7) |

> **Net:** the premise "except 6B RLS" understates it by one — 6A.5 `updated_at` is
> also required. Importantly, **both are already in the documented deploy chain**:
> the 6B execution checklist applies `…001 → …002 (updated_at) → …003 (RLS)` before
> the Auth cut-over. 6C adds **no new migration of its own**.

This `updated_at` dependency is **not new to 6C** — Phase 5F `approveEstimate` and
admin `updateBooking` already write it. 6C widens the set of paths that rely on it.

---

## 4. Criterion 2 — Hidden schema assumptions

| Field / object used | Source | Assumption-safe? |
|---|---|---|
| `customer_email`, `customer_name`, `customer_phone`, `booking_date`, `status`, `notes`, `created_at` | base schema (`001`) | ✅ |
| `updated_at` | 6A.5 (`002`) | ⚠️ documented dep (§3), not hidden |
| `reviews.booking_reference` | 6A.5 (`001`) | ✅ **not used by 6C** (6C never touches reviews) |
| `media` bucket + `customer-documents/<id>/attachments/` | existing (5D/5E) | ✅ no new bucket/prefix |
| Cancellation marker `【キャンセル希望】` appended to user notes | convention | ✅ contains no `ref:` and no ` / ` → does not collide with `_unpackNotes`/`_parseItems` or the 6B reviews `split_part(notes,'ref:')` join |

No assumption about a column/table that the migration set doesn't already create.
`updateContact` defensively `delete`s `email`/`id`/`createdAt` from the patch
(`portalSelfService.js`), so it cannot smuggle an identity-column write.

---

## 5. Criterion 3 — Production-breaking paths

- **Write failure is recoverable.** `updateBooking` throws on PGRST204/RLS denial;
  every 6C handler wraps the call in try/catch and surfaces a localized error
  (`_ssMsg`) — no uncaught rejection, no page break. The optimistic UI simply does
  not advance.
- **UI is feature-gated.** `managePanels()` returns `''` when `window.PortalSelfService`
  is absent, and each panel is gated by status predicates — a missing module or a
  terminal booking yields no broken controls.
- **Audit is best-effort.** `_audit()` catches and returns `false`; a denied audit
  INSERT (pre-6B) never blocks the user action.
- **Document upload double-listener is benign.** The new `#docUpInput` sits inside a
  `label.ph-up`, so the pre-existing photo `change` listener
  (`closest('.ph-up input[type=file]')`) also fires — but `handlePhotoUpload` returns
  immediately when the input has no `data-cat` (the doc input has none). Net effect:
  only `handleDocUpload` runs. **Minor fragility** (relies on the `data-cat` guard),
  not a break. *(Observation O1.)*
- **No load-order risk.** `portalSelfService.js` has no load-time dependencies and is
  added after `portalReviews.js`, before the inline app.

**Sequencing caveat:** if 6C code ships **before** the 6A.5+6B chain, the self-service
actions render but fail on submit (error toast). Recommend gating the 6C front-end
release on the chain, or feature-flagging — not a crash, but a poor UX window.

---

## 6. Criterion 4 — Admin workflow regression

- **No admin/CMS/automation file changed.** Verified: only `portalSelfService.js`
  (new), `portalDocs.js` (additive), `portal.html`, tests, `package.json`.
- **Cancellation preserves the admin workflow.** `requestCancellation` writes only a
  notes marker — **no `status` key in the patch** (asserted by test). The admin's
  confirm/complete/cancel transitions and `autoStatusRules` remain the sole authority
  over the real status.
- **No field clobber.** `updateBooking` re-fetches `current` immediately before the
  write (`bookingService.js:219`) and packs all columns from it, so a minimal patch
  (date / phone+name / notes) changes only the intended field; `status`, `workers`,
  `items`, addresses are carried through from the fresh row.
- **Inherent (not a regression):** the 6B `bookings_auth_update_own` policy is
  email-scoped, **not column-scoped** — at the raw API a customer could write any
  column on *their own* row (e.g. self-set status). 6C's UI never exposes this; it is
  a pre-accepted 6B design property, unchanged here. *(Dependency D-RLS, not a 6C
  regression.)*

---

## 7. Criterion 5 — Storage permission regression

- **6C adds no storage policy, bucket, or grant.** `uploadAttachment`/`removeAttachment`
  reuse the existing private `media` bucket and the `customer-documents/<id>/attachments/`
  prefix, with scope guards that reject other-booking, admin-section, and traversal
  paths (5 tests).
- **No regression to existing storage behavior** — read/download (`PortalDocs.list`/
  `getDownloadUrl`) and photo upload (`PortalPhotos`) are unchanged.
- **Shared, inherited dependency (not introduced by 6C):** whether the `authenticated`
  role can `upload`/`list`/`createSignedUrl`/`remove` on `media` depends on the
  existing `storage.objects` policies covering `authenticated` after the 6A role flip.
  This is exactly the open item on the 6B staging checklist ("storage succeeds as
  authenticated"). Phase 5E's photo upload carries the identical dependency. 6C adds
  one more authenticated upload path with the same (unverified) requirement.

---

## 8. Remaining blockers & dependencies

| ID | Item | Type | Severity | Resolution |
|---|---|---|---|---|
| B1 | `bookings.updated_at` (6A.5 `…002`) unapplied | Migration dep | 🔴 Blocking (function) | Apply via 6B checklist Stage B (already sequenced). |
| B2 | `bookings_auth_update_own` / `_select_own` (6B `…003`) unapplied | Migration dep | 🔴 Blocking (auth) | Apply via 6B checklist Stage C + cut-over. |
| B3 | Authenticated-role storage access on `media` unverified | Config/verify | 🟠 High (doc/photo upload) | 6B staging checklist storage check; verify before relying on uploads. |
| B4 | 6C front-end shipped before the chain → actions fail on submit | Sequencing | 🟡 Medium | Release 6C UI with/after the chain, or feature-flag. |
| D1 | `audit_auth_insert` (6B) for audit entries | Soft dep | 🟢 Low | Degrades gracefully (best-effort). |
| O1 | Doc-upload shares the `.ph-up` change listener | Code fragility | 🟢 Low | Works via `data-cat` guard; optional future cleanup. |
| O2 | `removeAttachment` implemented + tested but not wired to a delete button in the docs UI | Minor gap | 🟢 Low | Intentional (download-only UI); add later if needed. |

**No blocker requires a code change to 6C** — B1/B2/B3 are the same migration+config
gates the 6A.5/6B phases already own. 6C is correct *given* that chain.

---

## 9. Production readiness score

| Dimension | Weight | Score | Basis |
|---|---|---|---|
| Code correctness & test coverage | 25% | 9.5/10 | 25/25 deterministic tests; render check clean; additive design. |
| Schema/migration independence | 25% | 6/10 | No new migration, but depends on unapplied 6A.5 `updated_at` **and** 6B (premise only partly met). |
| Isolation & auth preservation | 20% | 9/10 | Own-row writes; email immutable; audit append-only; storage scope-guarded. |
| Admin/CMS/storage non-regression | 20% | 9.5/10 | Nothing admin/storage changed; cancellation is a request. |
| Deploy safety / reversibility | 10% | 8/10 | Recoverable failure modes; needs sequencing behind the chain (B4). |

### **Phase 6C production readiness: 82 / 100 — READY (CONDITIONAL)**

**Decision:** ✅ **Ready to ship as the final step of the 6A.5 → 6B → 6C deployment
chain.** ❌ **Not ready as a standalone deploy** ahead of that chain.

- Apply `…001 → …002 (updated_at) → …003 (RLS)` and complete the 6B cut-over +
  storage verification (per `PHASE_6B_EXECUTION_CHECKLIST.md`), **then** release the
  6C front-end. With the chain in place, 6C functions correctly and introduces no
  schema change, no admin regression, and no storage regression.
- Until the chain is live, hold (or flag) the 6C UI so customers don't meet
  actions that fail on submit (B4).

---

## 10. What was NOT done (this verification)

- ❌ No code, database, or migration changed.
- ❌ No live execution (no migrated DB / authenticated session available here).
- ❌ Phase 6D not started.
- ✅ Code-level analysis only — this report is the sole deliverable.
