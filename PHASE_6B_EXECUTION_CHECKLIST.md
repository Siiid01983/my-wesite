# Phase 6B.5 — Production Execution Checklist (Phase 6A + 6B)

**Target project:** `hello-moving` — ref `ursohvtxzqxeczvrspiw` (PRODUCTION)
**Apply order:** `…001` reviews → `…002` bookings → `…003` 6B RLS (+ Magic Link cut-over)
**Mode:** attended · low-traffic window · rollback staged before first write
**Gate authority:** `PHASE_6B_DEPLOYMENT_GATE.md` (GO–CONDITIONAL on P1–P5 below)

> Stop at any unchecked gate (▶ GATE). If a gate fails, go to ROLLBACK.

---

## PRE-FLIGHT

**Authorization & artifacts (P1)**
- □ Deployment gate verdict is GO-CONDITIONAL and read by the operator
- □ Three migration files committed to git (no longer untracked `??`)
- □ Rollback SQL (§ROLLBACK) pasted into a SQL Editor tab, **unexecuted**
- □ `PHASE_6A_DEPLOYMENT_RUNBOOK.md` + this checklist open and within reach
- □ One operator at the keyboard; no concurrent admin/CMS edits or other migrations

**Window & access (P4)**
- □ Low-traffic, off-peak window scheduled; ≤90 min, no walk-away while Auth is on
- □ Logged into Supabase Dashboard; URL project ref confirmed = `ursohvtxzqxeczvrspiw`
- □ Single deployment path chosen: **Dashboard SQL Editor** *or* **CLI** (not both)
- □ Admin clean browser profile ready — anon key, **no** portal Auth session (P5 / F6)
- □ Two controllable test inboxes ready (Customer A, Customer B) for Magic Links

**Read-only snapshots (rollback baseline)**
- □ Snapshot `pg_policies` for bookings, reviews, communications, audit_log, hm_data, services, calendar_availability — saved
- □ Snapshot `relrowsecurity` for the same tables + `inbox_messages` — saved
- □ Snapshot `information_schema.role_table_grants` for `authenticated` + `anon` — saved
- □ Row counts captured: `bookings` ≈ 22, `reviews` = 0

**Column pre-flight (P2 — STOP if any missing)**
- □ `bookings.customer_email` exists live
- □ `communications.customer_email` exists live
- □ `reviews.booking_reference` — **expected ABSENT pre-deploy** (created by `…001`); confirm `updated_at` not yet on bookings, `source`/`booking_reference` not yet on reviews (idempotent either way)
- ▶ **GATE PF-1:** `bookings.customer_email` + `communications.customer_email` present. If either missing → **HALT** (CREATE POLICY in `…003` would fail). Do not proceed.

**Auth cut-over readiness (P3 — do NOT enable yet)**
- □ Magic Link / Email provider config staged but **confirmed currently DISABLED** (guarantees `…003` policies stay dormant through Stage A–B)
- □ Email sender domain verified on production; portal redirect origin(s) allow-listed and ready to toggle
- ▶ **GATE PF-2:** all PRE-FLIGHT boxes checked + PF-1 passed. Else **HALT**.

---

## DEPLOYMENT

### Stage A — 6A.5 reviews drift (`…001`, zero-risk, reviews = 0 rows)
- □ Confirm project ref in URL = `ursohvtxzqxeczvrspiw`
- □ Run `20260617000001_phase6a_reviews_drift.sql`
- □ Verify block returns 2 rows: `booking_reference | text | YES`, `source | text | YES`
- ▶ **GATE A:** both columns present, no errors. Else → ROLLBACK.

### Stage B — 6A.5 bookings drift (`…002`, additive, bookings = 22 rows)
- □ Run `20260617000002_phase6a_bookings_drift.sql`
- □ Verify `updated_at | timestamp with time zone | NO | now()`
- □ Verify trigger `trg_bookings_updated_at` present (`tgenabled = O`)
- □ Verify `SELECT count(*) FROM bookings WHERE updated_at IS NULL` = `0` (backfill OK)
- □ Verify row counts unchanged (`bookings` ≈ 22, `reviews` = 0)
- □ If any app write briefly 404/PGRST204 → re-issue `NOTIFY pgrst, 'reload schema';`
- ▶ **GATE B:** 6A.5 app validation green (see VALIDATION §6A) before any RLS. Else → ROLLBACK.

