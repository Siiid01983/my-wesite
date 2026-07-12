'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   BA Overlay Prefill API (Customer Portal V2, Step 4.1) — additive, UI-only.

   window.BAOverlay.prefill(payload) opens the EXISTING booking overlay to the
   service and injects From/To/Notes/Inventory using ONLY the overlay's PUBLIC
   surface (window.openBookingApp, window.baConfirmAddr) plus its form inputs
   (#ba-input-from/to, #ba-floor-from/to, #ba-notes, #ba-disposal).

   It does NOT modify the Booking Engine, create-booking.php, pricing, slot-lock,
   validation, or the overlay's internal code. No booking is created, no booking
   state machine runs — prefill only. Submit-time validation runs unchanged
   against the injected values.

   payload: { service, fromAddress|fromAddr, toAddress|toAddr, fromFloor,
              toFloor, notes, inventory|items }
   Excluded by design: reference, status, created date, internal ids.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  function el(id) { return document.getElementById(id); }

  // Fill one address via the overlay's PUBLIC save function (sets baState + row).
  function setAddr(dir, addr, floor) {
    var inp = el('ba-input-' + dir);
    if (!inp || !addr) return;
    inp.value = addr;
    var f = el('ba-floor-' + dir); if (f && floor) f.value = floor;
    if (typeof window.baConfirmAddr === 'function') { try { window.baConfirmAddr(dir); } catch (e) {} }
  }

  function inject(p) {
    setAddr('from', p.fromAddress || p.fromAddr || '', p.fromFloor || '');
    setAddr('to',   p.toAddress   || p.toAddr   || '', p.toFloor   || '');
    var notes = el('ba-notes'); if (notes && p.notes) notes.value = p.notes;
    var inv = (p.inventory != null) ? p.inventory : p.items;
    if (inv) {
      // Inventory is injected as text into the disposal free-text field (#ba-disposal)
      // — the reliable, visible inventory field.
      // TODO(inventory): also pre-check the structured furniture drawer (baCounts /
      // config-keyed items) once a stable item-ID mapping exists between stored
      // bookings and hm_booking_config. Skipped today because a past booking's items
      // do not map 1:1 to the overlay's furniture option keys (would need an overlay
      // API + a canonical item taxonomy). Additive follow-up; no booking-engine change.
      var d = el('ba-disposal');
      if (d) d.value = Array.isArray(inv) ? inv.filter(Boolean).join('、') : String(inv);
    }
  }

  window.BAOverlay = window.BAOverlay || {};
  window.BAOverlay.prefill = function (payload) {
    payload = payload || {};
    var tries = 0;
    (function go() {
      if (typeof window.openBookingApp === 'function') {
        try { window.openBookingApp(payload.service || undefined); } catch (e) {}
        // Inject after the overlay has rendered its booking screen + drawers.
        setTimeout(function () { try { inject(payload); } catch (e) {} }, 140);
        return;
      }
      if (tries++ < 40) setTimeout(go, 100);   // wait up to ~4s for the overlay
    })();
  };
})();
