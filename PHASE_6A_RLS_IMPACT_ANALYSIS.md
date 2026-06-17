# Phase 6A — RLS Impact Analysis

**Purpose:** Determine whether `supabase/recommendations/PHASE_6A_customer_rls_recommendations.sql`
can be safely applied before Phase 6B.
**Verdict (TL;DR):** **NOT production-ready as written.** The recommendations are
directionally correct but incomplete and rest on schema assumptions that the
repository's own migrations contradict. Applying them as-is would **break the
public marketing site and portal storage for logged-in customers** and may
silently no-op on `communications`. Apply only after the required modifications
in §6 and the live verification in §9.

**No SQL was executed. No table was modified. Phase 6B was not started.**

---

## 1. Method

- Read the recommendations SQL and every relevant migration (`001`, `002`,
  `20260101000000_rls_policies`, `20260614000001_phase30_email_delivery`,
  `20260614000002_inbox_messages`, `20260616000001_audit_log`).
- Cross-checked column/role assumptions against the **live runtime code**
  (`bookingService.js`, `js/portal/*`, `js/services/auditService.js`).
- Traced which PostgREST **role** each workflow presents (admin, CMS, public
  site, portal) before and after Magic Link login.

---

## 2. Critical context: the role flip is **origin-wide**, not portal-only

Supabase-js persists the session in `localStorage` under a per-project key shared
by **every page on the origin** (`persistSession: true`, the default this build
relies on). Consequence:

> Once a customer clicks a Magic Link, **every** subsequent page load on the same
> origin — including `index.html` (the public marketing site) and the booking
> form — restores that session and presents PostgREST role **`authenticated`**,
> not `anon`.

This single fact drives most findings below. RLS policies are **per-role**: a
table whose only policies are `TO anon` will **deny** an `authenticated` caller
outright (when RLS is enabled). So enabling Auth doesn't just gate the portal —
it changes the role on tables the public site and booking form depend on.

---

## 3. Ground-truth schema findings (repo vs. live code)

| Table | Repo migration says | Live code (`bookingService.js` / portal) uses | Risk |
|---|---|---|---|
| `bookings` email col | `email` (001) | **`customer_email`** (`_bookingToRow`, `getBookingsByEmail` `.ilike('customer_email')`) | **HIGH** — recommendation targets `customer_email`; if the live column is actually `email`, the policy fails to create or silently scopes nothing. The live code working in Phase 5 implies `customer_email` exists, i.e. an **out-of-band migration not in this repo** altered the table. Must confirm live. |
| `bookings` date col | `move_date` (001) | `booking_date` | Medium — same drift class; not used by the RLS policies but proves the repo schema is stale. |
| `bookings.id` | `UUID` | UUID (`b.id::text` cast OK) | Low — cast is valid for UUID. |
| `reviews` | `booking_reference TEXT` exists (002); **no email column** | `booking_reference` written by portal; join-by-bookings required | Medium — confirmed no email column, so the join approach is necessary (and fragile, see §5). |
| `communications` | **No `CREATE TABLE` and no `ENABLE RLS` anywhere in the repo**; only an `ADD COLUMN` + `comm_anon_update` policy + `GRANT UPDATE TO anon` (phase30) | portal selects `customer_email, booking_id, sender_email, subject, message, direction, created_at` | **HIGH** — schema and RLS state are unknown from the repo. The recommended `comm_auth_select_own` may no-op (RLS disabled) or be insufficient (no anon base SELECT/INSERT in repo). |
| `inbox_messages` | RLS **DISABLED** (20260614000002) | not touched by portal | Medium — see §4. |
| `audit_log` | RLS **ENABLED**, anon INSERT+SELECT, `GRANT INSERT,SELECT TO anon` only | portal writes via `AuditService.record` | Medium — `authenticated` lacks a GRANT (see §5/F2). |

**RLS enablement confirmed in repo:** `hm_data`, `services`, `reviews`,
`bookings`, `calendar_availability` (all `ENABLE` + anon `USING(true)`), and
`audit_log`. **Not confirmed:** `communications`. **Disabled:** `inbox_messages`.

---

## 4. Per-table analysis

### bookings — **RISKY (needs work)**
- `bookings_auth_select_own` (SELECT, `customer_email = auth.email()`): conceptually correct; **depends on the `customer_email` column actually existing live** (§3).
- `bookings_auth_update_own` (UPDATE): needed for estimate approval, which post-login runs as `authenticated`. Correct in spirit, but:
  - Missing companion **`authenticated` INSERT** policy → the public booking form, submitted by a logged-in customer, runs as `authenticated` and would be **DENIED** (booking creation breaks). The form currently inserts as `anon`.
  - `set_updated_at` trigger and the `status` CHECK constraint are unaffected (good).
