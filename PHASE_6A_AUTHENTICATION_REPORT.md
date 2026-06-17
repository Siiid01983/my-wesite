# Phase 6A — Customer Authentication Hardening Report

**Status:** Implemented (security hardening only — no Phase 6B work started)
**Date:** 2026-06-16
**Branch:** `phase-5a-customer-portal`
**Scope:** Replace the customer portal's booking-lookup + email-verification +
sessionStorage access model with **Supabase Auth Magic Link** authentication,
without breaking any existing Phase 5A–5G functionality.

---

## 1. Summary

The customer portal previously granted access to anyone who could supply a
booking's **email + reference number** — both are values that appear in
confirmation emails and are therefore *knowledge factors*, not proof of identity.
The "session" was a self-minted random token in `sessionStorage`.

Phase 6A replaces that with **Supabase Auth passwordless email (Magic Link)**:

- The customer enters only their **email address**.
- Supabase emails them a **one-time link**. Clicking it proves they control the
  inbox and mints a real, signed, auto-refreshing **JWT session**.
- The portal resolves the customer's booking(s) from the **verified email**, not
  from a typed reference. A customer can only ever reach a booking whose
  `customer_email` equals their authenticated email.

Authentication is now a **possession factor** (control of the email inbox)
backed by cryptographic tokens, instead of a guessable knowledge factor.

All existing portal features (dashboard, communications, documents, photos,
estimate approval, reviews) are preserved and now sit behind real authentication.
The legacy booking-lookup logic is **retained but no longer surfaced in the UI**,
per the "do not delete until migration is verified" requirement.

---

## 2. Architecture changes

### Before (Phase 5A)

```
login.html ──(email + ref)──► PortalAuth.login()
                                  │  BookingService.getBookingById(ref)
                                  │  compare booking.email === typed email
                                  ▼
                          sessionStorage token (hm_portal_sess, 60-min)
                                  │
portal.html ──► PortalAuth.requireSession() ──► getCurrentBooking(ref)
```

### After (Phase 6A)

```
login.html ──(email only)──► PortalSupabaseAuth.sendMagicLink(email)
                                  │  supabase.auth.signInWithOtp({ emailRedirectTo })
                                  ▼
                          Supabase emails a one-time link
                                  │  (customer clicks)
                                  ▼
portal.html ◄── redirect with token ──► supabase-js consumes it
                                  │  (persistSession + autoRefreshToken)
                                  ▼
PortalAuth.resolveSession()  ── Supabase JWT (verified email) ─┐
                             ── legacy sessionStorage (fallback)┤
                             ── neither → redirect to login ────┘
                                  │
getCurrentBooking() ── authed → BookingService.getBookingsByEmail(verified email)
                    └─ legacy → BookingService.getBookingById(ref) + email re-check
```

### Layering

A new thin module wraps Supabase Auth; `PortalAuth` becomes an auth-aware
resolver that keeps the legacy path alive for migration safety. The shared
`SupabaseClient` is **unchanged** — supabase-js v2 defaults
(`persistSession`, `autoRefreshToken`, `detectSessionInUrl`) already provide
everything Magic Link needs, so admin/public surfaces are untouched.

---

## 3. Authentication flow diagram

```
┌──────────┐   1. enter email          ┌─────────────────────┐
│ Customer │ ────────────────────────► │  login.html         │
└──────────┘                           │  sendMagicLink()    │
     ▲                                 └─────────┬───────────┘
     │                                           │ 2. signInWithOtp
     │                                           ▼
     │                                 ┌─────────────────────┐
     │       3. one-time link email    │  Supabase Auth      │
     │ ◄────────────────────────────── │  (Email provider)   │
     │                                 └─────────────────────┘
     │ 4. click link
     ▼
┌─────────────────────────────────────────────────────────────┐
│ portal.html?...token...                                       │
│   supabase-js detectSessionInUrl → stores JWT (localStorage)  │
│   PortalSupabaseAuth.waitForSession() captures SIGNED_IN      │
│   PortalAuth.resolveSession() → { authed:true, email }        │
│   getCurrentBooking() → getBookingsByEmail(verified email)    │
│   render dashboard / comms / docs / photos / reviews          │
└─────────────────────────────────────────────────────────────┘
   Session auto-refreshes; logout = supabase.auth.signOut()
```

