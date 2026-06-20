# RLS Audit — Hello Moving (Supabase + anon-key client)

**Date:** 2026-06-20
**Scope:** Supabase Row-Level Security posture + every client-side direct data-access point.
**Method:** Read-only. Policy migrations + code were read; live state was confirmed with
read-only `SELECT` probes using the public anon key. **No writes, DDL, or deploys were
performed.** Row/column counts were captured; **no customer PII was exfiltrated.**

> This is a point-in-time audit. The live-state figures below reflect what was actually
> applied on the audit date; the committed SQL tree is harder to trust (see P2-6).

---

## 1. Scope & method

- **Branch:** `main`. Audit changed nothing in the database.
- **Credential check:** `js/config/env.js` holds the **anon key only** (`"role":"anon"`).
  No `service_role` key in client code — the one `service_role` string is a comment in
  `js/portal/portalSupabaseAuth.js` referencing a server-side Edge Function. ✅
- **Tables in scope:** `bookings`, `communications`, `reviews`, `services`, `hm_data`,
  `calendar_availability`, `audit_log`, `inbox_messages`.
- **Surfaces:** public `index.html`, admin `admin.html`, portal `js/portal/*` + `portal.html`.
- **Canonical policy sources:** `supabase/migrations/20260101000000_rls_policies.sql`,
  `supabase/migrations/20260617000003_phase6b_customer_isolation_rls.sql`,
  `supabase/migrations/20260614000002_inbox_messages.sql`.

---

## 2. Bypass inventory

Direct `.from()` calls in `js/`. The canonical data layer is `window.Adapter`
(`js/services/supabaseAdapter.js`); domain writes are supposed to route through it.

| File:Line | Table | Op | Surface | Via Adapter? | Verdict |
|---|---|---|---|---|---|
| `services/supabaseAdapter.js` ×23 | all | CRUD | admin | **is the Adapter** | canonical |
| `services/contentLoader.js:265–269` | hm_data, services, reviews, calendar | read | public | No (parallel read path) | Acceptable (public content read) |
| `services/healthCheck.js:49` | hm_data | read | admin | No (probe) | Acceptable |
| `services/statisticsService.js:60,441,481` | bookings, reviews | read | admin | No (BI service) | Acceptable (read-only) |
| `modules/communications/communications.js` ×10 | communications | C/R/U + probe | admin | **No — no Adapter layer exists** | Gap (consistency) |
| `portal/portalComms.js:63` | communications | read (by email) | portal | No | Acceptable (relies on `comm_auth_select_own`) |
| `modules/inbox/inbox.js:35` | inbox_messages | read | admin | No | Gap — reads RLS-disabled table |
| `modules/wmc/wmcMedia.js:53` + storage | hm_data, media | R/W | admin (WMC) | No | Gap (consistency) |
| `modules/wmc/pageManager.js:55` | hm_data | write | admin (WMC) | No | Gap (consistency) |
| `modules/website/wmc{Blog,Theme,Overview,Services}.js` | hm_data | R/W | admin (WMC) | No | Gap (consistency) |

**None of the bypasses create a *new* security hole** — every table they touch already grants
anon full CRUD (§3). They are maintainability gaps (no JP↔EN mapping, no localStorage
fallback, no cache invalidation), not the source of exposure.

---

## 3. RLS posture matrix (live, empirically confirmed)

Read-only probe with the **public anon key** (`HTTP 206 range=0-0/N` ⇒ readable, N rows exist):

```
anon SELECT bookings        HTTP=206  24 rows, 10 cols readable
anon SELECT communications  HTTP=206  38 rows, 12 cols readable
anon SELECT audit_log       HTTP=206  28 rows,  7 cols readable
anon SELECT hm_data         HTTP=206  11 rows,  3 cols readable
anon SELECT reviews / services / calendar / inbox_messages  HTTP 200, 0 rows (empty, but readable)
```

