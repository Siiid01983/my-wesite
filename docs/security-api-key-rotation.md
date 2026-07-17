# API Key Rotation Procedure

`window.API_KEY` (in `js/config/env.js`) is the page-served public key sent as
`X-API-KEY` to `hm-api/*`. It is **not a secret** — it ships to every browser.
After the RC-E read hardening (see `rest.php` / `_lib.php hm_require_staff_read`),
this key **no longer grants read access to customer PII**; sensitive reads now
require a staff session token. Rotation is therefore defense-in-depth: it
invalidates any previously scraped key and re-baselines the public gate.

## When to rotate
- On any suspicion the key was used to scrape data (before the RC-E fix).
- On a routine cadence (e.g. quarterly), or when a developer with access leaves.

## What the key still gates (post-hardening)
- **Public reads:** CMS content only — `hm_data`, `services`, `reviews`,
  `blog_posts`, `calendar_availability`. (No PII.)
- **Public writes:** booking creation (`create-booking.php`), review submission,
  contact/portal message send — all with their own server-side validation.
- **NOT** `bookings` / `communications` / `inbox_messages` / `audit_log` reads —
  those require a staff token or an ownership-gated endpoint.

## Procedure (zero-downtime)
The server accepts a key match via `hash_equals` against `config['api_key']`.
To rotate without a flash of 401s, use the standard deploy that regenerates
`env.js` from the deploy secret.

1. **Generate a new key**
   ```bash
   openssl rand -hex 32
   ```
2. **Update the deploy secret** used by `deploy.js` to emit `env.js`
   (`API_BASE`/`API_KEY`). Set the new value in the CI/deploy secret store
   (do NOT hand-edit the committed `env.js`).
3. **Update the server** `hm-api/_config.php` `api_key` to the **new** value.
   - If the server supports a dual-key window, set `api_key` = new and
     `api_key_prev` = old for a short overlap, then drop `api_key_prev`.
   - If not, deploy step 3 and step 4 together (brief; only affects public
     endpoints — PII reads are already staff-gated).
4. **Redeploy the frontend** so every page serves the new `env.js`
   (bump `CACHE_VERSION` / service-worker precache so clients pick it up).
5. **Invalidate caches / SW**: confirm `sw.js` `CACHE_VERSION` advanced so the
   old `env.js` is not served from cache.
6. **Verify** (see checklist below).

## Post-rotation verification
- [ ] Public site loads; booking form submits (`create-booking.php` 200).
- [ ] Reviews/CMS content still render (public reads OK with new key).
- [ ] Ops app + admin panel load data (staff-token reads unaffected by key).
- [ ] Customer portal messaging loads (`portal-communications.php`).
- [ ] Old key now returns `401 {code:"api_key"}` on `hm-api/*`.
- [ ] No `bad_api_key` spikes in logs after the SW cache window elapses.

## Rollback
Restore the previous `api_key` in `_config.php` and redeploy the prior `env.js`.
Because reads are staff-gated regardless of the key, a rollback does not
re-expose PII.
