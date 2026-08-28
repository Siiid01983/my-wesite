/* ════════════════════════════════════════════════════════════════════════════
   blogNavGate.js — hide the「ブログ」nav item UNTIL a published post exists.

   The public blog (blog.html) is DB-driven; with zero published posts it only
   shows an empty state. This gate hides the ブログ links in the desktop header
   nav (#headerNavEl) and the mobile nav (#mobileNav) while the blog is empty,
   and REVEALS them automatically the moment a post is published — no redeploy.

   Design:
   • Additive + fail-closed: if the API is unreachable the blog nav stays hidden
     (matches "hide until posts exist"). Nothing else on the page is touched.
   • Flash-free: this file is loaded in <head> (no defer) so the hide CSS is
     registered before the nav paints. Modern browsers hide the whole <li> via
     :has(); a marker class (added on DOMContentLoaded) covers the rest and any
     CMS-re-rendered desktop nav.
   • Read-only: a single public SELECT on blog_posts (status='published', limit 1)
     via the same window.api the rest of the site uses. No writes, no new system.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LINK = 'a[href*="blog.html"]';
  var NAVS = ['#headerNavEl', '#mobileNav'];

  // 1) Hide immediately via CSS (no flash; survives a CMS nav re-render).
  var style = document.createElement('style');
  style.id = 'hm-blog-gate';
  style.textContent =
    '#headerNavEl li:has(> ' + LINK + '),#mobileNav li:has(> ' + LINK + '){display:none !important}' +
    '.hm-blog-gated{display:none !important}';
  (document.head || document.documentElement).appendChild(style);

  // JS belt (browsers without :has(), and to tag the <li> once the nav exists).
  function hide() {
    NAVS.forEach(function (sel) {
      var root = document.querySelector(sel);
      if (!root) return;
      root.querySelectorAll(LINK).forEach(function (a) { (a.closest('li') || a).classList.add('hm-blog-gated'); });
    });
  }
  hide();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hide);

  function reveal() {
    var s = document.getElementById('hm-blog-gate');
    if (s && s.parentNode) s.parentNode.removeChild(s);
    NAVS.forEach(function (sel) {
      var root = document.querySelector(sel);
      if (!root) return;
      root.querySelectorAll('.hm-blog-gated').forEach(function (el) { el.classList.remove('hm-blog-gated'); });
    });
  }

  // 2) Reveal only when at least one published post exists.
  function whenApi(cb, timeoutMs) {
    var t0 = Date.now();
    (function poll() {
      if (window.api) return cb(window.api);
      var b = window.__BOOTSTRAP__;
      if (b && b.stage === 'FAILED') return cb(null);
      if (Date.now() - t0 > timeoutMs) return cb(null);
      setTimeout(poll, 120);
    })();
  }

  whenApi(function (api) {
    if (!api) return; // fail-closed → keep hidden
    try {
      Promise.resolve(api.from('blog_posts').select('id').eq('status', 'published').limit(1))
        .then(function (res) { if (res && !res.error && res.data && res.data.length) reveal(); })
        .catch(function () { /* keep hidden */ });
    } catch (e) { /* keep hidden */ }
  }, 15000);
})();