### Stage C — 6B additive policies, Auth still OFF → DORMANT (`…003` sections A,B,C,E,public-content)
- □ Run `…003` through sections **A** (public-content auth SELECT), **B** (bookings auth select/insert/update), **C** (reviews auth select/insert), **E** (audit auth insert) and their GRANTs
- □ (If running `…003` whole-file, this includes Stage D below — see note)
- □ Confirm `pg_policies` now lists the `*_auth_*` policies on bookings/reviews/audit_log/hm_data/services/calendar_availability
- ▶ **GATE C:** anon world unchanged — admin reads + CMS save behave exactly as the Stage-0 snapshot (policies are inert with Auth off). Else → ROLLBACK.

### Stage D — communications RLS ENABLEMENT (the high-risk step, `…003` section D)
- □ Confirm anon base policies `comm_anon_select/insert/update/delete` re-asserted **before** `ALTER TABLE … ENABLE ROW LEVEL SECURITY`
- □ Confirm `comm_auth_select_own` created
- □ Confirm `communications.relrowsecurity = true` after run
- □ **Immediately** run VALIDATION §D admin-Comms regression (CR1)
- ▶ **GATE D (CRITICAL):** admin Communication Center read/send/update/delete all work. If ANY fails → ROLLBACK Stage D now (`DISABLE RLS` / drop policy).

### Stage E — Run trailing VERIFY + REST reload (`…003` tail)
- □ `NOTIFY pgrst, 'reload schema';` issued (file emits it)
- □ VERIFY block: authenticated policies present on all 7 listed tables
- □ VERIFY block: `communications.rls_enabled = true`; `inbox_messages` unchanged (RLS still off, no authenticated grant)
- □ VERIFY block: `authenticated` grants match (bookings SIU, reviews SI, comms S, audit I, content S)
- ▶ **GATE E:** verify output matches expected. Else → ROLLBACK.

### Stage F — Auth cut-over (activates the `authenticated` role, origin-wide) (P3)
- □ Seed 2 disposable bookings tagged `notes:'TEST-6B'` under inboxes A and B (distinct `customer_email`, one with `ref:HM-…`)
- □ Enable the Email / Magic Link provider; confirm portal origin allow-listed
- ▶ **GATE F:** provider enabled, test Magic Link received in inbox A. Proceed to VALIDATION isolation checks.

> **Note (whole-file apply):** `…003` is one file; running it applies sections A–G in
> one shot (Stage C + D together). If applied whole, treat Stage C and D gates as a
> single post-run check and run the §D regression immediately. Auth (Stage F) is a
> **separate Dashboard toggle** — never bundled into the SQL.

---

## VALIDATION

### §6A — 6A.5 app validation (after Stage B, before any RLS)
- □ Admin: create a review → persists; reload → still present
- □ Admin: toggle **approve** → persists across refresh
- □ Admin: confirm / complete / cancel a booking → status persists and survives `syncFromSupabase` (re-login)
- □ `updated_at` advances on each UPDATE (query row before/after)
- □ Automation `autoStatusRules` transition → persists; Realtime UPDATE broadcasts to a 2nd admin tab
- □ Public booking form INSERT still succeeds; CMS/WMC `hm_data` save unaffected
- □ Dashboard / BI counts unchanged vs. baseline; no new `[SUPABASE ERROR]` console lines
- ▶ feeds **GATE B**

### §C — Anon-world preservation (after Stage C, Auth still off)
- □ Admin (clean profile, anon): reads all bookings/reviews; confirm/complete/cancel persists
- □ CMS/WMC: edit + save hero/services → persists, public render updates
- □ Public `index.html` as anonymous visitor: hero/FAQ/footer/services/calendar/testimonials render
- ▶ feeds **GATE C**

### §D — Communications regression (after Stage D — CRITICAL, CR1)
- □ Admin Communication Center: **read** existing threads
- □ Admin: **send** a message → persists
- □ Admin: **update** (status patch) → persists
- □ Admin: **delete** a test message → succeeds
- □ Edge `send-email`/`receive-email` path representative (or stubbed) — service_role unaffected
- ▶ feeds **GATE D (CRITICAL)**

### §F — Portal & isolation (after Stage F, Auth on)
**Positive — Customer A (authenticated)**
- □ Portal dashboard shows **only A's** booking(s)/comms/reviews — no console RLS denials
- □ `index.html` while logged in as A: hero/FAQ/footer/services/calendar render (F1)
- □ Public testimonials visible to A (F1b)
- □ A submits a review → insert OK, `source='customer'`, `approved=false`; duplicate-guard returns it (no 2nd submit)
- □ A submits public booking form while authenticated → row created (F-insert)
- □ Estimate approval (5F) moves **A's own** booking to confirmed in the DB row
- □ Portal storage: list / upload / `createSignedUrl` / remove succeed as authenticated
- □ A triggers an approval/review → `audit_log` appends; A **cannot read** the trail

