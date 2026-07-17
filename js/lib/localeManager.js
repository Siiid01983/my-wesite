/* ════════════════════════════════════════════════════════════════════════════
   localeManager.js — bilingual (JA/EN) UI engine for Ops + Admin.

   Additive & framework-free. Depends on window.LOCALES.{ja,en} (locales/*.js
   loaded first). Exposes:

     window.Locale = { get, set, t, apply, onChange, switchHtml, bindSwitch }
     window.t(key, params)                                   // shortcut

   Model:
     • Language is stored in localStorage['hm_lang']; DEFAULT = 'ja'.
     • t('a.b', {n:3}) → LOCALES[lang]['a.b'] with {n}→3; fallback en→ja→key,
       so nothing ever renders blank.
     • JS-rendered UIs call t() at render time (Ops modules, admin JS).
     • Static HTML uses data-i18n / data-i18n-attr; Locale.apply() fills them.
     • set() persists then reloads → a clean, fully-consistent re-render (all page
       state already lives in localStorage / URL). No half-translated screens.

   Translates ONLY UI chrome. Customer data, messages, booking notes, and stored
   DB values are never passed through t(). No API / DB / booking-engine coupling.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var KEY = 'hm_lang', DEFAULT = 'ja', SUPPORTED = ['ja', 'en'];
  var listeners = [];

  function read() {
    try { var v = localStorage.getItem(KEY); return SUPPORTED.indexOf(v) >= 0 ? v : DEFAULT; }
    catch (_) { return DEFAULT; }
  }

  var Locale = (window.Locale = {
    DEFAULT: DEFAULT,
    SUPPORTED: SUPPORTED,

    get: function () { return read(); },

    set: function (lang) {
      if (SUPPORTED.indexOf(lang) < 0) lang = DEFAULT;
      if (lang === read()) return;
      try { localStorage.setItem(KEY, lang); } catch (_) {}
      listeners.forEach(function (fn) { try { fn(lang); } catch (_) {} });
      // Reload so every render()/apply() re-runs in the new language.
      try { location.reload(); } catch (_) {}
    },

    /* Translate one key. Missing → en→ja→key. {param} interpolation. */
    t: function (key, params) {
      var lang = read();
      var table = (window.LOCALES && window.LOCALES[lang]) || {};
      var s = table[key];
      if (s == null && lang !== 'ja') { var ja = (window.LOCALES && window.LOCALES.ja) || {}; s = ja[key]; }
      if (s == null) s = key;                              // never blank
      if (params) {
        s = String(s).replace(/\{(\w+)\}/g, function (m, k) { return params[k] != null ? params[k] : m; });
      }
      return s;
    },

    /* Fill static markup: <el data-i18n="key"> textContent, and
       <el data-i18n-attr="placeholder:key,aria-label:key"> attributes.
       <body data-i18n-title="key"> sets document.title. Sets <html lang>. */
    apply: function (root) {
      root = root || document;
      var t = Locale.t;
      var nodes = root.querySelectorAll ? root.querySelectorAll('[data-i18n]') : [];
      Array.prototype.forEach.call(nodes, function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
      var attrs = root.querySelectorAll ? root.querySelectorAll('[data-i18n-attr]') : [];
      Array.prototype.forEach.call(attrs, function (el) {
        (el.getAttribute('data-i18n-attr') || '').split(',').forEach(function (pair) {
          var i = pair.indexOf(':'); if (i < 0) return;
          el.setAttribute(pair.slice(0, i).trim(), t(pair.slice(i + 1).trim()));
        });
      });
      try { document.documentElement.lang = read(); } catch (_) {}
      try {
        var tk = document.body && document.body.getAttribute('data-i18n-title');
        if (tk) document.title = t(tk);
      } catch (_) {}
    },

    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },

    /* Segmented JA/EN control markup (caller places it; bindSwitch wires clicks). */
    switchHtml: function (extraClass) {
      var cur = read();
      return '<div class="hm-lang ' + (extraClass || '') + '">' +
        '<button type="button" data-lang="ja" class="' + (cur === 'ja' ? 'on' : '') + '">日本語</button>' +
        '<button type="button" data-lang="en" class="' + (cur === 'en' ? 'on' : '') + '">EN</button>' +
      '</div>';
    },
    bindSwitch: function (root) {
      var nodes = (root || document).querySelectorAll('[data-lang]');
      Array.prototype.forEach.call(nodes, function (b) {
        if (b.__hmLangBound) return; b.__hmLangBound = true;
        b.addEventListener('click', function () { Locale.set(b.getAttribute('data-lang')); });
      });
    },
  });

  window.t = function (k, p) { return Locale.t(k, p); };

  /* Minimal self-contained styles for the switch (works on Ops + Admin without
     touching either stylesheet). Injected once. */
  function injectCss() {
    if (document.getElementById('hm-lang-css')) return;
    var css =
      '.hm-lang{display:inline-flex;border:1px solid rgba(255,255,255,.35);border-radius:999px;overflow:hidden;font-size:.72rem;font-weight:700;line-height:1}' +
      '.hm-lang button{appearance:none;border:none;background:transparent;color:inherit;padding:5px 9px;cursor:pointer;font:inherit;opacity:.7}' +
      '.hm-lang button.on{background:rgba(255,255,255,.9);color:#2C3626;opacity:1}' +
      '.hm-lang.dark{border-color:#d8dad4}.hm-lang.dark button{color:#2C3626}.hm-lang.dark button.on{background:#9AB57A;color:#fff}';
    var s = document.createElement('style'); s.id = 'hm-lang-css'; s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  /* Boot: style + translate static markup + wire any static switch. */
  function boot() { injectCss(); Locale.apply(document); Locale.bindSwitch(document); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
