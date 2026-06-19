# LOGIN_REFACTOR_PLAN.md

**Change:** Replace Customer Portal **Magic Link** authentication with **Email + Confirmation Number (Booking Reference)** authentication.

**Status:** PLAN ONLY — no code changed yet. No deployment.
**Date:** 2026-06-19
**Scope:** Customer Portal only (`login.html` / `portal.html` / `js/portal/*`). **Admin panel is NOT touched.**

---

## 1. Current behaviour (what we are replacing)

| Element | Today |
|---|---|
| `login.html` | Collects **email only**. Calls `PortalSupabaseAuth.sendMagicLink(email)` → Supabase Auth emails a one-time link. Shows a "check your inbox" confirmation box. |
| Authentication | Customer clicks the emailed link → lands on `portal.html` with a Supabase Auth **JWT** (role `authenticated`). |
| `portal.html` guard | `PortalAuth.resolveSession('login.html')` resolves, in order: (1) Supabase Auth JWT session, (2) **legacy** email+reference `sessionStorage` session, (3) none → redirect to login. |
| Session | Supabase JWT (auto-refresh) **or** legacy `hm_portal_sess` token (60-min sliding TTL). |

> Note: the **legacy email+reference login already exists** in the codebase as `PortalAuth.login(email, ref)` (`js/portal/portalAuth.js`). It was kept as a migration fallback. This refactor **promotes that path back to primary** and retires Magic Link from the UI.

---

## 2. Target behaviour (what we are building)

**Login form (`login.html`):**
- Field 1: **メールアドレス** (Email Address)
- Field 2: **予約番号 / Confirmation Number** (Booking Reference, e.g. `HM-20260101-AB12`)
- Button: ログイン (Login) — no email is sent.

**Authentication logic (already implemented in `PortalAuth.login`):**
1. User submits email + booking reference.
2. `BookingService.getBookingById(ref)` queries the `bookings` table.
3. Match check (client-side, on the returned row):
   - `customer_email` (row) == entered email (case-insensitive), **and**
   - the reference resolves to a real booking row.
4. If valid → mint a customer portal session (`hm_portal_sess` in `sessionStorage`, 60-min sliding TTL) via `PortalAuth.login()`.
5. Redirect to `portal.html`.
6. **No Magic Link email is sent.**
7. On failure → single generic message ("予約が見つかりませんでした…") so we never disclose whether a given email/reference exists.

---

## 3. Files that WILL be modified

| # | File | Change | Risk |
|---|---|---|---|
| 1 | **`login.html`** | **REWRITE the form + inline script.** Add the booking-reference input; change copy from "send a link" to "enter email + reference"; replace the submit handler to call `PortalAuth.login(email, ref)` and redirect to `portal.html` on success; remove the "email sent" confirmation box and the "resend" button; update the already-logged-in redirect to check `PortalAuth.getSession()`. Remove the `portalSupabaseAuth.js` script tag (no longer needed on this page). | **Medium** — this is the only behavioural change. |

### Files reviewed and intentionally NOT modified

| File | Why no change is needed |
|---|---|
| **`portal.html`** | Its route guard `PortalAuth.resolveSession('login.html')` **already** accepts the legacy email+reference session (fallback branch). With no Magic Link callbacks in the URL, `waitForSession()` returns `null` fast and resolution falls straight through to the legacy session. All portal features (overview, booking, progress, messages, documents, photos, reviews, self-service) read through `PortalAuth.getCurrentBooking()`, whose legacy branch re-verifies the email↔booking match on every load. **Preserved.** |
| **`js/portal/portalAuth.js`** | `login()`, `getSession()`, `resolveSession()`, `getCurrentBooking()`, `logout()` already implement the email+reference model end-to-end. No functional change required. *(Optional, non-functional: refresh the header comments that call this path "legacy".)* |
| **`js/portal/portalSupabaseAuth.js`** | Left in the repo, dormant. `portal.html` still loads it; `resolveSession()` guards every call with `if (window.PortalSupabaseAuth && …)`, so an unused module is harmless. Not deleted, to keep the diff minimal and reversible. |
| **`bookingService.js`** | `getBookingById()` / `getBookingsByEmail()` already provide the lookup. No change. |
| **`admin.html` and all `js/` admin modules** | **Out of scope. Untouched**, per requirements. |
| **`supabase/migrations/*` (incl. Phase 6B RLS)** | No migration edited, dropped, or re-run. See §4. |

