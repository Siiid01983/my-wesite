# Phase 6B.3 — Controlled Production Validation Plan

**Goal:** Design a production-safe strategy to validate Phase 6B Customer-Isolation
& RLS **without** standing up a separate staging project — using temporary test
accounts, a limited-scope rollout, and a reversible deployment.

**Constraints honored:** No new Supabase project · No Phase 6C · No code changes ·
No migration executed yet. **This document is analysis/planning only.**

**Date:** 2026-06-17
**Branch:** `phase-5a-customer-portal`
**Subject migration:** `supabase/migrations/20260617000003_phase6b_customer_isolation_rls.sql`
(plus 6A.5 deps `…001`, `…002`)

---

## 1. The core insight that makes this safe

The Phase 6B migration has three properties that, together, permit controlled
validation directly on production:

1. **Additive** — it only *adds* `authenticated` policies + grants. Every existing
   `TO anon` policy (admin, CMS, public, automation) is left intact, so the anon
   world is unchanged by the policy adds.
2. **Dormant until Auth is enabled** — supabase-js only presents the `authenticated`
   role once a user holds a Magic Link session. Until the Email provider is enabled,
   **there are no `authenticated` callers**, so the new policies match nothing and
   change no behavior (coupling note R7 in the hardening report).
3. **Instantly reversible at the provider level** — disabling the Email/Magic Link
   provider reverts every client to `anon` globally, with no SQL, instantly.

This lets us **decouple two events that the runbook would otherwise fuse**:

| Event | Risk profile | Reversibility |
|---|---|---|
| **(A) Apply the policy SQL** (additive adds) | Near-zero — dormant, anon untouched | `DROP POLICY` (idempotent) |
| **(B) Enable Magic Link** (activates `authenticated` origin-wide) | Real — this is the live cut-over | Disable provider (instant, global) |

The **one exception** to "additive/dormant" is the `communications` **RLS
enablement**, which becomes active for the **anon admin path immediately** on apply —
it does not wait for Auth. That single sub-step is the crux of the whole plan and is
isolated into its own gated stage (Stage 2) with a standby rollback.

> Strategy in one line: **stage the SQL behind the dormancy property, gate the one
> active change (communications) on a live admin regression, then enable Auth last
> and validate isolation with disposable test accounts — rolling back at the
> provider in seconds if anything fails.**

---

## 2. Is production-safe validation feasible? — verdict per mechanism

| Mechanism asked for | Feasible? | How / caveat |
|---|---|---|
| **Temporary test accounts** | ✅ Yes | Seed 2 disposable bookings under controllable inboxes (Gmail `+` aliases / test-mail). Auth is open (`shouldCreateUser:true`), so a Magic Link mints a real session; RLS scopes it to that email. Delete the test bookings + auth users on teardown. |
| **Limited-scope rollout** | ⚠️ Partial | Magic Link is a **global** provider toggle — it cannot be enabled per-user. "Limited scope" is therefore achieved by **blast-radius control**, not feature-flagging: (a) low-traffic window, (b) only emails that *have a booking* ever see a portal, (c) disposable test data, (d) seconds-to-rollback. |
| **Reversible deployment** | ✅ Yes | Policy adds → `DROP POLICY`; communications enablement → drop policy / `DISABLE RLS`; Auth activation → disable provider (global, instant). No row data is modified at any step. |

**Conclusion:** Production validation is feasible and genuinely reversible, *because*
of the additive/dormant design — **provided** the communications enablement is gated
and the deployment is windowed. This is a reasonable substitute for a staging
project for *this specific* migration; it would not be for a destructive one.

---

## 3. Blocker classification

Carrying forward PB1–PB6 from `PHASE_6B_PRODUCTION_READINESS.md` and classifying
each against the controlled-production approach:

| ID | Blocker | Classification | Resolution under this plan |
|---|---|---|---|
| **PB1** | No staging environment | ✅ **Validatable in production** | This plan removes the dependency — validate on prod under controlled, reversible stages. The original "build staging" requirement is *waived* for this migration's risk profile. |
| **PB2** | Migration never applied | ✅ **Validatable in production** | Applied as Stages 1–2 directly to prod; pre-flight snapshot first, `DROP POLICY` rollback ready. |
| **PB3** | 0/10 live checks executed | ✅ **Mostly validatable in production** · 🟡 some manual | Isolation/admin/public/insert/audit checks run with test accounts (Stage 3–4). Magic Link delivery + portal render are **manual** (PB5). |
| **PB4** | `communications` RLS enablement unverified | ✅ **Validatable in production (gated)** | Isolated to **Stage 2**, its own low-traffic window, immediate admin-CRUD regression, standby rollback. This is the highest-risk step and the plan's center of gravity. |
| **PB5** | Magic Link config unconfirmed + email deliverability | 🟡 **Requires manual verification** | Operator confirms provider config, sender domain, URL allow-list, and receives a real Magic Link in a real inbox. Cannot be automated/headless. |
| **PB6** | 6A.5 dependency (`reviews.booking_reference`) | ✅ **Validatable in production** | Applied in order `001 → 002 → 003`; confirmed by a read-only column pre-flight before Stage 3. |

