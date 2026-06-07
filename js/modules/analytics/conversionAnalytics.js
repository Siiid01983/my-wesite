'use strict';
/* ════════════════════════════════════════════════════════
   CONVERSION ANALYTICS — Phase 23
   Funnel: Quote request → Booking → Confirmed → Completed
   Computes:
     • Conversion rate (quotes → bookings)
     • Average time-to-convert (quote createdAt → booking createdAt)
     • Per-service cancellation and confirmation rates
     • 6-month monthly conversion trend
   Depends on: AnalyticsEngine, Adapter
   ════════════════════════════════════════════════════════ */
(function () {

  const _CANCELLED  = new Set(['キャンセル', 'cancelled']);
  const _CONFIRMED  = new Set(['確定', 'confirmed', '完了', 'completed']);
  const _COMPLETED  = new Set(['完了', 'completed']);

  /* ── Compute conversion metrics ── */
  function compute(bookings, quotes) {
    const AE = window.AnalyticsEngine;
    if (!AE) return null;

    const bkLen  = bookings.length;
    const qtLen  = quotes.length;

    const confirmed  = bookings.filter(b => _CONFIRMED.has(b.status)).length;
    const completed  = bookings.filter(b => _COMPLETED.has(b.status)).length;
    const cancelled  = bookings.filter(b => _CANCELLED.has(b.status)).length;
    const pending    = bkLen - confirmed - cancelled;

    const convRate = qtLen > 0 ? Math.round((bkLen / qtLen) * 100) : 0;

    /* Time-to-convert via email match */
    const qtByEmail = {};
    quotes.forEach(q => {
      const k = (q.email || '').toLowerCase().trim();
      if (k) qtByEmail[k] = q;
    });
    const convertTimes = [];
    bookings.forEach(b => {
      const k = (b.email || '').toLowerCase().trim();
      if (!k || !qtByEmail[k]) return;
      const qTs = new Date(qtByEmail[k].createdAt || 0).getTime();
      const bTs = new Date(b.createdAt || 0).getTime();
      const h   = (bTs - qTs) / 3600000;
      if (h > 0 && h < 8760) convertTimes.push(h);
    });
    const avgConvertH = convertTimes.length
      ? convertTimes.reduce((s, h) => s + h, 0) / convertTimes.length
      : null;

    /* Per-service rates */
    const byService = {};
    bookings.forEach(b => {
      const svc = (b.service || b.service_type || 'その他').slice(0, 12);
      if (!byService[svc]) byService[svc] = { total: 0, confirmed: 0, cancelled: 0 };
      byService[svc].total++;
      if (_CONFIRMED.has(b.status)) byService[svc].confirmed++;
      if (_CANCELLED.has(b.status)) byService[svc].cancelled++;
    });
    const svcRates = Object.entries(byService)
      .map(([svc, m]) => ({
        svc,
        total:            m.total,
        confirmationRate: m.total > 0 ? Math.round((m.confirmed / m.total) * 100) : 0,
        cancellationRate: m.total > 0 ? Math.round((m.cancelled / m.total) * 100) : 0,
      }))
      .sort((a, b) => b.cancellationRate - a.cancellationRate);

    /* 6-month monthly trend */
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const d  = new Date(); d.setMonth(d.getMonth() - i);
      const ym = d.toISOString().slice(0, 7);
      const mBk = bookings.filter(b => (b.createdAt || '').startsWith(ym)).length;
      const mQt = quotes.filter(q  => (q.createdAt  || '').startsWith(ym)).length;
      trend.push({ ym, bookings: mBk, quotes: mQt, rate: mQt > 0 ? Math.round((mBk / mQt) * 100) : 0 });
    }

    return {
      funnel: { quotes: qtLen, bookings: bkLen, confirmed, completed, cancelled, pending },
      convRate,
      avgConvertH,
      svcRates,
      trend,
    };
  }

  /* ── Render into a container element ── */
  function render(containerId, bookings, quotes) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const c = compute(bookings, quotes || []);
    if (!c) { el.innerHTML = _skeleton(); return; }

    const convColor = c.convRate >= 50 ? 'var(--green)'
                    : c.convRate >= 25 ? 'var(--yellow)'
                    : 'var(--red)';
    const f   = c.funnel;
    const max = Math.max(f.quotes, f.bookings, 1);

    const funnelRows = [
      { label: '見積りリクエスト', val: f.quotes,    color: 'var(--blue)' },
      { label: '予約受付',         val: f.bookings,  color: 'var(--green)' },
      { label: '確定済み',         val: f.confirmed, color: '#10b981' },
      { label: '完了',             val: f.completed, color: '#059669' },
      { label: 'キャンセル',       val: f.cancelled, color: 'var(--red)' },
    ].map(row => {
      const pct = Math.round((row.val / max) * 100);
      return `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;font-size:12px">
          <span style="width:88px;color:var(--gray-1);flex-shrink:0">${row.label}</span>
          <div style="flex:1;background:var(--bg-soft-2);border-radius:4px;height:10px;overflow:hidden">
            <div style="width:${pct}%;height:10px;background:${row.color};border-radius:4px;transition:width .3s"></div>
          </div>
          <span style="width:28px;text-align:right;font-weight:700;font-size:12px">${row.val}</span>
        </div>`;
    }).join('');

    const topCancel = c.svcRates.slice(0, 3).map(s => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--line-2);font-size:11px">
        <span style="color:var(--gray-1)">${s.svc}</span>
        <div style="display:flex;gap:8px">
          <span style="color:var(--green)">${s.confirmationRate}% 確定</span>
          <span style="color:var(--red)">${s.cancellationRate}% 取消</span>
        </div>
      </div>`).join('');

    const timeStr = c.avgConvertH != null
      ? (c.avgConvertH < 24
          ? Math.round(c.avgConvertH) + '時間'
          : Math.round(c.avgConvertH / 24) + '日')
      : '—';

    el.innerHTML = `
      <div class="panel" style="margin-bottom:0;height:100%">
        <div class="panel-head">
          <span class="panel-title">転換率 分析</span>
          <span style="font-size:12px;font-weight:700;color:${convColor}">${c.convRate}% 転換</span>
        </div>
        <div class="panel-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
            <div class="stat-card" style="margin:0;padding:11px 13px">
              <div class="stat-label">転換率</div>
              <div class="stat-val" style="font-size:20px;color:${convColor}">${c.convRate}%</div>
              <div class="stat-sub">見積り → 予約</div>
            </div>
            <div class="stat-card" style="margin:0;padding:11px 13px">
              <div class="stat-label">平均転換時間</div>
              <div class="stat-val" style="font-size:20px">${timeStr}</div>
              <div class="stat-sub">見積り → 確定</div>
            </div>
          </div>
          <div class="bi-section-header">コンバージョンファネル</div>
          ${funnelRows}
          ${topCancel ? `<div class="bi-section-header" style="margin-top:12px">サービス別成功率</div>${topCancel}` : ''}
        </div>
      </div>`;
  }

  function _skeleton() {
    return `<div class="panel" style="margin-bottom:0;height:100%">
      <div class="panel-head"><span class="panel-title">転換率 分析</span></div>
      <div class="panel-body"><div class="empty" style="padding:20px 0"><p>データなし</p></div></div>
    </div>`;
  }

  window.ConversionAnalytics = { compute, render };
})();
