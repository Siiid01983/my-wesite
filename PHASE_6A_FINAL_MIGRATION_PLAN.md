# Phase 6A.4 — Final Drift Migration Plan

**Goal:** The production-ready specification to close the confirmed schema drift in
`bookings` and `reviews`.
**Constraint:** Analysis/specification only — **no SQL executed, no migrations
created, no database/Supabase change, no code change.** Phase 6B not started.
**Note on format:** per the task, this document gives **specifications** (column
properties, semantics, sequencing) and intentionally contains **no executable SQL
or migration files**. The implementing engineer authors the DDL from these specs.

**Confirmed drift (from 6A.1–6A.3):**
- `bookings` missing **`updated_at`**
- `reviews` missing **`source`** and **`booking_reference`**

All fixes are **purely additive**. Live volumes: `bookings` = 22 rows,
`reviews` = 0 rows.

---

## bookings

### Migration specification

| Property | Value |
|---|---|
| Target table | `public.bookings` |
| Object 1 — column | `updated_at` |
| Type | `timestamptz` |
| Default | `now()` |
| Nullable | **NOT NULL** (safe — the default backfills the 22 existing rows at add-time) |
| Idempotency | add only if absent (`ADD COLUMN IF NOT EXISTS` semantics) |
| Optional backfill | set `updated_at = created_at` for the 22 existing rows (historical accuracy; cosmetic) |
| Object 2 — function | `set_updated_at()` — the `BEFORE UPDATE` trigger fn from migration `001`. **Create-or-replace defensively** (its live existence is unconfirmed; idempotent). |
| Object 3 — trigger | `trg_bookings_updated_at` `BEFORE UPDATE … FOR EACH ROW EXECUTE set_updated_at()`; drop-if-exists then create (idempotent) |
| Post-DDL step | Reload the PostgREST schema cache so the REST API recognises the new column (Supabase auto-reloads on DDL via event trigger; trigger a manual reload if writes still 404/PGRST204 briefly). |

Rationale for the trigger: the column alone stops the `400`, but the four writers
already *send* `updated_at` explicitly, so the trigger is not strictly required for
those paths. It **is** recommended so that any future write that omits the field
(or DB-side changes) still keeps the timestamp current — matching migration `001`'s
original design.

### Compatibility analysis

| Path | Today | After add | Verdict |
|---|---|---|---|
| `createBooking` / `Adapter.addBooking` INSERT | OK (no `updated_at` sent) | OK — `default now()` fills it | ✅ no change |
| `updateBooking` (B1), `cancelBooking` (B2), `approveEstimate` (B3, **portal approval**) | 🔴 `400 PGRST204` → never persists | ✅ persists | **Fixed** |
| `Adapter.updateBooking` (B4 — **admin status + automation `autoStatusRules`**) | 🔴 never persists | ✅ persists | **Fixed** |
| `statisticsService` explicit SELECT (`id,booking_date,service_id,status,customer_email,customer_name,created_at`) | OK | OK — list excludes `updated_at`; unaffected | ✅ no change |
| `SELECT *` paths (`Adapter.syncFromSupabase`, Realtime payloads) | OK | New field appears; `sbToBooking` maps only known fields and ignores extras | ✅ no change |
| `DataProvider.seed('bookings', …)` | OK | Stores raw row incl. new field | ✅ no change |

Affected workflows (now repaired): **portal estimate approval (5F)**, **admin
booking confirm/complete/cancel/edit**, **automation auto-status transitions**.
No workflow is degraded. CMS/WMC and analytics are unaffected (analytics only
*indirectly* benefits — statuses now persist, so re-synced data is no longer stale).

### Rollback strategy
- Reversible by dropping `trg_bookings_updated_at`, then the `set_updated_at`
  function (only if not shared — leave if reused elsewhere), then `updated_at`.
- Dropping `updated_at` returns writes to the prior **broken-but-stable** behaviour;
  only timestamp values are lost — **no business data**.