### Three-bucket summary

- **Can be validated in production:** cross-customer isolation, admin (anon)
  preservation, CMS write-path preservation, public-site-while-authenticated (F1),
  testimonials (F1b), authenticated booking insert, audit append-only,
  communications enablement regression, migration application + ordering (PB1, PB2,
  PB3-core, PB4, PB6).
- **Requires staging (genuinely better off-prod) — deferred, not blocking:**
  exhaustive **negative/abuse** testing (high-volume id-swap fuzzing, auth bypass
  attempts), edge-function **email failure-mode** simulation, and any **schema-drift
  experiments**. None are required for a GO; they remain open follow-ups best done if
  a staging project ever exists.
- **Requires manual verification:** Magic Link email **deliverability + receipt**
  (PB5), **admin clean-browser discipline** (F6 / PR2), and **visual** confirmation
  the portal renders without console RLS denials.

---

## 4. Risk matrix (controlled production execution)

Probability × Impact for the act of validating on production with this plan:

| ID | Risk | Prob. | Impact | Exposure | Primary control |
|---|---|---|---|---|---|
| CR1 | **communications RLS enablement denies an unknown admin path** (Comms Center read/send breaks) | Med | High | 🔴 High | Stage 2 gate: re-assert anon CRUD *before* `ENABLE RLS`; immediate admin regression; `DISABLE RLS` rollback on standby |
| CR2 | **Auth activation breaks homepage for logged-in visitors** (F1 regression if public-content `authenticated` SELECTs wrong) | Low | High | 🟠 Med | F1 policies verified static; Stage 3 first action = load `index.html` while authed; provider-disable rollback |
| CR3 | **Test data leaks into real reporting/analytics** (disposable bookings counted as real) | Med | Low | 🟡 Low | Tag test rows (`notes: 'TEST-6B'`); delete on teardown; run in low-traffic window; exclude from any month-end pull |
| CR4 | **Real customer hits the portal during the window** (open Auth surface) | Low | Med | 🟡 Low | Short, off-peak window; only booking-holders see data; isolation already scoped by RLS; rollback ready |
| CR5 | **Magic Link undeliverable** (sender/domain) → checks 1–4,8,9 can't run | Med | Low (to validation, not prod) | 🟡 Low | Verify sender on prod first (PB5); this fails the *validation*, not production data |
| CR6 | **Operator applies wrong file / wrong order** (PB6 dependency) | Low | Med | 🟡 Low | Read-only pre-flight confirms `reviews.booking_reference`; apply `001→002→003`; snapshot `pg_policies` first |
| CR7 | **Forgotten rollback artifact** (test auth user / policy left half-applied) | Low | Low | 🟢 Low | Teardown checklist (§7); post-validation `pg_policies` + auth-users diff vs. snapshot |
| CR8 | **F6 admin shared-session** during validation (admin reads as authed) | Low | Med | 🟡 Low | Admin uses clean browser profile, no portal login (manual discipline) |

**Aggregate:** one High-exposure risk (CR1, the communications enablement),
fully mitigated by isolating it to a gated stage with an instant rollback. Everything
else is Medium-or-lower with a global provider-disable safety net.

---

## 5. Deployment strategy — staged, gated, reversible

### 5.0 Pre-deployment checks (read-only, no change)

Run **before** any write. All are `SELECT`-only against production:

- [ ] **Snapshot for rollback:** `pg_policies`, `pg_class.relrowsecurity`, role grants
      (per `PHASE_6A_RLS_IMPACT_ANALYSIS.md` §9). Store the snapshot.
- [ ] **Column pre-flight (PB6):** confirm `bookings.customer_email`,
      `communications.customer_email`, and `reviews.booking_reference` exist.
      *If `reviews.booking_reference` is absent, STOP — apply `…001` first.*
- [ ] **Provider config (PB5):** confirm Email/Magic Link **currently disabled**
      (guarantees Stage 1–2 dormancy), sender domain verified, portal origin
      allow-listed and ready to toggle.
- [ ] **Admin clean profile ready (F6):** a browser profile with the anon key and
      **no** portal Auth session.