**Session lifecycle**

| Event | Behaviour |
|---|---|
| Create | Magic Link click → supabase-js stores a JWT in `localStorage`. |
| Restore | On page load, `getSession()` returns the persisted JWT → no re-login. |
| Refresh | `autoRefreshToken` renews the access token before expiry automatically. |
| Expire | Refresh token exhausted/invalid → `resolveSession()` returns `null` → redirect to `login.html`. |
| Logout | `PortalAuth.logout()` → `supabase.auth.signOut()` + clears any legacy token. |

---

## 4. Affected files

### New

| File | Purpose |
|---|---|
| `js/portal/portalSupabaseAuth.js` | `window.PortalSupabaseAuth` — wraps Supabase Auth: `sendMagicLink`, `waitForSession`, `getAuthedEmail`, `signOut`, `cleanUrl`, `isConfigured`. Touches Auth only — no business tables. |
| `supabase/recommendations/PHASE_6A_customer_rls_recommendations.sql` | RLS isolation recommendations. **Outside `migrations/` so it is never auto-applied.** |
| `PHASE_6A_AUTHENTICATION_REPORT.md` | This report. |

### Modified

| File | Change |
|---|---|
| `login.html` | Email-only Magic Link form (removed the 予約番号 field); "check your inbox" confirmation state + "resend / different address"; auto-redirect to portal if already authenticated. Loads `portalSupabaseAuth.js`. |
| `portal.html` | Route guard now `await PortalAuth.resolveSession('login.html')` (async); secure async logout via `signOut()`; loads `portalSupabaseAuth.js` before `portalAuth.js`. Feature code unchanged. |
| `js/portal/portalAuth.js` | Reworked to be Auth-backed: new `resolveSession()` (Supabase → legacy → redirect); `getCurrentBooking()` resolves by **verified email** for authed sessions (legacy ref path retained); `logout()` now ends the Supabase session; `getSession()` returns the resolved/authed session synchronously for callers (audit actor labelling). Legacy `login()` preserved. |
| `bookingService.js` | Added `getBookingsByEmail(email)` — server-side scoped (`ilike customer_email`), newest-first. Additive; nothing else changed. |

### Deliberately **not** changed

- `js/services/supabaseClient.js` (shared — defaults suffice for Auth).
- Admin panel, WMC, CMS, public site, database schema.
- `PortalComms` / `PortalDocs` / `PortalPhotos` / `PortalApproval` / `PortalReviews`
  (booking-scoped logic unchanged; they now run behind real auth).
- Production RLS policies (recommendations only — see §7).

---

## 5. Authorization model

| Resource | Isolation mechanism (after Phase 6A) |
|---|---|
| Own booking | `getCurrentBooking()` queries `getBookingsByEmail(verified email)`; defence-in-depth re-checks `booking.email === auth email`. |
| Communications | `PortalComms.fetchForBooking([ids], sess.email)` — scoped to the bound booking id(s) **and** filtered by the verified email. |
| Documents | `PortalDocs` confines every list/download to `customer-documents/<bookingId>/…`; out-of-scope paths blocked; signed URLs only. |
| Photos | `PortalPhotos` — same booking-prefix confinement; signed URLs only; uploads built from the bound id. |
| Reviews | `PortalReviews` — one per booking, scoped photo folder, `source:'customer'`, `approved:false` into the existing moderation workflow. |
| Audit log | Append-only from the portal; the portal exposes **no** audit-read path and never loads `window.Auth`, so customers cannot read the trail. |

