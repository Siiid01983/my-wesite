'use strict';
/* ════════════════════════════════════════════════════════
   SERVICE PERFORMANCE — Phase 23
   Composite performance score per service (0–100 pts):
     volume  40%  — share of total active bookings
     revenue 40%  — share of total revenue
     growth  20%  — 30-day count vs prior 30-day count
   Renders a ranked bar list with trend badges.
   Depends on: AnalyticsEngine, Adapter
   ════════════════════════════════════════════════════════ */
(function () {

  const _SHORT = {
    '単身引越し':'単身',
    'カップル・ご夫婦引越し':'カップル',
    '学生・新生活引越し':'学生',
    '当日・お急ぎ引越しプラン':'当日',
    '不用品回収・処分':'不用品',
    '不用品回収・処分サービス':'不用品',
    '家具組立・分解':'家具',
    'その他':'その他',
  };

  function _priceFor(svc) {
    const prices = window.Adapter ? Adapter.getPrices() : {};
    const p = prices[svc] || 0;
    return typeof p === 'number' ? p : (p.base || 0);
  }

  function _normalize(values) {
    const max = Math.max(...values, 1);
    return values.map(v => v / max);
  }

  /* ── Compute ranked service list ── */
  function compute(bookings) {
    const AE = window.AnalyticsEngine;
    if (!AE || !bookings.length) return [];

    const iso30 = AE.daysAgoIso(30);
    const iso60 = AE.daysAgoIso(60);

    const active = bookings.filter(b => b.status !== 'キャンセル' && b.status !== 'cancelled');

    const map = {};
    active.forEach(b => {
      const svc = b.service || b.service_type || 'その他';
      const d   = b.date || b.move_date || '';
      if (!map[svc]) map[svc] = { svc, count: 0, rev: 0, last30: 0, prev30: 0 };
      map[svc].count++;
      map[svc].rev += _priceFor(svc);
      if (d >= iso30) map[svc].last30++;
      if (d >= iso60 && d < iso30) map[svc].prev30++;
    });

    const services = Object.values(map);
    if (!services.length) return [];

    const normVol  = _normalize(services.map(s => s.count));
    const normRev  = _normalize(services.map(s => s.rev));
    const normGrow = services.map(s => {
      const g = AE.pct(s.last30, s.prev30 || 1);
      return Math.max(0, Math.min(g, 100)) / 100;
    });

    services.forEach((s, i) => {
      s.label  = _SHORT[s.svc] || s.svc.slice(0, 8);
      s.growth = AE.pct(s.last30, s.prev30 || 1);
      s.score  = Math.round((normVol[i] * 0.4 + normRev[i] * 0.4 + normGrow[i] * 0.2) * 100);
    });

    return services.sort((a, b) => b.score - a.score);
  }

  /* ── Render into a container element ── */
  function render(containerId, bookings) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const services = compute(bookings);

    if (!services.length) { el.innerHTML = _skeleton(); return; }

    const AE       = window.AnalyticsEngine;
    const maxScore = Math.max(...services.map(s => s.score), 1);

    const rows = services.map(s => {
      const barPct = Math.round((s.score / maxScore) * 100);
      const gc     = s.growth > 0 ? 'var(--green)' : s.growth < 0 ? 'var(--red)' : 'var(--gray-1)';
      const gi     = s.growth > 0 ? '↑' : s.growth < 0 ? '↓' : '→';
      return `
        <div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:12px;font-weight:600">${s.label}</span>
            <div style="display:flex;align-items:center;gap:8px;font-size:11px">
              <span style="color:var(--gray-1)">${s.count}件 / ${AE.fmtYen(s.rev)}</span>
              <span style="color:${gc};font-weight:600">${gi}${Math.abs(s.growth)}%</span>
              <span style="font-weight:700;color:var(--blue);min-width:36px;text-align:right">${s.score}pt</span>
            </div>
          </div>
          <div style="background:var(--bg-soft-2);border-radius:4px;height:8px;overflow:hidden">
            <div style="width:${barPct}%;height:8px;background:var(--blue);border-radius:4px;transition:width .4s ease"></div>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="panel" style="margin-bottom:0;height:100%">
        <div class="panel-head">
          <span class="panel-title">サービス パフォーマンス</span>
          <span style="font-size:11px;color:var(--gray-2)">量・売上・成長 複合スコア</span>
        </div>
        <div class="panel-body">
          <div style="font-size:11px;color:var(--gray-2);margin-bottom:12px;line-height:1.4">
            量 40% + 売上 40% + 成長 20% の複合スコア。成長率は直近30日 vs 前30日の比較です。
          </div>
          ${rows}
        </div>
      </div>`;
  }

  function _skeleton() {
    return `<div class="panel" style="margin-bottom:0;height:100%">
      <div class="panel-head"><span class="panel-title">サービス パフォーマンス</span></div>
      <div class="panel-body"><div class="empty" style="padding:20px 0"><p>データなし</p></div></div>
    </div>`;
  }

  window.ServicePerformance = { compute, render };
})();
