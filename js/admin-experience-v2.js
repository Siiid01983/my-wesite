/* ============================================================================
   HELLO MOVING V2 — Admin experience enhancer (admin-v2.html only)
   Additive + gated (runs only under html.v2-dark, wrapped in try/catch).
   Gives the panel a premium first paint: shows a shimmer SKELETON in the
   dashboard until real content mounts, then fades it out. Touches no core JS;
   skeleton nodes use dedicated .v2-skel* classes so the observer can tell them
   apart from real .panel/.stat-grid/table/.empty content.
   ========================================================================== */
(function () {
  'use strict';
  if (!document.documentElement.classList.contains('v2-dark')) return;

  var SKEL_ID = 'v2SkelBoot';

  function statCard() {
    return '<div class="v2-skel-panel" style="height:96px;padding:20px 22px;margin:0">' +
             '<div class="v2-skel v2-skel-line sm" style="width:45%"></div>' +
             '<div class="v2-skel v2-skel-num" style="margin-top:16px"></div>' +
           '</div>';
  }
  function row() {
    return '<div class="v2-skel-row">' +
             '<div class="v2-skel v2-skel-circle" style="width:36px;height:36px"></div>' +
             '<div class="g"><div class="v2-skel v2-skel-line" style="width:40%"></div>' +
             '<div class="v2-skel v2-skel-line sm" style="width:24%"></div></div>' +
             '<div class="v2-skel v2-skel-line" style="width:64px;height:22px;border-radius:999px"></div>' +
           '</div>';
  }
  function dashboardSkeleton() {
    return '<div id="' + SKEL_ID + '" aria-hidden="true" aria-busy="true">' +
             '<div class="v2-skel-stats">' + statCard() + statCard() + statCard() + statCard() + '</div>' +
             '<div class="v2-skel-panel">' +
               '<div class="v2-skel v2-skel-title" style="margin-bottom:20px"></div>' +
               row() + row() + row() + row() +
             '</div>' +
           '</div>';
  }

  // Real content = any of these; skeleton uses .v2-skel* so it never matches.
  var REAL = '.stat-grid, .panel, table tbody tr, .empty';

  function boot() {
    try {
      var dash = document.getElementById('view-dashboard');
      if (!dash) return;
      if (dash.querySelector(REAL)) return;              // content already present
      if (document.getElementById(SKEL_ID)) return;      // skeleton already shown
      dash.insertAdjacentHTML('afterbegin', dashboardSkeleton());

      var t;
      var obs = new MutationObserver(function () {
        if (dash.querySelector(REAL)) clear();
      });
      function clear() {
        try { obs.disconnect(); } catch (e) {}
        clearTimeout(t);
        var s = document.getElementById(SKEL_ID);
        if (!s) return;
        s.style.transition = 'opacity .25s ease';
        s.style.opacity = '0';
        setTimeout(function () { if (s && s.parentNode) s.parentNode.removeChild(s); }, 260);
      }
      obs.observe(dash, { childList: true, subtree: true });
      t = setTimeout(clear, 8000);                        // fail-open safety net
    } catch (e) {}
  }

  // Tiny API in case a view wants to skeleton its own container later.
  window.HMSkel = { dashboard: dashboardSkeleton, row: row, statCard: statCard };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