---

## 4. Phase 6B RLS — what happens to it (IMPORTANT, read before approving)

**The Phase 6B RLS policies are NOT removed or modified — they stay applied in the database.** That requirement is met.

However, you must understand the **trust-model consequence** of this change, because it is real:

- Phase 6B's per-customer isolation policies (`bookings_auth_select_own`, `comm_auth_select_own`, `reviews_auth_select_own`) are written for the **`authenticated`** role and key off **`auth.email()`** — i.e. they only enforce when the request carries a **Supabase Auth JWT**, which is produced **only by Magic Link**.
- Email + Confirmation Number login produces **no JWT**. The portal runs as the **`anon`** role (the same anon key the public site/admin use). The baseline policy `bookings_anon_select USING(true)` lets `anon` read all booking rows.
- Therefore, with this change, **customer isolation reverts to being enforced in the application layer** — exactly the pre-Phase-6A model: `PortalAuth.login()` verifies `customer_email == entered email` before minting a session, and `getCurrentBooking()` re-verifies on every load. The Phase 6B `authenticated`-role policies remain in place but become **dormant** (nothing exercises them once Magic Link is gone).

**Net:** Phase 6B is preserved on disk and in the DB (nothing dropped), but it is no longer the *active* enforcement layer for the portal. Isolation is app-enforced via the email match. If DB-level (RLS) isolation is a hard requirement, Magic Link (or another flow that yields a real JWT) is the only way to keep `auth.email()` populated — that trade-off cannot be avoided by editing the front end alone.

This is the single most important thing to confirm before implementation. The requirement "Keep all Phase 6B RLS protections" is satisfied in the literal sense (policies untouched); this note documents that they go dormant under the new flow.

---

## 5. Security review of the new flow

| Concern | Handling |
|---|---|
| Enumeration | Single generic failure message for not-found / email-mismatch (already in `PortalAuth.login`). |
| Email match | Case-insensitive, trimmed; both reference resolution **and** email equality required. |
| Session | `sessionStorage` (cleared on tab close), random 16-byte token, 60-min sliding expiry. |
| Cross-booking access | `getCurrentBooking()` re-verifies the row's email matches the session email on every load; mismatch ⇒ forced logout. |
| Brute force | **Not** rate-limited at the portal layer (the booking reference is the shared secret). Optional hardening (out of scope for this change): add client-side attempt throttling, or a Supabase RPC/edge function that performs the match server-side. Flagged, not implemented. |
| Admin auth | Completely separate (`js/core/auth.js`, salted hash). Untouched. |

---

## 6. Verification plan (after implementation, before any deploy)

1. `node serve.js`, open `http://localhost:5050/login.html`.
2. Valid email + valid reference → lands on `portal.html`, header shows name + reference, all tabs load.
3. Valid email + wrong reference → generic error, no redirect.
4. Wrong email + valid reference → generic error, no redirect.
5. Refresh `portal.html` after login → stays authenticated (legacy session honoured).
6. Logout → returns to `login.html`, session cleared.
7. Confirm **no** Supabase Auth email is sent (network tab: no `signInWithOtp` call).
8. Confirm `admin.html` login still works unchanged.
9. Run `npm test` (DataProvider suite) — expect `pass 20 / fail 0` (unaffected, but a regression gate).

---

## 7. Deployment

**Not part of this task.** No build, push, or deploy will be performed automatically. After your approval of the code change and successful local verification, deployment remains a separate, manual decision.

---

## 8. Approval gate

Implementation will modify **one file: `login.html`**. Confirm:
- (a) proceed with the `login.html` rewrite, and
- (b) you accept the Phase 6B trust-model consequence described in §4 (RLS policies stay but go dormant; isolation becomes app-enforced).
