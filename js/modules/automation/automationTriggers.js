'use strict';

/* ════════════════════════════════════════════════════════
   AUTOMATION TRIGGERS — Phase 24
   Hooks into EventBus events and wires them to engine runs.
   Call init() once after AutomationEngine is ready.
   ════════════════════════════════════════════════════════ */

window.AutomationTriggers = (function () {

  var _handlers = {};

  function on(triggerId, fn) {
    if (!_handlers[triggerId]) _handlers[triggerId] = [];
    _handlers[triggerId].push(fn);
  }

  async function fire(triggerId, context) {
    var fns = _handlers[triggerId] || [];
    for (var i = 0; i < fns.length; i++) {
      try { await fns[i](context || {}); } catch (_) {}
    }
  }

  function init() {
    if (!window.EventBus) return;

    EventBus.on('booking:updated', function (e) {
      var booking = e.detail && e.detail.booking;
      if (!booking) return;
      fire('booking_updated', { booking: booking });
      if (booking.status === '完了') fire('booking_completed', { booking: booking });
    });

    EventBus.on('booking:created', function (e) {
      fire('booking_created', { booking: e.detail && e.detail.booking });
    });

    EventBus.on('quote:created', function (e) {
      fire('quote_created', { quote: e.detail && e.detail.quote });
    });

    /* Re-run all schedule rules whenever a booking or quote changes,
       in case a new entity now satisfies an existing rule today. */
    on('booking_completed', function () {
      if (window.AutomationEngine) AutomationEngine.run();
    });
    on('booking_created', function () {
      if (window.AutomationEngine) AutomationEngine.run();
    });
    on('quote_created', function () {
      if (window.AutomationEngine) AutomationEngine.run();
    });
  }

  return { on: on, fire: fire, init: init };

})();
