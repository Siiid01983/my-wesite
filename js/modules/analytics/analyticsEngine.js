'use strict';
/* ════════════════════════════════════════════════════════
   ANALYTICS ENGINE — Phase 23
   Pure computation: linear regression, moving averages,
   anomaly detection, forecasting, data aggregation.
   No DOM. No Supabase. Safe to call from any context.
   ════════════════════════════════════════════════════════ */
(function () {

  /* ── Linear regression on [{x, y}] points ── */
  function linearRegression(points) {
    const n = points.length;
    if (n < 2) return { slope: 0, intercept: points[0]?.y || 0, r2: 0 };
    const sumX  = points.reduce((s, p) => s + p.x, 0);
    const sumY  = points.reduce((s, p) => s + p.y, 0);
    const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
    const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
    const meanX = sumX / n;
    const meanY = sumY / n;
    const denom = sumX2 - n * meanX * meanX;
    if (Math.abs(denom) < 1e-10) return { slope: 0, intercept: meanY, r2: 0 };
    const slope     = (sumXY - n * meanX * meanY) / denom;
    const intercept = meanY - slope * meanX;
    const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
    const ssRes = points.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
    const r2    = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
    return { slope, intercept, r2 };
  }

  /* ── Simple moving average (trailing window) ── */
  function movingAverage(values, window) {
    const w = Math.max(1, Math.min(window, values.length));
    return values.map((_, i) => {
      const slice = values.slice(Math.max(0, i - w + 1), i + 1);
      return slice.reduce((s, v) => s + v, 0) / slice.length;
    });
  }

  /* ── Exponential moving average ── */
  function exponentialMA(values, alpha) {
    if (!values.length) return [];
    const a = alpha || (2 / (values.length + 1));
    return values.reduce((acc, v, i) => {
      acc.push(i === 0 ? v : a * v + (1 - a) * acc[i - 1]);
      return acc;
    }, []);
  }

  /* ── Anomaly detection using IQR (returns boolean array) ── */
  function detectAnomalies(values) {
    if (values.length < 4) return values.map(() => false);
    const sorted = [...values].sort((a, b) => a - b);
    const q1     = sorted[Math.floor(sorted.length * 0.25)];
    const q3     = sorted[Math.floor(sorted.length * 0.75)];
    const iqr    = q3 - q1;
    const lower  = q1 - 1.5 * iqr;
    const upper  = q3 + 1.5 * iqr;
    return values.map(v => v < lower || v > upper);
  }

  /* ── Project regression forward by n steps from lastX ── */
  function forecastNext(regression, lastX, n) {
    const out = [];
    for (let i = 1; i <= n; i++) {
      out.push(Math.max(0, regression.slope * (lastX + i) + regression.intercept));
    }
    return out;
  }

  /* ── Aggregate bookings into monthly buckets ── */
  /* Returns [{ym:'YYYY-MM', count, revenue}] sorted ascending */
  function aggregateMonthly(bookings, priceFor) {
    const map = {};
    bookings.forEach(b => {
      const dateStr = b.date || b.move_date;
      if (!dateStr) return;
      const ym = dateStr.slice(0, 7);
      if (!map[ym]) map[ym] = { ym, count: 0, revenue: 0 };
      map[ym].count++;
      const svc = b.service || b.service_type || '';
      const isActive = b.status !== 'キャンセル' && b.status !== 'cancelled';
      if (isActive) map[ym].revenue += (priceFor ? priceFor(svc) : 0);
    });
    return Object.values(map).sort((a, b) => (a.ym < b.ym ? -1 : 1));
  }

  /* ── Zero-fill gaps in a monthly series ── */
  function fillMonthGaps(monthly) {
    if (!monthly.length) return monthly;
    const result = [];
    const map    = Object.fromEntries(monthly.map(m => [m.ym, m]));
    const start  = new Date(monthly[0].ym + '-01');
    const end    = new Date(monthly[monthly.length - 1].ym + '-01');
    const cur    = new Date(start);
    while (cur <= end) {
      const ym = cur.toISOString().slice(0, 7);
      result.push(map[ym] || { ym, count: 0, revenue: 0 });
      cur.setMonth(cur.getMonth() + 1);
    }
    return result;
  }

  /* ── Percentage change helper ── */
  function pct(cur, prev) {
    if (prev === 0) return cur > 0 ? 100 : 0;
    return Math.round(((cur - prev) / Math.abs(prev)) * 100);
  }

  /* ── Format yen ── */
  function fmtYen(n) {
    return '¥' + Math.round(n || 0).toLocaleString();
  }

  /* ── ISO date string for today ── */
  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  /* ── ISO date N days ago ── */
  function daysAgoIso(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  window.AnalyticsEngine = {
    linearRegression,
    movingAverage,
    exponentialMA,
    detectAnomalies,
    forecastNext,
    aggregateMonthly,
    fillMonthGaps,
    pct,
    fmtYen,
    todayIso,
    daysAgoIso,
  };
})();
