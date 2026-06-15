# Phase 5F — Audit Log Migration — Report

**Status:** ✅ Complete and validated (20/20 migration checks, 21/21 approval regression)
**Date:** 2026-06-16
**Scope:** Move the audit trail from the `localStorage` `hm_audit_log` ring buffer
to a centralized, Supabase-backed table. No `bookings` / `communications` schema
change; the admin 監査ログ UI is preserved.

---

## Goal

Replace the per-browser `localStorage` audit log with a single Supabase-backed
audit trail that:
- both surfaces write to (customer portal + admin panel),
- the admin can read in full,
- customers can only append to (not read),
- survives browser cache clearing,
- keeps any legacy `hm_audit_log` entries visible (backward compatibility).

---

## Schema

New table `public.audit_log` (migration `20260616000001_audit_log.sql`):

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | `gen_random_uuid()` |
| `created_at` | `TIMESTAMPTZ` | `NOW()` |
| `actor` | `TEXT` | `admin` · `customer:<email>` · `system` |
| `action` | `TEXT` | `add\|update\|delete\|save\|login\|logout\|export\|other` |
| `target_type` | `TEXT` | `booking\|quote\|review\|price\|service\|media\|page\|…` |
| `target_id` | `TEXT` | booking ref / entity id |
| `details` | `TEXT` | human-readable description |

Indexes: `created_at DESC`, `action`, `(target_type, target_id)`, `actor`.

The service maps DB rows to the legacy UI entry shape
`{ id, ts, actor, action, entity, entityId, detail }` so the existing 監査ログ
renderer is untouched (`target_type→entity`, `target_id→entityId`,
`details→detail`, `created_at→ts`).

### Example actions captured

| Customer (portal) | Admin (panel) |
|---|---|
| Quote Approved (`quote` / `update`) | Booking Updated (`booking` / `update`) |
| Portal Login (`auth` / `login`) | Status Changed (`booking` / `update`) |
| Document Download (`document` / `other`) | CRM Updated (`customer` / `save`) |
| Photo Upload (`photo` / `add`) | Communication Sent (`communication` / `other`) |

*(Phase 5F migrates the storage layer + wires the Quote-Approval and existing
admin writers through it. Additional portal events — login/download/upload — can
now be recorded with a one-line `AuditService.record(...)` call.)*

---

## RLS policies

`audit_log` has **RLS enabled** and is **append-only** (no UPDATE/DELETE policy →
immutable trail):

| Policy | Role | Rule |
|---|---|---|
| `audit_anon_insert` | `anon` | `INSERT … WITH CHECK (true)` — portal customers **and** admin may append. |
| `audit_anon_select` | `anon` | `SELECT … USING (true)` — required because the admin reads with the same anon key. |
| *(none)* | — | No UPDATE / DELETE → rows cannot be altered or removed by any anon client. |

`GRANT INSERT, SELECT ON public.audit_log TO anon;`

### Security model & the single-key constraint (important)

This project uses **one shared anon key** for every surface and does **not** use
Supabase Auth (documented in `20260101000000_rls_policies.sql`). Postgres RLS
therefore **cannot** distinguish "customer" from "admin" by role — both are `anon`.
Embedding the `service_role` key in the browser would be far more dangerous, so it
is not used.

