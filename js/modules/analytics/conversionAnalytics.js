'use strict';
/* ════════════════════════════════════════════════════════
   CONVERSION ANALYTICS — Phase 23D
   コンバージョン分析

   Core funnel: Quote request → Booking created
   Three headline metrics:
     quotesReceived — total quote requests
     bookingsCreated— total bookings (all statuses)
     conversionRate — bookingsCreated ÷ quotesReceived × 100

   Supporting metrics:
     confirmed, completed, cancelled, pending counts
     avgConvertH — median hours quote→booking (email match)
     svcRates    — per-service confirmation/cancellation rate
     trend       — 6-month monthly quotes + bookings + rate

   Depends on: AnalyticsEngine, Adapter
   ════════════════════════════════════════════════════════ */
(function () {

  const _CANCELLED = new Set(['キャンセル', 'cancelled']);
  const _CONFIRMED = new Set(['確定', 'confirmed', '完了', 'completed']);
  const _COMPLETED = new Set(['完了', 'completed']);

  /* ═══════════════════════════════════════════════════════
     COMPUTE
  ════════════════════════════════════════════════════════ */
  function compute(bookings, quotes) {
    const bk = bookings || (window.Adapter ? Adapter.getBookings() : []);
    const qt = quotes   || (window.Adapter ? Adapter.getQuotes()   : []);

    const quotesReceived  = qt.length;
    const bookingsCreated = bk.length;
    const conversionRate  = quotesReceived > 0
      ? Math.round((bookingsCreated / quotesReceived) * 100) : 0;

    const confirmed = bk.filter(b => _CONFIRMED.has(b.status)).length;
    const completed = bk.filter(b => _COMPLETED.has(b.status)).length;
    const cancelled = bk.filter(b => _CANCELLED.has(b.status)).length;
    const pending   = bookingsCreated - confirmed - cancelled;

    /* Average time-to-convert via email match */
    const qtByEmail = {};
    qt.forEach(q => {
      const k = (q.email || '').toLowerCase().trim();
      if (k) qtByEmail[k] = q;
    });
    const times = [];
    bk.forEach(b => {
      const k   = (b.email || '').toLowerCase().trim();
      const qts = new Date(qtByEmail[k]?.createdAt || 0).getTime();
      const bts = new Date(b.createdAt || 0).getTime();
      const h   = (bts - qts) / 3600000;
      if (k && qtByEmail[k] && h > 0 && h < 8760) times.push(h);
    });
    const avgConvertH = times.length
      ? times.reduce((s, h) => s + h, 0) / times.length : null;

    /* Per-service confirmation / cancellation rates */
    const byService = {};
    bk.forEach(b => {
      const svc = (b.service || b.service_type || 'その他');
      if (!byService[svc]) byService[svc] = { total: 0, confirmed: 0, cancelled: 0 };
      byService[svc].total++;
      if (_CONFIRMED.has(b.status)) byService[svc].confirmed++;
      if (_CANCELLED.has(b.status)) byService[svc].cancelled++;
    });
    const svcRates = Object.entries(byService)
      .map(([svc, m]) => ({
        svc: svc.length > 12 ? svc.slice(0, 11) + '…' : svc,
        total:            m.total,
        confirmationRate: m.total > 0 ? Math.round((m.confirmed / m.total) * 100) : 0,
        cancellationRate: m.total > 0 ? Math.round((m.cancelled / m.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    /* 6-month monthly trend */
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const d  = new Date(); d.setMonth(d.getMonth() - i);
      const ym = d.toISOString().slice(0, 7);
      const mQt = qt.filter(q => (q.createdAt || '').startsWith(ym)).length;
      const mBk = bk.filter(b => (b.createdAt || '').startsWith(ym)).length;
      trend.push({ ym, quotes: mQt, bookings: mBk,
        rate: mQt > 0 ? Math.round((mBk / mQt) * 100) : 0 });
    }

    return {
      quotesReceived, bookingsCreated, conversionRate,
      funnel: { confirmed, completed, cancelled, pending },
      avgConvertH, svcRates, trend,
    };
  }

  /* ═══════════════════════════════════════════════════════
     RENDER — コンバージョン分析 panel
  ════════════════════════════════════════════════════════ */
  function render(containerId, bookings, quotes) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const c = compute(bookings, quotes);
    if (!c) { el.innerHTML = _skeleton(); return; }

    const { quotesReceived, bookingsCreated, conversionRate, funnel } = c;

    const rateColor = conversionRate >= 50 ? 'var(--green)'
                    : conversionRate >= 25 ? 'var(--yellow)'
                    : 'var(--red)';
    const rateBg    = conversionRate >= 50 ? 'rgba(16,185,129,.08)'
                    : conversionRate >= 25 ? 'rgba(245,158,11,.08)'
                    : 'rgba(239,68,68,.08)';

    /* ── Hero: three numbers ── */
    const hero = `
      <div style="display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:center;gap:6px;padding:16px 8px 14px;border-bottom:1px solid var(--line-2);margin-bottom:16px;text-align:center">

        <div>
          <div class="stat-label" style="margin-bottom:4px">見積り受付</div>
          <div style="font-size:28px;font-weight:700;line-height:1;color:var(--blue)">${quotesReceived}</div>
          <div class="stat-sub" style="margin-top:3px">件</div>
        </div>

        <div style="display:flex;flex-direction:column;align-items:center;gap:3px;color:var(--gray-2)">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
          <span style="font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase">転換</span>
        </div>

        <div>
          <div class="stat-label" style="margin-bottom:4px">予約成立</div>
          <div style="font-size:28px;font-weight:700;line-height:1;color:var(--green)">${bookingsCreated}</div>
          <div class="stat-sub" style="margin-top:3px">件</div>
        </div>

        <div style="width:1px;background:var(--line-2);height:44px"></div>

        <div style="background:${rateBg};border-radius:12px;padding:10px 8px">
          <div class="stat-label" style="margin-bottom:4px">転換率</div>
          <div style="font-size:28px;font-weight:700;line-height:1;color:${rateColor}">${conversionRate}%</div>
          <div class="stat-sub" style="margin-top:3px">見積り→予約</div>
        </div>
      </div>`;

    /* ── Funnel bars ── */
    const funnelMax = Math.max(quotesReceived, bookingsCreated, 1);
    const funnelSteps = [
      { label: '見積りリクエスト', val: quotesReceived,   color: 'var(--blue)',   pct: 100 },
      { label: '予約成立',         val: bookingsCreated,  color: 'var(--green)',  pct: Math.round((bookingsCreated  / funnelMax) * 100) },
      { label: '　 確定済み',      val: funnel.confirmed, color: '#10b981',       pct: Math.round((funnel.confirmed / funnelMax) * 100), indent: true },
      { label: '　 完了',          val: funnel.completed, color: '#059669',       pct: Math.round((funnel.completed / funnelMax) * 100), indent: true },
      { label: 'キャンセル',       val: funnel.cancelled, color: 'var(--red)',    pct: Math.round((funnel.cancelled / funnelMax) * 100) },
    ].map(row => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:${row.indent ? 4 : 7}px">
        <span style="width:90px;font-size:${row.indent ? '11px' : '12px'};color:${row.indent ? 'var(--gray-2)' : 'var(--gray-1)'};flex-shrink:0">${row.label}</span>
        <div style="flex:1;background:var(--bg-soft-2);border-radius:4px;height:${row.indent ? 6 : 10}px;overflow:hidden">
          <div style="width:${row.pct}%;height:100%;background:${row.color};border-radius:4px;transition:width .35s ease"></div>
        </div>
        <span style="width:30px;text-align:right;font-weight:700;font-size:12px;color:var(--ink)">${row.val}</span>
      </div>`).join('');

    /* ── Time-to-convert ── */
    const timeStr = c.avgConvertH != null
      ? (c.avgConvertH < 24
          ? Math.round(c.avgConvertH) + ' 時間'
          : Math.round(c.avgConvertH / 24) + ' 日')
      : '—';

    /* ── 6-month trend table ── */
    const trendRows = c.trend.map(row => {
      const rc = row.rate >= 50 ? 'var(--green)' : row.rate >= 25 ? 'var(--yellow)' : row.rate > 0 ? 'var(--red)' : 'var(--gray-2)';
      return `
        <tr>
          <td style="padding:5px 8px;font-size:11px;color:var(--gray-1)">${row.ym.slice(5)}月</td>
          <td style="padding:5px 8px;font-size:12px;text-align:center">${row.quotes}</td>
          <td style="padding:5px 8px;font-size:12px;text-align:center">${row.bookings}</td>
          <td style="padding:5px 8px;font-size:12px;text-align:center;font-weight:700;color:${rc}">${row.rate > 0 ? row.rate + '%' : '—'}</td>
        </tr>`;
    }).join('');

    /* ── Per-service table ── */
    const svcRows = c.svcRates.slice(0, 5).map(s => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--line-2);font-size:11px">
        <span style="color:var(--gray-1);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.svc}</span>
        <div style="display:flex;gap:10px;flex-shrink:0;margin-left:8px">
          <span style="color:var(--green);font-weight:600">${s.confirmationRate}% 確定</span>
          <span style="color:var(--red);font-weight:600">${s.cancellationRate}% 取消</span>
        </div>
      </div>`).join('');

    el.innerHTML = `
      <div class="panel" style="margin-bottom:0">
        <div class="panel-head">
          <span class="panel-title">コンバージョン分析</span>
          <span style="font-size:12px;font-weight:700;color:${rateColor}">${conversionRate}% 転換</span>
        </div>
        <div class="panel-body">

          ${hero}

          <div class="bi-section-header">コンバージョンファネル</div>
          ${funnelSteps}

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0">
            <div class="stat-card" style="margin:0;padding:11px 13px">
              <div class="stat-label">平均転換時間</div>
              <div class="stat-val" style="font-size:18px">${timeStr}</div>
              <div class="stat-sub">見積り → 予約確定</div>
            </div>
            <div class="stat-card" style="margin:0;padding:11px 13px">
              <div class="stat-label">保留中</div>
              <div class="stat-val" style="font-size:18px;color:var(--yellow)">${funnel.pending}</div>
              <div class="stat-sub">未確定の予約</div>
            </div>
          </div>

          <div class="bi-section-header">月別推移 (6ヶ月)</div>
          <div class="table-wrap" style="margin-bottom:12px">
            <table style="width:100%;border-collapse:collapse">
              <thead>
                <tr style="border-bottom:1px solid var(--line)">
                  <th style="padding:5px 8px;font-size:10px;font-weight:600;color:var(--gray-1);text-align:left">月</th>
                  <th style="padding:5px 8px;font-size:10px;font-weight:600;color:var(--gray-1);text-align:center">見積り</th>
                  <th style="padding:5px 8px;font-size:10px;font-weight:600;color:var(--gray-1);text-align:center">予約</th>
                  <th style="padding:5px 8px;font-size:10px;font-weight:600;color:var(--gray-1);text-align:center">転換率</th>
                </tr>
              </thead>
              <tbody>${trendRows}</tbody>
            </table>
          </div>

          ${svcRows ? `<div class="bi-section-header">サービス別成功率</div>${svcRows}` : ''}

        </div>
      </div>`;
  }

  function _skeleton() {
    return `<div class="panel" style="margin-bottom:0">
      <div class="panel-head"><span class="panel-title">コンバージョン分析</span></div>
      <div class="panel-body"><div class="empty" style="padding:20px 0"><p>データなし</p></div></div>
    </div>`;
  }

  window.ConversionAnalytics = { compute, render };
})();
