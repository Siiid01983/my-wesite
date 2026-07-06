'use strict';
/* ─────────────────────────────────────────────────────────────────────────
   Back-to-top button (トップへ) — public site.

   Injects its own <button class="back-to-top"> (styled in
   css/ui-enhancements.css §4), so no markup lives in index.html. Appears
   only after the user scrolls past SHOW_AT; the scroll listener is passive
   and rAF-throttled. Click scrolls to the top, honoring
   prefers-reduced-motion. Positioned above the .sticky-cta bar by CSS.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  var SHOW_AT = 600;   // px scrolled before the button appears (past the hero)

  function init() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'back-to-top';
    btn.setAttribute('aria-label', 'ページ上部へ戻る');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path fill="currentColor" d="M12 4l-8 8 1.4 1.4L11 7.8V20h2V7.8l5.6 5.6L20 12z"/></svg>' +
      '<span>トップへ</span>';
    document.body.appendChild(btn);

    btn.addEventListener('click', function () {
      var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    });

    var ticking = false;
    function update() {
      btn.classList.toggle('visible', window.scrollY > SHOW_AT);
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
