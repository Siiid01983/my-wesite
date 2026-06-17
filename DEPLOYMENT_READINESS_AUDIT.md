# Deployment Readiness Audit — Phase 6B (incl. 6A.5 migrations)

**Scope:** Git + migration readiness audit for the 6A.5 → 6B deployment artifacts.
Verification only. **No migration executed, no push, no deploy.** Phase 6D not started.

**Date:** 2026-06-17
**Branch:** `phase-5a-customer-portal`
**HEAD:** `13935bd feat: Phase 5G Customer Review System`
**Target project:** `hello-moving` — ref `ursohvtxzqxeczvrspiw` (PRODUCTION)

---

## 1. Executive result

> ## 🔴 NO-GO (git readiness) — migrations are NOT tracked
>
> **Migration content is ready** (all three files present, well-formed, correctly
> ordered). **Git is not:** all three migration files are **untracked (`??`)**, plus
> there is a **stray empty (0-byte) duplicate** of `…001` at the repo root, and the
> **9 modified application files** that the migrations support (incl. `bookingService.js`,
> `portal.html`) are uncommitted. Deploying from this state is unauditable and risks a
> code/schema mismatch.
>
> **Single blocker class:** commit the artifacts. Once the three migration files (and
> the supporting 6C/app changes) are committed and the stray empty file is removed,
> this flips to **GO** for git/migration readiness.

---

## 2. Git readiness

### 2.1 Migration file tracking (Task 1) — ❌ FAIL

| File | Path | Tracked by git? |
|---|---|---|
| `20260617000001_phase6a_reviews_drift.sql` | `supabase/migrations/` | ❌ **UNTRACKED (`??`)** |
| `20260617000002_phase6a_bookings_drift.sql` | `supabase/migrations/` | ❌ **UNTRACKED (`??`)** |
| `20260617000003_phase6b_customer_isolation_rls.sql` | `supabase/migrations/` | ❌ **UNTRACKED (`??`)** |

`git ls-files --error-unmatch` reports all three as not-in-index. **Task-1 requirement
(all migration files tracked) is NOT satisfied.**

### 2.2 Stray / misplaced file — ⚠️ hazard

| File | State | Risk |
|---|---|---|
| `20260617000001_phase6a_reviews_drift.sql` **at repo ROOT** | untracked, **0 bytes (empty)** | Duplicate filename of the canonical migration, but empty and misplaced. `supabase db push` only reads `supabase/migrations/`, so it would **not** be applied — but it is a footgun (could be committed/opened/applied by mistake). **Should be deleted.** |

### 2.3 Uncommitted tracked files (Task 3 — modified) — 9 files

These are tracked files with uncommitted modifications (the 6A/6C code the deployment
depends on):

```
 M bookingService.js          ← writes updated_at (needs 6A.5 …002)
 M portal.html                ← Phase 6C self-service UI
 M js/portal/portalDocs.js    ← Phase 6C attachment upload
 M js/portal/portalAuth.js    ← Phase 6A auth
 M login.html                 ← Phase 6A magic-link login
 M package.json               ← test wiring
 M js/core/bootstrap.js
 M js/utils/swRegister.js
 M sw.js
```

> Note: git reports LF→CRLF normalization warnings on these (cosmetic line-ending
> conversion on next checkout; not a blocker).

### 2.4 Untracked new files (Task 3 — others)

**Migrations (3):** the three `supabase/migrations/20260617*` files (§2.1).
**Stray (1):** root-level empty `20260617000001_phase6a_reviews_drift.sql` (§2.2).
**New code (3):** `js/portal/portalSelfService.js`, `js/portal/portalSupabaseAuth.js`,
`tests/portalSelfService.test.js`.
**SQL recommendations (1):** `supabase/recommendations/PHASE_6A_customer_rls_recommendations.sql`.
**Reports (~22 `.md`):** `PHASE_6A_*`, `PHASE_6B_*`, `PHASE_6C_*`, `PRE_FLIGHT_VERIFICATION_REPORT.md`,
`AUDIT_DEPLOYMENT_STATUS.md`, `APP_CONFIG_FAILURE_REPORT.md`, `RELEASE_SUMMARY_PHASE_5.md`,
`SERVICE_WORKER_RECOVERY_REPORT.md`, `TEXT_SOURCE_AUDIT.md`.

**Git readiness verdict: ❌ NOT READY** — nothing from Phase 6A.5/6B/6C is committed;
HEAD is still at Phase 5G.

---

## 3. Migration readiness

### 3.1 Presence & integrity — ✅ PASS

All three canonical files exist under `supabase/migrations/`, are non-empty, and match
the content verified in the deployment gate / pre-flight phases. (The pre-flight already
confirmed the live DB is in the correct pre-deploy state: `bookings.customer_email` and
`communications.customer_email` present; `reviews.booking_reference`/`source` and
`bookings.updated_at` correctly absent.)