**Negative — Customer B + isolation (the security assertion)**
- □ B sees only B's data
- □ A→B and B→A cross-reads (id-swap / direct query) return **0 rows at the DB**, not just app
- □ A cannot UPDATE B's booking (5F approval on B denied)
- □ `inbox_messages` not readable by A or B (authenticated)
- ▶ **GATE VAL (CRITICAL):** all positive pass + every cross-read denied by the DB. If any isolation breach → disable provider immediately, ROLLBACK, investigate before retry.

### Promotion decision
- □ All gates A–F + VAL green → **GO**: leave policies + Auth enabled
- □ Any gate failed → **NO-GO**: ROLLBACK, leave Auth disabled, write up failure
- □ On GO: delete `TEST-6B` bookings + test auth users; diff `pg_policies`/grants/auth-users vs. Stage-0 snapshot
- □ Record cut-over in ops notes incl. the F6 admin-clean-browser rule and the N1 rollback order

---

## ROLLBACK

> Tiers fastest → most complete. No production row data is modified by any step.
> Full-stack SQL rollback order is **reverse-apply: `003 → 002 → 001`** (N1: the 6B
> reviews policy depends on `reviews.booking_reference`; drop 6B policies before that column).

**Tier 1 — instant, no SQL (Auth-side surprise / homepage break / isolation breach)**
- □ Supabase → Authentication → Providers → **disable Email/Magic Link**
- □ Confirm all clients revert to role `anon`; portal + homepage behave as pre-cut-over

**Tier 2 — drop 6B policies (`…003`, additive)**
- □ `DROP POLICY IF EXISTS "bookings_auth_select_own" ON bookings;`
- □ `DROP POLICY IF EXISTS "bookings_auth_insert" ON bookings;`
- □ `DROP POLICY IF EXISTS "bookings_auth_update_own" ON bookings;`
- □ `DROP POLICY IF EXISTS "reviews_auth_select_own" ON reviews;`  ← drop BEFORE any reviews-column rollback (N1)
- □ `DROP POLICY IF EXISTS "reviews_auth_insert" ON reviews;`
- □ `DROP POLICY IF EXISTS "comm_auth_select_own" ON public.communications;`
- □ `DROP POLICY IF EXISTS "audit_auth_insert" ON public.audit_log;`
- □ `DROP POLICY IF EXISTS "hm_data_auth_select" ON hm_data;`
- □ `DROP POLICY IF EXISTS "services_auth_select" ON services;`
- □ `DROP POLICY IF EXISTS "calendar_availability_auth_select" ON calendar_availability;`
- □ `NOTIFY pgrst, 'reload schema';` (grants may be left — harmless without a matching policy)

**Tier 3 — revert communications enablement (only if Stage D is the failure)**
- □ `ALTER TABLE public.communications DISABLE ROW LEVEL SECURITY;`
- □ Re-confirm admin Comms CRUD works (back to pre-6B behavior)

**Tier 4 — revert 6A.5 schema (only if rolling back the whole stack — reverse order)**
- □ `DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;`
- □ `ALTER TABLE public.bookings DROP COLUMN IF EXISTS updated_at;`
- □ **Do NOT** `DROP FUNCTION set_updated_at()` — shared with `calendar_availability`
- □ `ALTER TABLE public.reviews DROP COLUMN IF EXISTS booking_reference;`  ← only after Tier 2 dropped `reviews_auth_select_own`
- □ `ALTER TABLE public.reviews DROP COLUMN IF EXISTS source;`
- □ `NOTIFY pgrst, 'reload schema';`
- □ If applied via CLI: `supabase migration repair --status reverted 20260617000003 20260617000002 20260617000001`

**Post-rollback**
- □ Verify expected objects gone: target policies absent; `communications.relrowsecurity` matches intent; reviews/bookings columns absent (if Tier 4)
- □ Confirm Email provider state matches decision (disabled on NO-GO)
- □ Delete `TEST-6B` bookings + test auth users
- □ Diff `pg_policies` / grants / `relrowsecurity` vs. Stage-0 snapshot — confirm clean revert
- □ Production confirmed back to pre-6B `anon` behavior; record outcome
