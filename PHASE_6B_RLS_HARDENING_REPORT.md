# Phase 6B — Customer Isolation & RLS Hardening Report

**Goal:** Enforce per-customer data isolation at the database layer for the
Supabase Auth (Magic Link) portal introduced in Phase 6A, while keeping the admin
panel, CMS/WMC, public website, and automation working unchanged.

**Status:** Migration authored. The deliverable is the policy migration file
`supabase/migrations/20260617000003_phase6b_customer_isolation_rls.sql`. It has
**not** been executed/pushed to Supabase (no DB credentials are exercised from
here; applying RLS to production is a coupled, outward-facing change that runs
through the deployment runbook in staging first). **No code changed. Phase 6C not
started.**

**Date:** 2026-06-17
**Branch:** `phase-5a-customer-portal`

---

## 1. The core problem this closes

Before Phase 6A, **every** surface (public site, admin, WMC, portal) hit Supabase
as PostgREST role `anon`, and all RLS policies were `TO anon … USING (true)`.
Isolation lived only in app code.

Phase 6A gave customers real Supabase Auth sessions. A logged-in customer's
requests now evaluate as role **`authenticated`**, and — because supabase-js
persists the session per-origin — that role flip is **origin-wide** (it also
applies on `index.html`, not just the portal).

Two consequences drive every policy below:

1. **Opportunity:** isolate per-customer with `auth.email()` at the DB.
2. **Requirement:** with the current anon-only policies, an `authenticated` caller
   matches **no** policy and is **denied** — so without companion `authenticated`
   policies, the portal reads nothing **and the public homepage breaks for any
   logged-in visitor**.

This report's migration adds the `authenticated` policies and leaves every `anon`
policy intact.

---

## 2. Tasks completed

| # | Task | Result |
|---|---|---|
| 1 | Review current RLS policies | Done — see §3. Audited `001`, `002`, `20260101000000_rls_policies`, `phase30_email_delivery`, `inbox_messages`, `audit_log`, plus the 6A recommendations + impact analysis. |
| 2 | Add authenticated-role policies where needed | Done — migration authored (§4). |
| 3 | Verify portal access isolation | Verified by design + staging checklist (§6). Customer reads scoped to `auth.email()`. |
| 4 | Verify admin access still works | Verified by design — all `anon` policies untouched; admin is `anon` (§6). |
| 5 | Verify public pages work for authenticated users | Addressed the F1 gap — added authenticated SELECT on public-content tables (§4.A); staging checklist (§6). |
| 6 | Verify storage not broken | Storage stays app-enforced (private bucket + signed URLs); no object RLS added; staging check listed (§6). |

---

## 3. Current RLS state reviewed (pre-6B)

| Table | RLS | Policies present | In 6B scope |
|---|---|---|---|
| `bookings` | ENABLED | anon SELECT/INSERT/UPDATE/DELETE (`USING true`) | ✅ |
| `reviews` | ENABLED | anon SELECT/INSERT/UPDATE/DELETE | ✅ |
| `communications` | **NOT enabled in repo** | only `comm_anon_update` (inert while RLS off) | ✅ |
| `audit_log` | ENABLED | anon INSERT + anon SELECT (append-only) | ✅ |
| `hm_data` | ENABLED | anon CRUD | read-coverage only |
| `services` | ENABLED | anon CRUD | read-coverage only |
| `calendar_availability` | ENABLED | anon CRUD | read-coverage only |
| `inbox_messages` | DISABLED | none | out of scope (flagged §7) |

**Schema facts confirmed against live code (resolves the impact-analysis drift):**
- `bookings.customer_email` is the live email column (`bookingService.js:71` writes it, `:207` filters `.ilike('customer_email')`). The stale migration-001 `email` column is not what the code uses.
- `communications.customer_email` + `booking_id` exist and the portal is **read-only** on them (`portalComms.js:63-65`).
- `reviews` has no email column; ownership is via `booking_reference` (added in Phase 6A.5 migration `20260617000001`).

---

## 4. Policies created / updated

