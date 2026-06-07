'use strict';

/* ════════════════════════════════════════════════════════
   DASHBOARD LAYOUT — Phase 21A
   Persists widget visibility and order to localStorage.
   Does NOT touch rendering — storage + API layer only.
   ════════════════════════════════════════════════════════ */

window.DashboardLayout = (function () {

  var STORAGE_KEY = 'hm_dashboard_layout';
  var VERSION     = 1;

  /* Canonical widget list in default render order.
     'elementId' is the DOM container each widget renders into — stored here
     so future render phases can resolve layout → DOM without extra mapping. */
  var DEFAULT_WIDGETS = [
    { id: 'stats',          elementId: 'statGrid',          visible: true, order:  1 },
    { id: 'quick-actions',  elementId: 'qaGrid',            visible: true, order:  2 },
    { id: 'observability',  elementId: 'obsPanel',          visible: true, order:  3 },
    { id: 'bi-revenue',     elementId: 'biRevenuePanel',    visible: true, order:  4 },
    { id: 'bi-trend',       elementId: 'biTrendPanel',      visible: true, order:  5 },
    { id: 'bi-service',     elementId: 'biServicePanel',    visible: true, order:  6 },
    { id: 'bi-customer',    elementId: 'biCustomerPanel',   visible: true, order:  7 },
    { id: 'bi-operational', elementId: 'biOperationalPanel',visible: true, order:  8 },
    { id: 'bi-export',      elementId: 'biExportPanel',     visible: true, order:  9 },
    { id: 'recent-bookings',elementId: 'recentWrap',        visible: true, order: 10 },
    { id: 'activity',       elementId: 'activityWrap',      visible: true, order: 11 },
  ];

  /* Deep-clone the default layout (never hand out a mutable reference). */
  function _defaultLayout() {
    return {
      version: VERSION,
      widgets: DEFAULT_WIDGETS.map(function (w) {
        return { id: w.id, elementId: w.elementId, visible: w.visible, order: w.order };
      }),
    };
  }

  /* ── Public API ── */

  /* Returns the persisted layout, or the default if none / version mismatch. */
  function get() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return _defaultLayout();
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== VERSION || !Array.isArray(parsed.widgets)) {
        return _defaultLayout();
      }
      return parsed;
    } catch (_) {
      return _defaultLayout();
    }
  }

  /* Persists the given layout object. */
  function save(layout) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch (_) {
      /* Silently ignore write failures (quota / private-browsing). */
    }
  }

  /* Resets to the default layout, persists it, and returns it. */
  function reset() {
    var layout = _defaultLayout();
    save(layout);
    return layout;
  }

  /* Returns widget IDs sorted by their current order value. */
  function getWidgetOrder() {
    return get().widgets
      .slice()
      .sort(function (a, b) { return a.order - b.order; })
      .map(function (w) { return w.id; });
  }

  /* Accepts an array of widget IDs and updates their order to match,
     then persists the result. Returns the updated layout. */
  function setWidgetOrder(ids) {
    var layout = get();
    ids.forEach(function (id, index) {
      var widget = layout.widgets.find(function (w) { return w.id === id; });
      if (widget) widget.order = index + 1;
    });
    save(layout);
    return layout;
  }

  return {
    get:            get,
    save:           save,
    reset:          reset,
    getWidgetOrder: getWidgetOrder,
    setWidgetOrder: setWidgetOrder,
  };

}());
