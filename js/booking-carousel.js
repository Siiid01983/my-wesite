/* ============================================================================
 * booking-carousel.js — premium horizontal inventory shelf enhancer.
 *
 * Progressive enhancement over the CSS carousel (.ba-items-grid inside
 * #ba-items-host). Presentation only — no booking logic, slugs, names,
 * quantities, or state are touched. Fail-open: any error leaves the plain
 * CSS snap-carousel fully usable.
 *
 * Adds, on every browser (not just ones with CSS scroll-driven animation):
 *   • center-focus  — the card nearest the track centre gets `.is-center`
 *                     (scale/gold/opacity) based on ACTUAL scroll position.
 *   • edge padding  — leading/trailing space so the FIRST and LAST card can
 *                     reach the centre position.
 *   • keyboard      — ArrowLeft / ArrowRight move between cards (snap-scroll).
 *   • desktop       — vertical-wheel → horizontal scroll, and mouse click-drag.
 * Respects prefers-reduced-motion (smooth→instant; CSS drops the scale motion).
 * ==========================================================================*/
(function () {
  'use strict';
  var mq = window.matchMedia || function () { return { matches: false }; };
  var reduce = mq('(prefers-reduced-motion: reduce)').matches;
  var coarse = function () { return mq('(pointer:coarse)').matches; };

  function cards(track) { return track.querySelectorAll('.ba-item-card'); }

  // Mark the card whose centre is nearest the track's viewport centre.
  function markCenter(track) {
    var cs = cards(track);
    if (!cs.length) return;
    var mid = track.scrollLeft + track.clientWidth / 2, best = null, bd = Infinity;
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i], cc = c.offsetLeft + c.offsetWidth / 2, d = Math.abs(cc - mid);
      if (d < bd) { bd = d; best = c; }
    }
    for (var j = 0; j < cs.length; j++) cs[j].classList.toggle('is-center', cs[j] === best);
  }

  // Leading/trailing space so first & last can reach centre. Uses margins on the
  // first & last card (NOT track padding) so the flex `%` card width is unaffected.
  function padEnds(track) {
    var cs = cards(track);
    if (!cs.length) return;
    var p = Math.max(4, (track.clientWidth - cs[0].offsetWidth) / 2);
    for (var i = 0; i < cs.length; i++) { cs[i].style.marginLeft = ''; cs[i].style.marginRight = ''; }
    cs[0].style.marginLeft = p + 'px';
    cs[cs.length - 1].style.marginRight = p + 'px';
    track.style.scrollPaddingInline = '0px';
  }

  function centerCard(track, card) {
    if (!card) return;
    track.scrollTo({ left: card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2,
                     behavior: reduce ? 'auto' : 'smooth' });
  }

  function wire(track) {
    if (track.__hmCar) return;
    track.__hmCar = 1;
    track.setAttribute('tabindex', '0');
    track.setAttribute('role', 'group');
    track.setAttribute('aria-label', '荷物を左右にスワイプして選択');

    var raf = 0;
    track.addEventListener('scroll', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; markCenter(track); });
    }, { passive: true });

    // Keyboard: arrow keys step to prev/next card and centre it.
    track.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      var cs = [].slice.call(cards(track));
      var cur = track.querySelector('.ba-item-card.is-center') || cs[0];
      var idx = cs.indexOf(cur) + (e.key === 'ArrowRight' ? 1 : -1);
      idx = Math.max(0, Math.min(cs.length - 1, idx));
      centerCard(track, cs[idx]);
    });

    // Desktop: translate vertical wheel to horizontal scroll (touch keeps native).
    track.addEventListener('wheel', function (e) {
      if (coarse()) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (track.scrollWidth <= track.clientWidth) return;
      track.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });

    // Desktop: mouse click-drag to pan (guard the click so a drag never fires a stepper).
    var down = false, sx = 0, sl = 0, moved = false;
    track.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse') return;
      down = true; moved = false; sx = e.clientX; sl = track.scrollLeft;
    });
    window.addEventListener('pointermove', function (e) {
      if (!down) return;
      if (Math.abs(e.clientX - sx) > 3) moved = true;
      track.scrollLeft = sl - (e.clientX - sx);
    });
    window.addEventListener('pointerup', function () { down = false; });
    track.addEventListener('click', function (e) {
      if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
    }, true);

    padEnds(track);
    markCenter(track);
  }

  function wireAll() {
    var tracks = document.querySelectorAll('#ba-items-host .ba-items-grid');
    for (var i = 0; i < tracks.length; i++) { wire(tracks[i]); padEnds(tracks[i]); markCenter(tracks[i]); }
  }

  function boot() {
    var host = document.getElementById('ba-items-host');
    if (!host) return;
    // Re-wire whenever the item list re-renders (baRenderItems replaces innerHTML).
    try { new MutationObserver(wireAll).observe(host, { childList: true }); } catch (e) {}
    wireAll();
    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        var t = document.querySelectorAll('#ba-items-host .ba-items-grid');
        for (var i = 0; i < t.length; i++) { padEnds(t[i]); markCenter(t[i]); }
      }, 120);
    });
  }

  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
