'use strict';

/* ════════════════════════════════════════════════════════
   AUTOMATION SCHEDULER — Phase 24
   Fires registered callbacks every 5 minutes so the engine
   can evaluate time-based rules without page reloads.
   ════════════════════════════════════════════════════════ */

window.AutomationScheduler = (function () {

  var _timer     = null;
  var _callbacks = [];
  var INTERVAL   = 5 * 60 * 1000; // 5 minutes

  function start() {
    if (_timer) return;
    _timer = setInterval(function () {
      _callbacks.forEach(function (fn) { try { fn(); } catch (_) {} });
    }, INTERVAL);
  }

  function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
  }

  /* Register a callback to fire on each tick. */
  function onTick(fn) { _callbacks.push(fn); }

  /* Immediately invoke all tick callbacks (used by "Run Now" button). */
  function runNow() {
    _callbacks.forEach(function (fn) { try { fn(); } catch (_) {} });
  }

  function isRunning() { return !!_timer; }

  return { start: start, stop: stop, onTick: onTick, runNow: runNow, isRunning: isRunning };

})();
