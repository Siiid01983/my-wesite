# Admin Authentication Migration — localStorage → MySQL (hybrid session + token)

## Why this change
Admin login previously verified credentials **in the browser** against a
localStorage blob (`hm_admin_creds`) using salted SHA‑256, with staff accounts in
`hm_staff`. Anyone with DevTools could read/replace those values, and there was no
real server-side account of who is an admin. This migrates credentials to a
server-side **MySQL `admin_users`** table using `password_hash()` /
`password_verify()` (bcrypt), supporting **multiple accounts** and **roles
(`admin`, `manager`)**, with no credentials stored in the browser.

## What stays the same (by design — "hybrid")
The existing **HMAC admin token** that `rest.php` enforces (`hm_require_admin()` +
`X-ADMIN-TOKEN`) and `js/services/adminReauth.js` are **unchanged**. On login the
new endpoint mints that same token, so all admin-only write/delete enforcement
keeps working exactly as before. `admin.html` markup is untouched.

## Components

| File | Role |
|---|---|
| `hm-api/admin_users.schema.sql` | `admin_users` table DDL (migration SQL) |
| `hm-api/_admin_users.php` | Data layer + secure PHP session + token guard (include; `.htaccess`-denied) |
| `hm-api/admin-login.php` | `login` + `force_change_password` (login gate only) |
| `hm-api/admin-logout.php` | `logout` — destroys the PHP session |
| `hm-api/admin-session.php` | `verify` — token/session validity + current identity (revocation-aware) |
| `hm-api/admin-users.php` | user management (`list`/`create`/`update`=edit+disable/`reset_password`/`delete`) + `change_password` |
| `hm-api/admin-migrate.php` | One-time table create + first-admin seed; self-locks once provisioned |
| `hm-api/_lib.php` | `hm_admin_auth_enabled()` now accepts the MySQL path (legacy hash no longer required) — additive |
| `hm-api/_config.example.php` | New keys: `admin_seed_email/name/password`, `admin_setup_token` |
| `js/core/auth.js` | `Auth` now authenticates via `admin-login.php`; no localStorage credentials |
| `js/modules/security/security.js`, `staff.js` | Read admin email/roles from the server session; `manager` role label |

### Login flow
1. `Auth.login(email, password)` → `POST admin-login.php {action:'login'}`
2. Server `password_verify()` against `admin_users`, then:
   - starts a hardened PHP session (`hm_admin_sid`, HttpOnly, Secure, SameSite),
   - mints the HMAC admin token (role `admin`; account role in `urole`),
   - returns `{ token, exp, enforced, mustChange, user }`.
3. Client stores the token (sessionStorage + `window.__HM_ADMIN_TOKEN`) and a
   non-credential session marker (role/name/email + 30‑min UI timeout).

### Roles
`admin` = full access incl. managing other admin accounts. `manager` = panel
operator (mints a working token for content/calendar writes) but **cannot**
create/update/delete admin accounts (`hm_admin_require_manage_role`). The staff
UI's non-admin options map to `manager` server-side.

### Logout
`POST {action:'logout'}` destroys the PHP session; the client drops the token.
The HMAC token is stateless (cannot be revoked server-side without a denylist),
so it also naturally expires within `admin_session_ttl` (default 12h).

### Password reset (admin-initiated)
A logged-in **admin** resets another account's password via the existing
"パスワードリセット / PW変更" UI → `{action:'reset_password'}`, which sets the new
hash **and forces `must_change`** so the target picks their own password on next
login (handled by the existing force-change screen).

---

## Deployment (staging first, then production)

> PHP/MySQL are not installed locally, so validation is **post-deploy** (see below).

> **Sequencing (avoid a login gap):** the new `js/core/auth.js` requires
> `admin_users` to be seeded **and** `admin_session_secret` set before anyone can
> log in. Do steps **2–4 (backend config + seed + verify) BEFORE** putting the new
> `js/*` in front of admins** — i.e. upload `hm-api/*`, configure, run the
> migration, confirm a token is minted, and only then cut over the frontend JS.
> On a single atomic deploy, run `php hm-api/admin-migrate.php` immediately after
> upload so the gap is seconds, not minutes.

1. **Upload** the new/changed `hm-api/*` files and the `js/*` changes.
2. **Configure** `hm-api/_config.php` (copy from `_config.example.php` keys):
   - `admin_session_secret` → 64+ random chars (`php -r "echo bin2hex(random_bytes(32));"`)
   - `admin_seed_email` / `admin_seed_name`
   - `admin_seed_password` → the desired first-admin password
     *(or leave blank to migrate the existing `admin_pass_hash` 1:1, or to get a
     generated temp password)*
   - keep `admin_auth_enabled => false` **for now**
