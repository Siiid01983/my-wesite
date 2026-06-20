// js/portal/portalAuth.js → window.PortalAuth
// Customer Portal authentication & session management.
//
// Phase 6A (Authentication Hardening) reworks this module around API Auth
// (Magic Link) while preserving the original Phase 5A logic for safe migration:
//
//   PRIMARY  (hardened) — the session comes from a real API Auth JWT. The
//     customer proved ownership of their email via a one-time link. Authorization
//     resolves the booking(s) whose customer_email equals that verified email.
//
//   LEGACY   (fallback) — the original "email + booking reference → sessionStorage
//     token" path. KEPT, unmodified in behaviour, so any session opened before
//     the cut-over keeps working and the lookup logic is retained until the new
//     flow is verified in production. New logins no longer use it (login.html now
//     sends a Magic Link), but PortalAuth.login() remains callable.
//
// Reuses existing infrastructure only (PortalLogin / BookingService /
// ApiClient). Does NOT touch admin, CRM, WMC, or the database schema.

(function () {
  'use strict';

  const SESSION_KEY = 'hm_portal_sess';
  const TTL_MS      = 60 * 60 * 1000; // 60-minute idle window (legacy path)

  // The resolved session for this page load. Set by resolveSession(). For an
  // authenticated (API) session there is no sessionStorage token — the JWT
  // lives in the API client — so we cache the derived shape here so the
  // sync getSession() callers (e.g. audit actor labelling) keep working.
  let _active = null;

  function _now() { return Date.now(); }

  function _randToken() {
    try {
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return String(_now()) + Math.random().toString(36).slice(2);
    }
  }

  function _read() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function _write(sess) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(sess)); } catch (_) {}
  }

  // ── Legacy sessionStorage session (Phase 5A) ────────────────────────────────
  // Returns the live legacy session object, or null if absent/expired.
  // Sliding expiry: each valid access pushes the expiry forward.
  function _legacyGetSession() {
    const s = _read();
    if (!s || !s.token || !s.ref) return null;
    if (!s.exp || s.exp < _now()) { _clearLegacy(); return null; }
    s.exp = _now() + TTL_MS;
    _write(s);
    return s;
  }

  function _clearLegacy() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
  }

  // Synchronous accessor used across the portal (header render, audit actor, …).
  // Prefers the resolved (possibly authenticated) session, then the legacy one.
  function getSession() {
    if (_active) return _active;
    return _legacyGetSession();
  }

  // ── Hardened resolution (Phase 6A) ──────────────────────────────────────────
  // Resolve the active session for a protected page. Order:
  //   1. API Auth session (verified email)        → authenticated
  //   2. Legacy sessionStorage session                 → migration fallback
  //   3. neither                                        → redirect to login
  // Returns the session object (and caches it in _active), or null after redirect.
  async function resolveSession(redirect) {
    // 1. API Auth (primary)
    if (window.PortalLogin && PortalLogin.isConfigured()) {
      let authSession = null;
      try { authSession = await PortalLogin.waitForSession(); } catch (_) {}
      // Consume + tidy the magic-link callback artefacts from the URL.
      try { PortalLogin.cleanUrl(); } catch (_) {}
      if (authSession && authSession.user && authSession.user.email) {
        const email = String(authSession.user.email).toLowerCase().trim();
        const meta  = authSession.user.user_metadata || {};
        _active = {
          authed: true,
          token:  authSession.access_token || _randToken(),
          email:  email,
          name:   meta.name || meta.full_name || '',
          ref:    '',                         // filled once the booking resolves
          iat:    _now(),
          exp:    authSession.expires_at ? authSession.expires_at * 1000 : 0,
        };
        return _active;
      }
    }

    // 2. Legacy fallback (pre-migration sessions keep working)
    const legacy = _legacyGetSession();
    if (legacy) { _active = legacy; return _active; }

    // 3. No session
    if (redirect) location.replace(redirect);
    return null;
  }

  // ── Legacy login (retained until migration verified — NOT used by login.html
  //    anymore, which now sends a Magic Link). Verifies email + reference against
  //    a real booking and mints a legacy sessionStorage token. ───────────────────
  async function login(email, ref) {
    email = (email || '').trim().toLowerCase();
    ref   = (ref   || '').trim();

    if (!email || !ref) {
      return { ok: false, message: 'メールアドレスと予約番号を入力してください。' };
    }
    const base = (window.API_BASE || '').replace(/\/+$/, '');
    if (!base) {
      return { ok: false, message: '現在ログインできません。しばらくしてから再度お試しください。' };
    }

    // Server-side verification (hm-api/auth.php): email + reference are checked
    // against the bookings table. A generic failure is returned for both
    // "not found" and "email mismatch" (anti-enumeration).
    let out = null;
    try {
      const res = await fetch(base + '/auth.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': window.API_KEY || '' },
        body: JSON.stringify({ email, reference: ref }),
      });
      out = await res.json().catch(() => null);
    } catch (err) {
      console.error('[PortalAuth] auth.php failed:', err);
      return { ok: false, message: '接続エラーが発生しました。' };
    }

    if (!out || !out.ok || !out.booking) {
      return { ok: false, message: '予約が見つかりませんでした。入力内容をご確認ください。' };
    }

    const booking = (typeof _rowToBooking === 'function')
      ? _rowToBooking(out.booking) : out.booking;

    const session = {
      authed: false,
      token: _randToken(),
      ref:   ref,
      email: email,
      name:  (out.booking.customer_name || (booking && booking.name) || ''),
      iat:   _now(),
      exp:   _now() + TTL_MS,
    };
    _write(session);
    _active = session;
    return { ok: true, session: session, booking: booking };
  }

  // Secure logout — ends both the API Auth session and any legacy token.
  async function logout() {
    _active = null;
    _clearLegacy();
    if (window.PortalLogin && PortalLogin.isConfigured()) {
      try { await PortalLogin.signOut(); } catch (_) {}
    }
  }

  // Re-fetch the booking the current session is authorised for.
  //   • Authenticated session — resolves bookings by the VERIFIED email and
  //     returns the most recent. (Multi-booking selection is future work.)
  //   • Legacy session        — re-fetches by reference, re-verifying the email
  //     match so a tampered token can't read another customer's booking.
  async function getCurrentBooking() {
    const s = getSession();
    if (!s) return null;
    if (typeof BookingService === 'undefined' || !window.api) return null;

    // Authenticated path: email is cryptographically trustworthy.
    if (s.authed) {
      let list = [];
      try {
        list = await BookingService.getBookingsByEmail(s.email);
      } catch (err) {
        console.error('[PortalAuth] getBookingsByEmail failed:', err);
        return null;
      }
      if (!list || !list.length) return null;
      const booking = list[0]; // newest
      // Defence-in-depth: the row's email must equal the authenticated email.
      if ((booking.email || '').trim().toLowerCase() !== s.email) return null;
      // Bind the session to the resolved booking reference.
      if (_active) _active.ref = booking.id || _active.ref;
      return booking;
    }

    // Legacy path: reference lookup + email re-verification.
    let booking = null;
    try {
      booking = await BookingService.getBookingById(s.ref);
    } catch (err) {
      console.error('[PortalAuth] getCurrentBooking failed:', err);
      return null;
    }
    if (!booking) return null;
    if ((booking.email || '').trim().toLowerCase() !== s.email) {
      logout();
      return null;
    }
    return booking;
  }

  // Synchronous guard (legacy callers). Prefer the async resolveSession() on
  // protected pages so the API Auth session is honoured.
  function requireSession(redirect) {
    const s = getSession();
    if (!s) {
      location.replace(redirect || 'login.html');
      return null;
    }
    return s;
  }

  window.PortalAuth = {
    login,
    logout,
    getSession,
    resolveSession,
    getCurrentBooking,
    requireSession,
    SESSION_KEY,
    TTL_MS,
  };
})();
