/* ════════════════════════════════════════════════════════════════════════════
   works-gallery.js — public 作業事例 Cover Flow carousel + fullscreen viewer

   DB-driven (zero hardcoded images). Fetches <API_BASE>/gallery.php, builds a
   transform-based Cover Flow driven by pointer events + requestAnimationFrame
   (one code path for touch and mouse; loop by index arithmetic, no DOM cloning,
   no scroll-snap). Hides the whole section on empty/failure — never a blank gap,
   never an error on the public site. No external libraries.

   The Hero is not touched by this file.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SPACING_FACTOR = 0.80;   // adjacent-card center distance as a fraction of card width (~14% overlap w/ scale .88)
  var EAGER = 3;               // first N images load eager+high priority; rest lazy via IntersectionObserver
  var AUTOPLAY_MS = 5000;
  var RESUME_MS = 2000;

  var S = {
    root: null, track: null, viewport: null, dotsEl: null, liveEl: null,
    items: [], n: 0,
    pos: 0, target: 0, raf: 0, animating: false,
    spacing: 0,
    hover: false, docHidden: false, cooldownUntil: 0,
    drag: null,
    reduced: false,
    fs: null
  };

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  ready(init);

  function init() {
    S.root = document.getElementById('works');
    S.track = document.getElementById('wgTrack');
    S.viewport = S.root && S.root.querySelector('.wg-viewport');
    S.dotsEl = document.getElementById('wgDots');
    S.liveEl = document.getElementById('wgLive');
    if (!S.root || !S.track) return;
    S.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    fetchData();
  }

  function apiBase() { return String(window.API_BASE || '').replace(/\/+$/, ''); }

  function fetchData() {
    var base = apiBase();
    if (!base) {
      // window.API_BASE / API_KEY are set asynchronously by js/core/bootstrap.js
      // (it dynamically loads js/config/env.js during its staged startup). This
      // defer script's init() can run BEFORE that completes, so we must WAIT for
      // the globals rather than give up permanently — otherwise the feed is never
      // requested and the section stays hidden even though gallery.php has data.
      fetchData._tries = (fetchData._tries || 0) + 1;
      if (fetchData._tries > 150) return;   // ~15s ceiling, then stop quietly
      setTimeout(fetchData, 100);
      return;
    }
    fetch(base + '/gallery.php', { headers: { 'X-API-KEY': window.API_KEY || '' }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var items = j && Array.isArray(j.data) ? j.data : [];
        if (!items.length) return;     // zero items → keep section hidden (3.6)
        S.items = items; S.n = items.length;
        reveal();
      })
      .catch(function () { /* network/parse failure → keep hidden, no error surfaced */ });
  }

  function reveal() {
    S.root.hidden = false;
    render();
    injectJsonLd();
    measure();
    bindControls();
    setIndex(0, true);
    startAutoplay();
    window.addEventListener('resize', debounce(measure, 150));
  }

  /* ── build cards ──────────────────────────────────────────────────────────── */
  function render() {
    S.track.innerHTML = '';
    var io = ('IntersectionObserver' in window)
      ? new IntersectionObserver(onIntersect, { root: null, rootMargin: '200px', threshold: 0.01 })
      : null;

    S.items.forEach(function (it, i) {
      var card = document.createElement('button');
      card.className = 'wg-card wg-skeleton';
      card.type = 'button';
      card.dataset.index = i;
      card.setAttribute('aria-label', (it.title || '作業事例') + '（拡大表示）');

      var w = it.width || 1200, h = it.height || 800;
      var pic = document.createElement('picture');
      var eager = i < EAGER;

      if (it.image_webp) {
        var src = document.createElement('source');
        src.type = 'image/webp';
        if (eager) src.srcset = it.image_webp; else src.dataset.srcset = it.image_webp;
        pic.appendChild(src);
      }
      var img = document.createElement('img');
      img.width = w; img.height = h;
      img.alt = it.alt_text || it.title || '';
      img.decoding = 'async';
      if (eager) { img.src = it.image_url; img.loading = 'eager'; img.setAttribute('fetchpriority', 'high'); }
      else { img.dataset.src = it.image_url; img.loading = 'lazy'; }
      img.addEventListener('load', function () { card.classList.remove('wg-skeleton'); });
      pic.appendChild(img);
      card.appendChild(pic);
      S.track.appendChild(card);

      if (!eager && io) io.observe(card);
    });

    // Dots
    if (S.dotsEl) {
      S.dotsEl.innerHTML = '';
      S.items.forEach(function (_, i) {
        var d = document.createElement('button');
        d.className = 'wg-dot'; d.type = 'button';
        d.setAttribute('aria-label', (i + 1) + '枚目へ');
        d.addEventListener('click', function () { userInteract(); setIndex(i); });
        S.dotsEl.appendChild(d);
      });
    }
  }

  function onIntersect(entries, obs) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var card = e.target;
      var img = card.querySelector('img');
      var src = card.querySelector('source');
      if (src && src.dataset.srcset) { src.srcset = src.dataset.srcset; delete src.dataset.srcset; }
      if (img && img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; }
      obs.unobserve(card);
    });
  }

  /* ── layout / transforms ──────────────────────────────────────────────────── */
  function measure() {
    var card = S.track.querySelector('.wg-card');
    var cw = card ? card.offsetWidth : (S.viewport ? S.viewport.offsetWidth * 0.68 : 300);
    S.spacing = cw * SPACING_FACTOR;
    applyTransforms();
  }

  function wrapOff(i) {
    var n = S.n, d = (i - S.pos) % n;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    return d;
  }

  function applyTransforms() {
    var cards = S.track.children;
    for (var i = 0; i < cards.length; i++) {
      var o = wrapOff(i);
      var ao = Math.min(Math.abs(o), 1);
      var scale = 1 - 0.12 * ao;                       // center 1.0 → neighbor 0.88
      var opacity = Math.abs(o) > 1.6 ? 0 : 1 - 0.45 * ao;  // center 1 → neighbor .55 → far 0
      var x = o * S.spacing;
      var c = cards[i];
      c.style.transform = 'translate3d(calc(-50% + ' + x + 'px), -50%, 0) scale(' + scale + ')';
      c.style.opacity = opacity;
      c.style.zIndex = String(100 - Math.round(Math.abs(o) * 10));
      c.style.pointerEvents = opacity > 0.05 ? 'auto' : 'none';
      c.classList.toggle('is-center', Math.abs(o) < 0.5);
    }
  }

  /* ── animation loop ──────────────────────────────────────────────────────── */
  function startAnim() {
    if (S.reduced) { S.pos = S.target; applyTransforms(); afterSettle(); return; }
    if (S.animating) return;
    S.animating = true;
    setWillChange(true);
    S.raf = requestAnimationFrame(frame);
  }
  function frame() {
    var diff = S.target - S.pos;
    if (Math.abs(diff) < 0.001) {
      S.pos = S.target;
      applyTransforms();
      S.animating = false;
      setWillChange(false);
      afterSettle();
      return;
    }
    S.pos += diff * 0.18;
    applyTransforms();
    S.raf = requestAnimationFrame(frame);
  }
  function setWillChange(on) {
    var cards = S.track.children;
    for (var i = 0; i < cards.length; i++) cards[i].style.willChange = on ? 'transform, opacity' : '';
  }
  function afterSettle() { updateActive(); }

  /* ── navigation ──────────────────────────────────────────────────────────── */
  function go(delta) { S.target += delta; startAnim(); updateActive(); }
  function setIndex(i, instant) {
    // Move to the nearest representation of index i (shortest path around the loop).
    var cur = S.target, n = S.n;
    var d = (i - (((cur % n) + n) % n));
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    S.target = cur + d;
    if (instant) { S.pos = S.target; applyTransforms(); }
    else startAnim();
    updateActive();
  }
  // Based on TARGET (not the mid-animation pos) so dots + the live-region
  // announcement update instantly on interaction rather than lagging a step
  // behind the ~easing settle.
  function currentIndex() { return (((Math.round(S.target) % S.n) + S.n) % S.n); }

  function updateActive() {
    var idx = currentIndex();
    if (S.dotsEl) {
      var dots = S.dotsEl.children;
      for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('is-active', i === idx);
    }
    if (S.liveEl) S.liveEl.textContent = (idx + 1) + ' / ' + S.n;
  }

  /* ── controls: arrows, keyboard, pointer drag, tap ───────────────────────── */
  function bindControls() {
    var prev = S.root.querySelector('.wg-prev');
    var next = S.root.querySelector('.wg-next');
    if (prev) prev.addEventListener('click', function () { userInteract(); go(-1); });
    if (next) next.addEventListener('click', function () { userInteract(); go(1); });

    S.root.addEventListener('mouseenter', function () { S.hover = true; }, true);
    S.root.addEventListener('mouseleave', function () { S.hover = false; });
    document.addEventListener('visibilitychange', function () { S.docHidden = document.hidden; });

    // Keyboard on the stage
    S.viewport.setAttribute('tabindex', '0');
    S.viewport.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); userInteract(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); userInteract(); go(1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFullscreen(currentIndex()); }
    });

    // Unified pointer path (touch + mouse). translate3d driven by pointer delta.
    S.viewport.addEventListener('pointerdown', onPointerDown);
    S.viewport.addEventListener('pointermove', onPointerMove);
    S.viewport.addEventListener('pointerup', onPointerUp);
    S.viewport.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerDown(e) {
    userInteract();
    var startCard = e.target.closest ? e.target.closest('.wg-card') : null;
    S.drag = { id: e.pointerId, x: e.clientX, startPos: S.target, moved: 0, card: startCard };
    S.pos = S.target;              // freeze current visual position
    try { S.viewport.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function onPointerMove(e) {
    if (!S.drag || e.pointerId !== S.drag.id) return;
    var dx = e.clientX - S.drag.x;
    S.drag.moved = Math.max(S.drag.moved, Math.abs(dx));
    S.pos = S.drag.startPos - dx / (S.spacing || 1);
    applyTransforms();
  }
  function onPointerUp(e) {
    if (!S.drag || e.pointerId !== S.drag.id) return;
    var moved = S.drag.moved, card = S.drag.card;
    try { S.viewport.releasePointerCapture(e.pointerId); } catch (_) {}
    S.drag = null;
    userInteract();
    if (moved < 8) {
      // Tap: center card → fullscreen; a side card → navigate to it.
      if (card) {
        var i = Number(card.dataset.index);
        if (i === currentIndex()) openFullscreen(i);
        else setIndex(i);
      }
    } else {
      S.target = Math.round(S.pos);
      startAnim();
    }
    updateActive();
  }

  function userInteract() { S.cooldownUntil = Date.now() + RESUME_MS; }

  /* ── autoplay (pause on hover / hidden tab / interaction) ─────────────────── */
  function startAutoplay() {
    if (S.n < 2 || S.reduced) return;
    setInterval(function () {
      if (S.hover || S.docHidden) return;
      if (Date.now() < S.cooldownUntil) return;
      if (S.fs && S.fs.open) return;
      go(1);
    }, AUTOPLAY_MS);
  }

  /* ── fullscreen viewer ───────────────────────────────────────────────────── */
  function buildFs() {
    if (S.fs) return S.fs;
    var el = document.createElement('div');
    el.className = 'wg-fs';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', '作業事例（拡大表示）');
    el.innerHTML =
      '<img class="wg-fs-img" alt="">' +
      '<button class="wg-fs-btn wg-fs-close" aria-label="閉じる"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
      '<button class="wg-fs-btn wg-fs-prev" aria-label="前へ"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>' +
      '<button class="wg-fs-btn wg-fs-next" aria-label="次へ"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>' +
      '<div class="wg-fs-count" aria-hidden="true"></div>';
    document.body.appendChild(el);

    var fs = {
      el: el,
      img: el.querySelector('.wg-fs-img'),
      count: el.querySelector('.wg-fs-count'),
      btnClose: el.querySelector('.wg-fs-close'),
      btnPrev: el.querySelector('.wg-fs-prev'),
      btnNext: el.querySelector('.wg-fs-next'),
      open: false, index: 0, lastFocus: null, zoomed: false,
      lastTap: 0, swipe: null
    };
    S.fs = fs;

    fs.btnClose.addEventListener('click', closeFullscreen);
    fs.btnPrev.addEventListener('click', function () { fsNav(-1); });
    fs.btnNext.addEventListener('click', function () { fsNav(1); });
    el.addEventListener('click', function (e) { if (e.target === el) closeFullscreen(); });

    // Double-tap / double-click to zoom (kept simple so it never competes with swipe).
    fs.img.addEventListener('click', function (e) {
      e.stopPropagation();
      var now = Date.now();
      if (now - fs.lastTap < 300) { fs.zoomed = !fs.zoomed; fs.img.classList.toggle('zoomed', fs.zoomed); }
      fs.lastTap = now;
    });

    // Swipe navigation (only when not zoomed).
    fs.img.addEventListener('pointerdown', function (e) { fs.swipe = { x: e.clientX, id: e.pointerId }; });
    el.addEventListener('pointerup', function (e) {
      if (!fs.swipe || e.pointerId !== fs.swipe.id) { fs.swipe = null; return; }
      var dx = e.clientX - fs.swipe.x; fs.swipe = null;
      if (!fs.zoomed && Math.abs(dx) > 50) fsNav(dx < 0 ? 1 : -1);
    });

    // Keyboard: ESC close, arrows navigate, Tab focus-trap.
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeFullscreen(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); fsNav(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); fsNav(1); }
      else if (e.key === 'Tab') trapTab(e, fs);
    });
    return fs;
  }

  function openFullscreen(i) {
    var fs = buildFs();
    fs.index = i;
    fs.lastFocus = document.activeElement;
    setFsImage();
    fs.el.classList.add('open');
    fs.open = true;
    document.body.dataset.wgScroll = document.body.style.overflow || '';
    document.body.style.overflow = 'hidden';               // lock background scroll
    fs.btnClose.focus();
  }
  function closeFullscreen() {
    var fs = S.fs; if (!fs || !fs.open) return;
    fs.el.classList.remove('open');
    fs.open = false; fs.zoomed = false; fs.img.classList.remove('zoomed');
    document.body.style.overflow = document.body.dataset.wgScroll || '';
    delete document.body.dataset.wgScroll;
    if (fs.lastFocus && fs.lastFocus.focus) fs.lastFocus.focus();
    setIndex(fs.index);                                    // sync carousel to where the viewer left off
  }
  function fsNav(delta) {
    var fs = S.fs;
    fs.index = (((fs.index + delta) % S.n) + S.n) % S.n;
    fs.zoomed = false; fs.img.classList.remove('zoomed');
    setFsImage();
  }
  function setFsImage() {
    var fs = S.fs, it = S.items[fs.index];
    fs.img.src = it.image_webp || it.image_url;
    fs.img.alt = it.alt_text || it.title || '';
    fs.count.textContent = (fs.index + 1) + ' / ' + S.n;
  }
  function trapTab(e, fs) {
    var f = [fs.btnClose, fs.btnPrev, fs.btnNext];
    var i = f.indexOf(document.activeElement);
    if (e.shiftKey) { if (i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } }
    else { if (i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
  }

  /* ── SEO: ImageObject JSON-LD for the rendered items ─────────────────────── */
  function injectJsonLd() {
    try {
      var list = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        'itemListElement': S.items.map(function (it, i) {
          return {
            '@type': 'ListItem', 'position': i + 1,
            'item': {
              '@type': 'ImageObject',
              'name': it.title || '作業事例',
              'description': it.alt_text || it.title || '',
              'contentUrl': it.image_url
            }
          };
        })
      };
      var s = document.createElement('script');
      s.type = 'application/ld+json';
      s.textContent = JSON.stringify(list);
      document.head.appendChild(s);
    } catch (_) {}
  }

  /* ── util ────────────────────────────────────────────────────────────────── */
  function debounce(fn, ms) {
    var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }
})();
