'use strict';
/* ============================================================================
   HELLO MOVING V2  —  js/v2.js   (index.html only)
   Tiny experience layer on top of the existing scripts:
     1. Header: transparent-over-hero → frosted-light once scrolled past ~10% vh.
     2. Hero ambient parallax: glows + route drift subtly toward the cursor
        (desktop pointers only; disabled for touch and reduced-motion).
   The hero LOAD sequence is pure CSS (css/v2.css). Nothing here touches booking,
   the CMS renderer, or any data path.
   ========================================================================== */
(function () {
  var doc = document;
  var header = doc.getElementById('siteHeader');

  /* 1) Header scroll state ---------------------------------------------------*/
  if (header) {
    var THRESHOLD = 40;
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        header.classList.toggle('v2-scrolled', window.scrollY > THRESHOLD);
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* 2) Hero ambient parallax (desktop, motion-safe) --------------------------*/
  var mq = window.matchMedia;
  var okHover = !!(mq && mq('(hover: hover) and (pointer: fine)').matches);
  var reduced = !!(mq && mq('(prefers-reduced-motion: reduce)').matches);
  if (!okHover || reduced) return;

  var hero  = doc.querySelector('.v2hero');
  if (!hero) return;
  var glowA = hero.querySelector('.v2hero__glow--a');
  var glowB = hero.querySelector('.v2hero__glow--b');
  var route = hero.querySelector('.v2hero__route');
  var pending = null, raf = 0;

  hero.addEventListener('pointermove', function (e) {
    pending = e;
    if (!raf) raf = requestAnimationFrame(apply);
  }, { passive: true });
  hero.addEventListener('pointerleave', function () {
    if (glowA) glowA.style.transform = '';
    if (glowB) glowB.style.transform = '';
    if (route) route.style.transform = '';
  }, { passive: true });

  function apply() {
    raf = 0;
    if (!pending) return;
    var r = hero.getBoundingClientRect();
    var dx = (pending.clientX - r.left) / r.width - 0.5;   // -0.5..0.5
    var dy = (pending.clientY - r.top) / r.height - 0.5;
    if (glowA) glowA.style.transform = 'translate3d(' + (dx * 26) + 'px,' + (dy * 26) + 'px,0)';
    if (glowB) glowB.style.transform = 'translate3d(' + (dx * -34) + 'px,' + (dy * -30) + 'px,0)';
    if (route) route.style.transform = 'translate3d(' + (dx * 14) + 'px,' + (dy * 14) + 'px,0)';
  }
})();
