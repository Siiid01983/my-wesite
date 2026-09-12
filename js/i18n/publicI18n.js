/* ════════════════════════════════════════════════════════════════════════════
   js/i18n/publicI18n.js — PUBLIC customer-site English layer (ADDITIVE).

   Adds an English view of the existing Japanese public site WITHOUT modifying any
   Japanese source text. Japanese is the source of truth, the default, and the
   fallback: a missing English entry renders the existing Japanese unchanged.

   Design (approved):
     • Preference key:  localStorage['hm_pub_lang']  (SEPARATE from Ops/Admin's
       'hm_lang', which is never read or written here).
     • URL strategy:    ?lang=en → English · no param (or ?lang=ja) → Japanese.
       Existing Japanese URLs / canonical behavior are preserved untouched.
     • Detection precedence:  query ?lang  >  stored hm_pub_lang  >  browser
       language (en* → en, ja* / everything else → ja)  >  default 'ja'.
       ?lang persists the choice. Never uses IP / SIM / phone / geolocation.
     • Rendering: an overlay dictionary (locales/public.en.js, Japanese→English).
       When English is active the engine walks visible text nodes + a small set of
       attributes and, ONLY on an exact whole-node match, swaps in English. It
       never edits the DOM in Japanese mode, never rewrites the HTML source, and
       skips dynamic/customer-data regions and translate="no" elements.
     • A visible 日本語 | English switch is always injected.

   NOT loaded on Ops/Admin. No API/DB/booking-engine coupling: t() is display-only
   and status enums, [data-service] values, packed-note tokens, prices, and API
   payloads are never passed through it.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var KEY = 'hm_pub_lang', DEFAULT = 'ja', SUPPORTED = ['ja', 'en'];

  /* ── Pure helpers (unit-testable; no DOM / no globals) ─────────────────── */

  function normalize(v) {
    v = String(v == null ? '' : v).toLowerCase();
    return SUPPORTED.indexOf(v) >= 0 ? v : null;
  }

  // Parse ?lang= out of a raw search string (e.g. "?a=1&lang=EN").
  function queryLang(search) {
    var m = /[?&]lang=([^&#]+)/i.exec(String(search || ''));
    return m ? normalize(decodeURIComponent(m[1])) : null;
  }

  // Map one browser language tag to a supported language, or null.
  function tagToLang(tag) {
    var l = String(tag || '').toLowerCase();
    if (l.indexOf('en') === 0) return 'en';   // en, en-US, en-GB, …
    if (l.indexOf('ja') === 0) return 'ja';   // ja, ja-JP, …
    return null;                              // everything else → undecided
  }

  /* Decide the active language from explicit inputs. Returns
     { lang, persist, source }. `persist` is true only when an explicit ?lang was
     given (that choice should be written to storage).
       precedence: query > stored > browser > default. */
  function decide(opts) {
    opts = opts || {};
    var q = queryLang(opts.query);
    if (q) return { lang: q, persist: true, source: 'query' };

    var stored = normalize(opts.stored);
    if (stored) return { lang: stored, persist: false, source: 'stored' };

    var langs = (opts.navigatorLanguages && opts.navigatorLanguages.length)
      ? opts.navigatorLanguages
      : (opts.navigatorLanguage ? [opts.navigatorLanguage] : []);
    for (var i = 0; i < langs.length; i++) {
      var d = tagToLang(langs[i]);
      if (d) return { lang: d, persist: false, source: 'browser' };
    }
    return { lang: DEFAULT, persist: false, source: 'default' };
  }

  // Translate one Japanese string; fall back to the Japanese itself.
  function translate(dict, ja, lang) {
    if (lang !== 'en') return ja;               // Japanese mode: untouched
    if (ja == null) return ja;
    var en = dict && dict[ja];
    return (en == null || en === '') ? ja : en; // missing → Japanese fallback
  }

  // Build the href for a language, preserving the rest of the current URL.
  // English → ensure ?lang=en. Japanese → strip lang param (clean JP URL).
  function switchHref(loc, lang) {
    loc = loc || {};
    var path = loc.pathname || '';
    var hash = loc.hash || '';
    var search = String(loc.search || '');
    var qs = search.replace(/^\?/, '').split('&').filter(function (p) {
      return p && !/^lang=/i.test(p);
    });
    if (lang === 'en') qs.push('lang=en');
    var q = qs.length ? ('?' + qs.join('&')) : '';
    return path + q + hash;
  }

  // Node export for tests (pure logic only).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalize: normalize, queryLang: queryLang, tagToLang: tagToLang,
      decide: decide, translate: translate, switchHref: switchHref, KEY: KEY, DEFAULT: DEFAULT };
  }
  if (typeof window === 'undefined') return;   // stop here under node

  /* ── Browser wiring ────────────────────────────────────────────────────── */

  function readStored() { try { return localStorage.getItem(KEY); } catch (_) { return null; } }
  function writeStored(v) { try { localStorage.setItem(KEY, v); } catch (_) {} }
  function dict() { return window.HM_PUBLIC_EN || {}; }

  var _decided = decide({
    query: location.search,
    stored: readStored(),
    navigatorLanguages: navigator.languages,
    navigatorLanguage: navigator.language,
  });
  var _lang = _decided.lang;
  if (_decided.persist) writeStored(_lang);     // ?lang= persists the choice

  var _applying = false, _observer = null, _scheduled = false;

  // Regions whose text is dynamic/customer-data and must never be swapped.
  var SKIP_SEL = '.ba-val, .ba-review-table, .pchat-bubble, .hmcc-b, .pchat-name,' +
    ' .hmcc-name, .ba-ref-num, .pv2-bubble, .pv2-msg-list, [data-noi18n],' +
    ' [translate="no"], script, style, noscript';
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, INPUT: 1, CODE: 1, PRE: 1 };
  var ATTRS = ['placeholder', 'aria-label', 'title'];

  function inSkip(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (SKIP_TAGS[n.tagName]) return true;
      if (n.matches && n.matches(SKIP_SEL)) return true;
      var tr = n.getAttribute && n.getAttribute('translate');
      if (tr === 'no') return true;
    }
    return false;
  }

  // Swap one text node if its trimmed value is a dictionary key (whitespace kept).
  function swapTextNode(node, D) {
    var raw = node.nodeValue; if (!raw) return;
    var trimmed = raw.trim(); if (!trimmed) return;
    var en = D[trimmed];
    if (en == null || en === '' || en === trimmed) return;
    var lead = raw.match(/^\s*/)[0], tail = raw.match(/\s*$/)[0];
    node.nodeValue = lead + en + tail;
  }

  function applyEN(root) {
    var D = dict();
    root = root || document.body; if (!root) return;
    // Text nodes
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return inSkip(n.parentNode) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    var t;
    while ((t = walker.nextNode())) swapTextNode(t, D);
    // Translatable attributes
    var host = (root.querySelectorAll ? root : document);
    var withAttrs = host.querySelectorAll('[placeholder],[aria-label],[title]');
    Array.prototype.forEach.call(withAttrs, function (el) {
      if (inSkip(el)) return;
      ATTRS.forEach(function (a) {
        var v = el.getAttribute(a); if (!v) return;
        var en = D[v.trim()]; if (en && en !== v.trim()) el.setAttribute(a, en);
      });
    });
  }

  function applyAll() {
    if (_lang !== 'en') return;                 // Japanese mode: do nothing
    _applying = true;
    try {
      applyEN(document.body);
      // document.title (only if we have an English entry)
      var D = dict(), tt = document.title && D[document.title.trim()];
      if (tt) document.title = tt;
      document.documentElement.lang = 'en';     // additive; JP stays 'ja'
    } finally { _applying = false; }
  }

  // Batch re-applies so JS-injected UI (BA overlay, contact chat, CMS re-render)
  // gets translated without thrashing.
  function schedule() {
    if (_lang !== 'en' || _scheduled) return;
    _scheduled = true;
    (window.requestAnimationFrame || function (f) { setTimeout(f, 16); })(function () {
      _scheduled = false; applyAll();
    });
  }

  function startObserver() {
    if (_lang !== 'en' || _observer || !window.MutationObserver || !document.body) return;
    _observer = new MutationObserver(function (muts) {
      if (_applying) return;                    // ignore our own edits
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].addedNodes && muts[i].addedNodes.length) { schedule(); return; }
      }
    });
    _observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ── Language switch (日本語 | English) — always available ─────────────── */

  function injectCss() {
    if (document.getElementById('hm-pub-lang-css')) return;
    var css =
      '.hm-pub-lang{display:inline-flex;align-items:center;border:1px solid var(--line,#dfe3d8);' +
        'border-radius:999px;overflow:hidden;font-size:12px;font-weight:700;line-height:1;' +
        'vertical-align:middle;margin-left:10px;flex:none}' +
      '.hm-pub-lang a{padding:5px 10px;text-decoration:none;color:inherit;opacity:.72;white-space:nowrap}' +
      '.hm-pub-lang a.on{background:#9AB57A;color:#20301a;opacity:1}';
    var s = document.createElement('style'); s.id = 'hm-pub-lang-css'; s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  // One switch control. JA and EN are real query-based links (shareable), and a
  // click also persists the choice so it survives the navigation.
  function switchEl() {
    var wrap = document.createElement('div');
    wrap.className = 'hm-pub-lang';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Language / 言語');
    var ja = document.createElement('a'), en = document.createElement('a');
    ja.textContent = '日本語'; en.textContent = 'English';
    ja.href = switchHref(location, 'ja'); en.href = switchHref(location, 'en');
    if (_lang === 'ja') ja.className = 'on'; else en.className = 'on';
    ja.addEventListener('click', function () { writeStored('ja'); });
    en.addEventListener('click', function () { writeStored('en'); });
    wrap.appendChild(ja); wrap.appendChild(en);
    return wrap;
  }

  // Prefer mounting the switch INSIDE an existing header/nav so it never overlaps
  // page content or a top-right link. Ordered from most- to least-specific across
  // the public surfaces; the first present container wins.
  var MOUNT_ANCHORS = [
    '.header-cta',        // index.html desktop header
    '.p-header-right',    // portal-v2 header (right cluster)
    '.blog-nav',          // blog.html / article.html header nav
    '.rv-header',         // reviews.html header
    '.lg-header',         // privacy.html / terms.html header
    'header',             // any other page header
    'footer',             // last container fallback (e.g. login-v2 has no header)
  ];

  function mountSwitch() {
    injectCss();
    var mounted = false;
    for (var i = 0; i < MOUNT_ANCHORS.length; i++) {
      var host = document.querySelector(MOUNT_ANCHORS[i]);
      if (host && !host.querySelector('.hm-pub-lang')) { host.appendChild(switchEl()); mounted = true; break; }
    }
    // Mobile nav list (index) — independent secondary mount.
    var mnav = document.getElementById('mobileNav');
    if (mnav && !mnav.querySelector('.hm-pub-lang')) {
      var li = document.createElement('li'); li.appendChild(switchEl()); mnav.appendChild(li); mounted = true;
    }
    // True last resort (no header/footer at all): pin BOTTOM-LEFT so it can never
    // overlap a top-right back/nav link.
    if (!mounted && !document.querySelector('.hm-pub-lang')) {
      var f = switchEl();
      f.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:99999;background:#fff';
      document.body.appendChild(f);
    }
  }

  /* ── Public API ────────────────────────────────────────────────────────── */
  var PubI18n = window.PubI18n = {
    KEY: KEY, DEFAULT: DEFAULT, SUPPORTED: SUPPORTED,
    get: function () { return _lang; },
    // For JS-rendered strings: pt('日本語') → English (if active) else Japanese.
    t: function (ja) { return translate(dict(), ja, _lang); },
    set: function (lang) {                       // programmatic switch (navigates)
      lang = normalize(lang) || DEFAULT; writeStored(lang);
      location.href = switchHref(location, lang);
    },
    apply: applyAll,
    // expose pure helpers for reuse/testing
    _decide: decide, _switchHref: switchHref, _translate: translate, _tagToLang: tagToLang,
  };
  window.pt = PubI18n.t;

  function boot() {
    mountSwitch();
    if (_lang === 'en') { applyAll(); startObserver(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