3. **Migrate + seed**:
   - With shell: `php hm-api/admin-migrate.php`
   - Without shell: set `admin_setup_token` to a long random value, visit
     `https://<host>/hm-api/admin-migrate.php?token=<that value>` **once**, then
     delete the token.
4. **Verify** an admin can log in (token minted) — run the Playwright spec below.
5. **Enforce**: set `admin_auth_enabled => true` (and remove `admin_seed_password`
   / `admin_setup_token`). This activates `rest.php` admin-only enforcement.
6. **Repeat on production** once staging passes.

## Post-deploy validation (production-like)

Static (pre-deploy, already done): `node --check` on changed JS + `npm run test:all`
(the 2 failing smoke assertions require a live API/`localhost:5050` and are
environmental — unrelated to auth).

Automated (against the deployed URL):
```
ADMIN_URL=https://staging.hello-moving.com/admin.html \
ADMIN_EMAIL=admin@hello-moving.com \
ADMIN_PASSWORD='...' \
npx playwright test tests/admin-auth.spec.js
```
Covers: invalid password rejected · valid login mints a token · no
`hm_admin_creds` in localStorage · logout clears the token.

Manual checklist:
- [ ] Login with the seeded admin → dashboard loads.
- [ ] Security page → add a `manager` account → it can log in.
- [ ] Admin resets the manager's password → manager is forced to change it on next login.
- [ ] Manager cannot create/delete admin accounts (403 `forbidden`).
- [ ] Deleting/demoting the **last** admin is refused (`last_admin`).
- [ ] With `admin_auth_enabled=true`, an admin-only write (e.g. edit a service) succeeds; after the token expires, `adminReauth.js` shows the re-login prompt.
- [ ] `hm-api/admin-migrate.php` over HTTP without the token → 403; after provisioning → "already_provisioned".

---

## Rollback plan

The change is **reversible without a redeploy** at the enforcement level:

1. **Fastest (disable enforcement):** set `admin_auth_enabled => false` in
   `hm-api/_config.php`. `rest.php` immediately reverts to API‑key‑only; the admin
   panel keeps working. (Login still uses `admin_users` if the new JS is live.)
2. **Full revert to the legacy login:** redeploy the previous `js/core/auth.js`
   (+ `security.js`/`staff.js`). The old localStorage path returns. Keep
   `admin_pass_hash` populated in config so the legacy server token path still
   mints tokens.
3. **Remove the table (optional):** `DROP TABLE admin_users;` Nothing else
   references it; `hm_admin_auth_enabled()` falls back to the legacy hash path.

No customer/portal endpoint is touched, so booking/portal flows are unaffected by
any rollback step. **Data-loss scope:** only Step 3 (`DROP TABLE admin_users`)
removes data, and only the admin-account rows (re-creatable via `admin-migrate.php`);
no bookings/customers/reviews/communications are affected. Keep `admin_pass_hash`
populated so the legacy login still works after a drop.

---

## Security notes (from the pre-deploy audit)

- **Session cookie** `hm_admin_sid`: `HttpOnly` + `Secure` (https) + `SameSite=Lax`;
  `session_regenerate_id(true)` runs on every successful login (fixation defence).
- **CSRF:** all state-changing actions (`create_user`/`update_user`/`delete_user`/
  `reset_password`/`change_password`) authorize via the **`X-ADMIN-TOKEN` custom
  header** (held in `sessionStorage`, never a cookie). Browsers will not attach it
  to cross-site requests, and cross-origin attempts hit a CORS preflight the server
  only answers for the allowlisted origin — so a forged cross-site request carries
  no authorization. The session cookie alone authorizes nothing.
- **Token revocation:** account-management/password actions re-check that the
  token's `uid` still exists and is `active` on every call, and re-read the current
  role from the DB — so deleting/deactivating/demoting an admin takes effect
  immediately for these actions (not after token expiry).
- **No secrets to the browser:** responses never include password hashes, the
  signing secret, the API key, the setup token, or the session id (cookie-only,
  HttpOnly). The HMAC **token IS returned by design** — it is the client's own
  bearer credential, kept in `sessionStorage`, exactly like a JWT.
- **Brute force:** login `10/IP/min` + general endpoint `90/IP/min` +
  `change_password 10/IP/min`, all with strike-based IP blocking (`_ratelimit.php`);
  client-side lockout adds 5-attempt exponential backoff; failures are written to
  `error.log` via `hm_log_auth_fail`.

### Accepted residual risk
`rest.php` content writes (services/calendar/hm_data/inbox) trust the token
**signature** for its lifetime (`admin_session_ttl`, default 12h) and are **not**
re-checked against account status (that hot path does not load the admin_users
layer). A deactivated admin could therefore still perform *content* writes until
their token expires. **Mitigation:** set `admin_session_ttl` to a lower value
(e.g. `4 * 60 * 60`) to bound this window. The sensitive operations
(creating/deleting/elevating admin accounts) are already revocation-checked above.