- **Admin impact:** none — admin is `anon`; existing `TO anon` policies untouched.

### communications — **RISKY / INDETERMINATE**
- `comm_auth_select_own` (SELECT, `customer_email = auth.email()`): mirrors the app-layer guard, good intent.
- But: if RLS is **disabled** on `communications` (repo never enables it), this policy has **no effect** and an `authenticated` client retains full table access (a *widening*, not a tightening). If RLS is **enabled**, the repo shows **no anon SELECT/INSERT base policy** — so admin send/read and the `comm_anon_update` path must be re-confirmed live or admin comms break.
- **Email-delivery workflow** (edge function `send-email`, status patch via `comm_anon_update`, inbound `receive-email` → `inbox_messages`) is all `anon`/`service_role` — unaffected by an added `authenticated` SELECT.

### reviews — **RISKY**
- `reviews_auth_select_own` (join to `bookings`, scoped by email): **two problems.**
  1. **Hides public testimonials from logged-in users.** It replaces (for the `authenticated` role) the open `USING(true)` read. A customer logged into the portal who opens `index.html` would see **only their own** review in the public testimonials widget (or none). Public marketing content regression.
  2. **Fragile join** — parses `bookings.notes` with `split_part(... 'ref:' ...)`; brittle if `notes` contains `ref:` elsewhere, and runs a correlated subquery per row (perf on large tables).
- `reviews_auth_insert` (`WITH CHECK (true)`): functionally needed for portal review submit; acceptable (moderation is admin-side via `approved=false`), but needs a GRANT (§5/F2).