### 3.2 Deployment order (Task 4) — ✅ PASS

| Order | File | Self-documented order header |
|---|---|---|
| 1 | `20260617000001_phase6a_reviews_drift.sql` | "Apply **BEFORE** the bookings drift migration (lowest risk first)." |
| 2 | `20260617000002_phase6a_bookings_drift.sql` | "Apply **AFTER** `20260617000001`…" |
| 3 | `20260617000003_phase6b_customer_isolation_rls.sql` | "**Depends on:** `20260617000001` (reviews.booking_reference)…" |

- **Lexical filename order = dependency order:** `…000001` < `…000002` < `…000003`.
  `supabase db push` applies pending migrations in lexical filename order, which already
  encodes reviews → bookings → RLS. ✅
- **Dependency satisfied:** `…003`'s reviews policy references `reviews.booking_reference`,
  created by `…001` applied first. ✅
- **Cross-phase rollback (N1):** reverse-apply `003 → 002 → 001` (drop the 6B reviews
  policy before dropping `…001`'s column). Documented in the gate/checklist. ✅

**Migration readiness verdict: ✅ READY** — content present, well-formed, correctly
ordered, dependencies satisfiable. The only gap is that these correct files are not yet
committed (§2).

---

## 4. Remaining blockers

| ID | Blocker | Severity | Resolution (not performed here) |
|---|---|---|---|
| **BL-1** | 3 migration files **untracked** (Task-1 FAIL) | 🔴 Blocking | `git add supabase/migrations/20260617000001_*.sql 20260617000002_*.sql 20260617000003_*.sql` then commit. |
| **BL-2** | Stray **empty** root `20260617000001_phase6a_reviews_drift.sql` | 🟠 Hazard | Delete the root-level 0-byte duplicate (keep only `supabase/migrations/…`). |
| **BL-3** | 9 supporting app files (6A/6C) uncommitted | 🟠 Blocking | Commit alongside the migrations so deployed code matches schema (esp. `bookingService.js`, `portal.html`, `portalDocs.js`). |
| **BL-4** | New code/test untracked (`portalSelfService.js`, `portalSupabaseAuth.js`, `tests/portalSelfService.test.js`) | 🟡 Recommended | Commit with the release for a coherent, revertible changeset. |
| **BL-5** | Operator pre-flight items still pending (SQL `pg_policies`/`relrowsecurity`/grants snapshots; P3/P4/P5) | 🟡 Out of this audit's scope | Per `PRE_FLIGHT_VERIFICATION_REPORT.md` — complete in SQL Editor/Dashboard before Stage A. |

> All blockers are **artifact-commit / hygiene** issues. None is a defect in the
> migration SQL, the ordering, or the live DB state.

---

## 5. Final GO / NO-GO

| Dimension | Verdict |
|---|---|
| Migration content present & well-formed | ✅ GO |
| Deployment order `001 → 002 → 003` | ✅ GO |
| Dependencies satisfiable | ✅ GO |
| Live DB pre-deploy state (from pre-flight) | ✅ GO |
| **Migration files tracked by git (Task 1)** | ❌ **NO-GO** |
| Supporting app code committed | ❌ NO-GO |
| Stray empty duplicate removed | ❌ NO-GO |

### **FINAL: 🔴 NO-GO — pending commit of deployment artifacts.**

The deployment **must not proceed** while the migrations and the code they support are
uncommitted: the apply would be unauditable (no source-controlled record of exactly what
was deployed) and risks a code↔schema mismatch. **This is the only blocker class.**

**To reach GO (git/migration readiness):**
1. **Delete** the stray empty root `20260617000001_phase6a_reviews_drift.sql` (BL-2).
2. **`git add` + commit** the three `supabase/migrations/20260617*` files (BL-1) **and**
   the 9 modified app files + new 6C code/test (BL-3, BL-4) as one coherent release commit
   on `phase-5a-customer-portal`.
3. Re-run this audit → all three migration files report **TRACKED**, working tree clean
   of deployment artifacts → **GO** for git/migration readiness.
4. Then complete the operator pre-flight items (BL-5) and proceed per
   `PHASE_6B_EXECUTION_CHECKLIST.md` Stage A.

> Per instructions, this audit did **not** commit, push, deploy, or execute anything —
> remediation commands above are recommendations for the operator.

---

## 6. What was NOT done

- ❌ No `git add` / commit / push.
- ❌ No migration executed; no `db push`; no deployment.
- ❌ No file modified or deleted (stray-file removal is a recommendation only).
- ❌ Phase 6D not started.
- ✅ Read-only git/file inspection only — this report is the sole deliverable.
