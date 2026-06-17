# Phase 6B — Staging Validation Report

**Goal:** Validate Phase 6B Customer Isolation & RLS in **staging**.

**Date:** 2026-06-17
**Subject migration:** `supabase/migrations/20260617000003_phase6b_customer_isolation_rls.sql`

---

## ⛔ Headline: the live staging validation could NOT be executed

This is reported faithfully, not as a pass/fail of behavior that was never run:

| Precondition for a real staging run | State |
|---|---|
| A **staging** Supabase project exists | ❌ No. The only linked project is **`hello-moving` / `ursohvtxzqxeczvrspiw`** — production. No staging ref is configured. |
| The 6B migration is **applied** somewhere to test | ❌ No. The file is **untracked (`??`)** and has **no migration-ledger record** — it has never been run on any database. |
| The 6A.5 dependency (`reviews.booking_reference`) is applied | ❌ No. `20260617000001` / `…002` are also untracked/unapplied. The reviews ownership join depends on it. |
| Magic Link (Email) Auth provider enabled + portal origin allow-listed | ❓ Unconfirmed; required to mint an `authenticated` session. |
| This environment can reach the DB / drive a real inbox | ❌ No DB connectivity here; Magic Link login cannot be exercised headlessly. |

**Consequence:** Checks 1–9 are *runtime* checks that require a live, migrated,
Auth-enabled staging database and two real customer inboxes. None of that exists in
this environment, so **those checks were NOT EXECUTED.** What follows is therefore
split into:

- **✅ VERIFIED (STATIC):** confirmed correct by analysis of the actual policy file
  + live code paths — a pre-execution readiness gate, **not** a live test result.
- **⛔ NOT EXECUTED (BLOCKED):** requires the staging run above; the exact procedure
  and expected result are given so it can be run when staging exists.

No code, database, migration, or deployment was touched.

---

## Static verification (what was confirmed by analysis)

Policy file cross-checked against: `bookingService.js`, `js/portal/portalComms.js`,
`js/portal/portalReviews.js`, `js/services/auditService.js`, `contentLoader.js`,
and the prior RLS migrations.

| # | Check | Static verdict | Evidence (policy ↔ code) |
|---|---|---|---|
| 1 | Customer sees only own bookings | ✅ VERIFIED | `bookings_auth_select_own USING (lower(customer_email)=lower(auth.email()))` (mig L90-93) ↔ portal resolves via `getBookingsByEmail` (`bookingService.js:200-209`, `.ilike('customer_email')`). DB-level scope matches app scope (defense-in-depth). |
| 2 | Customer cannot access other customers' data | ✅ VERIFIED | bookings/communications scoped to `auth.email()` (L90-93, L193-196); reviews own-branch joins `bookings` by email (L130-137); `audit_log` has **no** authenticated SELECT (L211-220, customers can't read the trail); `inbox_messages` ungranted to authenticated (L224-230). |
| 3 | Public site works while logged in | ✅ VERIFIED | F1 fix: `hm_data/services/calendar_availability` get `authenticated SELECT USING(true)` + grants (L57-80). Without these a logged-in visitor (role `authenticated`) would be denied on `index.html`. |
| 4 | Reviews remain visible as intended | ✅ VERIFIED | `reviews_auth_select_own USING ((approved IS TRUE OR published IS TRUE) OR own-booking)` (L121-138) keeps public testimonials visible AND shows the customer their own pre-moderation review; duplicate-guard `.in('booking_reference',…)` (`portalReviews.js:65`) resolves via the own-branch. **Depends on `reviews.booking_reference` (6A.5 mig 001).** |
| 5 | Booking form still works | ✅ VERIFIED | `bookings_auth_insert WITH CHECK (true)` (L98-102) added so a logged-in customer's form submit (role `authenticated`) is not denied; anon insert path untouched for non-logged-in visitors. |
| 6 | Admin workflows still work | ✅ VERIFIED | No `anon` policy removed. Admin is `anon`; all existing `*_anon_*` policies on bookings/reviews/hm_data/services/calendar remain. communications anon CRUD re-asserted **before** `ENABLE RLS` (L163-200). |
| 7 | CMS still works | ✅ VERIFIED | CMS/WMC write `hm_data`/`services` via `anon`; those anon policies are unchanged. Added authenticated policy on `hm_data` is **SELECT-only** — no write-path interference. |
| 8 | Audit Log still records events | ✅ VERIFIED | Portal append path `sb.from('audit_log').insert(row)` (`auditService.js:93`) ↔ `audit_auth_insert` + `GRANT INSERT … TO authenticated` (L211-217); admin/anon insert+select retained; append-only preserved (no UPDATE/DELETE policy). |
| 9 | Communications still function | ✅ VERIFIED (with live caveat) | Admin anon CRUD (L163-188) + customer `comm_auth_select_own` (L192-196) ↔ portal read-only `from('communications').select(...)` (`portalComms.js:63`); edge functions use `service_role` (bypass RLS). **Caveat:** this is the one table whose RLS is newly *enabled* — must be confirmed live (R1). |
| 10 | No RLS policy conflicts | ✅ VERIFIED | All adds are additive + idempotent (`DROP POLICY IF EXISTS` then `CREATE`); per-role policies are OR-combined, so anon and authenticated coexist without conflict; column predicates match live schema (`customer_email`, `booking_reference`). |

