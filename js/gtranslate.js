/* ════════════════════════════════════════════════════════════════════════════
   js/gtranslate.js — small, opt-in Google Translate control (public site).

   Replaces the previous custom English overlay (locales/public.en.js +
   js/i18n/publicI18n.js), which auto-selected English from the browser language.

   MODEL
     • Japanese is ALWAYS the source page. Nothing here inspects
       navigator.language / navigator.languages, and no language preference is
       stored or restored. A visitor with an English browser gets the Japanese
       page, exactly like everyone else.
     • Translation is strictly OPT-IN: nothing from Google is requested until the
       visitor presses the control. Until then this file costs one small script
       and renders one button.
     • Google supplies English and every other language — we ship no translations.

   WHY THE IN-PAGE WIDGET (translate_a/element.js) RATHER THAN A LINK TO
   translate.goog:  the hosted proxy would move the visitor onto Google's domain,
   where the booking overlay's POSTs to /hm-api are unreliable. The in-page widget
   keeps the customer on hello-moving.com so booking, portal and chat keep working.

   BUSINESS-LOGIC SAFETY — verified before adopting this approach:
     Google Translate rewrites TEXT NODES only. It does not touch attributes, JS
     variables, form values or config objects. The booking payload is built
     entirely from `baState` / JS config maps / [data-service] attributes, and no
     code reads DOM text back into logic. Service routing, prices, status enums,
     _packNotes tokens, API payloads, auth and chat IDs are therefore unaffected.
     `markNoTranslate()` below is defence-in-depth for customer-data display nodes.

   Loading notes verified against this site:
     • No CSP is set, so no policy change is required.
     • sw.js does not intercept either Google host: translate.googleapis.com hits
       the explicit `.googleapis.com` network-only branch, and translate.google.com
       falls through (the final branch is same-origin only).
     • Google's injected top banner / body offset are suppressed, so translating
       causes no toolbar and no layout shift.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SRC = 'https://translate.google.com/translate_a/element.js?cb=hmGtReady';
  var _loading = false;

  /* Marks "this visitor opened the translator in THIS TAB". It stores no language
     — only whether a translation is in progress right now — so it does not
     recreate the removed language-preference system. Session-scoped, so a new
     visit always starts from the Japanese source. */
  var SESSION_KEY = 'hm_gt_session';

  /* STRICT JAPANESE-FIRST.
     Google persists an explicit choice in the `googtrans` cookie, which would
     otherwise translate the page automatically on the visitor's next visit. We
     expire that cookie at boot so every fresh page load starts from the Japanese
     source. We do NOT clear it once the visitor has opened the translator in this
     tab, so their explicit in-session choice survives any reload Google performs.
     The cookie is written across several domain scopes, so expire each of them. */
  function clearGoogleTranslateState() {
    try { if (sessionStorage.getItem(SESSION_KEY)) return; } catch (_) {}
    var host = location.hostname || '';
    var scopes = ['', host, '.' + host];
    var parts = host.split('.');
    if (parts.length > 2) scopes.push('.' + parts.slice(-2).join('.'));   // e.g. .hello-moving.com
    scopes.forEach(function (d) {
      try {
        document.cookie = 'googtrans=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/' +
          (d ? ';domain=' + d : '');
      } catch (_) {}
    });
    // Purge a stale key left by the removed custom English engine. Nothing reads
    // it any more; this just stops it lingering in returning visitors' storage.
    try { localStorage.removeItem('hm_pub_lang'); } catch (_) {}
  }

  /* Footer-only mount points. Deliberately NEVER the header: an earlier in-header
     language control added a 4th item to .header-cta and clipped the wordmark on
     mobile. The footer cannot overlap the logo, hero, CTAs or the sticky bar. */
  var MOUNTS = [
    '.hm-ft__bottom-inner', // index.html footer bottom row
    '.lg-footer',           // privacy / terms / cancellation-policy
    '.blog-footer__inner',  // blog / article
    '.lv2-pagefoot',        // login-v2
    'footer',               // any other public page
  ];

  /* Customer-data display nodes: keep them verbatim even while translating. Logic
     never reads these, so this is presentation hygiene, not a correctness fix. */
  var NO_TX = '.ba-val, .ba-ref-num, .ba-review-table, .pchat-bubble, .hmcc-b,' +
              ' .pv2-bubble, .pv2-msg-list, .pv2-ref, [data-noi18n]';

  function markNoTranslate(root) {
    try {
      (root || document).querySelectorAll(NO_TX).forEach(function (el) {
        el.classList.add('notranslate');
        el.setAttribute('translate', 'no');
      });
    } catch (_) {}
  }

  function injectCss() {
    if (document.getElementById('hm-gt-css')) return;
    var css =
      /* Our control — compact, inherits the surrounding footer type. */
      '.hm-gt{display:flex;justify-content:center;align-items:center;gap:6px;flex:0 0 100%;width:100%;margin:10px 0 0;white-space:nowrap}' +
      '.hm-gt-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid currentColor;' +
        'background:transparent;color:inherit;font:inherit;font-size:12px;line-height:1;' +
        'padding:6px 11px;border-radius:999px;cursor:pointer;opacity:.75;white-space:nowrap}' +
      '.hm-gt-btn:hover{opacity:1}' +
      '.hm-gt-widget{display:none}' +
      '.hm-gt.is-on .hm-gt-btn{display:none}' +
      '.hm-gt.is-on .hm-gt-widget{display:inline-flex;align-items:center}' +
      /* Suppress Google's injected chrome: the top banner iframe and the body
         offset it applies are what would otherwise shift the whole layout. */
      '.goog-te-banner-frame,.goog-te-balloon-frame,#goog-gt-tt{display:none !important}' +
      'body{top:0 !important;position:static !important}' +
      '.skiptranslate>iframe{display:none !important;height:0 !important}' +
      /* Google's InlineLayout.SIMPLE renders .goog-te-gadget-simple (an anchor,
         not a <select>). Restyle that one element to match the surrounding
         footer instead of Google's default white chip. */
      '.hm-gt-widget .goog-te-gadget{font-family:inherit !important;font-size:12px !important;' +
        'color:inherit !important;line-height:1 !important}' +
      '.hm-gt-widget .goog-te-gadget-simple{background:transparent !important;' +
        'border:1px solid currentColor !important;border-radius:999px !important;' +
        'padding:6px 11px !important;font-size:12px !important;line-height:1 !important;white-space:nowrap !important;' +
        'color:inherit !important;opacity:.75;display:inline-flex;align-items:center;gap:4px}' +
      '.hm-gt-widget .goog-te-gadget-simple:hover{opacity:1}' +
      '.hm-gt-widget .goog-te-gadget-simple *{color:inherit !important;font-size:12px !important;white-space:nowrap !important}' +
      /* Google's spacer image renders as a stray gap on a dark background. */
      '.hm-gt-widget img.goog-te-gadget-icon{display:none !important}' +
      /* Google renders <font> wrappers around translated text; keep them inline. */
      'font{background:transparent !important;box-shadow:none !important}';
    var s = document.createElement('style'); s.id = 'hm-gt-css'; s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  /* Google calls this once element.js has loaded. */
  window.hmGtReady = function () {
    try {
      new google.translate.TranslateElement({
        pageLanguage: 'ja',
        autoDisplay: false,               // never translate without an explicit choice
        layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
      }, 'hm-gt-widget');
      var wrap = document.querySelector('.hm-gt');
      if (wrap) wrap.classList.add('is-on');
      markNoTranslate();                  // re-mark: Google may have rebuilt nodes
    } catch (_) { /* leave the button in place so the visitor can retry */ }
  };

  function load() {
    if (_loading) return; _loading = true;
    // From here on this tab is mid-translation: stop clearing Google's state so
    // the visitor's explicit choice survives reloads for the rest of the session.
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (_) {}
    markNoTranslate();
    var s = document.createElement('script');
    s.src = SRC; s.async = true;
    s.onerror = function () { _loading = false; };
    document.head.appendChild(s);
  }

  function mount() {
    if (document.querySelector('.hm-gt')) return;
    var host = null;
    for (var i = 0; i < MOUNTS.length && !host; i++) host = document.querySelector(MOUNTS[i]);
    if (!host) return;                    // no footer on this page → no control

    injectCss();
    var wrap = document.createElement('span');
    wrap.className = 'hm-gt';
    // Google's widget must live in an element with this id.
    wrap.innerHTML = '<button type="button" class="hm-gt-btn" ' +
        'aria-label="Translate this page / このページを翻訳">🌐 Translate</button>' +
      '<span class="hm-gt-widget" id="hm-gt-widget"></span>';
    wrap.querySelector('.hm-gt-btn').addEventListener('click', load);
    host.appendChild(wrap);
  }

  clearGoogleTranslateState();   // strict Japanese-first, before Google can act
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