### inbox_messages — **MISLEADING "no change"**
- Recommendation says "do not grant authenticated any access." But RLS is **DISABLED**, so role is irrelevant: `anon` **and** `authenticated` can already `SELECT *` from `inbox_messages` (which holds inbound customer emails) via table GRANTs. This is a **pre-existing exposure** the Phase 6A note does not actually close. Not introduced by Auth, but should be flagged: to protect it you must **ENABLE RLS + add an explicit policy** (and ensure admin's anon read still works), which is itself a change requiring its own validation.

### audit_log — **SAFE (with one fix)**
- `audit_auth_insert` (INSERT only, no SELECT): correct — preserves append-only and keeps the trail unreadable by customers.
- **Fix required:** the audit migration grants `INSERT,SELECT` to **anon only**. The `authenticated` role needs `GRANT INSERT ON public.audit_log TO authenticated` or the policy can't be exercised (§5/F2).
- No UPDATE/DELETE policies → immutability preserved. Good.

---

## 5. Cross-cutting findings

| ID | Finding | Severity |
|---|---|---|
| **F1** | **Public-content tables not covered.** `hm_data`, `services`, `calendar_availability` (and `reviews` read) have **anon-only** RLS. A logged-in customer on `index.html` is `authenticated` → these reads are **DENIED** → hero/FAQ/footer/services/calendar/testimonials **break for logged-in customers**. The recommendations omit these tables entirely. | **Critical** |
| **F2** | **GRANTs ≠ policies.** A policy authorizes a row; the role still needs table-level `GRANT`. The repo grants explicitly to `anon` (e.g. audit_log, communications UPDATE). Unless the project relies on Supabase's default `authenticated` grants, every new `authenticated` policy needs a matching `GRANT … TO authenticated`. | High |
| **F3** | **Storage RLS not provided.** Portal documents/photos/reviews call `storage.objects` (`list`, `upload`, `createSignedUrl`, `remove`). Post-login these run as `authenticated`. If the `media` bucket has anon-only storage policies, **all portal file operations break**. The recommendation explicitly defers object-level RLS, leaving a gap. | High |
| **F4** | **Schema drift (repo vs. live).** `customer_email`/`booking_date` (live) vs `email`/`move_date` (migration 001). RLS DDL must be validated against `information_schema` live, not the repo. | High |
| **F5** | **`communications` RLS state unknown** from the repo (no CREATE/ENABLE). Behaviour of the new policy is indeterminate until inspected live. | High |
| **F6** | **Admin in a shared browser.** If an admin's browser also holds a customer Auth session, admin booking reads would evaluate as `authenticated` and be email-scoped → admin sees only that customer. Low probability (separate users/devices) but a real edge case worth a deploy note. | Low |

---

## 6. Classification

### ✅ Safe to apply (low risk, after live column verification)
- `audit_log` → `audit_auth_insert` (INSERT only) **+ `GRANT INSERT ON public.audit_log TO authenticated`**.
- `bookings_auth_select_own` (SELECT, own email) — *once `customer_email` confirmed live*.
- `communications` → `comm_auth_select_own` (SELECT, own email) — *only if RLS is enabled and an anon base SELECT exists; otherwise no-op/insufficient*.

### ⚠️ Risky — do not apply without modification
- `reviews_auth_select_own` — would hide public testimonials (F4 in the SQL / §4). Must become "approved/published **OR** own booking."
- `bookings_auth_update_own` — fine in isolation, but ships without the companion **`bookings_auth_insert`** the booking form needs.
- `inbox_messages` "no change" — does not actually protect the table (§4).
- Storage helper `hm_storage_owner_email` + `media_auth_rw_own` — sketch only; unvalidated against real paths; correlated subquery per object.

### ❌ Missing — required before any go-live
- `authenticated` **read** policies (`USING (true)`) on `hm_data`, `services`,
  `calendar_availability`, and an **approved-or-own** read on `reviews` (F1).
- `authenticated` **INSERT** on `bookings` and `reviews` (booking form, review submit).
- `authenticated` storage policies for the `media` bucket (F3).
- Explicit `GRANT … TO authenticated` per table (F2).

---

## 7. Required modifications (summary spec — not executed)

1. **Cover public-content tables for the authenticated role** (prevents homepage breakage):
   - `hm_data`, `services`, `calendar_availability`: add `FOR SELECT TO authenticated USING (true)`.
   - `reviews`: authenticated SELECT = `USING (approved OR published OR <own-booking join>)`.
2. **Add authenticated write paths the public flows need:**
   - `bookings`: `FOR INSERT TO authenticated WITH CHECK (true)` (booking form).
   - `reviews`: keep `reviews_auth_insert` (already proposed).
3. **Add GRANTs** for every authenticated policy: `GRANT SELECT/INSERT/UPDATE … TO authenticated` to match.
4. **Provide and validate storage policies** for `media` (authenticated list/read/insert/delete scoped to the booking-owner email), or formally accept signed-URL-only with a documented private-bucket posture **and confirm `createSignedUrl` works for `authenticated`**.
5. **Resolve schema drift first:** confirm `bookings.customer_email` (and `communications.customer_email`) exist live; otherwise rewrite predicates to the real column names.
6. **`communications`:** confirm RLS enabled + anon base SELECT/INSERT present before relying on `comm_auth_select_own`.
7. **`inbox_messages`:** decide explicitly — leave RLS disabled (accept exposure) or enable RLS with an admin-anon SELECT policy; do not imply protection that isn't there.

---

## 8. Deployment order (when modifications are ready)

1. **Staging clone first.** Never first-run on production.
2. Run the **read-only verification queries** (§9). Reconcile every column/role/RLS assumption.
3. Apply, in one transaction per logical group, **on staging**:
   1. Public-content authenticated **read** policies (`hm_data`, `services`, `calendar_availability`, `reviews` approved-or-own) **+ grants** — *unblocks the whole-origin role flip first.*
   2. `bookings` authenticated SELECT + INSERT + UPDATE **+ grants**.
   3. `communications` authenticated SELECT **+ grant** (only if RLS enabled + base policies exist).
   4. `audit_log` authenticated INSERT **+ grant**.
   5. Storage `media` authenticated policies (if adopting object-level RLS).
4. **Enable the Email/Magic Link provider and allow-list the portal origin only after the above is green in staging** (per Phase 6A report §9). Enabling Auth before the policies exist is what causes breakage.
5. Run the regression matrix as both an authenticated customer **and** an anonymous public visitor; confirm admin (anon) unaffected.
6. Promote table-group-by-table-group to production during a low-traffic window, re-running smoke checks after each.

---

## 9. Pre-flight verification (read-only — run live, change nothing)

```sql
-- Confirm real column names (resolves the email/customer_email drift)
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('bookings','communications','reviews','inbox_messages','audit_log')
  AND column_name LIKE '%email%' ORDER BY table_name, column_name;

-- Confirm which tables actually enforce RLS
SELECT relname, relrowsecurity AS rls_enabled
FROM pg_class WHERE relnamespace='public'::regnamespace
  AND relname IN ('bookings','communications','reviews','inbox_messages','audit_log',
                  'hm_data','services','calendar_availability');

-- Enumerate existing policies + their roles (find anon-only gaps)
SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname='public' ORDER BY tablename, cmd;

-- Confirm table-level grants per role (the F2 gap)
SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND grantee IN ('anon','authenticated')
ORDER BY table_name, grantee, privilege_type;

-- Storage policies on the media bucket
SELECT policyname, roles, cmd FROM pg_policies
WHERE schemaname='storage' AND tablename='objects';
```

If query 1 returns `email` (not `customer_email`) for `bookings`, **stop** and
rewrite the policies before proceeding.

---

## 10. Rollback plan

Every recommended object is additive and individually reversible; nothing drops
or alters existing anon policies, so rollback is low-risk **provided you also
roll back the Auth enablement** (the policies and the provider are coupled).

**Per-object rollback (immediate):**
```sql
DROP POLICY IF EXISTS "bookings_auth_select_own"  ON bookings;
DROP POLICY IF EXISTS "bookings_auth_update_own"  ON bookings;
DROP POLICY IF EXISTS "bookings_auth_insert"      ON bookings;
DROP POLICY IF EXISTS "comm_auth_select_own"      ON communications;
DROP POLICY IF EXISTS "reviews_auth_select_own"   ON reviews;
DROP POLICY IF EXISTS "reviews_auth_insert"       ON reviews;
DROP POLICY IF EXISTS "audit_auth_insert"         ON public.audit_log;
-- plus any hm_data/services/calendar authenticated read policies added in §7
-- (GRANTs may be left; they are harmless without a matching policy when RLS is on)
```

**Coupled rollback (the important one):** because the **role flip is the root
cause**, the fastest full mitigation if the portal or homepage breaks is to
**disable the Email/Magic Link provider** (Supabase → Authentication → Providers)
and have customers fall back to the retained legacy login path. With no new Auth
sessions minted, all clients revert to `anon` and the original behaviour resumes
without touching SQL. Existing sessions clear on `signOut`/expiry.

**Pre-change snapshot:** capture `pg_policies` + `role_table_grants` output (§9)
before applying so the exact prior state can be restored.

**No data rollback needed** — these are policy/grant DDL only; no row data is modified.

---

## 11. Production readiness score

| Dimension | Score | Notes |
|---|---|---|
| Correctness of intent | 7/10 | Right model (per-customer isolation via `auth.email()`), right "additive, keep anon" instinct. |
| Schema accuracy | 3/10 | Targets `customer_email` while the only repo schema says `email`; reviews join is fragile; unverified live. |
| Completeness | 2/10 | Omits public-content tables (F1), authenticated booking INSERT, grants (F2), and working storage policies (F3). |
| Safety if applied as-is | 2/10 | Would break the public site + portal storage for logged-in users; communications policy may silently no-op. |
| Reversibility | 9/10 | Fully additive; coupled rollback via disabling the provider is clean. |
| Verification rigor provided | 4/10 | Rollout notes exist; live `information_schema`/`pg_policies` pre-flight was missing (added here in §9). |

### **Overall: 35 / 100 — NOT READY (Conditional-Go)**

- **Do not** apply the file as written, and **do not** enable the Magic Link
  provider in production until the §6/§7 modifications land and §9 verification
  passes in staging.
- After modifications + live verification, the design is sound and the path to a
  **Go** is straightforward — the gaps are additive policies/grants, not a
  redesign.

---

## 12. Answers to the requested detections

- **Possible conflicts:** schema drift (`customer_email` vs `email`); `communications` RLS/base-policy state unknown; `audit_log`/`communications` grant to `anon` only.
- **Admin workflow breakage:** none from the proposed policies directly (admin is `anon`); only the shared-browser edge case (F6).
- **Portal workflow breakage:** **yes, if applied with Auth but without** authenticated storage policies (docs/photos/reviews) and without the booking-INSERT/grant fixes.
- **CMS workflow breakage:** none directly (CMS/WMC are `anon` on `hm_data`/`services`), **but** a logged-in customer viewing CMS-rendered public content hits F1 (homepage content denied) — a content-display regression, not a CMS-write break.
- **Communication workflow breakage:** none for the admin/edge `anon`/`service_role` paths; portal read depends on `communications` RLS being enabled with the new policy **and** an anon base policy still present.

*Analysis only. No SQL executed, no tables modified, Phase 6B not started.*
