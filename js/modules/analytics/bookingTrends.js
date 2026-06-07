'use strict';
/* ════════════════════════════════════════════════════════
   BOOKING TRENDS — Phase 23E
   予約トレンド

   Three trend horizons:
     daily   — last 14 days, compared to prior 14 days
     weekly  — last 12 weeks, compared to prior 12 weeks
     monthly — last 12 months, compared to prior 12 months

   Each horizon exposes: data[], growth%, trend direction.
   Peak detection: busiest DOW, busiest calendar month, peak streak.
   Results cached in AnalyticsCache ('bookingTrends', 5 min).

   Depends on: AnalyticsEngine, AnalyticsCache, drawBarChart
   ════════════════════════════════════════════════════════ */
(function () {

  var _DOW_JP = ['日','月','火','水','木','金','土'];
  var _DOW_FULL = ['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'];
  var _renderTab = 'weekly'; // default active tab

  function _priceFor() { return 0; } // trends use counts not revenue

  /* ── Build daily series ── */
  function _daily(bk, n) {
    var AE = window.AnalyticsEngine;
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var date = AE.daysAgoIso(i);
      var count = bk.filter(function (b) { return (b.date || b.move_date || '') === date; }).length;
      out.push({ date: date, count: count });
    }
    return out;
  }

  /* ── Build weekly series (Sunday-aligned) ── */
  function _weekly(bk, n) {
    var out = [];
    for (var w = n - 1; w >= 0; w--) {
      var s = new Date(); s.setHours(0,0,0,0); s.setDate(s.getDate() - s.getDay() - w * 7);
      var e = new Date(s); e.setDate(s.getDate() + 6);
      var sIso = s.toISOString().slice(0, 10);
      var eIso = e.toISOString().slice(0, 10);
      var count = bk.filter(function (b) { var d = b.date || b.move_date || ''; return d >= sIso && d <= eIso; }).length;
      out.push({ week: n - w, start: sIso, count: count });
    }
    return out;
  }

  /* ── Build monthly series ── */
  function _monthly(bk, n) {
    var out = [];
    for (var m = n - 1; m >= 0; m--) {
      var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - m);
      var ym = d.toISOString().slice(0, 7);
      var count = bk.filter(function (b) { return (b.date || b.move_date || '').startsWith(ym); }).length;
      out.push({ ym: ym, count: count });
    }
    return out;
  }

  /* ── Growth % between two sums ── */
  function _growth(curr, prev) {
    var AE = window.AnalyticsEngine;
    return AE ? AE.pct(curr, prev || 1) : 0;
  }

  /* ── Peak detection ── */
  function _peaks(bk) {
    var dow = [0,0,0,0,0,0,0];
    var months = {};
    bk.forEach(function (b) {
      var d = b.date || b.move_date || '';
      if (!d) return;
      dow[new Date(d + 'T00:00:00').getDay()]++;
      var ym = d.slice(0, 7);
      months[ym] = (months[ym] || 0) + 1;
    });
    var topDow     = dow.indexOf(Math.max.apply(null, dow));
    var topMonthYm = Object.entries(months).sort(function (a, b) { return b[1] - a[1]; })[0];
    return {
      dowIndex:   topDow,
      dowLabel:   _DOW_FULL[topDow],
      dowCount:   dow[topDow],
      peakMonth:  topMonthYm ? topMonthYm[0] : '—',
      peakMonthN: topMonthYm ? topMonthYm[1] : 0,
    };
  }

  /* ═══════════════════════════════════════════════════════
     COMPUTE
  ════════════════════════════════════════════════════════ */
  function compute(bookings) {
    var cached = window.AnalyticsCache ? AnalyticsCache.get('bookingTrends') : null;
    if (cached) return cached;

    var bk = bookings || (window.Adapter ? Adapter.getBookings() : []);

    var daily14  = _daily(bk, 14);
    var daily28  = _daily(bk, 28);
    var weekly12 = _weekly(bk, 12);
    var monthly12 = _monthly(bk, 12);

    var dailySum1  = daily14.reduce(function (s, d) { return s + d.count; }, 0);
    var dailySum2  = daily28.slice(0, 14).reduce(function (s, d) { return s + d.count; }, 0);
    var weeklySum1 = weekly12.slice(-6).reduce(function (s, w) { return s + w.count; }, 0);
    var weeklySum2 = weekly12.slice(0, 6).reduce(function (s, w) { return s + w.count; }, 0);
    var monthly6_1 = monthly12.slice(-6).reduce(function (s, m) { return s + m.count; }, 0);
    var monthly6_2 = monthly12.slice(0, 6).reduce(function (s, m) { return s + m.count; }, 0);

    var result = {
      daily:   daily14,
      weekly:  weekly12,
      monthly: monthly12,
      dailyGrowth:   _growth(dailySum1, dailySum2),
      weeklyGrowth:  _growth(weeklySum1, weeklySum2),
      monthlyGrowth: _growth(monthly6_1, monthly6_2),
      peaks: _peaks(bk),
      totalBookings: bk.length,
    };

    if (window.AnalyticsCache) AnalyticsCache.set('bookingTrends', result);
    return result;
  }

  /* ═══════════════════════════════════════════════════════
     RENDER — 予約トレンド panel
  ════════════════════════════════════════════════════════ */
  function render(containerId, bookings) {
    var el = document.getElementById(containerId);
    if (!el) return;

    var td = compute(bookings);
    _renderTab = _renderTab || 'weekly';
    _drawPanel(el, td);
  }

  function _drawPanel(el, td) {
    var tab    = _renderTab;
    var growth = tab === 'daily' ? td.dailyGrowth : tab === 'weekly' ? td.weeklyGrowth : td.monthlyGrowth;
    var gc     = growth > 0 ? 'var(--green)' : growth < 0 ? 'var(--red)' : 'var(--gray-1)';
    var gi     = growth > 0 ? '↑' : growth < 0 ? '↓' : '→';
    var tabDef = [
      { id: 'daily',   label: '日別' },
      { id: 'weekly',  label: '週別' },
      { id: 'monthly', label: '月別' },
    ];
    var tabs = tabDef.map(function (t) {
      var active = t.id === tab;
      return '<button class="bi-trend-btn' + (active ? ' active' : '') + '" ' +
        'onclick="BookingTrends.setTab(\'' + t.id + '\',\'' + el.id + '\')">' + t.label + '</button>';
    }).join('');

    var p = td.peaks;
    var peakHtml = p.dowCount > 0 ? [
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">',
      '<span style="font-size:11px;padding:3px 9px;border-radius:12px;background:var(--bg-soft-2);color:var(--ink)">',
      '🏆 ' + p.dowLabel + ' ' + p.dowCount + '件</span>',
      p.peakMonth !== '—' ? '<span style="font-size:11px;padding:3px 9px;border-radius:12px;background:var(--bg-soft-2);color:var(--ink)">📅 ' + p.peakMonth + ' ' + p.peakMonthN + '件</span>' : '',
      '</div>',
    ].join('') : '';

    el.innerHTML = [
      '<div class="panel" style="margin-bottom:0">',
        '<div class="panel-head">',
          '<span class="panel-title">予約トレンド</span>',
          '<div class="bi-trend-btns">' + tabs + '</div>',
        '</div>',
        '<div class="panel-body">',
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">',
            '<div>',
              '<span style="font-size:11px;color:var(--gray-1)">前期間比</span>',
              '<span style="font-size:15px;font-weight:700;margin-left:8px;color:' + gc + '">' + gi + ' ' + Math.abs(growth) + '%</span>',
            '</div>',
            '<div class="stat-val" style="font-size:13px;color:var(--gray-2)">総数 ' + td.totalBookings + '件</div>',
          '</div>',
          '<canvas id="trendsCanvas_' + el.id + '" class="bi-chart-canvas"></canvas>',
          peakHtml,
        '</div>',
      '</div>',
    ].join('');

    setTimeout(function () {
      if (typeof drawBarChart !== 'function') return;
      var isDark  = document.documentElement.classList.contains('dark');
      var canvasId = 'trendsCanvas_' + el.id;
      var data, labels;
      if (tab === 'daily') {
        data   = td.daily.map(function (d) { return d.count; });
        labels = td.daily.map(function (d) { return d.date.slice(5); });
      } else if (tab === 'weekly') {
        data   = td.weekly.map(function (w) { return w.count; });
        labels = td.weekly.map(function (w) { return 'W' + w.week; });
      } else {
        data   = td.monthly.map(function (m) { return m.count; });
        labels = td.monthly.map(function (m) { return m.ym.slice(5) + '月'; });
      }
      drawBarChart(canvasId, labels, data, isDark);
    }, 0);
  }

  function setTab(tab, containerId) {
    _renderTab = tab;
    var el = document.getElementById(containerId);
    if (!el) return;
    var td = compute();
    _drawPanel(el, td);
  }

  window.BookingTrends = { compute: compute, render: render, setTab: setTab };
})();
