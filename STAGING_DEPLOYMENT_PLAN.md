# Staging Deployment Plan — `staging.hello-moving.com` (cPanel)

Deploys branch **`auth-mysql-staging`** to an **isolated** staging site to validate
the MySQL admin-auth migration before any production change. **Production is never
touched** (separate subdomain, separate docroot, separate database, separate config).

> ⚠️ **DO NOT run `deploy.js` for staging.** It is hard-coded for the production
> FTP flow and its `needsCd` logic (`deploy.js:162`, `e.name === REMOTE`) does not
> match a nested path like `public_html/staging`, so it would silently upload into
> the **production web root**. Use the cPanel Git / File-Manager method in Step 5.

---

## 0. Production-isolation guarantees (why prod stays safe)

| Dimension | Production | Staging |
|---|---|---|
| Host/origin | `https://hello-moving.com` | `https://staging.hello-moving.com` |
| Docroot | `public_html` | `public_html/staging` |
| Database | `hellom41_<prod>` | `hellom41_staging` |
| API base | `…/hm-api` (origin-relative) | `…/hm-api` (origin-relative → resolves to staging) |
| Config | prod `hm-api/_config.php` | **separate** `public_html/staging/hm-api/_config.php` |

Because `env.js`/`env.public.js` set `API_BASE = window.location.origin + '/hm-api'`,
the staging copy automatically calls the **staging** API — no cross-wiring to prod.

---

## 1. Create the subdomain

cPanel → **Domains** → **Create A New Domain** (or **Subdomains** on older themes):
- Domain: `staging.hello-moving.com`
- Document Root: `public_html/staging`  ← set explicitly; uncheck "share docroot"
- Create.

## 2. Issue SSL for the subdomain (required)

cPanel → **SSL/TLS Status** (AutoSSL) → select `staging.hello-moving.com` → **Run AutoSSL**.
Login + the `Secure` session cookie require valid HTTPS on the subdomain. Wait until
the cert shows **valid** before testing login.

## 3. Create the staging database + user

cPanel → **MySQL® Databases**:
1. **New Database:** `staging` → full name becomes **`hellom41_staging`**.
2. **New User:** e.g. `hellom41_stg` → set a strong password (record it).
3. **Add User To Database:** user `hellom41_stg` → db `hellom41_staging` → **ALL PRIVILEGES**.

## 4. Load the schema

cPanel → **phpMyAdmin** → select `hellom41_staging` → **Import**:
1. Import `hm-api/schema.mysql.sql` (creates the 8 app tables: hm_data, bookings,
   calendar_availability, reviews, services, communications, inbox_messages, audit_log).
2. `admin_users` is created by `admin-migrate.php` in Step 7 (or import
   `hm-api/admin_users.schema.sql` here too — both are idempotent).

## 5. Deploy the branch to `public_html/staging`

**Preferred — cPanel Git™ Version Control** (no local tooling, excludes gitignored files):
1. cPanel → **Git™ Version Control** → **Create**.
2. Clone URL: `https://github.com/Siiid01983/my-wesite.git`
   Repository Path: `public_html/staging`
3. After clone → **Manage** → **Pull or Deploy** → **Checkout** branch
   `auth-mysql-staging`.

**Alternative — GitHub ZIP + File Manager:**
1. GitHub → branch `auth-mysql-staging` → **Code ▸ Download ZIP**.
2. cPanel → **File Manager** → `public_html/staging` → **Upload** the zip → **Extract**
   → move the extracted contents up so `public_html/staging/hm-api/…` and
   `public_html/staging/admin.html` sit directly in `public_html/staging`.

> Note: `js/config/env.js` is **gitignored**, so neither method ships it. Staging
> falls back to `js/config/env.public.js` → `API_BASE` is origin-relative and
> **`API_KEY` is empty**. That is why Step 6 sets the staging API key to `''`.

Confirm these arrived under `public_html/staging/hm-api/`:
`admin-login.php`, `admin-migrate.php`, `_admin_users.php`, `admin_users.schema.sql`,
`_lib.php`, `_db.php`, `_log.php`, `_ratelimit.php`, `rest.php`, `.htaccess`,
**`.user.ini`** (PHP runtime overrides — verify it copied; dotfiles are easy to miss).

## 6. Create the staging `hm-api/_config.php` (REQUIRED FILE)

Copy `public_html/staging/hm-api/_config.example.php` → `_config.php` (File Manager ▸
Copy, then edit) and set **staging-specific** values:

```php
// ── DB (staging) ──
'db_host' => 'localhost',
'db_name' => 'hellom41_staging',
'db_user' => 'hellom41_stg',
'db_pass' => '<staging db password>',

// ── CORS / API key ──
'allowed_origin' => 'https://staging.hello-moving.com',
'api_key'        => '',           // MUST be '' to match env.public.js (no env.js on staging)

// ── Admin auth ──
'admin_auth_enabled'   => false,  // keep OFF until the matrix passes; then flip to test enforcement
'admin_pass_hash'      => '',      // unused on the MySQL path
'admin_session_secret' => '<64+ random hex — see below>',
'admin_session_ttl'    => 4 * 60 * 60,

// ── First-admin seed (used once by admin-migrate.php, then blank these) ──
'admin_seed_email'    => 'admin@hello-moving.com',
'admin_seed_name'     => 'Staging Admin',
'admin_seed_password' => '<staging admin password>',
'admin_setup_token'   => '<long random — only if running migrate over HTTP>',

'debug' => true,                  // staging only — surfaces error detail
```

Generate the signing secret (cPanel → **Terminal**, or any shell):
```bash
php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
```

> Use **different** secrets/passwords than production. Never copy the prod `_config.php`.

## 7. Run the migration + seed the first admin

cPanel → **Terminal** (preferred):
```bash
cd ~/public_html/staging
php hm-api/admin-migrate.php
```
Expect `status: seeded` (first run) or `already_provisioned` (re-run = self-locked).
No shell? Set `admin_setup_token` (Step 6), then visit **once**:
`https://staging.hello-moving.com/hm-api/admin-migrate.php?token=<admin_setup_token>`
and afterwards delete the token from `_config.php`.

Confirm the row count:
```bash
php -r '$c=require"hm-api/_config.php";$d=new PDO("mysql:host={$c[db_host]};dbname={$c[db_name]}",$c[db_user],$c[db_pass]);echo $d->query("SELECT COUNT(*) FROM admin_users")->fetchColumn(),"\n";'
```

## 8. Run the auth test matrix + Playwright

**Matrix** (the committed runner — Terminal on the staging host):
```bash
cd ~/public_html/staging
BASE='https://staging.hello-moving.com/hm-api' API_KEY='' \
EMAIL='admin@hello-moving.com' PASS='<staging admin password>' \
MGR_EMAIL='' MGR_PASS='' \
bash tests/staging-auth-smoke.sh
```
Covers: php-lint · migrate/seed · valid login · invalid login · token validation ·
list_users-no-hash · create_user (admin) · manager→403 · change_password (+restore) ·
token revocation on delete · logout. Exit 0 ⇒ all passed. (Populate `MGR_*` after the
script creates a manager, or create one in the UI, to exercise role enforcement.)

**Playwright** (from any machine that can reach staging + has Node):
```bash
ADMIN_URL='https://staging.hello-moving.com/admin.html' \
ADMIN_EMAIL='admin@hello-moving.com' ADMIN_PASSWORD='<staging admin password>' \
npx playwright test tests/admin-auth.spec.js
```

## 9. Evidence to capture (paste into the staging report)

- **Migration evidence:** `admin-migrate.php` output (`seeded`) + the `SELECT COUNT(*)` row count.
- **Login evidence:** `staging-auth-smoke.sh` step 3 (token minted, cookie set, no hash in body) + Playwright "logs in … mints a token" PASS.
- **Logout evidence:** smoke step 11 (`loggedOut`) + Playwright logout PASS (token cleared).
- **Role evidence:** smoke step 6 (admin `list_users` ok, no `pass_hash`) + step 8 (manager `create_user` → **403**).
- **Rollback evidence:** Step 10 below.

## 10. Rollback verification (run on staging)

1. With `admin_auth_enabled => true`, confirm an admin-only write succeeds (edit a
   service in the staging admin), then set `admin_auth_enabled => false` and confirm
   `rest.php` reverts to API-key-only (writes still work) — proves the one-line,
   no-redeploy rollback.
2. `DROP TABLE admin_users;` in phpMyAdmin → confirm bookings/services/etc. are
   intact (the table is not referenced by `rest.php`) — proves no business-data loss.
3. Re-run `php hm-api/admin-migrate.php` → re-seeds cleanly — proves recoverability.

---

## Required files BEFORE deployment (checklist)

| File | Purpose | Action |
|---|---|---|
| `hm-api/schema.mysql.sql` | 8 app tables | import into `hellom41_staging` (Step 4) |
| `hm-api/admin_users.schema.sql` | admin_users DDL | created by migrate (or import) |
| `hm-api/admin-login.php`, `_admin_users.php`, `admin-migrate.php` | auth endpoint + lib + migrator | deploy (Step 5) |
| `hm-api/_lib.php`, `_db.php`, `_log.php`, `_ratelimit.php`, `rest.php` | shared backend | deploy |
| `hm-api/.htaccess`, `hm-api/.user.ini` | security + PHP runtime | deploy (verify dotfiles) |
| `hm-api/_config.php` (staging) | DB + secret + seed | **create on server** (Step 6) — not in git |
| `tests/staging-auth-smoke.sh`, `tests/admin-auth.spec.js` | validation | deploy / run |
| `js/config/env.public.js` | origin-relative API base, empty key | deploy (env.js is gitignored) |

**Do not deploy to production.** Promotion to production happens only after Step 8
exits 0 and Playwright is green, via a separate production plan.