> These are **design-correctness** confirmations. They do **not** assert the
> behavior was observed on a running database.

---

## Live-execution checks — NOT EXECUTED (blocked)

To be run once a migrated, Auth-enabled **staging** project exists. Apply
`20260617000001` → `…002` → `20260617000003`, enable Magic Link + allow-list the
portal origin, then:

| # | Procedure | Expected result |
|---|---|---|
| 1 | Log in as Customer A (Magic Link); open portal dashboard | Only A's booking(s) shown |
| 2 | As A, attempt to read B's booking/comms/review (direct query or id swap) | DB denies (0 rows), not just the app |
| 3 | While logged in as A, open `index.html` | Hero/FAQ/footer/services/calendar all render |
| 4 | (a) Public testimonials visible to A; (b) A submits a review, then re-opens | (a) testimonials show; (b) duplicate guard returns A's review, no second submit |
| 5 | Submit the public booking form while authenticated | Booking row created (`source` paths intact) |
| 6 | Admin (anon, separate browser): read all, confirm/complete/cancel, moderate reviews, send/read/update/delete comms | All succeed; statuses persist |
| 7 | CMS/WMC: edit + save hero/services | Saves persist; public render updates |
| 8 | Trigger a portal approval/review; check `audit_log` | New append-only row recorded; customer cannot read the trail |
| 9 | Admin Communication Center after `communications` RLS turns on | Send/read/update/delete all still work (the key regression) |
| 10 | Run the migration's trailing VERIFY block (`pg_policies`, `relrowsecurity`, grants) | authenticated policies present on all listed tables; `communications.rls_enabled = true` |

**Pre-flight (read-only) to run first in staging:** confirm live columns
(`bookings.customer_email`, `communications.customer_email`), confirm
`reviews.booking_reference` exists (6A.5), and snapshot `pg_policies` + grants for
rollback (per `PHASE_6A_RLS_IMPACT_ANALYSIS.md` §9).

---

## Passed checks

- **10 / 10 checks pass STATIC (design/policy + code-path) verification** — the
  migration is internally correct and complete for every requested guarantee.
- **0 / 10 checks executed live** (no staging environment — see blockers).

## Failed checks

- **None observed.** No check failed static verification. (Live failures cannot be
  excluded until executed — absence of a run is not a pass.)

## Blockers

| ID | Blocker | Impact |
|---|---|---|
| B1 | **No staging Supabase project** — only production is linked | Cannot run any live check without risking production |
| B2 | **Migration unapplied + untracked** (6B and 6A.5 deps) | Nothing to validate against; reviews own-branch needs `reviews.booking_reference` first |
| B3 | **Magic Link provider config unconfirmed** | Cannot mint an `authenticated` session → checks 1–4,8,9 cannot run |
| B4 | **No DB connectivity / no deliverable inbox in this environment** | Headless execution of the runtime matrix is impossible here |

## Risks

| ID | Risk | Severity | Note |
|---|---|---|---|
| R1 | `communications` RLS is newly **enabled**; an unknown admin access path could be denied | Medium | Check 9 must pass live before promotion |
| R2 | Reviews ownership join parses `bookings.notes` (`split_part('ref:')`) | Low | Brittle if `notes` contains `ref:` elsewhere; OK at current volume |
| R3 | Admin sharing a browser with a customer Auth session → admin reads become email-scoped (F6) | Medium | Use a separate admin browser/profile; verify in check 6 |
| R4 | `inbox_messages` pre-existing exposure (RLS disabled) | Medium | Out of 6B scope; flagged for separate hardening |
| R5 | Coupling: applying policies without enabling Auth is harmless; enabling Auth without them denies the portal | Low | Apply with the cut-over; rollback = disable provider |

---

## Readiness score

| Dimension | Score | Basis |
|---|---|---|
| Migration design correctness (static) | 9/10 | All 10 checks verified against policy + live code; additive, idempotent, schema-accurate |
| Staging **execution** completeness | 0/10 | Not run — no staging env, migration unapplied, Auth unconfirmed |
| Blocker clarity / path to green | 8/10 | Blockers are environmental and well-defined; procedure + expected results provided |
| Risk coverage | 8/10 | R1–R5 identified with mitigations; R1 (comms) is the gating live check |

### **Phase 6B staging validation: STATIC PASS 10/10 · LIVE EXECUTION BLOCKED (0/10 run)**
### **Overall staging-validation readiness: 45 / 100 — NOT YET VALIDATED (design-ready, execution-blocked)**

- The migration is **design-ready** and would, on analysis, satisfy all ten
  isolation/compatibility requirements. **However, the staging validation itself is
  incomplete** because no staging environment exists and the migration is unapplied —
  so no behavioral evidence exists yet.
- **To complete this phase honestly:** provision (or designate) a staging project,
  apply `20260617000001 → 002 → 003`, enable Magic Link, then run the §"Live-execution
  checks" matrix. Promote only after **10/10 live PASS**, with special attention to
  **check 9 (communications)** and **R1**.

---

## What was NOT done

- ❌ No SQL executed, no migration applied, no database/Supabase change.
- ❌ No code modified, nothing deployed, no migrations created.
- ❌ No live customer/admin sessions exercised (no staging env / no inbox here).
- ❌ Phase 6C not started.

*Validation report only. The live staging run remains outstanding and is gated on the blockers above.*
