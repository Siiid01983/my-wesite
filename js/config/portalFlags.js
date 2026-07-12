'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   Customer Portal feature flags — committed, versioned, DEFAULT-SAFE.

   CUSTOMER_PORTAL_V2_ENABLED gates the additive Phase-2 portal (portalV2.js).

   ── ALLOWLIST ROLLOUT (internal testing only) ───────────────────────────────
   V2 is NOT public. It activates ONLY for a logged-in portal session whose
   identity is on the allowlist below (matched by email OR booking reference).
   Every other visitor — and anyone not logged in — stays on Portal V1, exactly
   as before. Because the gate keys off a server-verified email+reference login
   (hm-api/auth.php), there is no URL/localStorage toggle that could expose V2
   to the public.

   Match → flag = true; no match / no session → flag = false (V1).

   Override precedence: if something set the flag BEFORE this file loads (e.g. a
   deploy-injected env.js), that explicit value is respected and the allowlist is
   skipped; otherwise the allowlist decides.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  // Internal-testing allowlist. Keep tight. Emails are lower-cased for compare;
  // references are upper-cased + trimmed for compare.
  var ALLOW_EMAILS = ['s.amrane1983@gmail.com'];   // ← admin / internal account
  var ALLOW_REFS   = ['HM-12345'];                 // ← test booking reference

  var EMAILS = ALLOW_EMAILS.map(function (e) { return String(e).trim().toLowerCase(); });
  var REFS   = ALLOW_REFS.map(function (r) { return String(r).trim().toUpperCase(); });

  function sessionAllowed() {
    var s = null;
    try { s = (window.PortalAuth && PortalAuth.getSession && PortalAuth.getSession()) || null; }
    catch (e) { s = null; }
    if (!s) return false;
    var email = String(s.email || '').trim().toLowerCase();
    var ref   = String(s.ref   || '').trim().toUpperCase();
    if (email && EMAILS.indexOf(email) !== -1) return true;
    if (ref   && REFS.indexOf(ref)     !== -1) return true;
    return false;
  }

  // Respect an explicit pre-set value (deploy-injected); else apply the allowlist.
  if (typeof window.CUSTOMER_PORTAL_V2_ENABLED === 'undefined') {
    var allowed = sessionAllowed();
    window.CUSTOMER_PORTAL_V2_ENABLED = allowed;   // default: OFF unless allowlisted
    try {
      console.info('[PortalFlags] CUSTOMER_PORTAL_V2_ENABLED=' + allowed +
        ' (allowlist gate; ' + (allowed ? 'session on allowlist — V2 active' : 'not allowlisted — Portal V1') + ').');
    } catch (e) {}
  }
})();
