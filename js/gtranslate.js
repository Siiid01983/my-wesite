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

  /* HEADER mount points, one per public page type (first match wins). The control
     lives in the same header slot as the Estimate CTA so it visually belongs to the
     Hello Moving header. It is a single, compact circular button that shares the
     Estimate button's gold identity — it does NOT add a wide item, so it fits beside
     the Estimate button on mobile (≥360px) without clipping the wordmark. */
  var MOUNTS = [
    '.header-cta',      // index.html — the Estimate CTA slot (primary target)
    '.blog-nav',        // blog.html / article.html header nav
    '.lg-header',       // privacy / terms / cancellation-policy header
    '.rv-header',       // reviews.html header
    '.p-header-right',  // portal-v2.html header
    '.lv2-card',        // login-v2.html — centered auth card (no header bar)
  ];

  /* Nodes Google must leave verbatim while translating:
       • the brand wordmark — Google rewrote "Hello Moving" to "Hello", and a
         brand name must never be translated;
       • customer-data display nodes. Logic never reads these, so that part is
         presentation hygiene rather than a correctness fix. */
  var NO_TX = '.brand-name, .brand-sub, .lg-brand, .ba-hdr-logo, .rv-brand,' +
              ' .ba-val, .ba-ref-num, .ba-review-table, .pchat-bubble, .hmcc-b,' +
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
      /* Our control — a compact, circular header button styled to match the Estimate
         button: same brand gold gradient, same dark ink (#0C0E0B), same font stack
         (inherited) and weight 600. It lives inline in the header's flex row and
         picks up that row's gap for spacing, so no header layout is redesigned and
         the Estimate button itself is untouched. A fixed 38px circle keeps it small
         enough to sit beside the Estimate button on a 360px header without overflow.
         The circular shape is intentional — we do NOT force Google's later widget
         into a pill. */
      '.hm-gt{display:inline-flex;align-items:center;vertical-align:middle;line-height:1;white-space:nowrap}' +
      '.hm-gt button.hm-gt-btn{display:inline-flex;align-items:center;justify-content:center;' +
        'width:38px;height:38px;padding:0;border:1px solid transparent;' +
        'background:linear-gradient(180deg,#FFB23E,#F5A623);color:#0C0E0B !important;font-family:inherit;' +
        'font-size:13px;font-weight:600;letter-spacing:.02em;line-height:1;text-align:center;' +
        'border-radius:999px;cursor:pointer;white-space:nowrap;flex:0 0 auto}' +
      '.hm-gt button.hm-gt-btn:hover{filter:brightness(1.05)}' +
      /* Keep it small on the tightest phones so brand + Estimate + control + menu
         never overflow the header row. */
      '@media (max-width:400px){.hm-gt button.hm-gt-btn{width:34px;height:34px;font-size:12px}}' +
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
         header instead of Google's default white chip. */
      '.hm-gt-widget .goog-te-gadget{font-family:inherit !important;font-size:12px !important;' +
        'color:inherit !important;line-height:1 !important}' +
      '.hm-gt-widget .goog-te-gadget-simple{background:linear-gradient(180deg,#FFB23E,#F5A623) !important;' +
        'border:1px solid transparent !important;border-radius:999px !important;' +
        'padding:6px 11px !important;font-size:12px !important;font-weight:600 !important;' +
        'letter-spacing:.04em !important;line-height:1 !important;white-space:nowrap !important;' +
        /* Google's label wraps onto two lines (「英語」 then ▼). The wrapper box is
           already centred in the circle, but the lines default to text-align:start,
           which leaves the ▼ hanging to the left. text-align inherits, so centring
           it here centres both lines — no override of Google's own rules needed. */
        'color:#0C0E0B !important;display:inline-flex;align-items:center;' +
        'justify-content:center;text-align:center !important;gap:4px}' +
      '.hm-gt-widget .goog-te-gadget-simple:hover{filter:brightness(1.05)}' +
      '.hm-gt-widget .goog-te-gadget-simple *{color:#0C0E0B !important;font-size:12px !important;' +
        'font-weight:600 !important;white-space:nowrap !important}' +
      /* Google's spacer image renders as a stray gap on a dark background. */
      '.hm-gt-widget img.goog-te-gadget-icon{display:none !important}' +
      /* Google renders <font> wrappers around translated text; keep them inline. */
      'font{background:transparent !important;box-shadow:none !important}' +
      /* TRANSLATED VIEW ONLY (html.translated-ltr / -rtl, which Google sets when a
         translation is active). Japanese renders without these classes, so the
         Japanese layout is bit-for-bit untouched.
         The sticky CTA labels are `white-space:nowrap` in equal thirds, which fits
         the short Japanese wording but lets longer translated labels (e.g. "Get a
         free quote now" = 139px in a 114px button) spill past the button edge and
         clip. Allow those labels to wrap instead. */
      'html.translated-ltr .sticky-btn span,html.translated-rtl .sticky-btn span{' +
        'white-space:normal !important;line-height:1.15;text-align:center;overflow-wrap:anywhere}' +
      'html.translated-ltr .sticky-btn,html.translated-rtl .sticky-btn{' +
        'text-align:center;padding-left:4px !important;padding-right:4px !important}' +
      '@media (max-width:400px){' +
      ' html.translated-ltr .sticky-btn,html.translated-rtl .sticky-btn{font-size:11px !important}' +
      '}';
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
        /* Expose ONLY these languages. 'ja' (the source) is listed first so the
           visitor can always revert to the Japanese original; the remaining 13 are
           the approved target languages, in the approved order. No other Google
           language is offered. Google renders the final dropdown order itself — we
           do not fight its DOM to reorder it. */
        includedLanguages: 'ja,en,zh-CN,zh-TW,ko,vi,ne,tl,pt,id,es,fr,ar,hi',
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
    // Trigger glyph: the "文A" translate mark (dark ink on the gold button, matching
    // the Estimate CTA). A colour emoji was avoided — it ignores `color` and would
    // render its own blue globe instead of the brand ink.
    wrap.innerHTML = '<button type="button" class="hm-gt-btn" ' +
        'title="Translate this page / このページを翻訳" ' +
        'aria-label="Translate this page / このページを翻訳">文A</button>' +
      '<span class="hm-gt-widget" id="hm-gt-widget"></span>';
    wrap.querySelector('.hm-gt-btn').addEventListener('click', load);
    host.appendChild(wrap);
  }

  clearGoogleTranslateState();   // strict Japanese-first, before Google can act
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
