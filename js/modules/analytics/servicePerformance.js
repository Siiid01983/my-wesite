'use strict';
/* ════════════════════════════════════════════════════════
   SERVICE PERFORMANCE — Phase 23B
   人気サービスランキング

   Tracks 5 core services with 4 metrics each:
     予約数   — active (non-cancelled) booking count
     売上     — total revenue from active bookings
     完了率   — completed ÷ (total − cancelled) × 100
     平均単価 — revenue ÷ active bookings

   Composite ranking score (0–100):
     予約数 30% + 売上 30% + 完了率 20% + 平均単価 20%

   Growth indicator: last-30-day count vs prior-30-day count.
   Depends on: AnalyticsEngine, Adapter
   ════════════════════════════════════════════════════════ */
(function () {

  /* ── Five canonical services ── */
  const SERVICES = [
    { key: 'single',    label: '単身引越し',             short: '単身',
      aliases: ['単身引越し'] },
    { key: 'couple',    label: 'カップル・ご夫婦引越し', short: 'カップル',
      aliases: ['カップル・ご夫婦引越し'] },
    { key: 'student',   label: '学生・新生活引越し',     short: '学生',
      aliases: ['学生・新生活引越し'] },
    { key: 'disposal',  label: '不用品回収・処分',       short: '不用品',
      aliases: ['不用品回収・処分', '不用品回収・処分サービス'] },
    { key: 'furniture', label: '家具組立・分解',         short: '家具',
      aliases: ['家具組立・分解'] },
  ];

  /* Reverse-lookup: alias string → service key */
  const _ALIAS = {};
  SERVICES.forEach(s => s.aliases.forEach(a => { _ALIAS[a] = s.key; }));

  function _resolveKey(svc) { return _ALIAS[svc] || null; }

  function _priceFor(svc) {
    const prices = window.Adapter ? Adapter.getPrices() : {};
    const p = prices[svc] || 0;
    return typeof p === 'number' ? p : (p.base || 0);
  }

  function _normalize(values) {
    const max = Math.max(...values, 1);
    return values.map(v => v / max);
  }

  /* ═══════════════════════════════════════════════════════
     COMPUTE — returns ranked array of service objects
  ════════════════════════════════════════════════════════ */
  function compute(bookings) {
    const AE    = window.AnalyticsEngine;
    const bk    = bookings || (window.Adapter ? Adapter.getBookings() : []);
    const iso30 = AE ? AE.daysAgoIso(30) : '';
    const iso60 = AE ? AE.daysAgoIso(60) : '';

    /* Initialise all 5 service counters */
    const map = {};
    SERVICES.forEach(s => {
      map[s.key] = { ...s, total: 0, active: 0, completed: 0, revenue: 0, last30: 0, prev30: 0 };
    });

    /* Accumulate booking metrics */
    bk.forEach(b => {
      const svc = b.service || b.service_type || '';
      const key = _resolveKey(svc);
      if (!key) return;
      const m  = map[key];
      const d  = b.date || b.move_date || '';
      const st = b.status || '';
      m.total++;
      if (st === 'キャンセル' || st === 'cancelled') return;
      m.active++;
      m.revenue += _priceFor(svc);
      if (st === '完了' || st === 'completed') m.completed++;
      if (d >= iso30) m.last30++;
      if (d >= iso60 && d < iso30) m.prev30++;
    });

    const services = Object.values(map);

    /* Derived metrics */
    services.forEach(s => {
      s.completionRate = s.active  > 0 ? Math.round((s.completed / s.active) * 100) : 0;
      s.avgOrderValue  = s.active  > 0 ? Math.round(s.revenue / s.active) : 0;
      s.growth         = AE ? AE.pct(s.last30, s.prev30 || 1) : 0;
    });

    /* Composite score */
    const normBk   = _normalize(services.map(s => s.active));
    const normRev  = _normalize(services.map(s => s.revenue));
    const normComp = _normalize(services.map(s => s.completionRate));
    const normAov  = _normalize(services.map(s => s.avgOrderValue));

    services.forEach((s, i) => {
      s.score = Math.round(
        normBk[i]   * 0.30 +
        normRev[i]  * 0.30 +
        normComp[i] * 0.20 +
        normAov[i]  * 0.20
      ) * 100;
      /* Re-scale 0–100 */
      s.score = Math.round(
        (normBk[i] * 0.30 + normRev[i] * 0.30 + normComp[i] * 0.20 + normAov[i] * 0.20) * 100
      );
    });

    return services.sort((a, b) => b.score - a.score);
  }

  /* ═══════════════════════════════════════════════════════
     RENDER — 人気サービスランキング panel
  ════════════════════════════════════════════════════════ */

  const _MEDALS   = ['🥇', '🥈', '🥉'];
  const _BAR_COLS = ['var(--yellow)', 'var(--gray-2)', '#cd7f32', 'var(--blue)', 'var(--blue)'];
  const _BG_TINTS = [
    'rgba(245,158,11,.07)', 'rgba(156,163,175,.06)',
    'rgba(180,140,90,.06)', 'transparent', 'transparent',
  ];

  function _chip(val, label, color) {
    return `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:12px;background:var(--bg-soft-2);font-size:10px">
      <span style="font-weight:700;color:${color || 'var(--ink)'}">${val}</span>
      <span style="color:var(--gray-2)">${label}</span>
    </span>`;
  }

  function render(containerId, bookings) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const services = compute(bookings);
    const AE       = window.AnalyticsEngine;
    const fmt      = n => AE ? AE.fmtYen(n) : '¥' + Math.round(n || 0).toLocaleString();
    const maxScore = Math.max(...services.map(s => s.score), 1);
    const hasData  = services.some(s => s.total > 0);

    if (!hasData) { el.innerHTML = _skeleton(); return; }

    const top = services[0];

    const rows = services.map((s, i) => {
      const barW = Math.round((s.score / maxScore) * 100);
      const gc   = s.growth > 0 ? 'var(--green)' : s.growth < 0 ? 'var(--red)' : 'var(--gray-2)';
      const gi   = s.growth > 0 ? '↑' : s.growth < 0 ? '↓' : '→';
      const rank = i < 3 ? `<span style="font-size:18px;line-height:1">${_MEDALS[i]}</span>`
                         : `<span style="font-size:12px;font-weight:700;color:var(--gray-2);min-width:20px;text-align:center">#${i + 1}</span>`;

      const compColor = s.completionRate >= 80 ? 'var(--green)'
                      : s.completionRate >= 50 ? 'var(--yellow)'
                      : 'var(--red)';

      return `
        <div style="padding:11px 12px;border-radius:10px;background:${_BG_TINTS[i]};margin-bottom:8px${i < 3 ? ';border:1px solid var(--line-2)' : ''}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            ${rank}
            <span style="font-size:13px;font-weight:700;color:var(--ink);flex:1">${s.label}</span>
            <span style="font-size:12px;font-weight:700;color:var(--blue)">${s.score}pt</span>
            <span style="font-size:11px;font-weight:600;color:${gc};min-width:36px;text-align:right">${gi}${Math.abs(s.growth)}%</span>
          </div>
          <div style="background:var(--bg-soft-2);border-radius:4px;height:6px;overflow:hidden;margin-bottom:8px">
            <div style="width:${barW}%;height:6px;border-radius:4px;background:${_BAR_COLS[i]};transition:width .4s ease"></div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">
            ${_chip(s.active + '件',       '予約数', '')}
            ${_chip(fmt(s.revenue),         '売上',   'var(--green)')}
            ${_chip(s.completionRate + '%', '完了率',  compColor)}
            ${_chip(fmt(s.avgOrderValue),   '平均単価','var(--blue)')}
          </div>
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="panel" style="margin-bottom:0">
        <div class="panel-head">
          <span class="panel-title">人気サービスランキング</span>
          <span style="font-size:11px;color:var(--gray-2)">予約・売上・完了率・平均単価</span>
        </div>
        <div class="panel-body">

          ${top.total > 0 ? `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.18);margin-bottom:14px">
            <span style="font-size:24px">🏆</span>
            <div>
              <div style="font-size:10px;font-weight:600;color:var(--yellow);text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px">総合1位</div>
              <div style="font-size:14px;font-weight:700;color:var(--ink)">${top.label}</div>
              <div style="font-size:11px;color:var(--gray-1);margin-top:2px">${top.active}件 · ${fmt(top.revenue)} · 完了率 ${top.completionRate}%</div>
            </div>
          </div>` : ''}

          ${rows}

          <div style="margin-top:10px;padding:8px 10px;border-radius:8px;background:var(--bg-soft);font-size:10px;color:var(--gray-2);line-height:1.5">
            スコア = 予約数 30% + 売上 30% + 完了率 20% + 平均単価 20% の複合評価
          </div>
        </div>
      </div>`;
  }

  function _skeleton() {
    return `<div class="panel" style="margin-bottom:0">
      <div class="panel-head"><span class="panel-title">人気サービスランキング</span></div>
      <div class="panel-body"><div class="empty" style="padding:20px 0"><p>データなし</p></div></div>
    </div>`;
  }

  window.ServicePerformance = { compute, render, SERVICES };
})();
