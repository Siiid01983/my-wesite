// js/portal/portalComms.js → window.PortalComms
// Customer Communication Center — READ-ONLY view of the existing
// `communications` table (Phase 5C).
//
// Security model: a customer may only ever see rows whose booking_id equals the
// booking their session is bound to. As defense-in-depth we ALSO drop any row
// whose customer_email does not match the session email, so even a booking_id
// collision could never leak another customer's correspondence.
//
// This module is strictly read-only (SELECT only). It does NOT write, modify, or
// re-use the admin communication system (js/modules/communications/communications.js).

(function () {
  'use strict';

  // Normalise booking id(s) the way the writer (_safeBookingId) does: booking_id
  // is a text column, so compare as strings. Accepts a single id or an array —
  // a booking has two equivalent identifiers (its HM-reference and its numeric
  // DB id) and the existing system has filed messages under either one. Both
  // identify the SAME booking, so querying for either stays single-booking scoped.
  function _safeIds(ids) {
    const arr = Array.isArray(ids) ? ids : [ids];
    return [...new Set(arr.filter(v => v != null && v !== '').map(String))];
  }

  function _norm(email) { return (email || '').toLowerCase().trim(); }

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

  // Fetch the communication history for one booking, scoped to one customer.
  //
  //   bookingIds    — the booking's identifier(s) the session is bound to. May be
  //                   a single id or [hmReference, numericDbId] — both name the
  //                   same booking (required; empty → returns nothing).
  //   customerEmail — the session email, used for the secondary email guard
  //
  // Returns rows newest-first. Returns [] on any error or missing scope so the
  // UI degrades gracefully and never shows un-scoped data.
  async function fetchForBooking(bookingIds, customerEmail) {
    const sb    = window.SupabaseClient;
    const ids   = _safeIds(bookingIds);
    const email = _norm(customerEmail);

    // Hard requirement: without a booking scope we return nothing. Never run an
    // unfiltered SELECT from the customer surface.
    if (!sb || !ids.length) return [];

    let data, error;
    try {
      ({ data, error } = await sb
        .from('communications')
        .select('id, booking_id, customer_email, sender_email, subject, message, direction, created_at')
        .in('booking_id', ids)
        .order('created_at', { ascending: false }));
    } catch (err) {
      console.error('[PortalComms] fetch failed:', err);
      return [];
    }
    if (error) {
      console.error('[PortalComms] fetch error:', error.message);
      return [];
    }

    const rows = (data || []).map(_map);

    // Defense-in-depth: drop any row whose customer_email is set but does not
    // match the authenticated customer. (Rows with a blank customer_email are
    // kept because they are already constrained by the unique booking_id.)
    return rows.filter(r => {
      const rc = _norm(r.customer_email);
      return !email || !rc || rc === email;
    });
  }

  window.PortalComms = { fetchForBooking };
})();
