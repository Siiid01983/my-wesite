# Phase 6A.1 — Live Supabase Schema & RLS Audit

**Goal:** Build a complete, evidence-based inventory of the **live** Supabase
project before any RLS deployment.
**Method:** Read-only probing with the **public anon key only** (the same access
the public website uses) against `https://ursohvtxzqxeczvrspiw.supabase.co`.
GET/HEAD reads + storage LIST only. **No SQL, no writes, no policy/storage/code
changes. Phase 6B not started.**

> **Headline:** Live column truth was obtained and resolves the open schema-drift
> questions — but it also uncovered **two blocking defects** the earlier
> recommendations depended on: the live `reviews` table has **no booking-link or
> email column at all**, and `bookings` has **no `updated_at` column** (which the
> approval/update code writes). The anon key **cannot** read `pg_policies`,
> grants, RLS flags, or storage policies, so the policy/grant/storage inventory
> below is split into **EMPIRICALLY CONFIRMED** vs **REQUIRES PRIVILEGED QUERY**.

---

## 1. Access boundary (what this audit can and cannot prove)

| Capability | Anon key result |
|---|---|
| Actual column names | ✅ Confirmed (sampled rows + per-column 200/400 existence probes). |
| Row counts (per table) | ✅ Confirmed via `Content-Range` exact count. |
| Anon **read** posture (RLS effect for `anon`) | ✅ Inferred (tables returning rows allow anon SELECT). |
| Actual indexes | ❌ Not exposed over PostgREST — needs `pg_indexes`. |
| RLS enabled/disabled flag per table | ❌ Not exposed — needs `pg_class.relrowsecurity`. |
| Existing policies (names/roles/predicates) | ❌ Not exposed — needs `pg_policies`. |
| Table grants per role | ❌ Not exposed — needs `information_schema.role_table_grants`. |
| Storage bucket list / object inventory | ⚠️ Inconclusive — anon returned empty (RLS/permission-gated). |
| `authenticated`-role behaviour | ❌ Cannot test without minting a real login (side-effecting email). |

Privileged read-only queries to close every ❌/⚠️ are in **Appendix A** (run in
the Supabase SQL Editor / with `service_role`). They change nothing.

---

## 2. Table inventory (LIVE — confirmed)

| Table | Rows visible to anon | Live columns (authoritative) | Anon read |
|---|---|---|---|
| **bookings** | 22 | `id, created_at, customer_name, customer_email, customer_phone, booking_date, service_id, status, notes` | ✅ allowed |
| **communications** | 31 | `id, booking_id, customer_email, sender_email, subject, message, direction, created_by, created_at, email_status, email_error, sent_at` | ✅ allowed |
| **reviews** | 0 | `id, customer_name, rating, review_text, approved, created_at, reference_id, headline, service, date_label, location, published` | ✅ allowed (empty) |
| **inbox_messages** | 0 | `id, sender, email, subject, body, booking_id, created_at` | ✅ allowed (RLS disabled) |
| **audit_log** | 1 | `id, created_at, actor, action, target_type, target_id, details` | ✅ allowed |
| **services** | 0 | `id, title, description, display_order, active, reference_id, badge, cta_text` (no `icon`) | ✅ allowed (empty) |
| **hm_data** | 10 | `key, value, updated_at` (no `id`) | ✅ allowed |
| **calendar_availability** | 0 | `date, status` (only) | ✅ allowed (empty) |

---

## 3. Schema-drift findings (live vs. repo migrations vs. live code)

