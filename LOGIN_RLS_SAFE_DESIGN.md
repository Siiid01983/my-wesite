# LOGIN_RLS_SAFE_DESIGN.md

**Change:** Replace the Customer Portal **Magic Link** UX with **Email + Confirmation Number**, while **keeping Supabase Auth** and **keeping Phase 6B RLS fully and actively enforced**.

**Status:** DESIGN ONLY — nothing implemented, nothing deployed.
**Date:** 2026-06-19
**Supersedes:** the app-session approach in `LOGIN_REFACTOR_PLAN.md` (rejected: it dropped the JWT and made Phase 6B RLS dormant).

---

## 1. The core problem

Phase 6B isolation policies enforce on the **`authenticated`** role and key off **`auth.email()`**:

```sql
-- 20260617000003_phase6b_customer_isolation_rls.sql
CREATE POLICY "bookings_auth_select_own" ON bookings FOR SELECT
  TO authenticated
  USING (lower(customer_email) = lower(auth.email()));
```

`auth.email()` is only populated when the request carries a **real Supabase Auth JWT**. So to keep RLS active, the customer **must finish login holding a genuine Supabase session** — not a local `sessionStorage` token.

Today that JWT comes from **Magic Link** (`signInWithOtp` → email → click → `setSession`). The requirement is to obtain the **same JWT** from **email + booking reference**, with **no email sent** and **no click**.

**Key insight:** A real GoTrue session can be minted *server-side* from a verified email, without any email being sent, using the **Admin API behind the `service_role` key**. The browser can never hold `service_role`, so this must live in an **Edge Function** — and the repo already runs Edge Functions with `service_role` (`supabase/functions/send-email`, `receive-email`), so the pattern and deploy flow already exist.

---

## 2. Target flow

```
1. Customer enters  email + 予約番号 (booking reference)  on login.html
2. Browser POSTs them to the new Edge Function  portal-auth  (anon-invokable)
3. portal-auth (service_role, BYPASSES RLS) validates the pair against bookings
4. On match: ensure a Supabase Auth user exists for that email (no email sent),
   then mint a session and return { access_token, refresh_token } to the browser
5. Browser calls  SupabaseClient.auth.setSession({access_token, refresh_token})
   → now holds a REAL authenticated JWT with auth.email() = customer's email
6. Redirect to portal.html
7. Every portal query runs as role `authenticated` → Phase 6B RLS ACTIVELY enforces
```

No Magic Link. No email. A normal, auto-refreshing Supabase session. RLS never goes dormant.

---

## 3. Architecture diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BROWSER  (login.html — anon key only, no service_role ever)                     │
│                                                                                │
│   [ Email ] [ 予約番号 / Confirmation Number ]  → "ログイン"                      │
│         │                                                                       │
│         │ 1. POST {email, reference}                                            │
│         ▼      (apikey: anon, over HTTPS)                                       │
└─────────┼──────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ EDGE FUNCTION  portal-auth   (Deno, deployed --no-verify-jwt)                    │
│ Holds SERVICE_ROLE key (env secret). BYPASSES RLS for the lookup only.          │
│                                                                                │
│   2. rate-limit (per IP + per email)                                            │
│   3. SELECT from bookings WHERE lower(customer_email)=lower(:email)             │
│        AND reference matches  (id::text  OR  notes 'ref:<reference>')           │
│        → no match ⇒ return generic 401 (no detail, no enumeration)             │
│   4. ensureUser(email):                                                         │
│        auth.admin.getUserByEmail(email)                                         │
│        └─ if absent → auth.admin.createUser({ email, email_confirm:true })      │
│           (email_confirm:true ⇒ usable immediately, **sends NO email**)         │
│   5. mint session WITHOUT emailing:                                             │
│        a) auth.admin.generateLink({ type:'magiclink', email })                  │
│           → returns properties.hashed_token   (generateLink does NOT send mail) │
│        b) anonClient.auth.verifyOtp({ type:'magiclink', token_hash })           │
│           → { access_token, refresh_token }                                     │
│   6. return { ok:true, access_token, refresh_token }                            │
└─────────┬──────────────────────────────────────────────────────────────────────┘
          │  (tokens, HTTPS)
          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ BROWSER                                                                          │
