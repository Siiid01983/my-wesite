'use strict';
/* ════════════════════════════════════════════════════════
   CUSTOMER INSIGHTS — Phase 23
   Computes:
     • Average Customer Lifetime Value (CLV)
     • Churn risk: repeaters with last booking > 90 days ago
     • Acquisition cohort by first-booking month (last 6 months)
     • Repeat rate (customers with > 1 booking)
     • Top customers by CLV
   Depends on: AnalyticsEngine, Adapter
   ════════════════════════════════════════════════════════ */
(function () {

  function _priceFor(svc) {
    const prices = window.Adapter ? Adapter.getPrices() : {};
    const p = prices[svc] || 0;
    return typeof p === 'number' ? p : (p.base || 0);
  }

  /* ── Group bookings by customer and compute metrics ── */
  function compute(bookings) {
    const AE = window.AnalyticsEngine;
    if (!AE || !bookings.length) return null;

    const iso90 = AE.daysAgoIso(90);
    const iso30 = AE.daysAgoIso(30);

    /* Group by email (fallback to name) */
    const byKey = {};
    bookings.forEach(b => {
      const key = (b.email || '').trim().toLowerCase() || ('__' + (b.name || b.customer_name || ''));
      if (!byKey[key]) byKey[key] = { name: b.name || b.customer_name || '—', email: b.email || '', bookings: [], firstAt: b.createdAt, lastAt: b.createdAt };
      byKey[key].bookings.push(b);
      if ((b.createdAt || '') < (byKey[key].firstAt || '')) byKey[key].firstAt = b.createdAt;
      if ((b.createdAt || '') > (byKey[key].lastAt  || '')) byKey[key].lastAt  = b.createdAt;
    });

    const customers = Object.values(byKey);

    /* CLV per customer */
    const clvList = customers.map(c => {
      return c.bookings.reduce((s, b) => {
        if (b.status === 'キャンセル' || b.status === 'cancelled') return s;
        return s + _priceFor(b.service || b.service_type || '');
      }, 0);
    });
    const avgCLV = customers.length
      ? Math.round(clvList.reduce((s, v) => s + v, 0) / customers.length)
      : 0;

    /* Churn risk: repeaters last seen > 90 days ago */
    const atRisk = customers.filter(c =>
      c.bookings.length >= 2 &&
      (c.lastAt || '').slice(0, 10) < iso90
    );

    /* Acquisition cohorts — first booking month, last 6 months */
    const cohorts = {};
    customers.forEach(c => {
      const ym = (c.firstAt || '').slice(0, 7);
      if (ym) cohorts[ym] = (cohorts[ym] || 0) + 1;
    });
    const cohortList = Object.entries(cohorts)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-6);

    /* Top by CLV */
    const topByClv = customers
      .map((c, i) => ({ ...c, clv: clvList[i] }))
      .sort((a, b) => b.clv - a.clv)
      .slice(0, 5);

    const repeaters  = customers.filter(c => c.bookings.length > 1).length;
    const newIn30    = customers.filter(c => (c.firstAt || '').slice(0, 10) >= iso30).length;

    return {
      totalCustomers: customers.length,
      avgCLV,
      atRiskCount: atRisk.length,
      newIn30,
      cohortList,
      topByClv,
      repeatRate: customers.length ? Math.round((repeaters / customers.length) * 100) : 0,
    };
  }

  /* ── Render into a container element ── */
  function render(containerId, bookings) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const ins = compute(bookings);
    if (!ins) { el.innerHTML = _skeleton(); return; }

    const AE        = window.AnalyticsEngine;
    const riskColor = ins.atRiskCount > 5 ? 'var(--red)'
                    : ins.atRiskCount > 0 ? 'var(--yellow)'
                    : 'var(--green)';

    const maxCohort = Math.max(...ins.cohortList.map(x => x[1]), 1);
    const cohortBars = ins.cohortList.map(([ym, cnt]) => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:11px">
        <span style="width:36px;color:var(--gray-1);flex-shrink:0">${ym.slice(5)}月</span>
        <div style="flex:1;background:var(--bg-soft-2);border-radius:3px;height:6px;overflow:hidden">
          <div style="width:${Math.round((cnt / maxCohort) * 100)}%;height:6px;background:var(--blue);border-radius:3px"></div>
        </div>
        <span style="width:22px;text-align:right;font-weight:600">${cnt}</span>
      </div>`).join('');

    const topRows = ins.topByClv.map(c => {
      const initials = (c.name || '—').split(/[\s　]+/).map(p => p[0] || '').join('').slice(0, 2).toUpperCase() || '—';
      return `
        <div class="bi-customer-row">
          <div class="bi-customer-avatar">${initials}</div>
          <div style="flex:1;min-width:0">
            <div class="bi-customer-name">${c.name || '—'}</div>
            <div class="bi-customer-sub">${c.bookings.length}件 · ${AE.fmtYen(c.clv)}</div>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="panel" style="margin-bottom:0;height:100%">
        <div class="panel-head">
          <span class="panel-title">顧客インサイト</span>
          <button class="btn btn-ghost btn-sm" onclick="go('customers')">一覧 →</button>
        </div>
        <div class="panel-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
            <div class="stat-card" style="margin:0;padding:11px 13px">
              <div class="stat-label">平均 CLV</div>
              <div class="stat-val" style="font-size:17px;color:var(--green)">${AE.fmtYen(ins.avgCLV)}</div>
              <div class="stat-sub">顧客生涯価値</div>
            </div>
            <div class="stat-card" style="margin:0;padding:11px 13px">
              <div class="stat-label">離脱リスク</div>
              <div class="stat-val" style="font-size:17px;color:${riskColor}">${ins.atRiskCount}名</div>
              <div class="stat-sub">90日以上未接触</div>
            </div>
            <div class="stat-card" style="margin:0;padding:11px 13px">
              <div class="stat-label">新規 (30日)</div>
              <div class="stat-val" style="font-size:17px">${ins.newIn30}名</div>
              <div class="stat-sub">新規顧客</div>
            </div>
            <div class="stat-card" style="margin:0;padding:11px 13px">
              <div class="stat-label">リピート率</div>
              <div class="stat-val" style="font-size:17px;color:var(--blue)">${ins.repeatRate}%</div>
              <div class="stat-sub">複数回利用</div>
            </div>
          </div>
          ${cohortBars ? `<div class="bi-section-header">月別新規獲得コホート</div>${cohortBars}` : ''}
          ${topRows ? `<div class="bi-section-header" style="margin-top:12px">CLV 上位顧客</div>${topRows}` : ''}
        </div>
      </div>`;
  }

  function _skeleton() {
    return `<div class="panel" style="margin-bottom:0;height:100%">
      <div class="panel-head"><span class="panel-title">顧客インサイト</span></div>
      <div class="panel-body"><div class="empty" style="padding:20px 0"><p>データなし</p></div></div>
    </div>`;
  }

  window.CustomerInsights = { compute, render };
})();
