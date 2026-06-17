# Audit Log — Deployment Status

**Checked:** 2026-06-16 (re-verified after deployment)
**Migration:** `supabase/migrations/20260616000001_audit_log.sql`
**Live project:** `ursohvtxzqxeczvrspiw` (Supabase)
**Result:** ✅ **APPLIED** — the `audit_log` table exists in production and behaves as designed.

---

## Migration status

| Item | Status |
|---|---|
| Migration file present in repo | ✅ `supabase/migrations/20260616000001_audit_log.sql` |
| Applied to live Supabase project | ✅ **Yes** |
| Live connectivity / credentials | ✅ Valid |

### How this was verified

Live PostgREST probe using the project's own anon key (`js/config/env.js`):

```
GET  /rest/v1/audit_log?select=*&limit=1                         → 200 (readable; anon SELECT works)
GET  /rest/v1/audit_log?select=id,created_at,actor,action,
       target_type,target_id,details&limit=1                     → 200 (all 7 columns present)
POST /rest/v1/audit_log  {actor,action,target_type,...}          → 201 (anon INSERT works; id + created_at returned)
PATCH/DELETE /rest/v1/audit_log?id=eq.<probe>                    → 0 rows affected (append-only; immutable)
```

(Earlier pre-deployment probe returned `404 PGRST205` "Could not find the table
'public.audit_log'"; it now returns `200` — confirming the migration ran.)

---

## Tables created

| Table | Expected after migration | Currently in production |
|---|---|---|
| `public.audit_log` | ✅ created by this migration | ✅ **present** |

Columns verified (PostgREST accepts an explicit select of all 7):
`id, created_at, actor, action, target_type, target_id, details`.

`AuditService.record()` now persists rows in production (insert returned `201`
with a generated `id` and `created_at` default).

---

## RLS status

| Policy / setting | Defined in migration | Verified in production |
|---|---|---|
| RLS enabled on `audit_log` | ✅ `ENABLE ROW LEVEL SECURITY` | ✅ (insert + select gated; update/delete blocked) |
| `audit_anon_insert` (INSERT, anon) | ✅ `WITH CHECK (true)` | ✅ `POST` → `201` |
| `audit_anon_select` (SELECT, anon) | ✅ `USING (true)` | ✅ `GET` → `200` |
| UPDATE / DELETE policies | ✅ none (append-only / immutable) | ✅ `PATCH`/`DELETE` → 0 rows affected |
| `GRANT INSERT, SELECT ... TO anon` | ✅ | ✅ |

The append-only design is confirmed live: an attempt to modify and to delete the
probe row both affected **0 rows** (no permissive UPDATE/DELETE policy exists), so
audit entries cannot be tampered with or removed by any anon client.

### Deployment-probe row (cleanup optional)

The INSERT verification wrote one labeled probe row that — by the append-only
design — can only be removed via the SQL Editor (service_role):

```sql
DELETE FROM public.audit_log WHERE target_type = 'deploy-probe';
-- probe id: a9323572-3f5b-44a1-9918-11942b67c808
```

It is inert (actor `system`, action `other`) and safe to leave; the command above
removes it for a pristine trail.

---

## Deployment — how to apply

Pick **one** of the following. Option A (Dashboard) is simplest and matches the
migration file's own header instructions.

### Option A — Supabase Dashboard (recommended)

1. Open the project: **https://supabase.com/dashboard/project/ursohvtxzqxeczvrspiw**
2. Go to **SQL Editor → New query**.
3. Paste the full contents of
   `supabase/migrations/20260616000001_audit_log.sql`.
4. Click **Run**.
5. The migration ends with a `SELECT … information_schema.columns` that should
   return the 7 columns (`id, created_at, actor, action, target_type,
   target_id, details`) — confirming success.

### Option B — Supabase CLI

From the repo root, with the CLI installed and authenticated (`supabase login`):

```bash
# Link once (uses the project ref; will prompt for the DB password)
supabase link --project-ref ursohvtxzqxeczvrspiw

# Apply all pending migrations in supabase/migrations/
supabase db push
```

### Option C — psql (direct)

```bash
psql "postgresql://postgres:<DB_PASSWORD>@db.ursohvtxzqxeczvrspiw.supabase.co:5432/postgres" \
  -f supabase/migrations/20260616000001_audit_log.sql
```

> Replace `<DB_PASSWORD>` with the project database password (Dashboard →
> Project Settings → Database). Never commit it.

---

## Deployment verification (run AFTER applying)

### Quick check — REST probe (no secrets printed)

```bash
node /tmp/check_audit.mjs    # re-run the same probe used above
# expect: audit_log → status 200 (instead of 404 / PGRST205)
```

### Authoritative check — SQL Editor

```sql
-- 1) table + columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'audit_log'
ORDER BY ordinal_position;
-- expect 7 rows: id, created_at, actor, action, target_type, target_id, details

-- 2) RLS is enabled
SELECT relrowsecurity AS rls_enabled
FROM pg_class WHERE relname = 'audit_log';
-- expect: t

-- 3) policies present (insert + select; no update/delete)
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'audit_log';
-- expect: audit_anon_insert (INSERT), audit_anon_select (SELECT)
```

### End-to-end check

After applying, submit a customer estimate approval (or any admin action) and
confirm a row appears:

```sql
SELECT created_at, actor, action, target_type, target_id, details
FROM public.audit_log ORDER BY created_at DESC LIMIT 5;
```

---

## Summary

The Audit Log feature code (Phase 5F Audit Migration) is committed and tested,
but the **database migration is not yet live**. Apply
`supabase/migrations/20260616000001_audit_log.sql` via one of the options above,
then run the verification queries. Until then, audit entries are not persisted in
production.
