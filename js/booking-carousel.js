/* ============================================================================
 * booking-carousel.js — premium horizontal inventory shelf enhancer (DESKTOP/
 * TABLET only, viewport ≥ 768px).
 *
 * Progressive enhancement over the CSS carousel (.ba-items-grid inside
 * #ba-items-host). Presentation only — no booking logic, slugs, names,
 * quantities, or state are touched. Fail-open.
 *
 * ≥ 768px  — adds, on every browser (not just ones with CSS scroll-driven anim):
 *   • center-focus  — the card nearest the track centre gets `.is-center`.
 *   • edge margins  — first & last card can reach the centre position.
 *   • keyboard      — ArrowLeft / ArrowRight move between cards.
 *   • desktop       — vertical-wheel → horizontal scroll, and mouse click-drag.
 *
 * ≤ 767px  — INACTIVE. The inventory is a plain 2-column CSS grid; this script
 *   demotes each track (removes tabindex/role, `.is-center`, and any inline
 *   end-margins) so nothing scrolls horizontally and no carousel-only focusable
 *   element remains. It re-activates automatically if the viewport grows.
 *
 * Respects prefers-reduced-motion (smooth→instant; CSS drops the scale motion).
 * ==========================================================================*/
(function () {
  'use strict';
  var mq = window.matchMedia || function () { return { matches: false }; };
  var reduce = mq('(prefers-reduced-motion: reduce)').matches;
  var isDesktop = function () { return mq('(min-width:768px)').matches; };

  function cards(track) { return track.querySelectorAll('.ba-item-card'); }

  // Mark the card whose centre is nearest the track's viewport centre (desktop only).
  function markCenter(track) {
    var cs = cards(track);
    if (!cs.length) return;
    if (!isDesktop()) { for (var k = 0; k < cs.length; k++) cs[k].classList.remove('is-center'); return; }
    var mid = track.scrollLeft + track.clientWidth / 2, best = null, bd = Infinity;
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i], cc = c.offsetLeft + c.offsetWidth / 2, d = Math.abs(cc - mid);
      if (d < bd) { bd = d; best = c; }
    }
    for (var j = 0; j < cs.length; j++) cs[j].classList.toggle('is-center', cs[j] === best);
  }

  // Leading/trailing space (first & last card margins) so they can reach centre.
  function padEnds(track) {
    var cs = cards(track);
    if (!cs.length) return;
    for (var k = 0; k < cs.length; k++) { cs[k].style.marginLeft = ''; cs[k].style.marginRight = ''; }
    if (!isDesktop()) return;                        // grid mode: no end-margins
    var p = Math.max(4, (track.clientWidth - cs[0].offsetWidth) / 2);
    cs[0].style.marginLeft = p + 'px';
    cs[cs.length - 1].style.marginRight = p + 'px';
  }

  function centerCard(track, card) {
    if (!card) return;
    track.scrollTo({ left: card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2,
                     behavior: reduce ? 'auto' : 'smooth' });
  }

  function wire(track) {
    if (track.__hmCar) return;
    track.__hmCar = 1;

    var raf = 0;
    track.addEventListener('scroll', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; markCenter(track); });
    }, { passive: true });

    track.addEventListener('keydown', function (e) {
      if (!isDesktop()) return;
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      var cs = [].slice.call(cards(track));
      var cur = track.querySelector('.ba-item-card.is-center') || cs[0];
      var idx = cs.indexOf(cur) + (e.key === 'ArrowRight' ? 1 : -1);
      idx = Math.max(0, Math.min(cs.length - 1, idx));
      centerCard(track, cs[idx]);
    });

    track.addEventListener('wheel', function (e) {
      if (!isDesktop()) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (track.scrollWidth <= track.clientWidth) return;
      track.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });

    var down = false, sx = 0, sl = 0, moved = false;
    track.addEventListener('pointerdown', function (e) {
      if (!isDesktop() || e.pointerType !== 'mouse') return;
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
  }

  function promote(track) {
    wire(track);
    track.setAttribute('tabindex', '0');
    track.setAttribute('role', 'group');
    track.setAttribute('aria-label', '荷物を左右にスワイプして選択');
    padEnds(track);
    markCenter(track);
  }

  // Mobile: strip every carousel-only affordance so it's a plain, non-scrolling grid.
  function demote(track) {
    track.removeAttribute('tabindex');
    track.removeAttribute('role');
    track.removeAttribute('aria-label');
    var cs = cards(track);
    for (var i = 0; i < cs.length; i++) {
      cs[i].classList.remove('is-center');
      cs[i].style.marginLeft = '';
      cs[i].style.marginRight = '';
    }
  }

  function applyAll() {
    var tracks = document.querySelectorAll('#ba-items-host .ba-items-grid');
    for (var i = 0; i < tracks.length; i++) {
      if (isDesktop()) promote(tracks[i]); else demote(tracks[i]);
    }
  }

  function boot() {
    var host = document.getElementById('ba-items-host');
    if (!host) return;
    try { new MutationObserver(applyAll).observe(host, { childList: true }); } catch (e) {}
    applyAll();
    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(applyAll, 120);
    });
  }

  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
