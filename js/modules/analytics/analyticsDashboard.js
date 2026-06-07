'use strict';
/* ════════════════════════════════════════════════════════
   ANALYTICS DASHBOARD — Phase 23E
   高度分析 — dedicated advanced analytics page.

   Responsibilities:
     1. Patch VIEW_TITLES with 'analytics-advanced'
     2. Register all five analytics widgets via AnalyticsWidgets.register()
     3. Wrap go() to call _render() when view is analytics-advanced
     4. Render tabbed dashboard: 売上 | サービス | 顧客 | 転換率 | トレンド
     5. Provide per-tab export buttons (CSV via AnalyticsExport)

   Depends on: all analytics modules, AnalyticsWidgets, AnalyticsExport
   ════════════════════════════════════════════════════════ */
(function () {

  /* ── 1. Extend VIEW_TITLES ── */
  if (window.VIEW_TITLES) VIEW_TITLES['analytics-advanced'] = '高度分析';

  /* ── 2. Register all five widgets ── */
  (function _registerWidgets() {
    if (!window.AnalyticsWidgets) return;
    AnalyticsWidgets.register('revenueForecast', {
      label: '売上予測', icon: '📈',
      renderFn: function (id, bk) { window.RevenueForecast && RevenueForecast.render(id, bk); },
    });
    AnalyticsWidgets.register('serviceRanking', {
      label: '人気サービスランキング', icon: '⭐',
      renderFn: function (id, bk) { window.ServicePerformance && ServicePerformance.render(id, bk); },
    });
    AnalyticsWidgets.register('customerInsights', {
      label: '顧客分析', icon: '👥',
      renderFn: function (id, bk) { window.CustomerInsights && CustomerInsights.render(id, bk); },
    });
    AnalyticsWidgets.register('conversionFunnel', {
      label: 'コンバージョン分析', icon: '🎯',
      renderFn: function (id, bk, qt) { window.ConversionAnalytics && ConversionAnalytics.render(id, bk, qt); },
    });
    AnalyticsWidgets.register('bookingTrends', {
      label: '予約トレンド', icon: '📊',
      renderFn: function (id, bk) { window.BookingTrends && BookingTrends.render(id, bk); },
    });
  })();

  /* ── Tab state ── */
  var _tab = 'revenue';

  var _TABS = [
    { id: 'revenue',    label: '売上予測',    widget: 'revenueForecast',  exportFn: 'revenueForecast' },
    { id: 'services',   label: 'サービス',    widget: 'serviceRanking',   exportFn: 'serviceRankings' },
    { id: 'customers',  label: '顧客',        widget: 'customerInsights', exportFn: 'customerMetrics' },
    { id: 'conversion', label: '転換率',      widget: 'conversionFunnel', exportFn: null },
    { id: 'trends',     label: 'トレンド',    widget: 'bookingTrends',    exportFn: null },
  ];

  /* ── 3. Wrap go() ── */
  var _origGo = window.go;
  window.go = function (view) {
    _origGo(view);
    if (view === 'analytics-advanced') _render();
  };

  /* ── 4. Render the full page ── */
  function _render() {
    var el = document.getElementById('view-analytics-advanced');
    if (!el) return;

    var tabBtns = _TABS.map(function (t) {
      var active = t.id === _tab;
      return '<button class="bi-trend-btn' + (active ? ' active' : '') + '" ' +
        'style="padding:6px 14px;font-size:12px" ' +
        'onclick="AnalyticsDashboard.setTab(\'' + t.id + '\')">' + t.label + '</button>';
    }).join('');

    var curTab  = _TABS.find(function (t) { return t.id === _tab; }) || _TABS[0];
    var expBtn  = curTab.exportFn
      ? '<button class="btn btn-ghost btn-sm" onclick="AnalyticsExport.' + curTab.exportFn + '()">' +
        '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>CSV出力</button>'
      : '';

    el.innerHTML = [
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap">',
        '<div class="bi-trend-btns" style="flex:1;display:flex;gap:4px;flex-wrap:wrap">' + tabBtns + '</div>',
        '<div style="display:flex;gap:6px;flex-shrink:0">',
          expBtn,
          '<button class="btn btn-ghost btn-sm" onclick="AnalyticsDashboard.refresh()" title="キャッシュをクリアして再計算">',
            '↺ 更新',
          '</button>',
        '</div>',
      '</div>',
      '<div id="advDashPanel"></div>',
    ].join('');

    _renderTab();
  }

  /* ── 5. Render active tab's widget ── */
  function _renderTab() {
    var panel  = document.getElementById('advDashPanel');
    if (!panel) return;
    var curTab = _TABS.find(function (t) { return t.id === _tab; }) || _TABS[0];

    panel.innerHTML = '<div id="advWidgetHost"></div>';

    var bk = window.Adapter ? Adapter.getBookings() : [];
    var qt = window.Adapter ? Adapter.getQuotes()   : [];

    if (window.AnalyticsWidgets) {
      AnalyticsWidgets.renderWidget(curTab.widget, 'advWidgetHost', bk, qt);
    }
  }

  /* ── Public API ── */
  function setTab(tabId) {
    _tab = tabId;
    _render();
  }

  function refresh() {
    if (window.AnalyticsCache) AnalyticsCache.clear();
    if (window.toast) toast('キャッシュをクリアしました。再計算中…');
    _render();
    if (window.AuditLog) AuditLog.record('other', 'analytics', 'cache_clear', '高度分析キャッシュ クリア');
  }

  window.AnalyticsDashboard = { setTab: setTab, refresh: refresh };
})();
