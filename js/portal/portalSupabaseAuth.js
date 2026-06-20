// js/portal/portalSupabaseAuth.js → window.PortalSupabaseAuth
// Phase 6A — Customer Authentication Hardening.
//
// Wraps Supabase Auth (Magic Link / passwordless email OTP) for the customer
// portal. This is the SECURE replacement for the previous "booking lookup +
// typed email + sessionStorage token" model: the customer now proves ownership
// of their email by clicking a one-time link Supabase mails them, and Supabase
// issues a real, signed, auto-refreshing JWT session.
//
// Trust model:
//   • Authentication — Supabase verifies the customer controls the email inbox
//     (Magic Link). The authenticated email is cryptographically trustworthy.
//   • Authorization  — handled in PortalAuth: a customer may only reach a portal
//     for a booking whose customer_email equals their authenticated email.
//
// This module touches ONLY Supabase Auth. It does not read or write any
// business table, and reuses the shared window.SupabaseClient unmodified
// (supabase-js v2 defaults already give persistSession + autoRefreshToken +
// detectSessionInUrl, which is exactly what Magic Link needs).

(function () {
  'use strict';

  // Admin allowlist — emails permitted to log in with the email alone (no
  // booking reference). MUST mirror ADMIN_EMAILS in
  // supabase/functions/portal-auth/index.ts. The server is authoritative; this
  // client copy only relaxes the reference requirement in the UI. Lowercase.
  var ADMIN_EMAILS = ['admin@hello-moving.com'];
  function isAdminEmail(email) {
    return ADMIN_EMAILS.indexOf(String(email || '').trim().toLowerCase()) !== -1;
  }

  // Where Supabase should send the customer back to after they click the link.
  // Must be added to the project's Auth → URL Configuration allow-list.
  function _redirectTo() {
    return location.origin + location.pathname.replace(/[^/]*$/, '') + 'portal.html';
  }

  function _sb() { return window.SupabaseClient || null; }

  // True when a Supabase client with an auth surface is available.
  function isConfigured() {
    const sb = _sb();
    return !!(sb && sb.auth && typeof sb.auth.signInWithOtp === 'function');
  }

  // True when the current URL carries an auth callback (magic-link landing).
  // Implicit flow returns tokens in the hash; PKCE returns ?code=…; errors come
  // back as ?error=… / #error=… . Used to decide whether to wait for the client
  // to finish consuming the redirect before declaring "no session".
  function hasRedirectParams() {
    const h = location.hash || '';
    const q = location.search || '';
    return h.indexOf('access_token=') !== -1 ||
           h.indexOf('error=') !== -1 ||
           /[?&]code=/.test(q) ||
           /[?&]error=/.test(q);
  }

  // Strip the auth callback artefacts from the address bar once consumed so a
  // refresh or shared URL never re-triggers token handling. Removes the hash
  // (implicit-flow tokens) and the known PKCE/error query params.
  function cleanUrl() {
    try {
      if (!hasRedirectParams()) return;
      const url = new URL(location.href);
      ['code', 'state', 'error', 'error_code', 'error_description'].forEach(function (k) {
        url.searchParams.delete(k);
      });
      const qs = url.searchParams.toString();
      history.replaceState({}, document.title, url.pathname + (qs ? '?' + qs : ''));
    } catch (_) {}
  }

  // Send a Magic Link to the given email. Returns { ok } or { ok:false, error }.
  // shouldCreateUser stays at its default (true): anyone can authenticate, but
  // PortalAuth still gates the portal on the email matching a real booking, so
  // authentication alone grants no access to data.
  async function sendMagicLink(email) {
    const sb = _sb();
    email = (email || '').trim().toLowerCase();
    if (!sb || !sb.auth) return { ok: false, error: 'unavailable' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'bad-email' };
    try {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: _redirectTo() },
      });
      if (error) {
        console.warn('[PortalSupabaseAuth] signInWithOtp:', error.message);
        return { ok: false, error: error.message };
      }
      return { ok: true };
    } catch (err) {
      console.error('[PortalSupabaseAuth] sendMagicLink threw:', err);
      return { ok: false, error: (err && err.message) || 'send-failed' };
    }
  }

  // Authenticate with Email + Confirmation Number (booking reference) and END UP
  // WITH A REAL SUPABASE SESSION — so Phase 6B RLS (auth.email()) stays enforced.
  // No email is sent: the `portal-auth` Edge Function validates the pair against
  // bookings (service_role), mints a session, and returns its tokens, which we
  // install via setSession(). Returns { ok } or { ok:false, error }.
  async function loginWithReference(email, ref) {
    const sb = _sb();
    email = (email || '').trim().toLowerCase();
    ref   = (ref || '').trim();
    if (!sb || !sb.auth) return { ok: false, error: 'unavailable' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'bad-email' };
    // Admins authenticate with the email alone; everyone else needs a reference.
    if (!ref && !isAdminEmail(email)) return { ok: false, error: 'bad-ref' };

    const base    = String(window.SUPABASE_URL || '').replace(/\/+$/, '');
    const anonKey = window.SUPABASE_ANON_KEY || '';
    if (!base || !anonKey) return { ok: false, error: 'unavailable' };

    let body = null;
    try {
      const res = await fetch(base + '/functions/v1/portal-auth', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        anonKey,
          'Authorization': 'Bearer ' + anonKey,
        },
        body: JSON.stringify({ email, reference: ref }),
      });
      body = await res.json().catch(function () { return null; });
      if (!res.ok || !body || !body.ok) {
        return { ok: false, error: (body && body.error) || 'invalid-credentials', status: res.status };
      }
    } catch (err) {
      console.error('[PortalSupabaseAuth] loginWithReference threw:', err);
      return { ok: false, error: (err && err.message) || 'network' };
    }

    if (!body.access_token || !body.refresh_token) return { ok: false, error: 'no-session' };
    try {
      const { error } = await sb.auth.setSession({
        access_token:  body.access_token,
        refresh_token: body.refresh_token,
      });
      if (error) {
        console.error('[PortalSupabaseAuth] setSession failed:', error.message);
        return { ok: false, error: error.message };
      }
    } catch (err) {
      console.error('[PortalSupabaseAuth] setSession threw:', err);
      return { ok: false, error: (err && err.message) || 'set-session-failed' };
    }
    return { ok: true };
  }

  // Resolve the active Supabase Auth session, accounting for a magic-link landing
  // whose token the client is still consuming asynchronously. Resolution rules:
  //   • a session already exists                → return it immediately
  //   • no session AND no callback in the URL   → return null fast (unauthenticated)
  //   • a callback is present                   → wait for SIGNED_IN (up to timeout)
  // Returns the Supabase session object, or null.
  function waitForSession(timeoutMs) {
    timeoutMs = timeoutMs || 5000;
    return new Promise(function (resolve) {
      const sb = _sb();
      if (!sb || !sb.auth) return resolve(null);

      let settled = false;
      let sub = null;
      function finish(session) {
        if (settled) return;
        settled = true;
        try { if (sub && sub.subscription) sub.subscription.unsubscribe(); } catch (_) {}
        resolve(session || null);
      }

      // Event-driven capture — fires when the URL token finishes exchanging.
      try {
        sub = sb.auth.onAuthStateChange(function (_evt, session) {
          if (session) finish(session);
        });
      } catch (_) {}

      // Immediate check for an already-persisted session.
      sb.auth.getSession().then(function (res) {
        const s = res && res.data && res.data.session;
        if (s) return finish(s);
        // No session and nothing inbound to wait for → don't stall the page.
        if (!hasRedirectParams()) return finish(null);
        // Otherwise let onAuthStateChange settle, bounded by the timeout.
        setTimeout(function () { finish(null); }, timeoutMs);
      }).catch(function () { finish(null); });
    });
  }

  // The verified email of the current session, or '' if unauthenticated.
  async function getAuthedEmail() {
    const session = await waitForSession(0).catch(function () { return null; });
    const email = session && session.user && session.user.email;
    return email ? String(email).toLowerCase().trim() : '';
  }

  // End the Supabase session (secure logout). Resolves once cleared.
  async function signOut() {
    const sb = _sb();
    if (!sb || !sb.auth) return;
    try { await sb.auth.signOut(); } catch (err) {
      console.warn('[PortalSupabaseAuth] signOut:', err && err.message);
    }
  }

  window.PortalSupabaseAuth = {
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
