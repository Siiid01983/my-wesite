/* ════════════════════════════════════════════════════════════════════════════
   diagnostics.js — window.HMDiagnostics

   Centralized, dependency-free failure recorder. Captures the four failure
   classes the system actually cares about — API, upload, auth, storage — plus
   uncaught errors and unhandled promise rejections. It NEVER throws and has no
   dependencies, so every other module can call it defensively:

       if (window.HMDiagnostics) window.HMDiagnostics.record('upload', {...});

   Storage: an in-memory ring buffer (fast, survives the page) mirrored to
   localStorage 'hm_diag_log' (survives reload, capped). Read it from the admin
   console with  HMDiagnostics.getReport()  or render it anywhere.

   Load order: as early as possible (before apiClient.js ideally) so global
   error hooks are installed before other scripts can fail. Safe to load late.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.HMDiagnostics) return;   // idempotent — never double-install

  var LS_KEY   = 'hm_diag_log';
  var MAX_MEM  = 200;                 // ring-buffer entries kept in memory
  var MAX_LS   = 50;                  // entries persisted to localStorage
  var CATS     = ['api', 'upload', 'auth', 'storage', 'sw', 'error', 'rejection'];

  var _buf = [];                      // newest-first
  var _counts = {};                   // category → count (since load)
  CATS.forEach(function (c) { _counts[c] = 0; });

  function _persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(_buf.slice(0, MAX_LS))); }
    catch (_) { /* quota — keep memory copy only */ }
  }

  function _hydrate() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) _buf = arr.slice(0, MAX_MEM);
    } catch (_) { /* ignore corrupt cache */ }
  }

  function record(category, detail) {
    try {
      var cat = (CATS.indexOf(category) >= 0) ? category : 'error';
      var entry = {
        ts:   new Date().toISOString(),
        cat:  cat,
        page: (location && location.pathname) || '',
        detail: (detail && typeof detail === 'object') ? detail : { message: String(detail == null ? '' : detail) },
      };
      _buf.unshift(entry);
      if (_buf.length > MAX_MEM) _buf.length = MAX_MEM;
      _counts[cat] = (_counts[cat] || 0) + 1;
      _persist();
      try {
        document.dispatchEvent(new CustomEvent('hm:diagnostic', { detail: entry }));
      } catch (_) { /* no DOM event support — fine */ }
    } catch (_) { /* a diagnostics failure must never break the caller */ }
    return null;
  }

  function getLog()     { return _buf.slice(); }
  function getCounts()  { return Object.assign({}, _counts); }
  function clear()      { _buf = []; CATS.forEach(function (c) { _counts[c] = 0; }); try { localStorage.removeItem(LS_KEY); } catch (_) {} }

  // A compact, human-readable snapshot for the admin console / health view.
  function getReport() {
    return {
      ts:      new Date().toISOString(),
      page:    (location && location.pathname) || '',
      apiBase: window.API_BASE || null,
      online:  (typeof navigator !== 'undefined') ? navigator.onLine : null,
      counts:  getCounts(),
      total:   _buf.length,
      recent:  _buf.slice(0, 20),
    };
  }

  /* ── Global capture: uncaught errors + unhandled promise rejections ──────── */
  try {
    window.addEventListener('error', function (e) {
      // Resource load errors (e.target is an element) vs. script errors.
      if (e && e.target && e.target !== window && (e.target.src || e.target.href)) {
        record('error', { type: 'resource', url: e.target.src || e.target.href });
      } else if (e) {
        record('error', { type: 'script', message: e.message, src: e.filename, line: e.lineno });
      }
    }, true);

    window.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason;
      record('rejection', { message: (r && (r.message || r)) ? String(r.message || r) : 'unhandled rejection' });
    });

    // Service-worker controller changes / failures (admin pages register one).
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('error', function () { record('sw', { message: 'service worker error' }); });
    }
  } catch (_) { /* listener install failed — diagnostics still works manually */ }

  _hydrate();

  window.HMDiagnostics = {
    record:    record,
    getLog:    getLog,
    getCounts: getCounts,
    getReport: getReport,
    clear:     clear,
    CATEGORIES: CATS.slice(),
  };
})();
