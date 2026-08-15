'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   Service Image Lightbox — js/service-lightbox.js   (additive, standalone)

   Opens a full-screen modal showing a service card's ORIGINAL image (the exact
   same URL the card renders — the DB image_path from hm-api/service-images.php,
   or the built-in fallback — NEVER a thumbnail/variant). Delegated: any element
   carrying `data-lightbox-src` (and optional `data-lightbox-title`) triggers it,
   so it keeps working across the async CMS re-renders of #serviceCardsGrid.

   Close: × button, backdrop click, or Escape. Tap the image to toggle a 2×
   zoom (pan by scrolling). Booking is untouched — the card BODY still routes to
   openBookingApp(); only the PHOTO opens this viewer.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  var overlay, imgEl, capEl, lastFocus;

  function build() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'hm-lbx';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'サービス画像');
    overlay.innerHTML =
      '<div class="hm-lbx__dialog">' +
        '<button type="button" class="hm-lbx__close" aria-label="閉じる">×</button>' +
        '<div class="hm-lbx__imgwrap"><img class="hm-lbx__img" alt=""></div>' +
        '<div class="hm-lbx__caption"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    imgEl = overlay.querySelector('.hm-lbx__img');
    capEl = overlay.querySelector('.hm-lbx__caption');

    overlay.addEventListener('click', function (e) {
      // backdrop OR anything that is not the image/caption closes; × closes.
      if (e.target === overlay || e.target.classList.contains('hm-lbx__close') ||
          e.target.classList.contains('hm-lbx__dialog') || e.target.classList.contains('hm-lbx__imgwrap')) {
        close();
      }
    });
    imgEl.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleZoom();
    });
    return overlay;
  }

  function toggleZoom() {
    var z = imgEl.classList.toggle('is-zoomed');
    imgEl.style.transform = z ? 'scale(2)' : '';
  }

  function open(src, title) {
    if (!src) return;
    build();
    imgEl.classList.remove('is-zoomed');
    imgEl.style.transform = '';
    imgEl.src = src;                       // ORIGINAL image (same URL as the card)
    imgEl.alt = title || '';
    capEl.textContent = title || '';
    capEl.style.display = title ? '' : 'none';
    lastFocus = document.activeElement;
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    var btn = overlay.querySelector('.hm-lbx__close');
    if (btn) { try { btn.focus(); } catch (_) {} }
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    imgEl.src = '';
    if (lastFocus && typeof lastFocus.focus === 'function') { try { lastFocus.focus(); } catch (_) {} }
  }

  function onKey(e) { if (e.key === 'Escape' || e.key === 'Esc') close(); }

  // Delegated trigger — works for cards rendered/re-rendered after page load.
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-lightbox-src]') : null;
    if (!t) return;
    var src = t.getAttribute('data-lightbox-src');
    if (!src) return;
    e.preventDefault();
    e.stopPropagation();
    open(src, t.getAttribute('data-lightbox-title') || '');
  });

  // Public API (optional programmatic use)
  window.HMServiceLightbox = { open: open, close: close };
})();