All `authenticated` policies are **additive**; no `anon` policy is removed. Each is
idempotent (`DROP POLICY IF EXISTS` then `CREATE`) and paired with a `GRANT … TO
authenticated` (closing the impact-analysis F2 "grants ≠ policies" gap).

### A. Public-content read coverage (fixes F1 — homepage breakage)

| Table | Policy | Cmd | Predicate |
|---|---|---|---|
| `hm_data` | `hm_data_auth_select` | SELECT | `USING (true)` |
| `services` | `services_auth_select` | SELECT | `USING (true)` |
| `calendar_availability` | `calendar_availability_auth_select` | SELECT | `USING (true)` |

Read-only — customers never edit site content. Without these, a logged-in
customer on `index.html` (role `authenticated`) would be denied hero/FAQ/footer/
services/calendar.

### B. bookings

| Policy | Cmd | Predicate | Why |
|---|---|---|---|
| `bookings_auth_select_own` | SELECT | `lower(customer_email)=lower(auth.email())` | Portal sees only its own booking(s) |
| `bookings_auth_insert` | INSERT | `WITH CHECK (true)` | Public booking form submitted by a **logged-in** customer (omitted by the raw recommendation) |
| `bookings_auth_update_own` | UPDATE | own-email `USING`+`WITH CHECK` | Phase 5F estimate approval on own row |

Grant: `SELECT, INSERT, UPDATE ON bookings TO authenticated`. No authenticated DELETE.

### C. reviews

| Policy | Cmd | Predicate | Why |
|---|---|---|---|
| `reviews_auth_select_own` | SELECT | `(approved OR published) OR (own-booking join on booking_reference)` | Customer sees public testimonials **and** their own pre-moderation review — **fixes F1b** (raw recommendation hid public testimonials from logged-in users) |
| `reviews_auth_insert` | INSERT | `WITH CHECK (true)` | Portal/FAQ review submit (app enforces 1/booking, `approved:false`) |

Grant: `SELECT, INSERT ON reviews TO authenticated`. No authenticated UPDATE/DELETE
(moderation stays admin-side via `anon`).

### D. communications (the F5 fix — ENABLE RLS safely)

The repo never enabled RLS here, so the customer SELECT-own policy would have been
**inert** (and a logged-in customer could read the whole table via grants). This
migration:

1. Re-asserts the full **anon** base policies `comm_anon_select / _insert / _update
   / _delete` (`USING/CHECK true`) so the admin Communication Center keeps full
   CRUD. (`comm_anon_update` already existed; re-asserted idempotently.)
2. Adds `comm_auth_select_own` (SELECT, `lower(customer_email)=lower(auth.email())`)
   — portal is read-only, so no authenticated write policies.
3. `ALTER TABLE … ENABLE ROW LEVEL SECURITY` **after** the anon policies exist.

Edge functions (`send-email`, `receive-email`) use **`service_role`**, which
**bypasses RLS** → unaffected. Grants: anon CRUD + `SELECT TO authenticated`.

### E. audit_log

| Policy | Cmd | Predicate | Why |
|---|---|---|---|
| `audit_auth_insert` | INSERT | `WITH CHECK (true)` | Logged-in customers record approvals/reviews |

Grant: `INSERT ON public.audit_log TO authenticated` (the audit migration granted
to `anon` only — F2 fix). **No** authenticated SELECT → trail stays unreadable by
customers; append-only preserved (no UPDATE/DELETE policy anywhere).

---

## 5. Affected tables

| Table | Change in this migration |
|---|---|
| `bookings` | +3 authenticated policies, +grant. Anon unchanged. |
| `reviews` | +2 authenticated policies, +grant. Anon unchanged. |
| `communications` | +4 anon base policies (re-assert), +1 authenticated SELECT, **RLS enabled**, +grants. |
| `audit_log` | +1 authenticated INSERT, +grant. |
| `hm_data` | +1 authenticated SELECT, +grant (read coverage). |
| `services` | +1 authenticated SELECT, +grant (read coverage). |
| `calendar_availability` | +1 authenticated SELECT, +grant (read coverage). |
| `inbox_messages` | **No change** (out of scope; exposure flagged §7). |
| Storage `media` | **No change** (app-enforced isolation retained). |

---

## 6. Validation results