The trust anchor moved from *"knows email + ref"* to *"controls the email inbox"*.
Because the bound booking is derived from the cryptographically verified email,
a customer cannot pivot to another customer's booking by guessing a reference.

---

## 6. Security improvements

1. **Real authentication** — possession of the email inbox (Magic Link) replaces a
   guessable email+reference knowledge pair.
2. **Signed, expiring tokens** — Supabase JWTs with auto-refresh replace a
   self-minted `sessionStorage` token.
3. **Email-derived authorization** — the accessible booking is resolved from the
   *verified* email, eliminating reference-guessing as an access path.
4. **Server-side scoped queries** — `getBookingsByEmail()` filters at the database
   (`.ilike`) rather than pulling-then-filtering.
5. **Secure logout** — terminates the Supabase session server-side via `signOut()`.
6. **Role separation surfaced** — authenticated customers now present role
   `authenticated` to PostgREST (vs admin's `anon`), unlocking true DB-level
   per-customer RLS (see §7).
7. **No credential disclosure** — generic error copy retained; no enumeration of
   which emails/references exist.

---

## 7. RLS recommendations (NOT applied)

> Full SQL: `supabase/recommendations/PHASE_6A_customer_rls_recommendations.sql`
> (placed outside `migrations/` so it is never auto-run).

### Central finding ⚠️

Today **all** RLS policies are `TO anon … USING (true)` and customer isolation is
enforced only in app code. Once customers authenticate, their requests are role
**`authenticated`**, not `anon`. This is both an opportunity and a requirement:

- **Opportunity:** enforce per-customer isolation in the database using
  `auth.email()`.
- **Requirement:** if RLS is enforced as currently written (anon-only policies),
  an authenticated customer matches **no** policy and is **denied**. Companion
  `authenticated`-role policies must be added **before/with** enabling Auth in
  production, or the portal will read nothing.

The admin panel and public site keep using the `anon` key, so existing `TO anon`
policies are **left intact**; the recommendation only **adds** `authenticated`
policies.

### Per-table recommendations

| Table | Recommendation |
|---|---|
| `bookings` | Add `authenticated` SELECT/UPDATE scoped to `lower(customer_email)=lower(auth.email())`. Keep anon (admin + public insert). |
| `communications` | Add `authenticated` SELECT scoped by `customer_email = auth.email()`. No customer write policies (portal is read-only). |
| `reviews` | Add `authenticated` SELECT via a join to `bookings` (no email column today) + permissive `authenticated` INSERT (app enforces 1/booking, `approved:false`). Or add a `customer_email` column and scope directly. |
| `audit_log` | Add `authenticated` INSERT (append-only). **No** authenticated SELECT — customers must never read the trail. |
| `inbox_messages` | No change — RLS disabled; do not grant `authenticated` any access. |
| Storage (`media`) | Keep the bucket **private** and continue serving via short-lived signed URLs (already the case). Optional object-level RLS via a path→owner-email helper is sketched but must be validated against real paths first. |

---

## 8. Validation results

### Automated smoke test (Playwright headless, dev server :5050)

| Check | Result |
|---|---|
| `login.html` renders email-only Magic Link form | ✅ `#email` present, `#ref` removed |
| Login button copy | ✅ "ログインリンクを送信" |
| `window.PortalSupabaseAuth` loaded & configured | ✅ `isConfigured() === true`, `sendMagicLink` present |
| `PortalAuth.resolveSession` exposed | ✅ present |
| `BookingService.getBookingsByEmail` exposed | ✅ present (legacy `getBookingById` also retained) |
| Console / page errors on `login.html` | ✅ none |
| `portal.html` unauthenticated access | ✅ redirects to `login.html` |
| Console / page errors on `portal.html` | ✅ none |
| `node --check` on all modified JS | ✅ pass (3/3) |

### Manual / config-dependent (requires live Supabase Auth + a real inbox)

These require the Email provider enabled and the portal origin allow-listed
(see §9); they cannot be exercised headlessly without a deliverable inbox:

| Area | How to verify |
|---|---|
| Magic Link delivery + login | Submit an email on `login.html`; click the emailed link; confirm landing authenticated on `portal.html`. |
| Session restore | Reload `portal.html` after login → stays authenticated (no re-login). |
| Session expiry | Invalidate the session (sign out elsewhere / expire) → next nav redirects to `login.html`. |
| Logout | Click ログアウト → `signOut()` → redirected; reload does not restore. |
| Customer A ≠ B | Log in as A; confirm only A's booking, comms, docs, photos, reviews appear. With the §7 RLS applied in staging, confirm B's rows are denied at the DB too. |
| Regression (5A–5G) | Dashboard, messages, documents, photo upload/delete, estimate approval, review submit — all function against the resolved booking. |

### Regression assessment (code-level)

All Phase 5 feature modules are **unchanged** and continue to operate on the
booking object returned by `getCurrentBooking()`; only the *source* of that
booking changed (verified email vs typed reference). The `sess.email` used by the
Communication Center is now the verified email. Audit actor labelling
(`PortalApproval`/`PortalReviews` `_actor()`) still resolves via
`PortalAuth.getSession()`, which now returns the authenticated session.

---

## 9. Required production configuration

Before this is live, configure in the Supabase dashboard:

1. **Authentication → Providers → Email:** enable Email, with **Magic Link** /
   passwordless sign-in turned on.
2. **Authentication → URL Configuration:** add the portal origin(s) to the
   redirect allow-list, e.g. `https://<your-domain>/portal.html` (and
   `http://localhost:5050/portal.html` for local dev).
3. **(Recommended)** Apply the §7 RLS in **staging** first, verify the portal
   reads/writes succeed for an authenticated customer and that cross-customer
   access is denied, confirm the admin/public anon paths are unaffected, then
   promote.

---

## 10. Remaining risks

1. **RLS/role mismatch (highest priority).** Until the §7 `authenticated`-role
   policies are applied, an enforced anon-only RLS posture will deny authenticated
   portal reads. Apply the companion policies with the Auth cut-over.
2. **Open sign-up surface.** `signInWithOtp` defaults to `shouldCreateUser:true`,
   so anyone can *authenticate* an email — but they see a portal **only** if a
   booking exists under that verified email. Authentication ≠ authorization here.
   Consider rate-limiting and (optionally) restricting sign-ups if needed.
3. **Multiple bookings per email.** The portal currently binds to the **most
   recent** booking for the verified email. A booking selector for repeat
   customers is future work (out of Phase 6A scope).
4. **Email deliverability.** Magic Link UX depends on inbox delivery; misconfigured
   SMTP/sender or spam filtering blocks login. Verify the Supabase email sender.
5. **Storage object-level RLS.** Storage isolation remains app-enforced (scoped
   prefixes + signed URLs). DB-level object RLS is sketched but intentionally not
   applied pending path validation.
6. **Legacy path still present.** The reference-lookup `PortalAuth.login()` and
   `sessionStorage` fallback remain (by requirement) until the Magic Link flow is
   verified in production; schedule their removal in a follow-up once confirmed.

---

## 11. Migration / cut-over checklist

- [ ] Enable Email (Magic Link) provider in Supabase.
- [ ] Allow-list `portal.html` origin(s) in Auth → URL Configuration.
- [ ] Apply §7 RLS in staging; verify isolation + admin/public unaffected.
- [ ] Verify full 5A–5G regression as an authenticated customer.
- [ ] Promote to production.
- [ ] After a verification window, remove the legacy reference-lookup login path
      and `sessionStorage` fallback (separate cleanup task).

*End of Phase 6A report. Phase 6B and later phases were not started.*