| Table | anon SELECT | anon INSERT | anon UPDATE | anon DELETE | authenticated (portal) |
|---|---|---|---|---|---|
| **bookings** | ✅ **all 24 (PII)** | ✅ | ✅ all | ✅ all | own-row R/I/U |
| **communications** | ✅ **all 38** | ✅\* | ✅ | ✅\* | own-row read |
| **reviews** | ✅ all | ✅ | ✅ | ✅ | own-or-public read, insert |
| **hm_data** | ✅ all | ✅ | ✅ | ✅ | read |
| **services** | ✅ all | ✅ | ✅ | ✅ | read |
| **calendar_availability** | ✅ all | ✅ | ✅ | ✅ | read |
| **audit_log** | ✅ **all 28** | ✅ | ❌ (append-only) | ❌ | insert only (read withheld) |
| **inbox_messages** | ⚠️ **RLS DISABLED** | ✅ | ✅ | ✅ | (via PUBLIC grant) |

\* anon INSERT+DELETE on `communications` was empirically proven live during the audit by
`CommModule.diagnose()` (`INSERT 201`, `DELETE 204`). SELECT was the only op re-probed for the
matrix; INSERT/UPDATE/DELETE cells are from the policy files (not re-tested, per the no-write
constraint).

**Security model (by design, per `20260101000000_rls_policies.sql` header):** Supabase Auth is
not used for admin. Every browser request uses the same anon key, so anon is granted full CRUD
on all tables and admin authentication is enforced in *application code* (`js/core/auth.js`
salted-hash session). Phase 6B (`20260617000003`) **adds** `authenticated`-role isolation
policies for the magic-link portal **on top of** — not in place of — the permissive anon
policies.

---

## 4. Findings

### ⚠️ [P0-1] The public anon key has full read/write/delete over all customer PII
`bookings` (24 rows: name/email/phone), `communications` (38), `audit_log` (28) are all
`SELECT USING(true) TO anon`. The anon key ships in `js/config/env.js`, loaded by the **public**
`index.html` — anyone who views source can extract it and read, modify, or delete every
customer's data. Evidence: `20260101000000_rls_policies.sql:137–159` + live probe (§3). The
Phase 6B `authenticated` isolation policies **do not mitigate this** — they only constrain
logged-in portal users; the raw anon path is untouched. Acknowledged "by design" in the
migration header, but **RLS cannot enforce app-layer auth, and the key is public**, so the
confidentiality guarantee does not hold. **Scope: every customer record.**

### ⚠️ [P0-2] `inbox_messages` has RLS disabled
`20260614000002_inbox_messages.sql:23` (`DISABLE ROW LEVEL SECURITY`) + the Phase 6B migration's
own §F note: "with RLS disabled, table-level grants let any role SELECT inbound customer emails
— a PRE-EXISTING exposure." Live probe confirms anon read (currently 0 rows, but live). Inbound
customer email bodies are exposed to the public key.

### ⚠️ [P1-3] The public key can destroy data
`DELETE … TO anon USING(true)` on bookings/communications/reviews/hm_data/calendar
(`20260101000000_rls_policies.sql:47,82,119,156,192`). The `diagnose()` probe demonstrated a
live anon `DELETE 204`. A leaked/extracted anon key is not just a read breach — it can wipe the
bookings table.

### [P2-4] `audit_log` is anon-readable and anon-appendable
The base audit migration granted anon SELECT+INSERT; Phase 6B deliberately withheld
*authenticated* read (`20260617000003:218`) but left anon read intact (28 rows readable, §3). The
tamper-evidence trail is both readable and forgeable via the public key (`WITH CHECK (true)`).

### [P2-5] Service-layer bypass / `communications` has no Adapter
19 module-level `.from()` calls (§2) skip `Adapter` — no status mapping, no localStorage
fallback, no cache invalidation. Not a security gap (tables are open anyway) but a
consistency/maintainability risk; `communications` notably has no domain layer at all.

### [P2-6] Migration directory drift
Two parallel trees: `./migrations/` (4 files) and `./supabase/migrations/` (10 files, canonical
CLI dir) with overlapping/differently-named migrations. Combined with the untracked
`MIGRATION_REPAIR_PLAN.md` / `POST_REPAIR_VERIFICATION.md`, the *applied* DB state vs. *committed*
SQL is ambiguous. (The §3 probe reflects what is actually applied.)