Consequently the **customer-vs-admin READ restriction is enforced in application
code** (the project's established model):

- **Customers can only create** — the portal bundle loads `AuditService` (whose
  only write method is `record()`) and `PortalApproval`, which calls `record()`.
  The portal has **no** audit-read code path.
- **Customers cannot read** — `AuditService.query()` refuses unless an admin
  session is present (`window.Auth.isLoggedIn()`). The portal never loads
  `window.Auth`, so a customer context returns an empty list.
- **Admin can read all** — the admin panel has `window.Auth` + an active session,
  so `query()` returns the full trail.

**DB-level hardening path (out of scope — do not start Phase 5G):** to enforce the
read restriction in the database, move reads behind a `service_role` Edge Function,
or adopt Supabase Auth with a role claim and a policy such as
`USING (auth.jwt() ->> 'role' = 'admin')`. This is noted in the migration file.

---

## Migrated components

| Component | File | Change |
|---|---|---|
| **Supabase migration** | `supabase/migrations/20260616000001_audit_log.sql` | **New.** `audit_log` table + indexes + RLS (append-only). |
| **Audit service** | `js/services/auditService.js` | **New.** `window.AuditService` — `record()` (INSERT, everyone), `query()` (SELECT, admin-gated, merges legacy localStorage), row↔UI mappers. |
| **Admin Audit Log** | `js/modules/audit/auditLog.js` | `record()` now writes through `AuditService` (Supabase) with an optimistic in-memory cache; `getAll()` returns the cache; `renderAuditLog()` refreshes from Supabase; `clear()` drops only legacy local entries (Supabase rows are immutable). UI/markup unchanged. |
| **Portal approval** | `js/portal/portalApproval.js` | `_writeAudit()` now records to `AuditService` (Supabase) instead of `localStorage`. |
| **Page wiring** | `admin.html`, `portal.html` | Include `js/services/auditService.js` (before `auditLog.js` / `portalApproval.js`). |
| **Tests** | `audit_migration_test.mjs` (new), `approval_test.mjs` (updated to the Supabase audit path) | Validation. |

### Backward compatibility
`AuditService.query()` merges any pre-existing `hm_audit_log` entries with the
Supabase rows (newest first), so legacy local entries remain visible after the
migration. New writes go to Supabase only — no new `localStorage` writes.

### Preserved
- `bookings` and `communications` schemas — untouched.
- Admin 監査ログ UI — same markup, filters, CSV export, refresh button.
- All existing `AuditLog.record(...)` callers (automation, analytics, WMC, Adapter
  patches) — unchanged; they now persist to Supabase transparently.

---

## Validation results

Run (dev server on `:5050` required):

```bash
node serve.js
node audit_migration_test.mjs   # → 20 passed, 0 failed
node approval_test.mjs          # → 21 passed, 0 failed (regression)
```

`audit_migration_test.mjs` uses a controlled fake Supabase modeling `audit_log`
(so it is deterministic and does not require the live table). Coverage of the
required checks:

| Required check | Result |
|---|---|
| **Quote approval creates audit row** | ✅ `PortalApproval.approve()` inserts an `audit_log` row (`target_type:'quote'`, `action:'update'`, `actor:'customer:…'`, details contain "Quote Approved" + 確定). |
| **Admin can see audit row** | ✅ With an admin session, `AuditService.query()` returns the approval entry (and ≥2 rows total). |
| **Customer cannot access other audit records** | ✅ In the portal context (no `window.Auth`), `query()` returns an empty list. |
| **Audit survives browser cache clearing** | ✅ After `localStorage.clear()`, `query()` still returns the Supabase-backed approval row. |
| **No localStorage dependency remains** | ✅ After recording, `hm_audit_log` is not written; reads work with localStorage empty. |
| **Schema / record contract** | ✅ Inserted row carries all 7 columns; admin `AuditLog.record()` maps `entity→target_type`, `entityId→target_id`, `detail→details`. |
| **Admin UI not broken** | ✅ `AuditLog.record()` routes to `AuditService`; the UI cache reflects new entries; render/filter/export paths intact. |
| **Backward compatibility** | ✅ Legacy `hm_audit_log` entries still appear in the admin view. |

---

## Notes / trade-offs

- **Append-only** means the admin "クリア" button no longer deletes the central
  trail; it clears only legacy local entries (confirm dialog updated to say so).
  This is intentional — audit trails should be immutable.
- **Write resilience:** `record()` is Supabase-only (no `localStorage` fallback)
  to satisfy "no localStorage dependency." If Supabase is unreachable, the entry
  is logged to the console rather than silently queued. A durable offline queue
  could be added later if required.
- No Supabase Edge Function, `bookings`/`communications` schema, or admin view
  markup was modified. Phase 5G was **not** started.
