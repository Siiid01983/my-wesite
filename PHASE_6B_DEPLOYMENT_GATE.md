# Phase 6B.4 — Final Deployment Readiness Gate

**Goal:** Final pre-deployment review of all Phase 6B artifacts. Verify the seven
safety dimensions and render a single **GO / NO-GO** decision.

**Method:** This gate verifies claims against the **actual SQL** of the three
migration files (`…001`, `…002`, `…003`) and the two Phase 6A procedure documents —
not against the summary reports alone. Line references below point at the real
migration source.

**Constraints honored:** No code modified · No database modified · No migration
executed · Stops after this report. Phase 6C not started.

**Date:** 2026-06-17
**Branch:** `phase-5a-customer-portal`

**Artifacts reviewed:**
`PHASE_6B_RLS_HARDENING_REPORT.md` · `PHASE_6B_STAGING_VALIDATION_REPORT.md` ·
`PHASE_6B_CONTROLLED_PRODUCTION_VALIDATION.md` · `PHASE_6A_MIGRATION_IMPLEMENTATION_REPORT.md` ·
`PHASE_6A_DEPLOYMENT_RUNBOOK.md` · and the SQL of
`20260617000001/2/3_*.sql`.

---

## 1. Verdict

> # ✅ GO — CONDITIONAL
>
> The artifact set is internally consistent and the migration SQL is **verified
> correct on all seven safety dimensions**. Deployment is authorized **only** as the
> staged, attended, reversible execution defined in
> `PHASE_6B_CONTROLLED_PRODUCTION_VALIDATION.md`, and **only** if the five hard
> pre-conditions in §4 are all true at execution time.
>
> This is **not** authorization for a blind, single-shot `apply-everything-to-prod`.
> An unconditional immediate apply (skipping the staged gates / pre-flight) is **NO-GO**.

The decision is GO because every prior NO-GO driver was *execution risk*, and the
controlled plan converts that risk into a **reversible, gated procedure** whose
safety net (provider-disable → global revert to `anon`, plus additive `DROP POLICY`
rollback, no row-data change) is sound. The remaining work is operator discipline,
not unresolved design risk.

---

## 2. The seven verification checks (against actual SQL)

| # | Check | Verdict | Evidence (file:line) |
|---|---|---|---|
| 1 | **Migration ordering** | ✅ PASS | §3.1 |
| 2 | **Rollback ordering** | ✅ PASS — with one cross-phase note | §3.2 |
| 3 | **Communications safety** | ✅ PASS (by design) — live regression is the in-flight gate | §3.3 |
| 4 | **Portal safety** | ✅ PASS (by design) — coupled to Auth cut-over | §3.4 |
| 5 | **Admin safety** | ✅ PASS (by design) — F6 browser discipline required | §3.5 |
| 6 | **Public website safety** | ✅ PASS (by design) | §3.6 |
| 7 | **audit_log safety** | ✅ PASS — append-only, customer-unreadable | §3.7 |

All seven pass static/design verification against the real SQL. None could be
falsified by behavioral evidence because none has been executed (0/10 live) — the
GO is therefore gated on running the §4 pre-flight + the controlled plan's stage
gates, which is where these become *observed* rather than *proven-by-design*.

---

## 3. Verification detail

### 3.1 Migration ordering ✅

- **Apply order** is reviews → bookings → RLS, encoded by lexical filename order
  `…000001` < `…000002` < `…000003`; `supabase db push` applies in that order
  (runbook §2 L94-98).
- **Dependency satisfied:** the 6B reviews policy joins on `reviews.booking_reference`
  (`…003` L133) which is created by `…001` (`…001` L38). `…003`'s header explicitly
  declares `Depends on: 20260617000001` (`…003` L38-39). Ordering honors it. ✅
- **No reverse dependency:** `…003` references `bookings.id`, `bookings.notes`,
  `bookings.customer_email`, `communications.customer_email` — all pre-existing/base
  schema. It does **not** reference `bookings.updated_at`, so `…003` is independent of
  `…002`. Applying all three in filename order is correct and slightly conservative.
- **Caveat (pre-flight):** `…003` assumes `bookings.customer_email` and
  `communications.customer_email` exist live; `CREATE POLICY comm_auth_select_own`
  (`…003` L192-196) and the bookings own-row policies fail at creation if the column
  is absent. The reports assert these exist (`bookingService.js`, `portalComms.js`)
  but this must be confirmed read-only before apply (→ §4 P2).

### 3.2 Rollback ordering ✅ (one cross-phase rule to document)

- **Within 6A.5:** rollback is reverse apply — bookings (`…002`) then reviews
  (`…001`); runbook §5 L192-203 and impl report §5 L119-131. Correctly does **not**
  drop the shared `set_updated_at()` (used by `calendar_availability`) — explicit
  warnings at runbook L211 / impl L134. ✅
- **Within 6B:** all objects are additive; rollback drops the authenticated policies
  and optionally `DISABLE RLS` on communications (hardening §8 L222-241). No row data
  touched. ✅