| # | Severity | Finding (with evidence) |
|---|---|---|
| **D1** | 🟢 Resolved | **`bookings.customer_email` EXISTS; `email` does NOT** (`400 column bookings.email does not exist`). Confirms the live schema matches the **code** (`bookingService.js`), not migration `001` (`email`/`move_date`). The Phase 6A RLS predicate `customer_email = auth.email()` targets the **correct** column. Likewise `booking_date`/`customer_phone`/`service_id` exist; `move_date`/`phone`/`service_type` do not. |
| **D2** | 🔴 **Blocking** | **`reviews` has NO booking-link and NO email column.** `400` for `booking_reference`, `booking_id`, `source`, **and** `customer_email`. Consequences: (a) the Phase 5G **customer review submit is broken on live** — `portalReviews.submit()` inserts `source` + `booking_reference`, both absent → PostgREST 400; (b) the Phase 6A recommended reviews RLS (join on `booking_reference`) is **impossible** — there is no column to scope by. Per-customer review isolation **cannot** be enforced at the DB layer without a schema change first. |
| **D3** | 🔴 **Blocking (operational)** | **`bookings.updated_at` does NOT exist** (`400 column bookings.updated_at does not exist`). `bookingService.updateBooking` / `cancelBooking` / `approveEstimate` all send `updated_at` in the update payload → these writes **400 on live**. The portal **estimate-approval** path (Phase 5F) writes `{status, updated_at}` and would therefore fail. (Pre-existing; surfaced here because Phase 6A relies on the approval path working as an `authenticated` user.) |
| **D4** | 🟡 Minor | **`bookings.reference_id` absent** — the HM-`ref` lives only inside `notes` (`ref:…`), confirming the notes-parsing lookup is the only id bridge (relevant to any review→booking mapping). |
| **D5** | 🟡 Minor | **`services.icon` absent**, **`calendar_availability` is only `(date, status)`** (no `capacity`/`bookings_count`/`notes`/`updated_at`). Repo migration `001`/`002` over-describe both tables. No Phase 6A impact, but proves the repo migrations are **not** a reliable schema source. |

> **Net:** the repository migrations (`001`, `002`) are **stale**; the live schema
> is leaner and was shaped by out-of-band changes. Any RLS DDL must be written
> against the **live** columns above, not the repo.

---

## 4. Policy inventory

### Empirically confirmed (anon role)
- `anon` can **SELECT** `bookings`, `communications`, `hm_data`, `audit_log`
  (rows returned), and `reviews`/`services`/`calendar_availability`/`inbox_messages`
  (200, currently empty). Consistent with the repo's `USING (true)` anon policies.
- `audit_log` is **anon-readable** (1 row returned) — confirms the documented
  over-permissive audit read (anyone with the anon key can read the trail).
- `inbox_messages` is anon-reachable — consistent with **RLS disabled** (migration
  `20260614000002`); it holds inbound customer emails and is currently empty.

### Requires privileged query (Appendix A) — **UNKNOWN from anon**
- Whether RLS is **enabled** on each table (the repo says yes for bookings/
  reviews/services/hm_data/calendar + audit_log; **unconfirmed live**, and
  **communications enablement is undocumented**).
- Exact policy names/roles/predicates, especially any `comm_anon_*` base policies
  for `communications` (none in the repo besides `comm_anon_update`).
- **Whether ANY `authenticated`-role policy exists.** Given the project has never
  used Supabase Auth, the working assumption is **none exist** → every
  authenticated access path is currently unprovisioned.

---

## 5. Grants inventory

**UNKNOWN from anon** (needs `information_schema.role_table_grants`). The repo
grants explicitly to `anon` only on at least `audit_log` (`GRANT INSERT,SELECT … TO anon`)
and `communications` (`GRANT UPDATE … TO anon`). Whether the `authenticated` role
holds table grants (via Supabase defaults or explicit grants) is unverified and is
a prerequisite: **a policy without a matching grant does not grant access.**

---

## 6. Storage inventory

| Probe (anon, read-only) | Result | Interpretation |
|---|---|---|
| `GET /storage/v1/bucket` | `200 []` | Anon sees no bucket metadata (bucket table is RLS/permission-gated). **Does not prove buckets are absent.** |
| `POST /storage/v1/object/list/media` (LIST) | `200`, 0 objects | The `media` bucket endpoint responds `200` (not `404`), implying the bucket **exists**, but anon object listing returns empty — consistent with RLS-filtered listing or an empty prefix. **Inconclusive.** |

**Conclusion:** Storage posture (bucket visibility, public/private flag, and
`storage.objects` policies per role) **cannot be determined with the anon key** and
must be read with `service_role` (Appendix A). This matters because the portal’s
documents/photos/reviews features call `storage.objects` and will run as
`authenticated` after Magic Link.

---

## 7. Surface → table usage map

