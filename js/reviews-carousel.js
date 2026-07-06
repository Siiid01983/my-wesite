'use strict';
/* ─────────────────────────────────────────────────────────────────────────
   Customer Voices — mobile auto-play for the review-card snap carousel.

   The CSS carousel lives in css/ui-enhancements.css (§1c). This module only
   SCROLLS the container — it never touches the DOM or styles, so there is
   zero layout impact and it cannot conflict with ContentLoader's
   _applyRevCards, which replaces the grid's innerHTML (cards are re-read
   from grid.children on every tick, so a CMS re-render is picked up
   automatically; an emptied/collapsed grid makes every tick a no-op).

   Gates (ALL must hold for a tick to scroll):
     - viewport ≤720px (matchMedia — the CSS carousel breakpoint)
     - prefers-reduced-motion NOT set
     - section visible (IntersectionObserver, threshold .35)
     - tab visible (document.visibilitychange)
     - no user interaction in the last 8s (pointerdown/touchstart/wheel)

   Snap compatibility: each auto-scroll targets the EXACT center-snap
   position of the next card (rect-based, computed at tick time), so the
   smooth scroll settles precisely on a scroll-snap point and never fights
   `scroll-snap-type: x mandatory`.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  var INTERVAL_MS = 5500;   // one advance every 5.5s
  var RESUME_MS   = 8000;   // hands-off period after the user touches it

  var mqMobile  = window.matchMedia('(max-width: 720px)');
  var mqReduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  function start() {
    var grid = document.getElementById('revGridEl') ||
               document.querySelector('.section.reviews .review-grid');
    if (!grid || !('IntersectionObserver' in window)) return;

    var visible = false;
    var pausedUntil = 0;
    var timer = null;

    var io = new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      sync();
    }, { threshold: 0.35 });
    io.observe(grid);

    /* User interaction pauses auto-play; it resumes by itself once the
       hands-off window elapses. Programmatic scrolls fire only `scroll`
       events (no pointer events), so auto-play never pauses itself. */
    ['pointerdown', 'touchstart', 'wheel'].forEach(function (ev) {
      grid.addEventListener(ev, function () {
        pausedUntil = Date.now() + RESUME_MS;
      }, { passive: true });
    });

    document.addEventListener('visibilitychange', sync);
    if (mqMobile.addEventListener) mqMobile.addEventListener('change', sync);
    else if (mqMobile.addListener) mqMobile.addListener(sync);  // iOS <14

    function active() {
      return mqMobile.matches && !mqReduced.matches && visible && !document.hidden;
    }

    /* The interval only exists while all gates hold — an off-screen or
       desktop page runs no timer at all. */
    function sync() {
      if (active() && !timer) timer = setInterval(tick, INTERVAL_MS);
      if (!active() && timer) { clearInterval(timer); timer = null; }
    }

    /* scrollLeft that centers `card` in the container = its snap position */
    function snapTarget(card) {
      var left = card.getBoundingClientRect().left
               - grid.getBoundingClientRect().left
               + grid.scrollLeft
               - (grid.clientWidth - card.offsetWidth) / 2;
      return Math.max(0, Math.min(Math.round(left), grid.scrollWidth - grid.clientWidth));
    }

    function tick() {
      if (Date.now() < pausedUntil) return;
      if (grid.scrollWidth <= grid.clientWidth + 1) return;  // empty/collapsed/not a carousel
      var cards = [];
      for (var i = 0; i < grid.children.length; i++) {
        if (grid.children[i].offsetWidth > 0) cards.push(grid.children[i]);
      }
      if (cards.length < 2) return;
      /* Advance from wherever the user left it: nearest snap position now,
         then one card forward (wrapping to the first at the end). */
      var cur = 0, best = Infinity;
      for (i = 0; i < cards.length; i++) {
        var d = Math.abs(snapTarget(cards[i]) - grid.scrollLeft);
        if (d < best) { best = d; cur = i; }
      }
      grid.scrollTo({ left: snapTarget(cards[(cur + 1) % cards.length]), behavior: 'smooth' });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
