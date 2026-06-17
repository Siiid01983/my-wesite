# Pre-Flight Verification Report — Phase 6A.5 + 6B Deployment

**Scope:** Execute the PRE-FLIGHT section of `PHASE_6B_EXECUTION_CHECKLIST.md` only —
read-only verification. **No migration executed, no SQL applied, no DB modified.**
Phase 6D not started.

**Target:** `hello-moving` — ref `ursohvtxzqxeczvrspiw` (PRODUCTION). Linked ref
confirmed via `supabase/.temp/linked-project.json`.

**Date:** 2026-06-17

**Verification method:** Column existence was confirmed against **production** via
read-only PostgREST `SELECT … limit 1` probes using the anon key (an existing column
returns HTTP 200; a missing column returns HTTP 400 / Postgres `42703`). Row counts
via `HEAD` + `count=exact`. These are SELECT/HEAD only — nothing was written.
Authoritative `pg_policies` / `relrowsecurity` / grants snapshots are **not** exposed
through the anon REST API and must be captured by the operator in the SQL Editor
(noted below as deferred, not failed).

---

## 1. Executive result

> ## ✅ GO (CONDITIONAL) — database starting-state pre-flight PASSES
>
> The critical column STOP-gate (**PF-1**) is satisfied: `bookings.customer_email`
> and `communications.customer_email` both **exist live**, so the 6B `…003` policy
> `CREATE`s will not fail. Migration dependencies are **satisfiable in the documented
> order** (`001 → 002 → 003`). No database-level blocker found.
>
> **One outstanding pre-condition blocks a clean start:** the three migration files
> are **still untracked (`??`) in git** (checklist **P1**). Commit them before the
> window. Operator-only items (rollback snapshots in SQL Editor + P3/P4/P5) remain to
> be completed by the operator and **cannot** be run from this read-only environment.

---

## 2. Task-3 explicit confirmations (live)

| Requested confirmation | Live result | Verdict | Note |
|---|---|---|---|
| `bookings.customer_email` exists | HTTP 200 — column present | ✅ **PASS** | Required by 6B bookings policies + portal email resolution. |
| `reviews.booking_reference` exists | HTTP 400 `42703` — **absent** | ⚠️ **ABSENT (expected)** | **Created by 6A.5 `…001`** (not yet applied). Its absence now is the correct pre-deploy state; `…001` runs first and creates it before `…003` references it. |
| `reviews.source` exists | HTTP 400 `42703` — **absent** | ⚠️ **ABSENT (expected)** | Also created by 6A.5 `…001`. Not used by any `…003` policy. |

> **Interpretation:** `reviews.booking_reference` and `reviews.source` are **supposed
> to be absent right now** — they are exactly what migration `…001` adds. The literal
> "exists" check is FALSE, but as a *pre-flight gate* this is a **PASS**: it confirms
> the expected starting state and that the `…001 → …003` dependency is real and will be
> satisfied by the apply order. Their absence is **not** a blocker; it is the
> dependency the deployment's Stage A closes.

---

## 3. Full PRE-FLIGHT checklist results

### Column pre-flight (P2 — the STOP gate) — executed live

| Check | Expected pre-deploy | Live | PASS/FAIL |
|---|---|---|---|
| `bookings.customer_email` exists | present | **present (200)** | ✅ PASS |
| `communications.customer_email` exists | present | **present (200)** | ✅ PASS |
| `reviews.booking_reference` | absent (added by `…001`) | **absent (42703)** | ✅ PASS (matches expectation) |
| `reviews.source` | absent (added by `…001`) | **absent (42703)** | ✅ PASS (matches expectation) |
| `bookings.updated_at` not yet present | absent (added by `…002`) | **absent (42703)** | ✅ PASS (matches expectation) |

> **▶ GATE PF-1 result: PASS.** Both columns the `…003` policies reference at CREATE
> time (`bookings.customer_email`, `communications.customer_email`) exist. Do **not**
> halt. The three columns expected to be absent pre-deploy are all correctly absent.

### Row counts (rollback baseline) — executed live

| Table | Checklist baseline | Live | Note |
|---|---|---|---|
| `bookings` | ≈ 22 | **23** | ℹ️ +1 vs. the checklist's snapshot (bookings grow naturally). Record **23** as the new rollback baseline. Not a blocker. |
| `reviews` | 0 | **0** | ✅ Matches; consistent with `…001` adding columns to an empty table (zero backfill risk). |

### Authorization & artifacts (P1) — verifiable here

| Item | State | PASS/FAIL |
|---|---|---|
| Three migration files present on disk | ✅ all three present | ✅ |
| Three migration files **committed** to git | ❌ all three **untracked (`??`)** | ❌ **FAIL (P1)** |
| Linked project ref = `ursohvtxzqxeczvrspiw` | ✅ confirmed | ✅ |

### Items NOT executable via read-only REST (operator must complete in SQL Editor / Dashboard)