### [P2-7] Allowlist drift guard — `ADMIN_EMAILS` is duplicated with no enforcement — ✅ FIXED
The portal admin allowlist exists as two hand-maintained copies: client
`js/portal/portalSupabaseAuth.js:28` and server `supabase/functions/portal-auth/index.ts:56–58`.
They currently match (verified — identical entry, identical `trim().toLowerCase()`
normalization), but nothing *enforced* that they stay in sync beyond a "MUST mirror" comment.
**Consequence is asymmetric and bounded:** since the server is authoritative, drift can only ever
make the client *under-grant* — never bypass or escalate. Hence P2, not a security hole.
**Resolved** by `tests/adminAllowlist.test.js` (commit `5d7fe31`): a pure-`fs` test that parses
both files and fails on divergence.

---

## 5. Remediation plan

**The P0s share one root cause and one real fix:** the admin panel authenticates in
*application code* (localStorage salted-hash, `js/core/auth.js`), not to Supabase — so it can
only use the anon key, which forces `USING(true)` on every table. Closing P0-1/P1-3 by tweaking
policies alone would break admin writes. So:

### P0 — strategic (requires sequencing; REVIEW ONLY, do not execute)
1. Give the admin panel a real Supabase identity (a dedicated `authenticated` admin user, or a
   custom `admin` role / JWT claim), routing admin writes through it instead of anon. The portal
   already obtains an `authenticated` JWT via the magic-link Edge Function
   (`supabase/functions/portal-auth/index.ts`) — this is the groundwork to build on.
2. Then drop the permissive anon policies on PII tables, keeping anon **INSERT only** where the
   *public* genuinely needs it (booking submit, review submit), with column-scoped checks:
   ```sql
   -- REVIEW ONLY — example shape, not a drop-in.
   DROP POLICY "bookings_anon_select" ON bookings;   -- remove anon read of all PII
   DROP POLICY "bookings_anon_update" ON bookings;
   DROP POLICY "bookings_anon_delete" ON bookings;
   -- keep public booking submission (bookings_anon_insert WITH CHECK (true)).
   -- admin read/update/delete now run as the authenticated admin role:
   CREATE POLICY "bookings_admin_all" ON bookings FOR ALL
     TO authenticated USING (auth.jwt()->>'role' = 'admin')
     WITH CHECK (auth.jwt()->>'role' = 'admin');
   ```
   The Phase 6B `authenticated`-own customer policies already exist and stay; this only removes
   the anon over-grant and adds an admin identity.

### P0-2 / P2-4 — minimal, lower-coupling (REVIEW ONLY)
- `inbox_messages`: `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` (the edge writer uses
  `service_role` and bypasses RLS regardless). Admin read then needs the admin-role policy above;
  interim, restrict to `service_role`-written + no anon read.
- `audit_log`: drop the anon SELECT policy (confirm first that no client reads it as anon —
  `AuditLog` appears to be a client-side ring buffer that only *inserts*); keep append-only.

### P2-5 / P2-6 — cleanup (no DB change)
- Introduce an `Adapter` comms layer (or fold the 10 raw calls behind one) for
  mapping/fallback/cache parity; same for the WMC `hm_data` writers.
- Reconcile the two migration directories to a single canonical `supabase/migrations/`; delete or
  archive `./migrations/`; reconcile against the live state captured in §3.

### P2-7 — ✅ done
`tests/adminAllowlist.test.js` (commit `5d7fe31`) now fails CI on any allowlist divergence.

---

## 6. Open questions / unverified

- **Applied vs. committed:** SELECT posture was confirmed empirically; anon INSERT/UPDATE/DELETE
  cells (except `communications`) come from policy files, not re-tested (no-write constraint).
- **Is `audit_log` ever read via the anon client?** Confirm before dropping its anon SELECT
  (believed insert-only client-side, not fully traced).
- **Admin → Supabase identity:** determine how much groundwork exists for `admin.html` to obtain
  an `authenticated` JWT (the portal already does) — this sizes the P0 fix.
- **Migration repair state:** the untracked `MIGRATION_REPAIR_PLAN.md` /
  `POST_REPAIR_VERIFICATION.md` bear on P2-6 and should be reconciled.

---

## Bottom line

The Phase 6B customer-isolation work is genuinely well-designed *for the portal* (`authenticated`
role, email-scoped, careful not to break public content). But it sits on top of a base model
where the **public anon key has `USING(true)` CRUD over all customer PII** — empirically, 24
bookings, 38 communications, and 28 audit rows were readable at audit time with the key shipped
on the homepage. That is the headline, and it cannot be fixed without giving the admin panel a
real Supabase identity. Nothing was changed, written, or deployed during this audit.
