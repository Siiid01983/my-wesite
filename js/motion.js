'use strict';
/* ============================================================================
   MOTION SYSTEM  —  js/motion.js   (pairs with css/motion.css)
   Additive scroll-reveal + counter engine for the public marketing page.

   What it does, once per page:
     • Tags a curated set of cards / section headers with `.hm-reveal` (+ an
       effect + a per-group stagger delay), then reveals each ONE TIME as it
       enters the viewport via a single IntersectionObserver.
     • Runs a count-up on the trust-strip stat numbers when that row reveals.

   Design guarantees:
     - No layout impact: it only adds classes + inline `animation-delay`, and
       animates transform/opacity (see css/motion.css).
     - Respects prefers-reduced-motion: no hiding, no count-up — the plain page.
     - Fails open: any error, or no IntersectionObserver support, reveals
       everything immediately so content is never stuck hidden.
     - Service cards are tagged at their authoritative "content final" moment by
       wrapping window.HM_revealServiceCards (they render/re-render async via the
       CMS ContentLoader), so the entrance plays exactly when the grid appears.
   ========================================================================== */
(function () {

  var REDUCED = window.matchMedia &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var STAGGER_MS = 90;   // 80–120ms band
  var STAGGER_CAP = 10;  // don't let long lists wait forever

  /* Curated reveal groups. Each entry: a selector whose matches are cards/blocks,
     the entrance effect, whether siblings stagger, and whether to count-up. */
  var GROUPS = [
    { sel: '.hero-reasons-grid > .reason-card',      effect: 'zoom',  stagger: true },
    { sel: '.trust-strip .ustat',                    effect: 'zoom',  stagger: true, counter: true },
    { sel: '.commit-grid > .commit-card',            effect: 'zoom',  stagger: true },
    { sel: '.process-timeline > .process-step',      effect: 'zoom',  stagger: true },
    { sel: '#revGridEl > .review-card',              effect: 'zoom',  stagger: true },
    { sel: '#faqListEl > .faq-item',                 effect: 'slide', stagger: true },
    { sel: '.section-head',                          effect: 'title', stagger: false },
    { sel: '.hero-reasons-title',                    effect: 'title', stagger: false },
    { sel: '.booking-cta-band',                      effect: 'zoom',  stagger: false }
  ];

  var io = null;

  /* Reveal now (used for the happy path AND the fail-open path). */
  function reveal(el) {
    el.classList.add('hm-in');
    if (el.__hmCounter && !REDUCED) countUp(el.__hmCounter);
    // Settle: strip the animation so :hover transforms aren't blocked by its
    // forwards fill. Prefer animationend; fall back on a timer.
    var settle = function () { el.classList.add('hm-done'); };
    el.addEventListener('animationend', settle, { once: true });
    setTimeout(settle, 1200);
  }

  /* Tag one element for reveal (idempotent). `i` = index within its group. */
  function tag(el, effect, i, counterEl) {
    if (el.__hmTagged) return;
    el.__hmTagged = true;
    el.classList.add('hm-reveal');
    if (effect === 'title') el.classList.add('hm-title');
    else if (effect === 'slide') el.classList.add('hm-slide');
    if (i > 0) el.style.animationDelay = (Math.min(i, STAGGER_CAP) * STAGGER_MS) + 'ms';
    if (counterEl) el.__hmCounter = counterEl;

    if (REDUCED || !io) { el.classList.add('hm-in', 'hm-done'); return; }
    io.observe(el);
  }

  /* Count-up a numeric stat in place, preserving surrounding text + commas.
     e.g. "15,000+" -> 0…15,000 (keeps "+"),  "最短2時間" -> 最短0…2時間. */
  function countUp(el) {
    var raw = el.__hmRaw != null ? el.__hmRaw : (el.__hmRaw = el.textContent);
    var m = raw.match(/[\d,]*\d/);
    if (!m) return;
    var numStr = m[0];
    var hasComma = numStr.indexOf(',') > -1;
    var target = parseInt(numStr.replace(/,/g, ''), 10);
    if (!isFinite(target) || target <= 0) return;
    var pre = raw.slice(0, m.index);
    var post = raw.slice(m.index + numStr.length);
    var dur = 1100, start = 0;
    function fmt(n) { return hasComma ? n.toLocaleString('en-US') : String(n); }
    function step(t) {
      if (!start) start = t;
      var p = Math.min((t - start) / dur, 1);
      var e = 1 - Math.pow(1 - p, 3);                 // easeOutCubic
      el.textContent = pre + fmt(Math.round(e * target)) + post;
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = pre + fmt(target) + post; // exact final
    }
    requestAnimationFrame(step);
  }

  /* Scan the configured groups and tag their current matches. */
  function scanGroups() {
    GROUPS.forEach(function (g) {
      var nodes = document.querySelectorAll(g.sel);
      for (var i = 0; i < nodes.length; i++) {
        var counterEl = g.counter ? nodes[i].querySelector('.trust-key') : null;
        tag(nodes[i], g.effect, g.stagger ? i : 0, counterEl);
      }
    });
  }

  /* Service cards render async via the CMS ContentLoader and are revealed by
     window.HM_revealServiceCards (drops the .svc-loading gate). Wrap it so we
     tag the *final* cards right when the grid becomes visible. */
  function wrapServiceReveal() {
    var orig = window.HM_revealServiceCards;
    if (typeof orig !== 'function' || orig.__hmWrapped) return !!orig;
    var wrapped = function () {
      var r = orig.apply(this, arguments);
      var cards = document.querySelectorAll('#serviceCardsGrid > .svc-img-card');
      for (var i = 0; i < cards.length; i++) tag(cards[i], 'zoom', i, null);
      return r;
    };
    wrapped.__hmWrapped = true;
    window.HM_revealServiceCards = wrapped;
    return true;
  }

  function init() {
    try {
      if (!REDUCED && 'IntersectionObserver' in window) {
        io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (!en.isIntersecting) return;
            io.unobserve(en.target);   // reveal ONCE
            reveal(en.target);
          });
        }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
      }
      scanGroups();

      // Hook service cards. If the inline renderer hasn't defined the fn yet,
      // retry briefly (it's defined by an inline <script> in index.html).
      if (!wrapServiceReveal()) {
        var tries = 0;
        var iv = setInterval(function () {
          if (wrapServiceReveal() || ++tries > 40) clearInterval(iv);
        }, 100);
      }
    } catch (e) {
      // Fail open: never leave content hidden.
      var hidden = document.querySelectorAll('.hm-reveal:not(.hm-in)');
      for (var i = 0; i < hidden.length; i++) hidden[i].classList.add('hm-in', 'hm-done');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