### Code/design-level (verifiable now)

| Check | Result |
|---|---|
| All existing `TO anon` policies preserved (admin/CMS/automation unaffected) | ✅ Migration only ADDs policies; no anon `DROP` except idempotent re-assert of identical anon policies on `communications`. |
| Live column names match policy predicates (`customer_email`, `booking_reference`) | ✅ Confirmed in `bookingService.js`, `portalComms.js`, Phase 6A.5 migration. |
| Public-content tables covered for `authenticated` (F1) | ✅ `hm_data`, `services`, `calendar_availability`, reviews-read. |
| Public testimonials still visible to logged-in users (F1b) | ✅ reviews SELECT is `(approved OR published) OR own`. |
| Booking creation by a logged-in customer (F-missing) | ✅ `bookings_auth_insert`. |
| Grants accompany every authenticated policy (F2) | ✅ explicit `GRANT … TO authenticated`. |
| communications RLS made effective without breaking admin (F5) | ✅ anon base policies asserted before `ENABLE RLS`; edge uses service_role. |
| audit_log stays append-only + customer-unreadable | ✅ INSERT only; no authenticated SELECT. |
| Idempotent / re-runnable | ✅ `DROP POLICY IF EXISTS` + idempotent `ENABLE RLS`. |

### Staging-only (require live Auth + a real inbox — must pass before production)

**Portal isolation (role = authenticated)**
- [ ] Customer A logs in (Magic Link) → sees only A's booking, comms, reviews.
- [ ] Customer A cannot read B's booking/comms/review (DB denies, not just app).
- [ ] Estimate approval (5F) updates A's own booking status; cannot update B's.
- [ ] Review submit (5G) inserts with `source='customer'`, `approved=false`.
- [ ] Portal dashboard, messages, documents, photos render (no RLS denials in console).

**Admin (role = anon) unchanged**
- [ ] Admin reads all bookings/reviews/communications; confirm/complete/cancel persists.
- [ ] Admin review moderation (approve/edit/delete) works.
- [ ] Admin Communication Center send/read/update/delete works after `communications` RLS turns on.

**Public site as a logged-in customer (origin-wide role flip)**
- [ ] `index.html` hero/FAQ/footer/services/calendar all render (F1 verified).
- [ ] Public testimonials still appear (F1b verified).
- [ ] Public booking form submits successfully while authenticated (F-insert verified).

**Storage**
- [ ] Portal `list` / `upload` / `createSignedUrl` / `remove` succeed as `authenticated`.

**Automation / edge**
- [ ] `autoStatusRules` transitions persist; `send-email`/`receive-email` (service_role) unaffected.

> These cannot be exercised headlessly (no deliverable inbox), so they are gated to
> a staging run per the deployment runbook before any production promotion.

---

## 7. Remaining risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Admin in a shared browser** (F6): if an admin also holds a customer Auth session on the same origin, supabase-js attaches that JWT and admin reads evaluate as `authenticated` → email-scoped (admin sees only that customer). | Medium | Admin uses a separate browser/profile (or incognito) with no portal login; future: an admin role claim or service_role admin path. Document in ops notes. |
| R2 | **`inbox_messages` exposure** (pre-existing): RLS disabled → grants let any role SELECT inbound customer emails. Not introduced by 6B; not closed here. | Medium | Separate hardening change: ENABLE RLS + admin-only read policy, independently validated. Out of 6B scope. |
| R3 | **Storage isolation is app-enforced only** (no object-level RLS). A bug in portal path-confinement could expose another customer's files. | Medium | Private bucket + signed URLs already in place; optional `storage.objects` policy sketched in the 6A recommendations — validate paths before adopting. |
| R4 | **communications RLS enablement** turns on enforcement for a table whose every access path must be re-verified. If an admin path other than the known CRUD exists, it could be denied. | Medium | Full anon CRUD asserted; **staging admin-comms regression is mandatory** before prod. |
| R5 | **reviews ownership join parses `bookings.notes`** (`split_part('ref:')`): brittle if `notes` contains `ref:` elsewhere; correlated subquery per row. | Low | Acceptable at current volume (22 bookings); long-term fix is a `reviews.customer_email` column (deferred — needs writer changes). |
| R6 | **Open sign-up surface**: `signInWithOtp` defaults to `shouldCreateUser:true`; anyone can authenticate an email but sees a portal only if a booking exists under it. | Low | Authentication ≠ authorization (RLS scopes to email); consider rate-limiting/sign-up restriction later. |
| R7 | **Coupling**: these policies and the Magic Link provider are coupled — enabling Auth without them denies the portal; applying them without Auth is harmless (no authenticated callers yet). | Low | Apply with the Auth cut-over per the runbook; rollback = disable the provider (all clients revert to anon). |

