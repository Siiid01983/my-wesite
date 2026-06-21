'use strict';
/**
 * RUNTIME PROTECTION LAYER — Booking architecture guard (public site only).
 *
 * Enforces at runtime that the BA OVERLAY is the only valid booking execution
 * path:  user action → openBookingApp() → BA overlay → BookingService.createBooking().
 *
 * DESIGN PRINCIPLES (read before editing):
 *  - FAIL-OPEN for the real flow. This wraps the single revenue-critical path
 *    (createBooking). A bug here must NEVER block a legitimate booking, so the
 *    guard ALLOWS whenever the BA overlay is actually open (DOM truth), or
 *    BA_ACTIVE is set, or an explicit ctx.source==='ba-overlay' is passed.
 *    It only BLOCKS calls made while the overlay is closed AND no BA context —
 *    i.e. genuinely out-of-band attempts (reintroduced legacy code, console
 *    pokes, injected scripts).
 *  - LAZY. BookingService is a lexical const loaded async by bootstrap.js, so we
 *    retry until it exists, then wrap its createBooking property.
 *  - SELF-HEALING. If the wrapper is ever replaced (late load / tamper), it is
 *    re-installed on an interval.
 *
 * Companion BUILD-TIME guard: tests/architecture-lock.test.js (primary defense).
 * This runtime layer is defense-in-depth.
 *
 * Deliberately NOT done (would harm production — see PR discussion):
 *  - Global window.fetch / XMLHttpRequest override: the whole app's data layer
 *    runs on fetch; intercepting it risks breaking admin/portal/API/health. The
 *    single booking write is already gated below, so this adds risk, not safety.
 *  - Health check that flags #quoteForm: #quoteForm is the INTENTIONAL UI entry
 *    gate (it creates no bookings — it fills BA_PREFILL and opens the overlay),
 *    so flagging it would be a false positive on every tick.
 */
(function () {
  if (window.__BOOKING_GUARD_INSTALLED__) return;
  window.__BOOKING_GUARD_INSTALLED__ = true;

  // ── 6. Hard-rule enforcement flags ──────────────────────────────────────────
  window.BOOKING_SYSTEM_MODE   = 'BA_OVERLAY_ONLY';
  window.LEGACY_BOOKING_DISABLED = true;
  window.BA_ACTIVE = window.BA_ACTIVE === true;

  // ── 1. Global runtime guard object ──────────────────────────────────────────
  window.__BOOKING_GUARD__ = {
    allowCreate: false,
    source: 'BA_OVERLAY_ONLY',
    validateContext: function (ctx) { return !!(ctx && ctx.source === 'ba-overlay'); },
  };

  // ── 3. Enforce BA-overlay context by wrapping the overlay's open/close ───────
  // (window.openBookingApp / closeBookingApp are defined by the inline overlay
  //  script, which runs before this file.)
  function wrapOverlayLifecycle() {
    var _open = window.openBookingApp;
    if (typeof _open === 'function' && !_open.__guarded__) {
      var openWrapped = function () {
        window.BA_ACTIVE = true;
        window.__BOOKING_GUARD__.allowCreate = true;
        return _open.apply(this, arguments);
      };
      openWrapped.__guarded__ = true;
      window.openBookingApp = openWrapped;
    }
    var _close = window.closeBookingApp;
    if (typeof _close === 'function' && !_close.__guarded__) {
      var closeWrapped = function () {
        window.BA_ACTIVE = false;
        window.__BOOKING_GUARD__.allowCreate = false;
        return _close.apply(this, arguments);
      };
      closeWrapped.__guarded__ = true;
      window.closeBookingApp = closeWrapped;
    }
  }

  function overlayIsOpen() {
    var el = document.getElementById('booking-app');
    return !!(el && el.classList.contains('open'));
  }

  // ── 2. Block unauthorized createBooking calls (fail-open for the real flow) ──
  function wrapCreateBooking() {
    // BookingService is a lexical global; typeof is safe before it loads.
    if (typeof BookingService === 'undefined' || !BookingService ||
        typeof BookingService.createBooking !== 'function') return false;
    if (BookingService.createBooking.__guarded__) return true;

    var _orig = BookingService.createBooking;
    var guarded = function (payload, ctx) {
      var allowed =
        (ctx && ctx.source === 'ba-overlay') ||  // explicit BA context
        window.BA_ACTIVE === true ||             // overlay lifecycle flag
        overlayIsOpen();                          // DOM truth (authoritative)

      if (!allowed) {
        console.error('[SECURITY BLOCK] Unauthorized booking attempt blocked ' +
          '(non-BA context). Route via openBookingApp().', payload);
        return Promise.reject(new Error('BOOKING_BLOCKED_NON_BA_SOURCE'));
      }
      return _orig.apply(this, arguments);
    };
    guarded.__guarded__ = true;
    guarded.__original__ = _orig;
    try { BookingService.createBooking = guarded; } catch (_) { return false; }
    return true;
  }

  // ── 4. Fail-safe for legacy/hero form submits ───────────────────────────────
  // Bubble phase, only acts if nothing already handled it. #quoteForm's own
  // handler (script.js) preventDefaults + validates + opens the overlay, so this
  // is a no-op in the normal flow — it only catches a raw submit if that handler
  // is ever removed, guaranteeing no booking is sent outside the overlay.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.tagName) return;
    var isHeroForm = form.id === 'quoteForm' ||
      (typeof form.closest === 'function' && form.closest('#home-hero'));
    if (!isHeroForm || e.defaultPrevented) return;
    e.preventDefault();
    console.warn('[RUNTIME GUARD] Unhandled hero form submit intercepted → routing to BA overlay');
    if (typeof window.openBookingApp === 'function') window.openBookingApp();
  }, false);

  // ── 7. Self-health check (auto diagnostics + self-heal), corrected ──────────
  // Re-installs the createBooking guard if it was replaced, and flags genuinely
  // forbidden artifacts. Does NOT flag #quoteForm (the intentional entry gate).
  function selfCheck() {
    wrapOverlayLifecycle();
    wrapCreateBooking();
    var violations = [];
    // A wired legacy bk* submit control would indicate the dead form was revived.
    if (document.getElementById('bkSubmitBtn')) violations.push('LEGACY_BK_SUBMIT_REVIVED');
    if (violations.length) console.error('[SYSTEM VIOLATION]', violations);
  }

  // ── Install: now, with quick retries for the async BookingService load ──────
  function install() {
    wrapOverlayLifecycle();
    if (!wrapCreateBooking()) {
      var tries = 0;
      var t = setInterval(function () {
        if (wrapCreateBooking() || ++tries > 100) clearInterval(t); // up to ~10s
      }, 100);
    }
    setInterval(selfCheck, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }

  console.info('RUNTIME PROTECTION ACTIVE: BA OVERLAY IS THE ONLY VALID EXECUTION CONTEXT');
})();
