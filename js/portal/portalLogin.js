// js/portal/portalLogin.js → window.PortalLogin
//
// SELF-HOSTED build — the customer portal authenticates with
//   Email + Booking Reference  (verified against the bookings table via the
//   PHP API), NOT a API Auth Magic Link.
//
// This file keeps the SAME public interface that login.html and portal.html
// already call, but every method now delegates to the legacy reference-based
// flow in PortalAuth (sessionStorage token). No email is sent; no JWT involved.

(function () {
  'use strict';

  // Admins should use admin.html. Kept only so login.html's UI helper resolves.
  var ADMIN_EMAILS = ['admin@hello-moving.com'];
  function isAdminEmail(email) {
    return ADMIN_EMAILS.indexOf(String(email || '').trim().toLowerCase()) !== -1;
  }

  // Always "configured" so login.html proceeds to loginWithReference().
  function isConfigured() { return true; }

  // No magic-link redirect artefacts in this model.
  function hasRedirectParams() { return false; }
  function cleanUrl() {}

  // Verify Email + Reference against a real booking and open a portal session.
  // Returns { ok:true } or { ok:false, error:'invalid-credentials' | ... }.
  async function loginWithReference(email, ref) {
    if (!window.PortalAuth || typeof PortalAuth.login !== 'function') {
      return { ok: false, error: 'unavailable' };
    }
    try {
      var res = await PortalAuth.login(email, ref);
      if (res && res.ok) return { ok: true };
      return { ok: false, error: 'invalid-credentials' };
    } catch (err) {
      console.error('[PortalAuth] loginWithReference failed:', err);
      return { ok: false, error: 'network' };
    }
  }

  // Magic Link is disabled in the self-hosted build.
  async function sendMagicLink() { return { ok: false, error: 'disabled' }; }

  // There is no auto-refreshing JWT session — the legacy sessionStorage token
  // (managed by PortalAuth) is the source of truth, so resolve null here.
  function waitForSession() { return Promise.resolve(null); }

  async function getAuthedEmail() {
    var s = (window.PortalAuth && PortalAuth.getSession && PortalAuth.getSession()) || null;
    return s && s.email ? String(s.email).toLowerCase().trim() : '';
  }

  async function signOut() {
    if (window.PortalAuth && typeof PortalAuth.logout === 'function') {
      try { await PortalAuth.logout(); } catch (_) {}
    }
  }

  window.PortalLogin = {
    isConfigured,
    isAdminEmail,
    sendMagicLink,
    loginWithReference,
    waitForSession,
    getAuthedEmail,
    signOut,
    hasRedirectParams,
    cleanUrl,
  };
})();
