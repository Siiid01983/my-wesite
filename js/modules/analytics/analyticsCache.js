'use strict';
/* ════════════════════════════════════════════════════════
   ANALYTICS CACHE — Phase 23E
   Browser-side TTL cache for analytics computation results.
   Storage key: hm_analytics_cache
   Default TTL: 5 minutes (300 000 ms)
   Invalidated automatically on booking:created / booking:updated.
   ════════════════════════════════════════════════════════ */
(function () {

  var KEY = 'hm_analytics_cache';
  var DEFAULT_TTL = 5 * 60 * 1000;

  function _load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; }
    catch (_) { return {}; }
  }

  function _save(store) {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (_) {}
  }

  function get(key) {
    var store = _load();
    var entry = store[key];
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      delete store[key]; _save(store);
      return null;
    }
    return entry.data;
  }

  function set(key, data, ttl) {
    var store = _load();
    store[key] = { data: data, expiry: Date.now() + (ttl || DEFAULT_TTL) };
    _save(store);
  }

  function invalidate(key) {
    var store = _load();
    if (key) { delete store[key]; _save(store); }
    else { localStorage.removeItem(KEY); }
  }

  function clear() { localStorage.removeItem(KEY); }

  /* Invalidate on booking changes so stale computations aren't served */
  document.addEventListener('booking:created',  function () { invalidate(); });
  document.addEventListener('booking:updated',  function () { invalidate(); });
  document.addEventListener('booking:cancelled',function () { invalidate(); });

  window.AnalyticsCache = { get: get, set: set, invalidate: invalidate, clear: clear };
})();
