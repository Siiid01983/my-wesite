/* ============================================================================
   HELLO MOVING V2.1 — motion enhancer (index.html only)
   Premium, restrained, GPU-only. Cursor-follow depth tilt on cards.
   Gated: runs only on .v2, desktop pointer, motion-safe. Additive + defensive.
   ========================================================================== */
(function () {
  'use strict';
  try {
    if (!document.body || !document.body.classList.contains('v2')) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!matchMedia('(pointer: fine)').matches) return;

    function bindTilt(el, max, lift) {
      if (el.dataset.v21tilt) return; el.dataset.v21tilt = '1';
      var raf = null, rx = 0, ry = 0;
      function apply() {
        el.style.transform = 'perspective(900px) rotateX(' + ry + 'deg) rotateY(' + rx + 'deg) translate3d(0,' + lift + 'px,0)';
        raf = null;
      }
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        rx = ((e.clientX - r.left) / r.width - 0.5) * max;
        ry = -((e.clientY - r.top) / r.height - 0.5) * max;
        if (!raf) raf = requestAnimationFrame(apply);
      });
      el.addEventListener('mouseleave', function () {
        if (raf) { cancelAnimationFrame(raf); raf = null; }
        el.style.transform = '';
      });
    }

    function init() {
      document.querySelectorAll('#serviceCardsGrid > *').forEach(function (c) { bindTilt(c, 5, -6); });
      document.querySelectorAll('.review-card').forEach(function (c) { bindTilt(c, 3, -4); });
    }

    if (document.readyState !== 'loading') init();
    else document.addEventListener('DOMContentLoaded', init);

    // service cards are rendered async by the CMS — re-bind when they mount
    var grid = document.getElementById('serviceCardsGrid');
    if (grid && 'MutationObserver' in window) {
      new MutationObserver(init).observe(grid, { childList: true });
    }
  } catch (e) { /* fail-open */ }
})();
