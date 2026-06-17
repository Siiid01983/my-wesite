# Phase 6B.1 — Validation Environment Preparation Plan

**Goal:** Define everything required to stand up a faithful **staging** environment
in which the Phase 6B Customer-Isolation & RLS validation (the 10 checks in
`PHASE_6B_STAGING_VALIDATION_REPORT.md`) can actually be executed — and which
unblocks B1–B4 from that report.

**Status:** Plan only. **No environment provisioned, no SQL run, no migration
applied, no credential changed, nothing deployed.** Phase 6C not started.

**Date:** 2026-06-17

---

## 0. Why this phase exists

The staging validation could not run because (from the validation report):

| Blocker | This plan resolves it via |
|---|---|
| B1 — no staging project (only prod `ursohvtxzqxeczvrspiw` is linked) | §2 Provision a dedicated staging project |
| B2 — 6B + 6A.5 migrations unapplied/untracked | §4 Replay the full migration set into staging (incl. `…001/002/003`) |
| B3 — Magic Link provider config unconfirmed | §6 Enable Email/Magic Link + URL allow-list |
| B4 — no DB connectivity / no deliverable inbox here | §7 Test inboxes + §8 seed data, run from an operator workstation |

---

## 1. Target staging environment — what "faithful" requires

To validate per-customer isolation honestly, staging must reproduce the **role
flip** (anon vs. authenticated) and every in-scope table/flow:

- A Supabase project **separate from production**, same region, same schema.
- **All 9 migrations** applied in order (schema + RLS + 6A.5 + 6B).
- **Magic Link (Email) Auth** enabled with the staging portal origin allow-listed.
- **Edge functions** (`send-email`, `receive-email`) deployed (or explicitly
  stubbed) so the communications/email-delivery path is representative.
- **Seed data**: two customers (A, B) with bookings/comms/reviews, plus public
  content (`hm_data`, `services`, `calendar_availability`) and an admin path.
- The web app pointed at staging via a **gitignored** `env.js` (never touch the
  committed `env.public.js`, which targets production).

---

## 2. Provisioning options (pick one)

| Option | Parity | Effort | Recommendation |
|---|---|---|---|
| **A. Dedicated staging Supabase project** (new project in the same org) | ★★★ Full — real Auth, RLS, Storage, edge fns | Medium | ✅ **Recommended** — closest to production; isolates all risk from prod |
| B. Supabase **branching** (preview branch off prod) | ★★★ if available on the plan | Low | Good if the org's plan includes branching; verify Auth + Storage parity on the branch |
| C. **Local** `supabase start` (Docker) | ★★ — RLS/Auth work locally; email delivery + real inboxes are harder | Low | Useful for fast SQL/RLS iteration; **not** sufficient for the Magic Link inbox checks (1–4,8,9) |

> The rest of this plan is written for **Option A**. For B/C, the schema/RLS steps
> are identical; only provisioning (§3) and Auth/email (§6–7) differ.

---

## 3. Preparation runbook (Option A)

> Operator runs these from a workstation with DB access — **not** from this
> environment. Each step is preparation; the validation run itself is Phase 6B
> execution (separate).

### Step 1 — Create the staging project
- Supabase Dashboard → same org (`wumhppnlqekruveomjqz`) → **New project**
  `hello-moving-staging`, same region as prod.
- Record: staging **project ref**, **URL**, **anon key**, **service_role key**
  (store secrets in a vault — never in git).

### Step 2 — Link the CLI to staging (kept separate from prod)
- `supabase link --project-ref <staging-ref>` (CLI v2.106.0 already in use).
- Confirm `supabase migration list` shows an empty remote ledger.

### Step 3 — Replay the schema (exact order)
Apply all nine, in filename order, via `supabase db push` **or** the SQL Editor:
```
001_initial_schema.sql
002_add_reference_fields.sql
20260101000000_rls_policies.sql
20260614000001_phase30_email_delivery.sql
20260614000002_inbox_messages.sql
20260616000001_audit_log.sql
20260617000001_phase6a_reviews_drift.sql      ← 6A.5 (reviews: source, booking_reference)
20260617000002_phase6a_bookings_drift.sql     ← 6A.5 (bookings: updated_at + trigger)
20260617000003_phase6b_customer_isolation_rls.sql  ← 6B (the subject under test)
```
- **Order matters:** `…003` (6B) references `reviews.booking_reference` from
  `…001`. Apply `001 → 002 → 003` of the 2026-06-17 set in that sequence.