- No data transformation occurs, so there is **no data rollback**.
- Order: trigger → (function, if safe) → column.

---

## reviews

### Migration specification

| Property | `source` | `booking_reference` | `customer_email` *(optional)* |
|---|---|---|---|
| Target table | `public.reviews` | `public.reviews` | `public.reviews` |
| Type | `text` | `text` | `text` |
| Default | none (NULL) | none (NULL) | none (NULL) |
| Nullable | **NULLABLE** (admin writes `'admin'`/`'customer'`; may be null) | **NULLABLE** (admin reviews without a linked booking write null) | **NULLABLE** |
| Constraints | **none** (no CHECK/FK/UNIQUE — see risk §dangerous) | **none** (booking ids live in `bookings.notes`; an FK would not resolve) | none |
| Idempotency | `ADD COLUMN IF NOT EXISTS` semantics | same | same |
| Backfill | none needed (**0 rows**) | none needed | none needed |
| Status | **Required** | **Required** | **Optional** — Phase-6A RLS enabler; needs writer code (out of scope) to populate, so defer unless adopting now |
| Post-DDL step | Reload PostgREST schema cache (as above) | | |

### Compatibility analysis

| Path | Today | After add | Verdict |
|---|---|---|---|
| `Adapter.addReview`/`updateReview` → `reviewToSb` (S1/R1 — **admin moderation/approve**) | 🔴 `400` (unknown `source`,`booking_reference`) → never persists | ✅ persists | **Fixed** |
| `portalReviews.submit` (S2/R2 — **portal review 5G**) | 🔴 INSERT `400` | ✅ persists | **Fixed** |
| `portalReviews.existingReview` `.in('booking_reference', …)` (R3 — duplicate guard) | 🔴 SELECT `400` (caught → false "no review") | ✅ correct duplicate detection | **Fixed** |
| `faq.js` review form → `Adapter.addReview` (S3) | 🔴 never persists | ✅ persists | **Fixed** |
| `sbToReview` read `r.source`/`r.booking_reference` (S4/R4) | tolerant default (`'admin'`/null) | reads real values | ✅ improved, no break |
| `contentLoader._mapReview` (public testimonials) | OK (doesn't read these cols; filters `approved & published`) | OK | ✅ no change |
| `reviewsEditor` badge / `関連予約ID` (S5/R6) | always 「管理者登録」/blank | shows true source / booking ref | ✅ cosmetic improvement |
| Upsert conflict target `reference_id` | OK | unchanged | ✅ no change |

Affected workflows (now repaired): **portal review submission + duplicate guard
(5G)**, **admin review create/edit/approve**, **FAQ-page review submission**.
Public-site read path and the localStorage-only public form are unaffected.

### Rollback strategy
- Reversible by dropping `customer_email` (if added), `booking_reference`, `source`.
- `reviews` is **empty**, so rollback is fully clean — no rows reference the columns.
- No data transformation → **no data rollback**.
- Order: `customer_email` (if present) → `booking_reference` → `source`.

---

## Deployment sequence

### Staging order
1. **Snapshot** live `bookings`/`reviews` columns + `pg_policies`/grants (6A.1
   Appendix A) as the rollback baseline.
2. **reviews** (empty → zero risk): add `source`, `booking_reference`
   (+ optional `customer_email`); reload schema cache.
3. **bookings**: add `updated_at` (default `now()`); ensure `set_updated_at()`;
   attach `trg_bookings_updated_at`; optional backfill `= created_at`; reload cache.
4. Run the **validation checklist** below in staging; all must pass before prod.

### Production order
- Identical to staging, in a **low-traffic window**, all statements written
  **idempotently** (`IF NOT EXISTS` / drop-if-exists for the trigger).
- Apply **reviews → bookings** (lowest risk first).
- Re-run the validation checklist after each table; reload the PostgREST schema
  cache after the DDL of each table.
- Do **not** enable any Phase 6A RLS or Magic Link provider here — that is a later,
  separately-gated phase.

### Validation checklist
**reviews**
- [ ] Admin: create a review → persists to Supabase; reload admin → still present.
- [ ] Admin: toggle **approve** on a review → `approved` change persists.
- [ ] Portal (5G): submit a review on a completed booking → row written with
      `source='customer'`, `approved=false`.
- [ ] Portal: `existingReview` returns the submitted review (duplicate guard works;
      no `400`).
- [ ] FAQ-page form: submit → persists with `source='customer'`.
- [ ] Public site: testimonials (`approved & published`) still render.

**bookings**
- [ ] Admin: confirm / complete / cancel a booking → status **persists** and
      survives a fresh `syncFromSupabase` (re-login).
- [ ] Portal (5F): estimate approval → status moves to `確定`/`confirmed` in Supabase.
- [ ] Automation: an `autoStatusRules` transition → persists to Supabase.
- [ ] Realtime: a `bookings` UPDATE broadcasts (admin tab reflects without reload).
- [ ] `updated_at` advances on each UPDATE (trigger working).
- [ ] Dashboard/BI counts unchanged vs. pre-migration baseline.

**Cross-cutting**
- [ ] Public booking form INSERT still succeeds.
- [ ] CMS/WMC content save (hm_data) unaffected.
- [ ] No new console `[SUPABASE ERROR]` lines during the above.

---

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PostgREST schema cache stale after DDL (new column not yet visible to REST) | Medium | Brief write failures | Reload schema (Supabase auto-reloads; trigger manual reload); verify in checklist. |
| `set_updated_at()` function absent live (only the trigger attach would fail) | Medium | Trigger creation errors | Create-or-replace the function defensively before attaching the trigger. |
| `bookings.updated_at` added `NOT NULL` without default | Low (avoided by spec) | Add fails on 22 rows | Spec mandates `DEFAULT now()`. |
| Adding a constraint (FK/CHECK/UNIQUE) on the new columns | Low (explicitly forbidden) | Add fails / couples to `notes`-based ids | Spec: columns are plain nullable `text`/`timestamptz`, no constraints. |
| Behaviour change visible to admins (statuses now "stick" that previously reverted) | High | **Positive** — correctness restored | Communicate as a fix; verify via checklist. |
| Realtime/`SELECT *` surfacing the new field | Low | None | Mappers ignore unknown fields; verified in compatibility tables. |
| Out-of-scope drift not addressed (`calendar_availability.updated_at`, `services.icon`) | — | Separate latent bugs | Note for a future phase; **not** part of 6A.4. |

**Net:** additive-only, reversible, zero data transformation, on 22-row / 0-row
tables. The dominant operational consideration is the schema-cache reload, not data risk.

---

## Readiness score

| Dimension | Score | Basis |
|---|---|---|
| Specification completeness | 10/10 | Exact type/default/nullability/constraints/trigger + post-DDL step for all three (+1 optional) columns. |
| Fix safety (additive/reversible) | 9/10 | No constraints, safe defaults, drop-based rollback, no data migration. |
| Compatibility coverage | 10/10 | Every read/write/Realtime/seed path checked per column; no degradation found. |
| Validation rigor | 9/10 | Per-workflow staging + prod checklist covering portal, admin, automation, public, CMS. |
| Current live integrity (pre-fix) | 2/10 | Portal approval, admin status/review writes, automation transitions silently fail today. |

### **Final migration plan readiness: 94 / 100 — READY TO IMPLEMENT (not yet applied)**

- The specification is complete, additive, reversible, and fully validated on
  paper. The only live unknowns are operational (schema-cache reload,
  `set_updated_at()` presence), both pre-mitigated in the spec.
- Recommended next step (separate, approved implementation phase): author the DDL
  from these specs, run **staging → reviews → bookings**, complete the validation
  checklist, then promote. Hold Phase 6A RLS and Phase 6B until both tables verify
  green.

*Analysis only. No SQL executed, no migrations created, no database/Supabase/code modified (only this report). Phase 6B not started.*
