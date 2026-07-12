'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   Rebook receiver (Customer Portal V2, Step 4) — additive & non-invasive.

   On index.html, if the portal left a rebook prefill in sessionStorage
   (key `hm_rebook_prefill`), open the EXISTING BA overlay deep-linked to the
   service via the public window.openBookingApp(). The payload is consumed once.

   NO effect when there is no rebook in progress → index.html is unchanged.
   Does NOT modify the Booking Engine, create-booking.php, or the overlay; it
   only calls the overlay's public entry point.

   Limitation (documented): the live overlay exposes only openBookingApp(service),
   so ONLY the service is prefilled here. from/to/notes/inventory are carried in
   the payload but require a separate overlay prefill API (sign-off) to apply.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  var KEY = 'hm_rebook_prefill';

  function run() {
    var raw;
    try { raw = sessionStorage.getItem(KEY); } catch (e) { return; }
    if (!raw) return;                                   // no rebook → index.html unchanged
    try { sessionStorage.removeItem(KEY); } catch (e) {} // consume once

    var p; try { p = JSON.parse(raw); } catch (e) { return; }
    if (!p) return;
    if (p.ts && (Date.now() - p.ts) > 5 * 60 * 1000) return;   // stale guard (>5 min)

    // Prefer the full prefill API (Step 4.1); else fall back to service-only.
    var tries = 0;
    (function open() {
      if (window.BAOverlay && typeof window.BAOverlay.prefill === 'function') {
        try { window.BAOverlay.prefill(p); } catch (e) {}
        return;
      }
      if (typeof window.openBookingApp === 'function') {   // fallback: service only
        try { window.openBookingApp(p.service || undefined); } catch (e) {}
        return;
      }
      if (tries++ < 40) setTimeout(open, 100);             // up to ~4s
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
