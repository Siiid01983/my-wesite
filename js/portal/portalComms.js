// js/portal/portalComms.js → window.PortalComms
// Customer Communication Center — READ-ONLY view of the existing
// `communications` table (Phase 5C).
//
// SECURITY (hardened): reads NO LONGER go through the public-key rest.php SELECT.
// They go through hm-api/portal-communications.php, which verifies the session's
// (email + reference) ownership SERVER-SIDE and scopes the result to that
// customer's booking + email. The client cannot supply the scope, so there is no
// global-read surface even though the page-served API key is public.
//
// As defense-in-depth we ALSO drop any row whose customer_email does not match
// the session email. Strictly read-only; does NOT write or re-use the admin
// communication system (js/modules/communications/communications.js).

(function () {
  'use strict';

  function _norm(email) { return (email || '').toLowerCase().trim(); }

  // The server proves ownership from the session's (email + reference); read them
  // from the verified portal session rather than trusting client-passed scope.
  function _session() {
    try { return (window.PortalAuth && PortalAuth.getSession && PortalAuth.getSession()) || null; }
    catch (e) { return null; }
  }

  // Map a raw DB row to the read-only shape the portal renders.
  function _map(r) {
    return {
      id:             r.id,
      booking_id:     r.booking_id     || null,
      customer_email: r.customer_email || '',
      sender_email:   r.sender_email   || 'booking@hello-moving.com',
      subject:        r.subject        || '',
      message:        r.message        || '',
      direction:      r.direction      || 'outbound',
      created_at:     r.created_at     || null,
    };
  }

  // Fetch the communication history for the session's booking, scoped to one
  // customer — resolved and enforced SERVER-SIDE.
  //
  //   bookingIds    — retained for call-site compatibility; NO LONGER trusted for
  //                   scoping (the server derives the booking from the reference).
  //   customerEmail — fallback for the session email (also used as the email guard)
  //
  // Returns rows newest-first. Returns [] on any error or missing scope so the
  // UI degrades gracefully and never shows un-scoped data.
  async function fetchForBooking(bookingIds, customerEmail) {
    const base = String(window.API_BASE || '').replace(/\/+$/, '');
    const sess = _session();
    const email = _norm(customerEmail || (sess && sess.email));
    const ref   = String((sess && sess.ref) || '').trim();

    // Hard requirement: without a verified (email + reference) we return nothing.
    // Ownership is proven server-side — never run an un-scoped read here.
    if (!base || !email || !ref) return [];

    let out;
    try {
      const res = await fetch(
        base + '/portal-communications.php?email=' + encodeURIComponent(email) + '&reference=' + encodeURIComponent(ref),
        { headers: { 'X-API-KEY': window.API_KEY || '' }, credentials: 'include' }
      );
      out = await res.json();
    } catch (err) {
      console.error('[PortalComms] fetch failed:', err);
      return [];
    }
    if (!out || !out.ok || !out.data) {
      if (out && out.error) console.error('[PortalComms] fetch error:', (out.error && out.error.message) || out.error);
      return [];
    }

    const rows = (out.data.items || []).map(_map);

    // Defense-in-depth: drop any row whose customer_email is set but does not
    // match the authenticated customer. (Blank customer_email rows are kept —
    // already constrained by the server-side booking scope.)
    return rows.filter(r => {
      const rc = _norm(r.customer_email);
      return !email || !rc || rc === email;
    });
  }

  window.PortalComms = { fetchForBooking };
})();
