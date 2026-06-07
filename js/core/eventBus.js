'use strict';

/* ── EventBus — typed document event wrapper ──
   Thin wrapper over CustomEvent so callers don't hand-spell event names.
   Existing code that uses document.dispatchEvent / document.addEventListener
   directly continues to work unchanged — EventBus is additive.
*/
window.EventBus = (function () {
  const _listeners = {};

  return {
    on(event, fn) {
      document.addEventListener(event, fn);
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(fn);
    },

    off(event, fn) {
      document.removeEventListener(event, fn);
      if (_listeners[event]) _listeners[event] = _listeners[event].filter(f => f !== fn);
    },

    emit(event, detail) {
      document.dispatchEvent(new CustomEvent(event, { detail }));
    },

    /* Remove all listeners registered through EventBus for a given event */
    clear(event) {
      (_listeners[event] || []).forEach(fn => document.removeEventListener(event, fn));
      delete _listeners[event];
    },
  };
})();