- After the last file, the migration's trailing VERIFY block (and §9 pre-flight)
  confirms policy/role/grant coverage.

### Step 4 — Deploy edge functions (communications path)
- `supabase functions deploy send-email` and `… receive-email` to staging,
  with their secrets (Resend/SMTP keys) set as **staging** secrets.
- If real email send/receive is out of scope for this run, **stub** them and mark
  check 9's email-delivery sub-path as "config-dependent" rather than failing it.

### Step 5 — Storage bucket
- Recreate the private **`media`** bucket (no public policy) so portal
  docs/photos/reviews signed-URL flows are testable (check: storage not broken).

### Step 6 — Enable Magic Link Auth
- Authentication → Providers → **Email** → enable, **Magic Link / passwordless** on.
- Authentication → URL Configuration → allow-list the staging portal origin(s),
  e.g. `https://<staging-host>/portal.html` and `http://localhost:5050/portal.html`.
- (Optional) leave `shouldCreateUser` default; note R: authentication ≠
  authorization (a verified email sees a portal only if a booking exists for it).

### Step 7 — Point the app at staging (credential safety)
- **Local dev:** create `js/config/env.js` (already gitignored — `.gitignore:4`)
  with the **staging** URL + anon key and `window.ENV = { ready: true }` (template:
  `env.example.js`). `bootstrap.js` loads `env.js` first and only falls back to
  `env.public.js`, so this cleanly redirects the local app to staging.
- **Hosted staging:** deploy a build whose `env.public.js` holds the **staging**
  anon key/URL. ⚠️ **Do NOT edit the repo's committed `env.public.js`** (it points
  at production `ursohvtxzqxeczvrspiw`); changing + committing it would redirect
  production traffic.
- 🔒 **Never commit** the staging `service_role` key anywhere.

### Step 8 — Seed test data (see §4 matrix)
- Insert via SQL Editor (service_role) or the admin panel pointed at staging.
- Mirror production-shaped rows: bookings packed with `notes` containing `ref:`,
  reviews keyed by `booking_reference`, communications keyed by `booking_id` +
  `customer_email`, plus `hm_data` content rows.

### Step 9 — Provision test inboxes
- Two real, controllable inboxes for **Customer A** and **Customer B** (e.g.
  Gmail "+" aliases or a test-mail service) to receive Magic Links.
- One **admin** access path (admin uses the anon key — a separate browser
  profile, no portal Auth session, to avoid the F6 shared-session edge case).

---

## 4. Seed data matrix (minimum representative set)