- **⚠️ Cross-phase dependency (must be respected, currently implicit):** the 6B policy
  `reviews_auth_select_own` (`…003` L121-138) references `reviews.booking_reference`.
  Postgres will **refuse to `DROP COLUMN reviews.booking_reference` while that policy
  exists** (or require CASCADE). Therefore a full-stack rollback **must** drop 6B
  (`…003`) **before** the 6A.5 reviews column (`…001`) — i.e. reverse-of-apply
  `003 → 002 → 001`. Each document is internally correct, but **no single document
  states the unified order**. The operator must roll back in strict reverse-apply
  order. (Documented here; not a blocker — see §6 Note N1.)

### 3.3 Communications safety ✅ (design) — in-flight live gate

- This is the **only** table whose enforcement state changes (RLS off → on,
  `…003` L200). The migration re-asserts the full anon CRUD base
  (`comm_anon_select/insert/update/delete`, L164-188) **before** `ENABLE ROW LEVEL
  SECURITY` (L200) — correct ordering so admin (anon) CRUD is covered the instant
  enforcement turns on. ✅
- Customer path: `comm_auth_select_own` (own-email SELECT, L192-196); portal is
  read-only → no authenticated write policy. ✅
- Edge functions (`send-email`/`receive-email`) use `service_role` → **bypass RLS**,
  unaffected (L160-161). ✅
- Grants: anon CRUD + authenticated SELECT (L202-203). ✅
- **Residual:** any admin path using a command/role not covered would be denied the
  moment RLS turns on. Covered by design (4 anon commands + service_role bypass), but
  this is risk **CR1** — the mandatory live admin-Comms regression (controlled plan
  Stage 2). It is the single highest-impact step and is correctly isolated into its
  own gated stage with a `DISABLE RLS` standby rollback.

### 3.4 Portal safety ✅ (design) — coupled to the Auth cut-over

- Customer (role `authenticated`) gets: own bookings read/insert/update
  (`…003` L89-110), own-or-public reviews read + insert (L121-148), own
  communications read (L192-196), audit append (L211-215), and public-content read
  so `index.html` works while logged in (L58-80). Every portal data path has a
  matching policy + grant. ✅
- **Coupling (R7):** these policies are dormant until Magic Link is enabled, and
  enabling Auth **without** them denies the portal. They must be applied **with** the
  cut-over (`…003` header L41-43). Operational precondition → §4 P3.
- **Storage:** app-enforced (private `media` bucket + signed URLs); object RLS
  intentionally not added (`…003` L233-243). Table grants are independent of storage,
  so portal storage ops should still succeed as `authenticated` — **verify live**
  (controlled plan storage check). ✅ by design.

### 3.5 Admin safety ✅ (design) — F6 browser discipline required

- **No anon policy is removed anywhere.** `…003` only ADDs authenticated policies,
  except on communications where it re-asserts *identical* anon CRUD policies. All
  admin anon paths on bookings/reviews/hm_data/services/calendar are untouched. ✅
- communications anon CRUD preserved (§3.3). ✅
- **Residual (PR2/CR8 — F6):** an admin holding a customer Auth session on the same
  origin would read as `authenticated` (email-scoped). Mitigation is operational: a
  clean admin browser profile with no portal login. Required → §4 P5.

### 3.6 Public website safety ✅

- **Anonymous visitor (anon):** all anon policies intact → public site unchanged. ✅
- **Logged-in visitor on `index.html` (origin-wide role flip → authenticated):**
  F1 fix grants authenticated SELECT on `hm_data`, `services`,
  `calendar_availability` (L58-80) so hero/FAQ/footer/services/calendar render. ✅
- **Testimonials (F1b):** `reviews_auth_select_own` includes `(approved IS TRUE OR
  published IS TRUE)` (L127) → public testimonials stay visible to logged-in users. ✅
- **Public booking form while authenticated:** `bookings_auth_insert WITH CHECK(true)`
  (L98-102) → submit not denied. ✅

### 3.7 audit_log safety ✅

- `audit_auth_insert`: INSERT only, `WITH CHECK (true)` (L211-215); `GRANT INSERT …
  TO authenticated` (L217). ✅
- **No** authenticated SELECT and **no** UPDATE/DELETE policy → customers can append
  but never read or mutate the trail; append-only preserved (L218-220). ✅
- anon insert+select from the base audit migration retained. ✅

---

## 4. Hard pre-conditions for GO (all must be true at execution time)

