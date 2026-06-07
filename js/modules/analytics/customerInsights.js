'use strict';
/* ════════════════════════════════════════════════════════
   CUSTOMER INSIGHTS — Phase 23C
   顧客分析

   Five core metrics:
     totalCustomers    — unique customers by email
     returningCustomers— customers with > 1 booking
     repeatRate        — returning ÷ total × 100  (%)
     avgCustomerValue  — total revenue ÷ total customers
     clv               — revenue ÷ count for repeat customers only
                         (loyal customers' avg lifetime spend)

   Supporting metrics:
     atRiskCount       — repeaters silent for > 90 days
     newIn30           — first-time customers in last 30 days
     cohortList        — new customers per month (last 6)
     topByClv          — top 5 customers by lifetime revenue
     totalRevenue      — all-time active booking revenue

   Depends on: AnalyticsEngine, Adapter
   ════════════════════════════════════════════════════════ */
(function () {

  function _priceFor(svc) {
    const prices = window.Adapter ? Adapter.getPrices() : {};
    const p = prices[svc] || 0;
    return typeof p === 'number' ? p : (p.base || 0);
  }

  /* ═══════════════════════════════════════════════════════
     COMPUTE
  ════════════════════════════════════════════════════════ */
  function compute(bookings) {
    const AE   = window.AnalyticsEngine;
    const bk   = bookings || (window.Adapter ? Adapter.getBookings() : []);
    if (!bk.length) return null;

    const iso90 = AE ? AE.daysAgoIso(90) : '';
    const iso30 = AE ? AE.daysAgoIso(30) : '';

    /* ── Group by email (fallback: name) ── */
    const byKey = {};
    bk.forEach(b => {
      const key = (b.email || '').trim().toLowerCase() || ('__' + (b.name || b.customer_name || ''));
      if (!byKey[key]) {
        byKey[key] = {
          name:     b.name || b.customer_name || '—',
          email:    b.email || '',
          bookings: [],
          firstAt:  b.createdAt || '',
          lastAt:   b.createdAt || '',
        };
      }
      const c = byKey[key];
      c.bookings.push(b);
      if ((b.createdAt || '') < c.firstAt) c.firstAt = b.createdAt || '';
      if ((b.createdAt || '') > c.lastAt)  c.lastAt  = b.createdAt || '';
    });

    const customers = Object.values(byKey);
    const total     = customers.length;

    /* ── Revenue per customer ── */
    const revenueOf = c => c.bookings.reduce((s, b) => {
      if (b.status === 'キャンセル' || b.status === 'cancelled') return s;
      return s + _priceFor(b.service || b.service_type || '');
    }, 0);

    const clvList      = customers.map(revenueOf);
    const totalRevenue = clvList.reduce((s, v) => s + v, 0);

    /* ── Core five metrics ── */
    const returningCustomers = customers.filter(c => c.bookings.length > 1).length;
    const repeatRate         = total > 0 ? Math.round((returningCustomers / total) * 100) : 0;
    const avgCustomerValue   = total > 0 ? Math.round(totalRevenue / total) : 0;

    /* CLV = avg revenue of customers who have booked more than once */
    const repeaterRevenues = customers
      .filter(c => c.bookings.length > 1)
      .map(revenueOf);
    const clv = repeaterRevenues.length > 0
      ? Math.round(repeaterRevenues.reduce((s, v) => s + v, 0) / repeaterRevenues.length)
      : avgCustomerValue;                        /* fallback when no repeaters yet */

    /* ── Supporting metrics ── */
    const atRiskCount = customers.filter(c =>
      c.bookings.length >= 2 && (c.lastAt || '').slice(0, 10) < iso90
    ).length;

    const newIn30 = customers.filter(c =>
      (c.firstAt || '').slice(0, 10) >= iso30
    ).length;

    /* Acquisition cohorts — first-booking month, last 6 months */
    const cohortMap = {};
    customers.forEach(c => {
      const ym = (c.firstAt || '').slice(0, 7);
      if (ym) cohortMap[ym] = (cohortMap[ym] || 0) + 1;
    });
    const cohortList = Object.entries(cohortMap)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-6);

    /* Top 5 by CLV */
    const topByClv = customers
      .map((c, i) => ({ ...c, clv: clvList[i] }))
      .sort((a, b) => b.clv - a.clv)
      .slice(0, 5);

    return {
      /* Five core metrics */
      totalCustomers:    total,
      returningCustomers,
      repeatRate,
      avgCustomerValue,
      clv,
      /* Supporting */
      atRiskCount,
      newIn30,
      cohortList,
      topByClv,
      totalRevenue,
      /* Backward compat alias used by insight cards */
      avgCLV: clv,
    };
  }

  /* ═══════════════════════════════════════════════════════
     RENDER — 顧客分析 panel
  ════════════════════════════════════════════════════════ */
  function render(containerId, bookings) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const ins = compute(bookings);
    if (!ins) { el.innerHTML = _skeleton(); return; }

    const AE       = window.AnalyticsEngine;
    const fmt      = n => AE ? AE.fmtYen(n) : '¥' + Math.round(n || 0).toLocaleString();
    const riskCol  = ins.atRiskCount > 5 ? 'var(--red)'
                   : ins.atRiskCount > 0 ? 'var(--yellow)'
                   : 'var(--green)';
    const rateCol  = ins.repeatRate >= 30 ? 'var(--green)'
                   : ins.repeatRate >= 15 ? 'var(--yellow)'
                   : 'var(--red)';

    /* Repeat-rate progress bar */
    const rateBar = `
      <div style="margin:10px 0 6px;display:flex;align-items:center;gap:10px">
        <div style="flex:1;background:var(--bg-soft-2);border-radius:4px;height:8px;overflow:hidden">
          <div style="width:${ins.repeatRate}%;height:8px;background:${rateCol};border-radius:4px;transition:width .4s ease"></div>
        </div>
        <span style="font-size:12px;font-weight:700;color:${rateCol};min-width:36px;text-align:right">${ins.repeatRate}%</span>
      </div>`;

    /* Cohort bars */
    const maxCohort  = Math.max(...ins.cohortList.map(x => x[1]), 1);
    const cohortBars = ins.cohortList.map(([ym, cnt]) => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:11px">
        <span style="width:36px;color:var(--gray-1);flex-shrink:0">${ym.slice(5)}月</span>
        <div style="flex:1;background:var(--bg-soft-2);border-radius:3px;height:6px;overflow:hidden">
          <div style="width:${Math.round((cnt / maxCohort) * 100)}%;height:6px;background:var(--blue);border-radius:3px"></div>
        </div>
        <span style="width:22px;text-align:right;font-weight:600;color:var(--ink)">${cnt}</span>
      </div>`).join('');

    /* Top CLV customer list */
    const topRows = ins.topByClv.filter(c => c.clv > 0).map(c => {
      const ini = (c.name || '—').split(/[\s　]+/).map(p => p[0] || '').join('').slice(0, 2).toUpperCase() || '—';
      return `
        <div class="bi-customer-row">
          <div class="bi-customer-avatar">${ini}</div>
          <div style="flex:1;min-width:0">
            <div class="bi-customer-name">${c.name || '—'}</div>
            <div class="bi-customer-sub">${c.bookings.length}件 · ${fmt(c.clv)}</div>
          </div>
          <span style="font-size:11px;font-weight:700;color:var(--green);flex-shrink:0">${fmt(c.clv)}</span>
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="panel" style="margin-bottom:0">
        <div class="panel-head">
          <span class="panel-title">顧客分析</span>
          <button class="btn btn-ghost btn-sm" onclick="go('customers')">一覧 →</button>
        </div>
        <div class="panel-body">

          <!-- Hero: CLV -->
          <div style="text-align:center;padding:14px 0 12px;border-bottom:1px solid var(--line-2);margin-bottom:14px">
            <div class="stat-label" style="margin-bottom:5px">顧客生涯価値 (CLV)</div>
            <div style="font-size:28px;font-weight:700;letter-spacing:-.5px;line-height:1.1;color:var(--green)">${fmt(ins.clv)}</div>
            <div style="font-size:11px;color:var(--gray-2);margin-top:5px">リピーター顧客の平均累計売上</div>
          </div>

          <!-- Repeat rate with bar -->
          <div style="margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:12px;font-weight:600;color:var(--ink)">リピート率</span>
              <span style="font-size:11px;color:var(--gray-2)">${ins.returningCustomers}名 / ${ins.totalCustomers}名</span>
            </div>
            ${rateBar}
            <div style="font-size:11px;color:var(--gray-2)">複数回ご利用のお客様の割合</div>
          </div>

          <!-- Four metric cards -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
            <div class="stat-card" style="margin:0;padding:11px 13px">
              <div class="stat-label">総顧客数</div>
              <div class="stat-val" style="font-size:20px;color:var(--blue)">${ins.totalCustomers}名</div>
              <div class="stat-sub">ユニーク顧客</div>
            </div>
            <div class="stat-card" style="margin:0;padding:11px 13px">
              <div class="stat-label">リピーター</div>
              <div class="stat-val" style="font-size:20px;color:var(--green)">${ins.returningCustomers}名</div>
              <div class="stat-sub">複数回利用</div>
            </div>
            <div class="stat-card" style="margin:0;padding:11px 13px">
              <div class="stat-label">平均顧客価値</div>
              <div class="stat-val" style="font-size:16px;line-height:1.3">${fmt(ins.avgCustomerValue)}</div>
              <div class="stat-sub">全顧客平均</div>
            </div>
            <div class="stat-card" style="margin:0;padding:11px 13px">
              <div class="stat-label">離脱リスク</div>
              <div class="stat-val" style="font-size:20px;color:${riskCol}">${ins.atRiskCount}名</div>
              <div class="stat-sub">90日以上未接触</div>
            </div>
          </div>

          <!-- Acquisition cohort -->
          ${ins.cohortList.length ? `
          <div class="bi-section-header">月別新規獲得コホート</div>
          ${cohortBars}` : ''}

          <!-- Top CLV customers -->
          ${topRows ? `
          <div class="bi-section-header" style="margin-top:12px">CLV 上位顧客</div>
          ${topRows}` : ''}

        </div>
      </div>`;
  }

  function _skeleton() {
    return `<div class="panel" style="margin-bottom:0">
      <div class="panel-head"><span class="panel-title">顧客分析</span></div>
      <div class="panel-body"><div class="empty" style="padding:20px 0"><p>データなし</p></div></div>
    </div>`;
  }

  window.CustomerInsights = { compute, render };
})();