│   7. SupabaseClient.auth.setSession({access_token, refresh_token})              │
│   8. location.replace('portal.html')                                            │
└─────────┼──────────────────────────────────────────────────────────────────────┘
          │  (now every request carries a real JWT; role = authenticated)
          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ portal.html  →  PortalAuth.resolveSession()  picks up the Supabase Auth session │
│                                                                                │
│   SELECT * FROM bookings ...   ⇒  PostgREST role = authenticated                │
│        Phase 6B policy: USING (lower(customer_email)=lower(auth.email()))       │
│        ✅ customer sees ONLY their own rows — RLS ACTIVELY ENFORCED              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Why no email is sent at any step:** `auth.admin.createUser({email_confirm:true})` provisions a confirmed account silently; `auth.admin.generateLink()` only *computes* a link/token and returns it to the caller — it never delivers anything. We exchange that token for a session server-side and hand the tokens straight back over the HTTPS response.

---

## 4. Files to modify / create

| # | File | Action | Detail |
|---|---|---|---|
| 1 | **`supabase/functions/portal-auth/index.ts`** | **CREATE** | New Edge Function (mirrors `send-email` conventions: `Deno.serve`, CORS, `Deno.env.get`). Validates email+reference against `bookings` with `service_role`, ensures the auth user, mints + returns `{access_token, refresh_token}`. Rate-limits. Generic failures. Deploy: `supabase functions deploy portal-auth --no-verify-jwt`. |
| 2 | **`js/portal/portalSupabaseAuth.js`** | **MODIFY (additive)** | Add `loginWithReference(email, ref)`: POST to `${SUPABASE_URL}/functions/v1/portal-auth` with the anon `apikey` header; on `ok`, call `_sb().auth.setSession({access_token, refresh_token})`; return `{ok}` / `{ok:false, error}`. **Keep** all existing methods (`waitForSession`, `cleanUrl`, `signOut`, `isConfigured`) — Supabase Auth is retained, not removed. `sendMagicLink` may stay as an unused fallback or be left in place. |
| 3 | **`login.html`** | **MODIFY** | Add the **予約番号 / Confirmation Number** input; update copy (no "we'll email a link"); replace the submit handler to call `PortalSupabaseAuth.loginWithReference(email, ref)` then `location.replace('portal.html')` on success; remove the "email sent / resend" confirmation box; keep the "already authenticated → portal" check (it already uses `PortalSupabaseAuth.waitForSession`). Keep the `portalSupabaseAuth.js` script tag. |

### Reviewed — **no change required**

| File | Why |
|---|---|
| **`portal.html`** | Route guard `PortalAuth.resolveSession('login.html')` already resolves the **Supabase Auth** session first. A session created via `setSession` is indistinguishable from a Magic-Link one, so the portal works unchanged with RLS active. |
| **`js/portal/portalAuth.js`** | `resolveSession()` authenticated branch + `getCurrentBooking()` (`getBookingsByEmail`) already operate on the verified email. Under active RLS, `getBookingsByEmail` now returns *only* the caller's rows — strictly safer, no code change. |
| **`bookingService.js`** | Lookups already exist; no change. |
| **`admin.html` / all `js/` admin modules / `js/core/auth.js`** | **Out of scope. Untouched.** |
| **All `supabase/migrations/*` incl. Phase 6B RLS** | **Not edited, not dropped, not re-run.** Policies stay exactly as deployed and now stay *active* because the portal keeps a real JWT. |

### Configuration (no file change, operational)
- Edge Function secret: `SERVICE_ROLE_KEY` (and `SUPABASE_URL`) set via `supabase secrets set` — **never** in client code or `env.js`.
- Endpoint `${SUPABASE_URL}/functions/v1/portal-auth` is derived in the client from the existing `window.SUPABASE_URL`; no new credential ships to the browser.
- Supabase Auth must remain **enabled** (it is, for Phase 6A). The email *provider* is no longer on the critical path (we never send), which incidentally removes the prod SMTP 429 rate-limit blocker noted in project memory.

---

## 5. Security implications

