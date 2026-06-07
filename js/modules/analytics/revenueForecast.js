'use strict';
/* ════════════════════════════════════════════════════════
   REVENUE FORECAST — Phase 23
   3-month revenue projection using linear regression on the
   last 6 months of actuals. Renders a panel with:
     • trend indicator + R² confidence score
     • per-month forecast rows
     • bar chart: last 4 actuals + 3 forecast months
     • anomaly callout when IQR outliers are detected
   Depends on: AnalyticsEngine, drawBarChart (admin-analytics.js)
   ════════════════════════════════════════════════════════ */
(function () {

  function _priceFor(svc) {
    const prices = window.Adapter ? Adapter.getPrices() : {};
    const p = prices[svc] || 0;
    return typeof p === 'number' ? p : (p.base || 0);
  }

  /* ── Compute forecast object from booking array ── */
  function compute(bookings) {
    const AE = window.AnalyticsEngine;
    if (!AE || !bookings.length) return null;

    const monthly = AE.fillMonthGaps(AE.aggregateMonthly(bookings, _priceFor));
    if (monthly.length < 2) return null;

    /* Use last 6 months for regression */
    const recent = monthly.slice(-6);
    const points = recent.map((m, i) => ({ x: i, y: m.revenue }));
    const reg    = AE.linearRegression(points);

    const nextRevs = AE.forecastNext(reg, points.length - 1, 3);
    const lastDate  = new Date(monthly[monthly.length - 1].ym + '-01');
    const forecast  = [1, 2, 3].map(i => {
      const d = new Date(lastDate); d.setMonth(d.getMonth() + i);
      return { ym: d.toISOString().slice(0, 7), revenue: nextRevs[i - 1] };
    });

    const revValues     = monthly.map(m => m.revenue);
    const anomalies     = AE.detectAnomalies(revValues);
    const anomalyMonths = monthly.filter((_, i) => anomalies[i]).map(m => m.ym);

    const isGrowing = reg.slope > 0;
    const growthPct = recent.length > 1
      ? AE.pct(recent[recent.length - 1].revenue, recent[0].revenue)
      : 0;

    return {
      monthly,
      recent,
      regression: reg,
      forecast,
      isGrowing,
      growthPct,
      confidence: Math.round(reg.r2 * 100),
      anomalyMonths,
    };
  }

  /* ── Render into a given container element ID ── */
  function render(containerId, bookings) {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!bookings || !bookings.length) { el.innerHTML = _skeleton(); return; }

    const f = compute(bookings);
    if (!f) { el.innerHTML = _skeleton(); return; }

    const AE         = window.AnalyticsEngine;
    const isDark     = document.documentElement.classList.contains('dark');
    const trendColor = f.isGrowing ? 'var(--green)' : 'var(--red)';
    const trendIcon  = f.isGrowing ? '↑' : '↓';
    const confColor  = f.confidence >= 70 ? 'var(--green)'
                     : f.confidence >= 40 ? 'var(--yellow)'
                     : 'var(--red)';

    const forecastRows = f.forecast.map(m => `
      <div class="bi-metric-row">
        <span class="bi-metric-label">${m.ym}</span>
        <span class="bi-metric-val" style="color:var(--blue)">${AE.fmtYen(m.revenue)}</span>
      </div>`).join('');

    const anomalyNote = f.anomalyMonths.length
      ? `<div style="margin-top:10px;padding:8px 10px;background:rgba(245,158,11,.1);border-radius:8px;font-size:11px;color:var(--yellow);line-height:1.5">
           ⚠ 異常値検出: ${f.anomalyMonths.join(', ')}
         </div>`
      : '';

    el.innerHTML = `
      <div class="panel" style="margin-bottom:0;height:100%">
        <div class="panel-head">
          <span class="panel-title">売上予測</span>
          <span style="font-size:11px;color:var(--gray-2)">3ヶ月先行予測</span>
        </div>
        <div class="panel-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
            <div class="stat-card" style="margin:0;padding:12px 14px;text-align:center">
              <div class="stat-label">トレンド</div>
              <div class="stat-val" style="color:${trendColor};font-size:22px">${trendIcon} ${Math.abs(f.growthPct)}%</div>
              <div class="stat-sub">直近6ヶ月</div>
            </div>
            <div class="stat-card" style="margin:0;padding:12px 14px;text-align:center">
              <div class="stat-label">予測精度</div>
              <div class="stat-val" style="color:${confColor};font-size:22px">${f.confidence}%</div>
              <div class="stat-sub">R² スコア</div>
            </div>
          </div>
          <div class="bi-section-header">月別予測</div>
          ${forecastRows}
          ${anomalyNote}
          <canvas id="revForecastCanvas" class="bi-chart-canvas" style="margin-top:14px"></canvas>
        </div>
      </div>`;

    requestAnimationFrame(() => _drawChart(f, isDark));
  }

  function _drawChart(f, isDark) {
    if (typeof drawBarChart !== 'function') return;
    const actual   = f.monthly.slice(-4);
    const labels   = [
      ...actual.map(m => m.ym.slice(5) + '月'),
      ...f.forecast.map(m => m.ym.slice(5) + '月?'),
    ];
    const data = [...actual.map(m => m.revenue), ...f.forecast.map(m => m.revenue)];
    drawBarChart('revForecastCanvas', labels, data, isDark);
  }

  function _skeleton() {
    return `<div class="panel" style="margin-bottom:0;height:100%">
      <div class="panel-head"><span class="panel-title">売上予測</span></div>
      <div class="panel-body"><div class="empty" style="padding:20px 0"><p>データを読み込み中…</p></div></div>
    </div>`;
  }

  window.RevenueForecast = { compute, render };
})();
