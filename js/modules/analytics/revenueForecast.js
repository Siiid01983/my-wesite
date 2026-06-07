'use strict';
/* ════════════════════════════════════════════════════════
   REVENUE FORECAST — Phase 23A
   Three-horizon revenue projection using linearly-weighted
   moving averages on historical weekly/monthly buckets.
   No external APIs. All computation runs locally.

   Public API:
     RevenueForecast.next7Days(bookings?)  → {projected, growth, actual, label}
     RevenueForecast.next30Days(bookings?) → {projected, growth, actual, label}
     RevenueForecast.nextMonth(bookings?)  → {projected, growth, actual, label, ym}
     RevenueForecast.compute(bookings?)    → full analysis object
     RevenueForecast.render(id, bookings?) → renders 予測売上 panel

   Depends on: AnalyticsEngine, drawBarChart (admin-analytics.js)
   ════════════════════════════════════════════════════════ */
(function () {

  function _bk(bookings) {
    return bookings || (window.Adapter ? Adapter.getBookings() : []);
  }

  function _priceFor(svc) {
    const prices = window.Adapter ? Adapter.getPrices() : {};
    const p = prices[svc] || 0;
    return typeof p === 'number' ? p : (p.base || 0);
  }

  /* ── Linearly-weighted average: newest value = highest weight ── */
  function _wAvg(values) {
    if (!values.length) return 0;
    let sw = 0, swv = 0;
    values.forEach((v, i) => { const w = i + 1; sw += w; swv += w * v; });
    return sw > 0 ? swv / sw : 0;
  }

  /* ── Revenue per Sunday-aligned week, oldest → newest ── */
  function _weekBuckets(bookings, n) {
    const out = [];
    for (let w = n - 1; w >= 0; w--) {
      const s = new Date(); s.setHours(0,0,0,0); s.setDate(s.getDate() - s.getDay() - w * 7);
      const e = new Date(s); e.setDate(s.getDate() + 6);
      const sIso = s.toISOString().slice(0, 10);
      const eIso = e.toISOString().slice(0, 10);
      const rev  = bookings
        .filter(b => { const d = b.date || b.move_date || ''; return d >= sIso && d <= eIso && b.status !== 'キャンセル' && b.status !== 'cancelled'; })
        .reduce((sum, b) => sum + _priceFor(b.service || b.service_type || ''), 0);
      out.push(rev);
    }
    return out;
  }

  /* ── Revenue per complete calendar month, oldest → newest ── */
  /* Excludes the current (partial) month to keep actuals clean */
  function _monthBuckets(bookings, n) {
    const out = [];
    for (let m = n - 1; m >= 0; m--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - m - 1);
      const ym  = d.toISOString().slice(0, 7);
      const rev = bookings
        .filter(b => { const dt = b.date || b.move_date || ''; return dt.startsWith(ym) && b.status !== 'キャンセル' && b.status !== 'cancelled'; })
        .reduce((sum, b) => sum + _priceFor(b.service || b.service_type || ''), 0);
      out.push({ ym, revenue: rev });
    }
    return out;
  }

  /* ═══════════════════════════════════════════════════════
     PUBLIC FORECAST METHODS
  ════════════════════════════════════════════════════════ */

  /* 7-day forecast — weighted avg of last 8 weekly revenue buckets */
  function next7Days(bookings) {
    const bk    = _bk(bookings);
    const weeks = _weekBuckets(bk, 8);
    const projected  = Math.round(_wAvg(weeks));
    const lastWeek   = weeks[weeks.length - 1] || 0;
    const prevWeek   = weeks[weeks.length - 2] || 0;
    const AE         = window.AnalyticsEngine;
    const growth     = AE ? AE.pct(projected, prevWeek || lastWeek || 1) : 0;
    return { projected, growth, actual: lastWeek, label: '今後7日間', days: 7 };
  }

  /* 30-day forecast — weighted avg weekly × 4.3 weeks */
  function next30Days(bookings) {
    const bk         = _bk(bookings);
    const weeks      = _weekBuckets(bk, 12);
    const projected  = Math.round(_wAvg(weeks) * (30 / 7));
    const last30     = weeks.slice(-4).reduce((s, v) => s + v, 0);
    const prev30     = weeks.slice(-8, -4).reduce((s, v) => s + v, 0);
    const AE         = window.AnalyticsEngine;
    const growth     = AE ? AE.pct(projected, prev30 || last30 || 1) : 0;
    return { projected, growth, actual: last30, label: '今後30日間', days: 30 };
  }

  /* Next calendar month forecast — weighted avg of last 6 complete months */
  function nextMonth(bookings) {
    const bk         = _bk(bookings);
    const months     = _monthBuckets(bk, 6);
    const projected  = Math.round(_wAvg(months.map(m => m.revenue)));
    const lastRev    = months[months.length - 1]?.revenue || 0;
    const prevRev    = months[months.length - 2]?.revenue || 0;
    const AE         = window.AnalyticsEngine;
    const growth     = AE ? AE.pct(projected, prevRev || lastRev || 1) : 0;
    const nextD      = new Date(); nextD.setMonth(nextD.getMonth() + 1);
    return { projected, growth, actual: lastRev, label: '来月予測', ym: nextD.toISOString().slice(0, 7) };
  }

  /* ─── compute() — full analysis for insight cards (backward compat) ─── */
  function compute(bookings) {
    const AE = window.AnalyticsEngine;
    const bk = _bk(bookings);
    if (!bk.length) return null;

    const f7   = next7Days(bk);
    const f30  = next30Days(bk);
    const fMon = nextMonth(bk);

    const months    = _monthBuckets(bk, 6);
    const revValues = months.map(m => m.revenue);
    const anomalies = AE ? AE.detectAnomalies(revValues) : revValues.map(() => false);
    const anomalyMonths = months.filter((_, i) => anomalies[i]).map(m => m.ym);

    /* Regression for confidence (kept for insight cards) */
    const points = months.map((m, i) => ({ x: i, y: m.revenue }));
    const reg    = AE ? AE.linearRegression(points) : { r2: 0, slope: 0 };

    return {
      f7, f30, fMon,
      months,
      anomalyMonths,
      confidence:  Math.round(reg.r2 * 100),
      isGrowing:   fMon.growth > 0,
      growthPct:   fMon.growth,
      /* backward compat — analyticsWidgets insight cards read these */
      forecast:    [{ ym: fMon.ym, revenue: fMon.projected }],
    };
  }

  /* ═══════════════════════════════════════════════════════
     RENDER — 予測売上 panel
  ════════════════════════════════════════════════════════ */
  function render(containerId, bookings) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const bk = _bk(bookings);
    if (!bk.length) { el.innerHTML = _skeleton(); return; }

    const f7   = next7Days(bk);
    const f30  = next30Days(bk);
    const fMon = nextMonth(bk);
    const AE   = window.AnalyticsEngine;
    const fmt  = n => AE ? AE.fmtYen(n) : '¥' + Math.round(n || 0).toLocaleString();
    const isDark = document.documentElement.classList.contains('dark');

    const heroColor = fMon.growth > 0 ? 'var(--green)' : fMon.growth < 0 ? 'var(--red)' : 'var(--gray-1)';
    const heroIcon  = fMon.growth > 0 ? '↑' : fMon.growth < 0 ? '↓' : '→';

    const horizonCard = (f) => {
      const gc = f.growth > 0 ? 'var(--green)' : f.growth < 0 ? 'var(--red)' : 'var(--gray-1)';
      const gi = f.growth > 0 ? '↑' : f.growth < 0 ? '↓' : '→';
      return `
        <div class="stat-card" style="margin:0;padding:11px 10px;text-align:center">
          <div class="stat-label" style="font-size:10px">${f.label}</div>
          <div style="font-size:14px;font-weight:700;color:var(--ink);margin:4px 0;line-height:1.2">${fmt(f.projected)}</div>
          <div style="font-size:11px;font-weight:700;color:${gc}">${gi} ${Math.abs(f.growth)}%</div>
        </div>`;
    };

    /* Chart: last 4 complete months actuals + next month forecast */
    const months = _monthBuckets(bk, 4);

    el.innerHTML = `
      <div class="panel" style="margin-bottom:0;height:100%">
        <div class="panel-head">
          <span class="panel-title">予測売上</span>
          <span style="font-size:11px;color:var(--gray-2)">加重移動平均</span>
        </div>
        <div class="panel-body">

          <!-- Hero: next month -->
          <div style="text-align:center;padding:14px 0 12px;border-bottom:1px solid var(--line-2);margin-bottom:14px">
            <div class="stat-label" style="margin-bottom:5px">来月 予測売上</div>
            <div style="font-size:28px;font-weight:700;letter-spacing:-.5px;line-height:1.1;color:var(--ink)">${fmt(fMon.projected)}</div>
            <div style="margin-top:7px;display:flex;align-items:center;justify-content:center;gap:6px">
              <span style="font-size:13px;font-weight:700;color:${heroColor}">${heroIcon} ${Math.abs(fMon.growth)}% 成長予測</span>
              <span style="font-size:11px;color:var(--gray-2)">先月比</span>
            </div>
          </div>

          <!-- 3-horizon grid -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
            ${horizonCard(f7)}${horizonCard(f30)}${horizonCard(fMon)}
          </div>

          <!-- Trend chart -->
          <canvas id="revForecastCanvas" class="bi-chart-canvas"></canvas>
        </div>
      </div>`;

    requestAnimationFrame(() => {
      if (typeof drawBarChart !== 'function') return;
      const labels = [...months.map(m => m.ym.slice(5) + '月'), fMon.ym.slice(5) + '月?'];
      const data   = [...months.map(m => m.revenue), fMon.projected];
      drawBarChart('revForecastCanvas', labels, data, isDark);
    });
  }

  function _skeleton() {
    return `<div class="panel" style="margin-bottom:0;height:100%">
      <div class="panel-head"><span class="panel-title">予測売上</span></div>
      <div class="panel-body"><div class="empty" style="padding:20px 0"><p>データを読み込み中…</p></div></div>
    </div>`;
  }

  window.RevenueForecast = { next7Days, next30Days, nextMonth, compute, render };
})();
