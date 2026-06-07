'use strict';

/* ── Storage Utilities ──
   Type-safe localStorage helpers with graceful fallback.
   All existing code continues to use localStorage directly;
   these helpers are available for new code.
*/
window.Storage = (function () {
  function _get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch(e) { return fallback; }
  }

  function _set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch(e) { return false; }
  }

  function _remove(key) {
    try { localStorage.removeItem(key); return true; }
    catch(e) { return false; }
  }

  function _keys(prefix) {
    const result = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!prefix || k.startsWith(prefix)) result.push(k);
    }
    return result;
  }

  return {
    get: _get,
    set: _set,
    remove: _remove,
    /* Returns all localStorage keys with optional prefix filter */
    keys: _keys,
    /* Read a JSON array, return empty array on failure */
    getArray(key) { const v = _get(key, []); return Array.isArray(v) ? v : []; },
    /* Append an item to a JSON array, capped at maxLen entries */
    pushToArray(key, item, maxLen = 50) {
      const arr = this.getArray(key);
      arr.unshift(item);
      if (maxLen && arr.length > maxLen) arr.length = maxLen;
      _set(key, arr);
    },
  };
})();