| # | Pre-condition | Why it gates GO | Source |
|---|---|---|---|
| **P1** | **Commit the three migration files** (currently untracked `??` in git) before any apply | Ledger/audit honesty; avoids an unrecorded prod change | git status; runbook §2 note L57-66 |
| **P2** | **Read-only pre-flight confirms** `bookings.customer_email`, `communications.customer_email`, `reviews.booking_reference` exist live | Policy creation in `…003` fails if any is absent | §3.1 caveat; controlled plan §5.0 |
| **P3** | **Magic Link provider configured + portal origin allow-listed**, applied **with** the policy cut-over (not before/without) | Coupling R7 — Auth without policies breaks portal; policies without Auth are dormant | `…003` L41-43; controlled plan §5.2 Stage 3 |
| **P4** | **Attended, low-traffic window**; rollback SQL + provider-disable staged and within reach | CR1 communications enablement + CR2 homepage need instant revert capability | controlled plan §5.1, §6 |
| **P5** | **Admin tested in a clean browser profile** (no portal Auth session) | F6 — otherwise admin reads as email-scoped `authenticated` | §3.5; PR2 |

Plus the **in-flight stage gates** from the controlled plan that must pass live or
trigger rollback: **Stage 2 admin-Comms regression (CR1)**, **Stage 3 homepage-while-
authed (CR2)**, **Stage 4 cross-customer denial at the DB**.

---

## 5. Risk matrix at the gate

| ID | Risk | Sev | Status at gate | Control |
|---|---|---|---|---|
| CR1 | communications RLS enablement denies an admin path | 🔴 High | Mitigated, unverified-live | Anon CRUD asserted before ENABLE (L164-200); Stage 2 live regression; `DISABLE RLS` rollback |
| CR2 | Homepage breaks for logged-in visitor (F1) | 🟠 Med | Mitigated by L58-80 | Stage 3 first check; provider-disable revert |
| N1 | Cross-phase rollback drops `booking_reference` before 6B policy | 🟠 Med | Documented here | Roll back strictly reverse-apply `003→002→001` |
| PR2 | F6 admin shared session | 🟡 Med | Operational | Clean admin profile (P5) |
| R7 | Coupling: Auth without policies / policies without Auth | 🟡 Med | Operational | Apply with cut-over (P3); rollback = disable provider |
| PR3 | `inbox_messages` pre-existing exposure | 🟡 Med | Out of scope, unchanged | Separate hardening; `…003` L223-230 leaves it untouched |
| PR4 | Storage isolation app-enforced only | 🟡 Med | Unchanged | Private bucket + signed URLs; verify live |
| PR5 | reviews join parses `bookings.notes` (`split_part('ref:')`) | 🟢 Low | Accepted at volume (~22) | Long-term `reviews.customer_email` column |
| — | Zero behavioral evidence (0/10 live) | 🟠 Med | Inherent | Controlled plan converts to in-flight gates |

No **un-mitigated High** risk remains; CR1 is High-but-controlled and is the gating
live check.

---

## 6. Notes & minor findings

- **N1 (rollback documentation gap):** the unified full-stack rollback order
  (`003 → 002 → 001`) is correct but only *implied* by "reverse apply order" across
  three independently-authored docs. Recommend recording it explicitly in ops notes
  before deploy. Not a blocker.
- **N2 (staging supersession):** `PHASE_6A_DEPLOYMENT_RUNBOOK.md` §3 says "run in
  staging first if a staging project exists." None exists; the controlled plan
  explicitly waives this for these additive/reversible migrations. The two documents
  are consistent under that waiver.
- **N3 (ledger):** if deployed via Dashboard SQL Editor, the CLI ledger is not
  updated — use `supabase migration repair --status applied …` (runbook §1 note
  L57-66) to keep `migration list` honest.
- **N4 (scope discipline):** `inbox_messages` (PR3) and storage object-RLS (PR4)
  are deliberately untouched by `…003` and remain open follow-ups, not gate items.

---

## 7. Decision summary

| Dimension | Result |
|---|---|
| 7/7 safety checks vs. actual SQL | ✅ PASS |
| Migration ordering | ✅ Correct (dependency-honoring) |
| Rollback ordering | ✅ Correct (+ document N1 cross-phase rule) |
| Internal consistency across 6 artifacts | ✅ Consistent (waivers N2/N3 noted) |
| Reversibility / safety net | ✅ Sound (provider-disable + additive DROP, no data change) |
| Behavioral evidence | ⚠️ None yet — converted to in-flight stage gates |
| Un-mitigated High risk | ✅ None (CR1 High-but-controlled) |

### **GATE DECISION: ✅ GO — CONDITIONAL**

Execute via `PHASE_6B_CONTROLLED_PRODUCTION_VALIDATION.md` (staged, attended,
reversible), contingent on **P1–P5** (§4) being true at execution time and the
in-flight stage gates (Stage 2 communications / Stage 3 homepage / Stage 4 isolation)
passing live. Any pre-condition unmet, or any stage gate failing → **halt and roll
back** (reverse-apply `003→002→001`; or, fastest, disable the Email provider). A
blind unconditional apply that skips the pre-flight or the staged gates is **NO-GO**.

---

## 8. What was NOT done (this gate)

- ❌ No code modified.
- ❌ No database modified.
- ❌ No migration executed / pushed.
- ❌ Phase 6C not started.
- ✅ Review-only — this report is the sole deliverable. Stopped after the report.
