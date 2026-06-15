// js/portal/portalAuth.js → window.PortalAuth
// Customer Portal authentication & session management (Phase 5A).
//
// Identity model: a customer proves ownership of a booking by supplying the
// email address on record PLUS the booking reference (HM-xxx). Both must match
// the same booking row — neither alone grants access.
//
// Session is held in sessionStorage so it survives page refresh within the tab
// but is cleared when the browser tab closes. A short idle TTL is also enforced.
//
// Reuses the existing infrastructure only (BookingService / SupabaseClient).
// Does NOT touch admin, CRM, WMC, or the database schema.

(function () {
  'use strict';

  const SESSION_KEY = 'hm_portal_sess';
  const TTL_MS      = 60 * 60 * 1000; // 60-minute idle window

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

  // Returns the live session object, or null if absent/expired.
  // Sliding expiry: each valid access pushes the expiry forward.
  function getSession() {
    const s = _read();
    if (!s || !s.token || !s.ref) return null;
    if (!s.exp || s.exp < _now()) { logout(); return null; }
    s.exp = _now() + TTL_MS;
    _write(s);
    return s;
  }

  // Verify email + reference against a real booking. Resolves the booking row
  // through the existing BookingService (which looks the reference up in the
  // bookings table). Only an exact, case-insensitive email match is accepted.
  async function login(email, ref) {
    email = (email || '').trim().toLowerCase();
    ref   = (ref   || '').trim();

    if (!email || !ref) {
      return { ok: false, message: 'メールアドレスと予約番号を入力してください。' };
    }
    if (typeof BookingService === 'undefined' || !window.SupabaseClient) {
      return { ok: false, message: '現在ログインできません。しばらくしてから再度お試しください。' };
    }

    let booking = null;
    try {
      booking = await BookingService.getBookingById(ref);
    } catch (err) {
      console.error('[PortalAuth] lookup failed:', err);
      return { ok: false, message: '接続エラーが発生しました。' };
    }

    // Generic message for both "not found" and "email mismatch" so we never
    // disclose whether a given reference exists.
    if (!booking) {
      return { ok: false, message: '予約が見つかりませんでした。入力内容をご確認ください。' };
    }
    const onFile = (booking.email || '').trim().toLowerCase();
    if (!onFile || onFile !== email) {
      return { ok: false, message: '予約が見つかりませんでした。入力内容をご確認ください。' };
    }

    // Prefer the human-facing HM-reference. When the resolved booking id is a
    // bare numeric DB id, keep the reference the customer actually typed so the
    // portal shows a number they recognise (and getBookingById can still resolve
    // either form on re-fetch).
    const displayRef = (booking.id && !/^\d+$/.test(String(booking.id))) ? booking.id : ref;

    const session = {
      token: _randToken(),
      ref:   displayRef,
      email: onFile,
      name:  booking.name || '',
      iat:   _now(),
      exp:   _now() + TTL_MS,
    };
    _write(session);
    return { ok: true, session: session, booking: booking };
  }

  function logout() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
  }

  // Re-fetch the booking that the current session is authorised for.
  // Re-verifies the email match on every fetch so a tampered session can't
  // read another customer's booking.
  async function getCurrentBooking() {
    const s = getSession();
    if (!s) return null;
    if (typeof BookingService === 'undefined' || !window.SupabaseClient) return null;

    let booking = null;
    try {
      booking = await BookingService.getBookingById(s.ref);
    } catch (err) {
      console.error('[PortalAuth] getCurrentBooking failed:', err);
      return null;
    }
    if (!booking) return null;
    if ((booking.email || '').trim().toLowerCase() !== s.email) {
      // Session no longer matches the record — revoke it.
      logout();
      return null;
    }
    return booking;
  }

  // Guard for protected pages. Redirects to login.html when no valid session.
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
    getCurrentBooking,
    requireSession,
    SESSION_KEY,
    TTL_MS,
  };
})();