| Checklist item | Why not executable here | Status |
|---|---|---|
| `pg_policies` snapshot (7 tables) | `pg_policies` not exposed via anon REST | ⏳ DEFERRED to operator |
| `relrowsecurity` snapshot (+ `inbox_messages`) | `pg_class` not exposed via anon REST | ⏳ DEFERRED to operator |
| `role_table_grants` snapshot (`authenticated`/`anon`) | `information_schema` grants not exposed via anon REST | ⏳ DEFERRED to operator |
| P3 — Magic Link provider config / origin allow-list | Dashboard Auth config, not a query | ⏳ DEFERRED to operator |
| P4 — low-traffic window, single deploy path | process / scheduling | ⏳ DEFERRED to operator |
| P5 — admin clean browser + 2 test inboxes | process / environment | ⏳ DEFERRED to operator |

---

## 4. Migration dependency verification (Task 4)

| Dependency | Required by | Provider | Satisfied? |
|---|---|---|---|
| `reviews.booking_reference` | `…003` reviews own-branch join (`reviews_auth_select_own`) | `…001` (applied first) | ✅ by apply order `001→003` (absent now, created in Stage A) |
| `communications.customer_email` | `…003` `comm_auth_select_own` (CREATE-time) | already live | ✅ exists now |
| `bookings.customer_email` | `…003` bookings own-row policies (CREATE-time) | already live | ✅ exists now |
| `bookings.updated_at` | Phase 5F/6C writes via `updateBooking` | `…002` | ✅ will be created in Stage B (absent now, as expected) |
| Apply order `001 → 002 → 003` | overall | filename lexical order | ✅ encoded by filenames |
| Cross-phase rollback `003 → 002 → 001` (N1) | rollback safety | documented | ✅ noted (the `…003` reviews policy depends on `…001`'s column) |

**All migration dependencies are satisfiable in the documented order.** No
dependency is unmet for a forward apply; the two "absent" columns are precisely what
Stages A/B create before the dependent policies in Stage C/D run.

---

## 5. Missing dependencies

- **None at the database level** that block a forward apply. The columns the `…003`
  policies reference at creation time (`bookings.customer_email`,
  `communications.customer_email`) are present.
- **Expected-absent (created during deploy, not missing dependencies):**
  `reviews.booking_reference`, `reviews.source` (Stage A / `…001`),
  `bookings.updated_at` (Stage B / `…002`).

---

## 6. Blocking issues

| ID | Issue | Severity | Resolution before window |
|---|---|---|---|
| **BL-1** | Migration files **untracked (`??`)** — P1 not satisfied | 🟠 Blocking (process/audit) | `git add` + commit the three `20260617*` files so the apply is auditable and the ledger is honest. Easily resolved; no DB impact. |
| **BL-2** | Rollback-baseline snapshots (`pg_policies`/`relrowsecurity`/grants) not yet captured | 🟡 Required gate | Operator runs the read-only snapshot queries in the SQL Editor and saves output **before** Stage A. |
| **BL-3** | P3/P4/P5 operator items (Magic Link config, window, admin browser, test inboxes) | 🟡 Required gate | Operator completes per checklist before the cut-over (Stage F). |

> No blocker is a **database-state** problem. BL-1 is the only item fully verifiable
> here and it is **open**. BL-2/BL-3 are environmental items this read-only context
> cannot perform; they remain mandatory operator gates.

---

## 7. GO / NO-GO recommendation

| Dimension | Verdict |
|---|---|
| Column STOP-gate (PF-1) | ✅ **GO** — required columns exist live |
| Migration dependency satisfiability | ✅ **GO** — satisfiable in order `001→002→003` |
| Expected-absent columns correct | ✅ **GO** — `booking_reference`/`source`/`updated_at` correctly absent |
| Row-count baseline | ✅ **GO** — reviews=0, bookings=23 (update baseline note) |
| P1 artifacts committed | ❌ **HOLD** — commit migrations first (BL-1) |
| Operator SQL snapshots + P3/P4/P5 | ⏳ **PENDING** — complete in Dashboard/SQL Editor |

### **Recommendation: 🟢 GO on the database starting-state pre-flight — CONDITIONAL on clearing BL-1 → BL-3 before opening the deployment window.**

- The **database is in the correct pre-deploy state**: the policy-referenced columns
  exist, the to-be-created columns are correctly absent, reviews is empty, and the
  dependency chain is satisfiable in the documented order. **No DB-level NO-GO.**
- **Before Stage A:** (1) commit the three migration files (BL-1); (2) capture the
  `pg_policies` / `relrowsecurity` / grants rollback snapshots in the SQL Editor
  (BL-2); (3) complete P3/P4/P5 operator readiness (BL-3).
- With BL-1→BL-3 cleared, proceed to DEPLOYMENT Stage A per
  `PHASE_6B_EXECUTION_CHECKLIST.md`. **Nothing in this report applied any migration or
  modified the database.**

---

## 8. What was NOT done

- ❌ No migration executed; no SQL applied; no `db push`.
- ❌ No database/schema/Auth/storage modification.
- ❌ No deployment stage entered (A–F not started).
- ❌ Phase 6D not started.
- ✅ Read-only verification only (REST `SELECT`/`HEAD` probes + git/file inspection).
  This report is the sole deliverable.