- [ ] **Test inboxes ready:** two controllable inboxes (A, B) for Magic Links.
- [ ] **Migration files committed** to the repo (durable ledger/audit before deploy).
- [ ] **Rollback SQL staged** in the editor, unexecuted (from hardening report §8).

### 5.1 Deployment window

- **When:** a **low-traffic, off-peak** window (e.g. late night JST), operator-attended.
- **Duration:** ≤ 60–90 min, single sitting, no walk-away while Auth is enabled.
- **Freeze:** no concurrent admin CMS edits or other migrations during the window.
- **Comms:** one operator at the keyboard; rollback steps printed and within reach.

### 5.2 Validation sequence (staged with per-stage go/no-go gates)

> Each stage must pass its gate before the next begins. Any gate failure → execute
> that stage's rollback and abort.

**Stage 0 — Pre-flight (above).** Gate: snapshot taken, columns confirmed, provider
confirmed *disabled*. ❌ fail → stop, do not apply anything.

**Stage 1 — Apply the additive policies (Auth still OFF → dormant).**
- Apply `…001`, `…002`, then the **additive** parts of `…003`: all `authenticated`
  policies + grants on `bookings`, `reviews`, `audit_log`, `hm_data`, `services`,
  `calendar_availability` — **excluding** the `communications` ENABLE RLS block.
- **Validate (anon world must be unchanged):** admin reads all bookings/reviews;
  CMS save; public `index.html` renders as anon. Because Auth is off, the new
  `authenticated` policies are inert.
- **Gate:** anon admin + public behavior identical to pre-deploy.
- **Rollback:** `DROP POLICY` the adds (idempotent); no data touched.

**Stage 2 — Communications RLS enablement (the gated high-risk step, Auth still OFF).**
- Re-assert `comm_anon_*` CRUD, add `comm_auth_select_own`, then `ENABLE ROW LEVEL
  SECURITY` on `communications`.
- **Validate immediately (anon admin regression — CR1):** in the clean admin
  profile, Communication Center **read / send / update / delete** all still work.
  (Edge `send-email`/`receive-email` use `service_role` → bypass RLS, unaffected.)
- **Gate:** admin Comms CRUD fully functional. ❌ fail → **rollback now.**
- **Rollback:** `DROP POLICY comm_auth_select_own` and/or `ALTER TABLE communications
  DISABLE ROW LEVEL SECURITY` → reverts to prior (RLS-off) behavior.

**Stage 3 — Enable Magic Link + activate the authenticated role (the live cut-over).**
- Seed two disposable bookings (A, B) tagged `notes:'TEST-6B'` under the test inboxes.
- Enable the Email/Magic Link provider; log in as **Test A**.
- **Validate (positive path):**
  - [ ] Portal dashboard shows **only A's** booking/comms/reviews (Checks 1).
  - [ ] `index.html` while authed: hero/FAQ/footer/services/calendar render (F1, CR2).
  - [ ] Public testimonials visible to A (F1b); A submits a review (insert ok), dup-guard holds.
  - [ ] Public booking form submits while authenticated (F-insert).
  - [ ] A portal approval/review appends to `audit_log`; A **cannot read** the trail.
- **Gate:** all positive checks pass, no console RLS denials.
- **Rollback:** **disable the Email provider** → all clients revert to anon instantly.

**Stage 4 — Cross-customer isolation (the security assertion).**
- Log in as **Test B**; attempt to read A's booking/comms/review (id-swap / direct query).
- Operator runs a direct id-swap query as each authed session.
- **Validate (negative path):**
  - [ ] B sees only B's data; A↔B cross-reads return **0 rows at the DB** (Check 2).
  - [ ] Estimate approval (5F) updates own row only; cannot update the other's.
  - [ ] `audit_log` not customer-readable; `inbox_messages` not customer-readable.
- **Gate:** every cross-read denied **by the database**, not just the app.
- **Rollback:** disable provider (as Stage 3).

**Stage 5 — Decision & disposition.**
- All gates green → **promotion candidate** (leave policies + Auth enabled), then
  teardown test data (§7).
- Any gate failed → rollback to the last-good stage, leave Auth **disabled**, write
  up the failure; production remains on the pre-6B anon behavior.

### 5.3 Limited-scope rollout note

Because Magic Link cannot be scoped per-user, "limited scope" = **(window × test
data × instant rollback)**. The natural authorization boundary helps: a verified
email sees a portal **only if a booking exists** under it, and RLS scopes every read
to `auth.email()`. During the short window the realistic worst case is a stray real
customer logging into *their own* (correctly isolated) portal — which is the intended
end state anyway.

---

## 6. Rollback strategy

### Rollback triggers (any one → roll back the current stage immediately)

