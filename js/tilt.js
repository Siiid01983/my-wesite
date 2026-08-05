'use strict';
/* ============================================================================
   3D TILT  —  js/tilt.js   (pairs with css/premium-polish.css)

   Premium cursor-following 3D tilt for the marketing cards. On desktop, a hovered
   card rotates subtly toward the cursor (perspective 1000px, max rotateX 4° /
   rotateY 6°, scale 1.02) and returns smoothly (250ms) on leave.

   Scope / guarantees:
     - DESKTOP POINTERS ONLY: bails entirely unless (hover:hover) and
       (pointer:fine) — phones/tablets get no tilt (the brief's "mobile: no 3D";
       they keep the fade/zoom/slide reveals from motion.js + native swipe).
     - Respects prefers-reduced-motion (bails).
     - Event DELEGATION on document → automatically covers ContentLoader's
       re-rendered service cards (no per-node binding, no MutationObserver).
     - transform/opacity only, translate3d + will-change → GPU, 60fps.
     - Sets the transform INLINE so it cleanly overrides the CSS :hover lift while
       active, and clears it on leave so the CSS shadow-lift resumes.

   Targets: service cards, review cards, stat cards, "why" (reason) cards.
   Excluded by design: FAQ (fade only), Process (slide only), commitments.
   ========================================================================== */
(function () {
  var mq = window.matchMedia;
  var okHover = !!(mq && mq('(hover: hover) and (pointer: fine)').matches);
  var reduced = !!(mq && mq('(prefers-reduced-motion: reduce)').matches);
  if (!okHover || reduced) return;

  var SEL   = '.svc-img-card, .review-card, .ustat, .reason-card';
  var MAX_X = 4, MAX_Y = 6, SCALE = 1.02, PERSP = 1000;

  var current = null;      // card currently being tilted
  var pending = null;      // latest {card,x,y} awaiting a frame
  var rafId   = 0;

  function onMove(e) {
    var card = (e.target && e.target.closest) ? e.target.closest(SEL) : null;
    if (card !== current) {
      if (current) reset(current);
      current = card;
      if (card) {
        card.style.transition = 'transform .1s ease-out';   // quick follow
        card.style.willChange = 'transform';
      }
    }
    if (!card) return;
    pending = { card: card, x: e.clientX, y: e.clientY };
    if (!rafId) rafId = requestAnimationFrame(apply);
  }

  function apply() {
    rafId = 0;
    if (!pending) return;
    var card = pending.card;
    var r = card.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    var px = (pending.x - r.left) / r.width;    // 0..1
    var py = (pending.y - r.top)  / r.height;   // 0..1
    var ry = (px - 0.5) * 2 * MAX_Y;            // -6..6
    var rx = (py - 0.5) * 2 * -MAX_X;           //  4..-4 (invert Y)
    card.style.transform =
      'perspective(' + PERSP + 'px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' +
      ry.toFixed(2) + 'deg) scale(' + SCALE + ') translate3d(0,0,0)';
  }

  function reset(card) {
    card.style.transition = 'transform .25s cubic-bezier(.22, .61, .36, 1)';  // smooth return
    card.style.transform  = '';
    card.style.willChange = '';
  }

  function clearCurrent() { if (current) { reset(current); current = null; } }

  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerdown', clearCurrent, { passive: true }); // don't stay tilted on click
  window.addEventListener('scroll', clearCurrent, { passive: true });
  window.addEventListener('blur', clearCurrent);
})();