| Table | Public site (`index.html`) | Portal (`portal.html`) | Admin (`admin.html`) | CMS / WMC |
|---|---|---|---|---|
| bookings | INSERT (booking form) | SELECT own + UPDATE (approval) | full CRUD | — |
| communications | — | SELECT own (read-only) | send / read / status-update | — |
| reviews | SELECT (testimonials) | SELECT/INSERT own | moderate (CRUD) | — |
| calendar_availability | SELECT (calendar widget) | — | CRUD | — |
| services | SELECT | — | CRUD | SELECT/CRUD (images) |
| hm_data | SELECT (hero/FAQ/footer/theme) | — | read/write | read/write (content/theme) |
| audit_log | — | INSERT (approval/review) | read + insert | — |
| inbox_messages | — | — | read | — |
| storage `media` | reads media URLs | list/upload/download/delete | media library | media library |

**Role presented to PostgREST today:** Public site, Admin, and CMS all use the
**`anon`** key (no Supabase Auth). Only the Phase 6A portal, after Magic Link,
will present **`authenticated`** — and because the session persists in
`localStorage` **per-origin**, that role is then presented by **every page on the
origin**, including `index.html`.

---

## 8. Detections

### 8.1 Schema drift
See §3. Blocking: **D2** (reviews has no link/email column), **D3** (bookings has
no `updated_at`). Minor: D4, D5. The reviews gap means the prior RLS
recommendation for `reviews` is **not implementable** on the live schema.

### 8.2 Missing `authenticated` policies
Assume **none exist** (project never used Auth; unconfirmable via anon). Therefore
**all** authenticated paths are unprovisioned: `bookings` (select own / insert /
update), `communications` (select own), `reviews` (select/insert), `audit_log`
(insert), plus every **public-content** read (`hm_data`, `services`,
`calendar_availability`, `reviews`) and **storage**.

### 8.3 Public pages that break after Magic Link login
If RLS is enabled with anon-only policies (per repo), a logged-in customer is
`authenticated` on **every** page, so on `index.html` these would be **denied**:
- `hm_data` → hero / FAQ / footer / theme content fails to load.
- `services` → service cards fail.
- `reviews` → testimonials fail.
- `calendar_availability` → booking calendar widget fails.
- `bookings` **INSERT** (booking form) → new bookings from a logged-in user fail.

This is the highest-impact risk and is **not** addressed by the existing
recommendations file. (Validate exact RLS state via Appendix A before sizing.)

### 8.4 Storage operations that fail after Auth activation
Portal `PortalDocs` / `PortalPhotos` / `PortalReviews` call `list`,
`createSignedUrl`, `upload`, `remove` on `storage.objects`. Post-login these run
as `authenticated`. If `media` storage policies are anon-only (unknown), **all**
portal file operations fail. Must be confirmed (Appendix A) and provisioned.

### 8.5 Policy conflicts
- **Reviews scoping conflict (blocking):** recommended `reviews_auth_select_own`
  joins on `booking_reference`, which **does not exist** → cannot be created.
- **Reviews public-read regression:** any `authenticated` scoped SELECT that
  replaces `USING(true)` would hide public testimonials from logged-in visitors.
- **Approval write conflict:** `bookings_auth_update_own` is moot while the
  approval write itself fails on the missing `updated_at` column (D3).

---

## 9. Recommended deployment sequence (analysis only — no SQL emitted)

1. **Run Appendix A** with `service_role` to capture authoritative RLS flags,
   policies, grants, indexes, and storage policies. Snapshot the output (baseline
   for rollback).
2. **Fix the blocking schema gaps FIRST (separate, code-owned change — not RLS):**
   - Decide the `reviews` ↔ booking/customer linkage (add `booking_reference`
     **and** a `customer_email`, or a `booking_id` FK) so reviews can be scoped
     **and** so Phase 5G submit works at all. Backfill as needed.
   - Resolve `bookings.updated_at` (add the column **or** stop sending it in
     `bookingService` update/cancel/approve) so the approval path works for
     authenticated users.
3. **Provision the `authenticated` role broadly before enabling Auth** (prevents
   the §8.3 origin-wide breakage):
   - public-content **read** for `hm_data`, `services`, `calendar_availability`,
     and `reviews` (approved/published **or** own);
   - `bookings` authenticated SELECT-own / INSERT / UPDATE-own;
   - `communications` authenticated SELECT-own (only after confirming RLS state +
     anon base policies);
   - `audit_log` authenticated INSERT (no SELECT);
   - matching **GRANTs** for each;
   - **storage** `media` authenticated policies (or a verified signed-URL-only
     posture).
4. **Stage → verify** as both an authenticated customer and an anonymous visitor;
   confirm admin/CMS (anon) unaffected.