| Area | Implication & mitigation |
|---|---|
| **Confirmation number is now a credential** | `HM-YYYYMMDD-XXXX` has low entropy (~4 base36 chars). It guards session minting, so it is brute-forceable. **Mandatory mitigations in `portal-auth`:** (a) rate-limit per IP **and** per email (e.g. 5/15 min, then backoff); (b) generic `401` for both "no such booking" and "email/reference mismatch" — never reveal which; (c) optional CAPTCHA/Turnstile after N failures; (d) log attempts for monitoring. Without rate-limiting this is the weakest point — call it out explicitly at review. |
| **`service_role` exposure** | Lives only in the Edge Function environment. Never returned to the client, never in `env.js`, never logged. The browser only ever holds the anon key + its own user JWT. |
| **No email verification of ownership** | Magic Link proved inbox control; email+reference proves *knowledge of a reference tied to that email*. This is a deliberate, weaker ownership proof chosen for UX. Documented trade-off: someone who learns a customer's email **and** their booking reference can log in. Generic errors + rate limiting keep this to a targeted (not bulk) risk. |
| **Account provisioning** | `createUser` is only ever reached **after** a valid email+reference match, so only real booking emails get auth accounts, and only on demand. `email_confirm:true` prevents any confirmation email. |
| **One auth user per email → all their bookings** | The session authorizes by **email**, so a customer with multiple bookings sees all of them in the portal (consistent with Phase 6A/6B, whose policies scope by `auth.email()`, not by a single reference). The reference is the *gate to get the session*, not a per-booking scope. Confirm this is the intended authorization model. |
| **RLS remains the enforcement layer** | Because the browser ends up with a real JWT, `bookings_auth_select_own`, `comm_auth_select_own`, `reviews_auth_select_own`, `bookings_auth_update_own`, and the audit append-only policy all enforce server-side. App-layer checks in `PortalAuth` become defence-in-depth, not the sole control. **This is the whole point of the design and it is satisfied.** |
| **Token handling** | `access_token`/`refresh_token` returned over HTTPS and stored by supabase-js exactly as Magic Link does today — no new storage surface. Auto-refresh and `signOut()` work unchanged. |
| **CORS** | `send-email` uses `Access-Control-Allow-Origin: *`. For an auth endpoint, tighten to the site origin(s) to reduce cross-origin abuse. |
| **`--no-verify-jwt` deploy** | Required so unauthenticated visitors can call it (they have no JWT yet). The function performs its own validation; this matches the existing `send-email` deployment. |
| **Admin auth untouched** | Separate system (`js/core/auth.js`, salted hash). No interaction with this change. |

---

## 6. Verification plan (after implementation, before any deploy)

1. Deploy `portal-auth` to **staging**; set `SERVICE_ROLE_KEY`/`SUPABASE_URL` secrets.
2. Valid email + valid reference → tokens returned → `setSession` → `portal.html` loads; **network tab shows a real JWT** on subsequent `bookings` requests, and **no `signInWithOtp` / no email**.
3. In the SQL editor confirm the session is `authenticated`: a portal `select * from bookings` returns **only** the customer's rows (RLS proof). A second customer cannot see the first's rows.
4. Wrong reference / wrong email → generic 401, no session, no redirect.
5. Rate-limit triggers after N attempts.
6. Refresh portal → session persists (real JWT auto-refresh).
7. Logout → `signOut()` clears the Supabase session → back to `login.html`.
8. `admin.html` login unaffected; `npm test` → `pass 20 / fail 0`.

---

## 7. Rejected alternative (for the record)

**Booking-reference-as-password (`signUp`/`signInWithPassword`, no Edge Function).** Rejected: requires disabling email confirmation project-wide (or handling a confirmation email — which we're removing); the reference becomes a permanent password with no rotation; multiple bookings per email collide on one password; and account creation/credential logic would run in the browser. The Edge Function approach keeps validation server-side, sends no email, needs no project-wide auth weakening, and matches existing infrastructure.

---

## 8. Approval gate (nothing built yet)

To proceed to implementation, confirm:
- (a) Build the **`portal-auth` Edge Function** + the `loginWithReference` client method + the `login.html` UX (3 files, §4).
- (b) Accept the **authorization model**: session is per **email**, so a customer sees all bookings on that email (§5).
- (c) Accept the **ownership-proof trade-off** (email+reference instead of inbox control) with **rate-limiting mandatory** in the function (§5).
- (d) Edge Function deployment is **manual** (`supabase functions deploy portal-auth --no-verify-jwt`); nothing auto-deploys.