| Entity | Customer A | Customer B | Purpose / checks |
|---|---|---|---|
| `bookings` | 1 row, `customer_email = A`, status confirmed, `notes` has `ref:HM-…A` | 1 row, `customer_email = B`, `ref:HM-…B` | 1,2,5,6 |
| `communications` | ≥1 row `booking_id` of A's booking, `customer_email = A` | ≥1 row for B | 2,9 |
| `reviews` | 1 own review (`booking_reference = A's ref`, `approved=false`) | 1 own review for B | 2,4 |
| `reviews` (public) | 1 approved+published testimonial (any) | — | 4 (visible to all) |
| `hm_data` | hero/FAQ/footer/services rows | — | 3,7 |
| `services` / `calendar_availability` | a few active services + booked dates | — | 3 |
| `audit_log` | empty (will be appended during checks 8) | — | 8 |
| `inbox_messages` | 1 inbound row (verify customers can't read) | — | 2 (out-of-scope exposure note) |

Keep volumes tiny (matches prod: ~22 bookings, low review count).

---

## 5. Validation harness — checks → execution mapping

Reuse the 10-row matrix in `PHASE_6B_STAGING_VALIDATION_REPORT.md` §"Live-execution
checks". Each maps to a concrete actor/session:

| Session | Used for checks |
|---|---|
| Customer A (Magic Link, role `authenticated`) | 1, 2, 4, 5, 8 |
| Customer B (Magic Link) | 2 (cross-customer denial), 4 |
| Anonymous visitor (no session, role `anon`) | 3 (public site), 5 (anon booking) |
| Logged-in visitor on `index.html` (A's session) | 3 (origin-wide role flip), 4 (testimonials) |
| Admin (anon key, separate browser) | 6, 7, 9 |
| DB operator (SQL Editor) | 2 (direct id-swap denial), 9 verify, 10 (pg_policies/grants) |

**Pre-flight (read-only, run first):** the five queries in
`PHASE_6A_RLS_IMPACT_ANALYSIS.md` §9 (live columns, `relrowsecurity`, `pg_policies`,
grants, storage policies) — confirm `bookings.customer_email`,
`communications.customer_email`, and `reviews.booking_reference` exist before the
behavioral run.

---

## 6. Guardrails (data & credential safety)

- ❌ Do not run any 6B/6A.5 migration against production during this phase.
- ❌ Do not modify or commit `js/config/env.public.js` (production pointer).
- ❌ Do not commit `service_role` keys or staging anon keys outside gitignored files.
- ✅ Use a **separate** Supabase project ref for staging; verify the ref in the URL
  before every destructive/seed action.
- ✅ Admin testing in a clean browser profile (no customer Auth session) — proves
  admin (anon) isolation and avoids F6.
- ✅ Use disposable test emails; do not seed real customer PII.

---

## 7. Entry / Exit criteria

**Entry (environment is "ready to validate") — all true:**
- [ ] Staging project created; ref/keys recorded in a vault.
- [ ] All 9 migrations applied in order; VERIFY block + §5 pre-flight green.
- [ ] Edge functions deployed or explicitly stubbed.
- [ ] `media` bucket present (private).
- [ ] Magic Link enabled + staging portal origin allow-listed.
- [ ] App pointed at staging via gitignored `env.js` (or staging build).
- [ ] Seed data (§4) loaded; two test inboxes + admin path ready.

**Exit (this prep phase complete):**
- [ ] An operator can log in as A via Magic Link and reach the portal.
- [ ] The §5 actor/session table is executable end-to-end.
- [ ] Hand off to the Phase 6B **execution** run (the 10-check matrix).

> This phase ends at "ready to validate." Running the 10 checks and scoring them is
> the subsequent execution step — **not** part of 6B.1.

---

## 8. Teardown / rollback

- After validation, **pause or delete** the staging project (cost + data hygiene).
- Delete test inboxes / aliases.
- Remove the local `js/config/env.js` staging pointer (or repoint to local dev) so
  the workstation no longer talks to staging.
- No production rollback is needed — production was never touched.

---

## 9. Risks & mitigations (environment-specific)

| Risk | Mitigation |
|---|---|
| Operator accidentally targets **production** ref | Verify ref in URL/CLI before each step; keep prod creds out of the staging shell |
| Committed `env.public.js` edited → prod redirected | Use gitignored `env.js` only; code-review guard on `env.public.js` |
| Edge-function secrets missing → comms email path fails | Deploy with staging secrets, or stub and scope check 9 to read-only isolation |
| Magic Link emails undeliverable (SMTP/sender) | Verify the Supabase email sender on staging before the run; use a reliable test-mail service |
| Staging schema drifts from prod (out-of-band prod changes) | Run §5 pre-flight column/RLS queries; reconcile before trusting results |
| `reviews.booking_reference` missing (6A.5 not applied) → reviews own-branch no-ops | Enforce migration order `…001 → 002 → 003`; pre-flight confirms the column |

---

## 10. Readiness

| Dimension | Score | Basis |
|---|---|---|
| Plan completeness | 9/10 | Provisioning, schema replay, Auth, app pointer, seed, inboxes, pre-flight, teardown all specified |
| Blocker coverage (B1–B4) | 10/10 | Each prior blocker mapped to a step |
| Safety (prod isolation) | 9/10 | Separate ref + gitignored creds + explicit guardrails |
| Executability by an operator | 8/10 | Concrete steps; depends on org plan (branching) + email deliverability |

### **Phase 6B.1 readiness: 90 / 100 — PLAN READY (environment not yet built)**

- The plan is complete and safe. The remaining work is **operational**: an operator
  with Supabase + email access executes §3, meets §7 entry criteria, then hands to
  the Phase 6B execution run.

---

## 11. What was NOT done

- ❌ No staging project created; no SQL/migration run; no Auth enabled.
- ❌ No `env.js`/`env.public.js` change; no edge function deployed; no data seeded.
- ❌ No code, database, or deployment change.
- ❌ Phase 6C not started.

*Preparation plan only. Build the environment per §3, satisfy §7, then execute the Phase 6B 10-check matrix.*
