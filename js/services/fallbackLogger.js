// Load order: js/config/appConfig.js → this file
(function () {
  'use strict';

  const STORAGE_KEY = 'hm_fallback_log';
  const MAX_ENTRIES = 50;

  function _load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  }

  function _save(entries) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* no-op */ }
  }

  window.FallbackLogger = {
    log(operation, table, error, success) {
      const cfg = window.HM_CONFIG || {};
      if (!cfg.LOG_FALLBACK) return;
      const entries = _load();
      entries.unshift({
        ts: new Date().toISOString(),
        operation,
        table,
        error: error ? String(error) : null,
        success: !!success
      });
      _save(entries.slice(0, MAX_ENTRIES));
    },

    getAll() { return _load(); },

    clear() { _save([]); }
  };
})();
