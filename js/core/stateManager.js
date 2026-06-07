'use strict';

/* ── StateManager — lightweight reactive state container ──
   Centralises ephemeral UI state that currently lives in scattered
   module-level vars (e.g. _biTrendPeriod, _pricingActiveIdx, _bulkMode).
   Existing module code continues to use its own variables unchanged;
   StateManager is available for new code that opts in.

   Usage:
     AdminState.set('key', value)
     AdminState.get('key', defaultValue)
     AdminState.subscribe('key', fn)   // fn(newValue, oldValue)
     AdminState.unsubscribe('key', fn)
*/
window.AdminState = (function () {
  const _state = {};
  const _subs  = {};

  return {
    get(key, fallback) {
      return key in _state ? _state[key] : fallback;
    },

    set(key, value) {
      const prev = _state[key];
      _state[key] = value;
      (_subs[key] || []).forEach(fn => { try { fn(value, prev); } catch(e) {} });
    },

    subscribe(key, fn) {
      if (!_subs[key]) _subs[key] = [];
      _subs[key].push(fn);
    },

    unsubscribe(key, fn) {
      if (_subs[key]) _subs[key] = _subs[key].filter(f => f !== fn);
    },

    snapshot() {
      return { ..._state };
    },
  };
})();