---

## 8. Rollback

All objects are additive and reversible; no row data is modified.

```sql
-- bookings
DROP POLICY IF EXISTS "bookings_auth_select_own" ON bookings;
DROP POLICY IF EXISTS "bookings_auth_insert"     ON bookings;
DROP POLICY IF EXISTS "bookings_auth_update_own" ON bookings;
-- reviews
DROP POLICY IF EXISTS "reviews_auth_select_own"  ON reviews;
DROP POLICY IF EXISTS "reviews_auth_insert"      ON reviews;
-- communications  (drop the authenticated policy; optionally turn RLS back off)
DROP POLICY IF EXISTS "comm_auth_select_own"     ON public.communications;
-- ALTER TABLE public.communications DISABLE ROW LEVEL SECURITY;  -- only if reverting the enablement
-- audit_log
DROP POLICY IF EXISTS "audit_auth_insert"        ON public.audit_log;
-- public-content read coverage
DROP POLICY IF EXISTS "hm_data_auth_select"               ON hm_data;
DROP POLICY IF EXISTS "services_auth_select"              ON services;
DROP POLICY IF EXISTS "calendar_availability_auth_select" ON calendar_availability;
NOTIFY pgrst, 'reload schema';
-- GRANTs may be left (harmless without a matching policy when RLS is on).
```

**Fastest full mitigation if the portal/homepage breaks:** disable the Email/Magic
Link provider in Supabase → all clients revert to `anon` and original behaviour
resumes without touching SQL (the policies become dormant — no authenticated
callers).

---

## 9. Readiness score

| Dimension | Score | Basis |
|---|---|---|
| Isolation correctness | 9/10 | Per-customer scoping via `auth.email()` on bookings/communications; own-or-public on reviews; append-only audit. |
| Completeness vs. impact analysis (F1–F6) | 9/10 | F1, F1b, F2, F4, F5, missing-INSERT all fixed; F3 storage and R2 inbox consciously deferred with rationale. |
| Admin / CMS / automation preservation | 9/10 | All anon policies intact; edge uses service_role. communications enablement is the one item needing live admin regression (R4). |
| Public-site preservation for authenticated users | 9/10 | Public-content read coverage added; testimonials + booking form preserved. |
| Safety / reversibility | 10/10 | Additive policies + grants, idempotent, provider-disable rollback, no data change. |
| Live verification rigor | 6/10 | Code/design verified; portal/admin/storage staging checks are gated (require live Auth + inbox) and not yet executed. |

### **Phase 6B readiness: 87 / 100 — READY FOR STAGING (apply with the Auth cut-over; production-gated on the §6 staging checklist)**

- The migration is complete, additive, idempotent, and closes the gaps the Phase 6A
  impact analysis scored 35/100. The remaining work is **operational**: run it in
  staging alongside enabling the Magic Link provider, pass the §6 checklist
  (especially R4 admin-comms regression after `communications` RLS turns on), then
  promote.
- **Gate:** do not promote to production until the staging checklist is green. Do
  **not** start Phase 6C.

---

## 10. What was NOT done

- ❌ No SQL executed / no migration pushed / no production change.
- ❌ No application code modified (the portal already presents the `authenticated` role from Phase 6A).
- ❌ `inbox_messages` not changed (out of scope; exposure flagged as R2).
- ❌ Storage object-level RLS not added (app-enforced isolation retained).
- ❌ Phase 6C not started.

*Migration authored. Apply via the Phase 6A deployment runbook pattern (staging → production) with the Magic Link cut-over.*