| Trigger | Stage | Action |
|---|---|---|
| Admin Comms CRUD fails after enablement (CR1) | 2 | `DROP POLICY comm_auth_select_own` / `DISABLE RLS` on communications |
| Homepage broken for logged-in visitor (CR2) | 3 | **Disable Email provider** (global revert) |
| Customer sees another customer's data (isolation breach) | 4 | **Disable Email provider** immediately; investigate before any retry |
| Console RLS denials block portal render | 3–4 | Disable provider; capture errors |
| Any admin (anon) regression vs. Stage-0 baseline | 1–4 | `DROP POLICY` the relevant adds |
| Magic Link undeliverable / can't mint session | 3 | Pause; not a prod risk — fix sender, retry or abort validation |
| Operator uncertainty / unexpected state | any | Disable provider + `DROP POLICY` adds → full revert |

### Rollback tiers (fastest → most complete)

1. **Tier 1 — Disable Email provider (seconds, no SQL):** reverts the entire
   `authenticated` activation globally; policies go dormant. Fixes CR2/CR4 and any
   Auth-side surprise. **Primary safety net.**
2. **Tier 2 — `DROP POLICY` the authenticated adds (idempotent SQL):** removes the
   6B policy surface; anon world unaffected (it never depended on them).
3. **Tier 3 — `DISABLE ROW LEVEL SECURITY` on communications:** reverts the one
   non-additive change to pre-6B (RLS-off) behavior.
4. **Teardown:** delete `TEST-6B` bookings + test auth users; diff `pg_policies` and
   auth users against the Stage-0 snapshot to confirm a clean revert.

**No production row data is modified at any stage**, so all rollbacks are
structural/config only — no data restore required.

---

## 7. Teardown checklist (post-validation, regardless of outcome)

- [ ] Delete `notes:'TEST-6B'` bookings (A, B) and any test comms/reviews/audit rows.
- [ ] Delete the test **auth users** (Authentication → Users).
- [ ] Diff `pg_policies` / grants / `relrowsecurity` vs. the Stage-0 snapshot.
- [ ] If **NO-GO:** confirm Email provider **disabled** and 6B policies dropped (or
      left dormant per decision); confirm communications RLS state matches intent.
- [ ] If **GO:** leave policies + Auth enabled; record the cut-over in ops notes,
      including the F6 admin clean-browser rule.
- [ ] Schedule deferred follow-ups: `inbox_messages` hardening (PR3), storage
      object-RLS evaluation (PR4), and the staging-only negative/abuse tests.

---

## 8. Final recommendation

### Is controlled production validation safe and sufficient for Phase 6B?

| Question | Verdict |
|---|---|
| Can 6B be validated on production without a new project? | ✅ **Yes** — additive + dormant design + provider-disable rollback make it genuinely reversible |
| Is it safe enough to attempt? | ✅ **Yes, conditionally** — gated stages, low-traffic window, instant Tier-1 rollback |
| Does it fully replace staging? | ⚠️ **For this migration, yes**; negative/abuse + email failure-mode testing remain better-off-prod follow-ups (non-blocking) |
| Highest residual risk? | 🔴 **CR1 — communications RLS enablement** (Stage 2), mitigated by isolation + standby rollback |

### **Recommendation: 🟢 CONDITIONAL GO — execute the controlled production validation as a staged, reversible rollout.**

Conditions (all must hold before Stage 1):

1. **Pre-flight green** (§5.0) — snapshot taken, `reviews.booking_reference`
   confirmed, Email provider confirmed *disabled*, rollback SQL staged.
2. **Migrations committed** to the repo first (durable audit trail).
3. **Operator-attended, off-peak window** with printed rollback steps.
4. **Stage gates enforced** — especially the **Stage 2 communications admin
   regression** (CR1) and the **Stage 4 cross-customer denial**; any gate failure
   rolls back and aborts.
5. **Teardown completed** (§7) and outcome recorded.

**Promotion to permanent production state is itself gated** on Stages 1–4 passing
live. If any gate fails, the correct outcome is a clean revert (Email provider off,
policies dropped/dormant) — production returns to pre-6B anon behavior with no data
impact, and the failure is fixed before a retry.

This plan is the pragmatic correct path given the "no new project" constraint: it
trades a separate environment for **execution discipline** (staging, gating,
windowing, instant rollback), which the migration's additive/dormant design uniquely
supports.

---

## 9. What was NOT done

- ❌ No migration executed; no SQL run; no Auth provider enabled.
- ❌ No new Supabase project created.
- ❌ No code modified; nothing deployed.
- ❌ Phase 6C not started.
- ✅ Analysis/planning only — this document is the sole deliverable.

*Controlled-production validation plan only. Execution (running Stages 0–5 against
production in an attended window) is a separate, operator-driven step gated on §8.*