5. **Only then** enable the Magic Link provider + allow-list the portal origin.
6. Promote table-group by table-group during low traffic; re-smoke after each.

> Detailed policy specs are intentionally **not** emitted here (analysis-only
> phase). They belong to the deployment phase, rewritten against §2 live columns
> after the §9.2 schema fixes land.

---

## 10. Production readiness score

| Dimension | Score | Basis |
|---|---|---|
| Discovery completeness (columns/counts/anon-read) | 8/10 | Column truth + anon posture confirmed live; indexes/policies/grants/storage still require privileged queries. |
| Schema correctness for RLS | 3/10 | `customer_email` confirmed (good), but reviews linkage absent (D2) and `bookings.updated_at` absent (D3) are blocking. |
| Policy provisioning for Auth | 1/10 | No `authenticated` policies/grants known to exist; public-content + storage uncovered. |
| Safety of enabling Auth **today** | 1/10 | Would break public site reads + booking form + portal storage for logged-in users. |
| Recovery posture | 9/10 | Auth is reversible by disabling the provider; all RLS work would be additive. |

### **Overall RLS-deployment readiness: 30 / 100 — NOT READY**

- **Blockers before any RLS rollout:** D2 (reviews linkage/email), D3
  (bookings `updated_at`), and the absence of any `authenticated` provisioning
  (policies + grants + storage), plus the unread policy/grant/storage inventory.
- **Strength:** the central drift question is now settled — `customer_email` is
  real, so the email-based isolation model is viable **once** the blockers are
  cleared and the privileged inventory (Appendix A) is captured.

---

## Appendix A — Privileged read-only verification queries (run with service_role; change nothing)

```sql
-- A1. RLS enabled per table
SELECT relname, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class WHERE relnamespace='public'::regnamespace
  AND relname IN ('bookings','communications','reviews','inbox_messages','audit_log',
                  'services','hm_data','calendar_availability');

-- A2. All policies (names, roles, commands, predicates)
SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname='public' ORDER BY tablename, cmd;

-- A3. Table grants per role (does `authenticated` hold any privilege?)
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public' AND grantee IN ('anon','authenticated')
ORDER BY table_name, grantee, privilege_type;

-- A4. Indexes (not visible over PostgREST)
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname='public'
  AND tablename IN ('bookings','communications','reviews','inbox_messages','audit_log',
                    'services','hm_data','calendar_availability')
ORDER BY tablename, indexname;

-- A5. Storage buckets (public flag) + object policies
SELECT id, name, public, file_size_limit FROM storage.buckets;
SELECT policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname='storage' AND tablename='objects';

-- A6. Confirm the blocking column gaps at the catalog level
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('bookings','reviews')
ORDER BY table_name, ordinal_position;
```

---

## Appendix B — Evidence log (anon key, read-only)

```
bookings              count=22  cols: id, created_at, customer_name, customer_email,
                                       customer_phone, booking_date, service_id, status, notes
  bookings.email           => 400 column bookings.email does not exist
  bookings.updated_at      => 400 column bookings.updated_at does not exist
  bookings.reference_id    => 400 column bookings.reference_id does not exist
communications        count=31  cols: id, booking_id, customer_email, sender_email, subject,
                                       message, direction, created_by, created_at,
                                       email_status, email_error, sent_at
reviews               count=0   cols present: id, customer_name, rating, review_text, approved,
                                       created_at, reference_id, headline, service, date_label,
                                       location, published
  reviews.booking_reference=> 400 does not exist
  reviews.booking_id       => 400 does not exist
  reviews.source           => 400 does not exist
  reviews.customer_email   => 400 does not exist
inbox_messages        count=0   cols: id, sender, email, subject, body, booking_id, created_at
audit_log             count=1   cols: id, created_at, actor, action, target_type, target_id, details
services              count=0   cols: id, title, description, display_order, active,
                                       reference_id, badge, cta_text   (icon => 400 does not exist)
hm_data               count=10  cols: key, value, updated_at
calendar_availability count=0   cols: date, status   (capacity => 400 does not exist)
storage GET /bucket            => 200 []     (anon sees no bucket metadata)
storage LIST media             => 200 0 objects (bucket reachable; listing empty/filtered)
```

*Analysis only. No SQL executed, no policies/tables/storage/code modified, Phase 6B not started.*
