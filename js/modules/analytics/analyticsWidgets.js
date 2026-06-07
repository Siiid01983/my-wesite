'use strict';
/* ════════════════════════════════════════════════════════
   ANALYTICS WIDGETS — Phase 23 / 23E
   Widget registry + three standalone widgets.

   Registry API (Phase 23E):
     AnalyticsWidgets.register(id, config)
       config: { label, icon, renderFn(containerId, bk, qt) }
     AnalyticsWidgets.renderWidget(id, containerId, bk, qt)
     AnalyticsWidgets.getAll() → [{id, label, icon}, ...]

   Built-in widgets:
     renderDemandForecast — weekly booking demand projection
     renderDowHeatmap     — day-of-week intensity heatmap
     renderInsightCards   — AI-style business insight cards
   Depends on: AnalyticsEngine, drawBarChart (admin-analytics.js)
   ════════════════════════════════════════════════════════ */
(function () {

  /* ── Widget registry ── */
  var _registry = {};

  function register(id, config) {
    _registry[id] = config || {};
  }

  function renderWidget(id, containerId, bk, qt) {
    var cfg = _registry[id];
    if (!cfg || typeof cfg.renderFn !== 'function') return;
    cfg.renderFn(containerId, bk, qt);
  }

  function getAll() {
    return Object.keys(_registry).map(function (id) {
      return { id: id, label: _registry[id].label || id, icon: _registry[id].icon || '' };
    });
  }

  const _DOW_S = ['日','月','火','水','木','金','土'];
  const _DOW_L = ['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'];

  /* ══ 1. DEMAND FORECAST ══════════════════════════════════
     Aggregates last 12 weeks, runs linear regression,
     projects 4 weeks forward. Renders bar chart with
     last-6-weeks actuals + 4-week forecast.
  ══════════════════════════════════════════════════════════ */
  function renderDemandForecast(containerId, bookings) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const AE = window.AnalyticsEngine;
    if (!AE || !bookings.length) {
      el.innerHTML = _empty('週次需要予測', 'データなし');
      return;
    }

    /* Build 12-week history */
    const WEEKS    = 12;
    const weekData = [];
    for (let i = WEEKS - 1; i >= 0; i--) {
      const start = new Date(); start.setHours(0,0,0,0);
      start.setDate(start.getDate() - start.getDay() - i * 7);
      const end  = new Date(start); end.setDate(start.getDate() + 6);
      const s    = start.toISOString().slice(0, 10);
      const e    = end.toISOString().slice(0, 10);
      weekData.push({ cnt: bookings.filter(b => { const d = b.date || b.move_date || ''; return d >= s && d <= e; }).length });
    }

    const points   = weekData.map((w, i) => ({ x: i, y: w.cnt }));
    const reg      = AE.linearRegression(points);
    const nextWeeks = AE.forecastNext(reg, points.length - 1, 4).map(Math.round);
    const total4   = nextWeeks.reduce((s, v) => s + v, 0);

    const isDark    = document.documentElement.classList.contains('dark');
    const trendTxt  = reg.slope > 0 ? '上昇トレンド ↑' : reg.slope < 0 ? '下降トレンド ↓' : '横ばい →';
    const trendCol  = reg.slope > 0 ? 'var(--green)' : reg.slope < 0 ? 'var(--red)' : 'var(--gray-1)';

    el.innerHTML = `
      <div class="panel" style="margin-bottom:0;height:100%">
        <div class="panel-head">
          <span class="panel-title">週次需要予測</span>
          <span style="font-size:11px;color:${trendCol}">${trendTxt}</span>
        </div>
        <div class="panel-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
            <div class="stat-card" style="margin:0;padding:11px 13px">
              <div class="stat-label">来週の予測</div>
              <div class="stat-val" style="font-size:22px;color:var(--blue)">${nextWeeks[0]}件</div>
              <div class="stat-sub">予測予約数</div>
            </div>
            <div class="stat-card" style="margin:0;padding:11px 13px">
              <div class="stat-label">翌4週間合計</div>
              <div class="stat-val" style="font-size:22px">${total4}件</div>
              <div class="stat-sub">予測合計</div>
            </div>
          </div>
          <canvas id="demandForecastCanvas" class="bi-chart-canvas"></canvas>
        </div>
      </div>`;

    requestAnimationFrame(() => {
      if (typeof drawBarChart !== 'function') return;
      const actuals   = weekData.slice(-6).map(w => w.cnt);
      const labels    = [...actuals.map((_, i) => `W-${6 - i}`), '来週','2週','3週','4週'];
      drawBarChart('demandForecastCanvas', labels, [...actuals, ...nextWeeks], isDark);
    });
  }

  /* ══ 2. DAY-OF-WEEK HEATMAP ══════════════════════════════
     Shows booking concentration per day as colour-filled
     tiles. Darker = more bookings.
  ══════════════════════════════════════════════════════════ */
  function renderDowHeatmap(containerId, bookings) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const counts = [0, 0, 0, 0, 0, 0, 0];
    const active = bookings.filter(b => b.status !== 'キャンセル' && b.status !== 'cancelled');
    active.forEach(b => {
      const d = b.date || b.move_date;
      if (d) counts[new Date(d + 'T00:00:00').getDay()]++;
    });

    const max = Math.max(...counts, 1);
    const cells = counts.map((cnt, i) => {
      const ratio   = cnt / max;
      const bg      = `rgba(37,99,235,${Math.max(0.06, ratio)})`;
      const txtCol  = ratio > 0.55 ? '#fff' : 'var(--ink)';
      return `
        <div title="${_DOW_L[i]}: ${cnt}件"
             style="flex:1;text-align:center;border-radius:8px;padding:10px 3px;background:${bg}">
          <div style="font-size:11px;font-weight:600;color:${txtCol}">${_DOW_S[i]}</div>
          <div style="font-size:15px;font-weight:700;color:${txtCol};margin:3px 0">${cnt}</div>
          <div style="font-size:10px;color:${txtCol};opacity:.8">${i===0||i===6?'休':'平'}</div>
        </div>`;
    }).join('');

    const topDow = counts.indexOf(Math.max(...counts));
    el.innerHTML = `
      <div class="panel" style="margin-bottom:0;height:100%">
        <div class="panel-head">
          <span class="panel-title">曜日別 需要ヒートマップ</span>
          <span style="font-size:11px;color:var(--gray-2)">最多: ${_DOW_L[topDow]}</span>
        </div>
        <div class="panel-body">
          <div style="display:flex;gap:5px;margin-bottom:10px">${cells}</div>
          <div style="font-size:11px;color:var(--gray-2);line-height:1.5">
            色の濃さが予約集中度を示します。ピーク曜日にリソースを優先配置してください。
          </div>
        </div>
      </div>`;
  }

  /* ══ 3. INSIGHT CARDS ════════════════════════════════════
     Generates business insight cards from pre-computed
     module outputs. Up to 4 cards, highest severity first.
  ══════════════════════════════════════════════════════════ */
  function renderInsightCards(containerId, data) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const cards = _generateInsights(data);
    if (!cards.length) { el.innerHTML = ''; return; }

    const html = cards.map(c => `
      <div style="background:var(--bg-soft);border-radius:12px;padding:14px 16px;border-left:3px solid ${c.color}">
        <div style="font-size:12px;font-weight:700;margin-bottom:4px;color:${c.color}">${c.icon} ${c.title}</div>
        <div style="font-size:12px;color:var(--gray-1);line-height:1.5">${c.body}</div>
      </div>`).join('');

    el.innerHTML = `
      <div class="panel" style="margin-bottom:0">
        <div class="panel-head"><span class="panel-title">ビジネスインサイト</span></div>
        <div class="panel-body" style="display:flex;flex-direction:column;gap:10px">${html}</div>
      </div>`;
  }

  /* ── Build insight cards from module outputs ── */
  function _generateInsights({ forecast, performance, insights: ci, conversion } = {}) {
    const out = [];

    if (forecast) {
      if (forecast.isGrowing && forecast.growthPct > 20) {
        out.push({ priority: 1, icon: '📈', color: 'var(--green)',
          title: '売上上昇トレンド検出',
          body: `直近6ヶ月で売上が ${Math.abs(forecast.growthPct)}% 増加中。リソース増強・早期予約特典を検討してください。` });
      } else if (!forecast.isGrowing && Math.abs(forecast.growthPct) > 15) {
        out.push({ priority: 1, icon: '📉', color: 'var(--red)',
          title: '売上下降に注意',
          body: `直近6ヶ月で売上が ${Math.abs(forecast.growthPct)}% 減少中。プロモーション強化またはオフシーズン割引を検討してください。` });
      }
      if (forecast.anomalyMonths && forecast.anomalyMonths.length) {
        out.push({ priority: 2, icon: '⚠️', color: 'var(--yellow)',
          title: '売上異常値を検出',
          body: `${forecast.anomalyMonths.join(', ')} に通常と大きく異なる売上パターンがあります。原因を確認してください。` });
      }
    }

    if (performance && performance.length) {
      const top = performance[0];
      const bot = performance[performance.length - 1];
      if (top) out.push({ priority: 2, icon: '⭐', color: 'var(--blue)',
        title: `トップサービス: ${top.label}`,
        body: `スコア ${top.score}pt で最高パフォーマンス。成長率 ${top.growth}% を維持。集中的な訴求で収益最大化を図れます。` });
      if (bot && bot.score < 30 && performance.length > 2) {
        out.push({ priority: 3, icon: '💡', color: 'var(--yellow)',
          title: `改善余地: ${bot.label}`,
          body: `スコア ${bot.score}pt で最低。料金見直しまたはターゲット広告でてこ入れを検討してください。` });
      }
    }

    if (ci && ci.atRiskCount > 3) {
      out.push({ priority: 1, icon: '🔔', color: 'var(--red)',
        title: `${ci.atRiskCount} 名が離脱リスク`,
        body: `90日以上予約のないリピーター顧客がいます。フォローアップメールまたは特別オファーで再エンゲージを図ってください。` });
    }

    if (conversion && conversion.convRate < 20 && conversion.funnel.quotes > 5) {
      out.push({ priority: 2, icon: '🎯', color: 'var(--yellow)',
        title: '転換率が低い状態',
        body: `見積りから予約への転換率が ${conversion.convRate}% です。自動フォローアップや返信速度の改善が効果的です。` });
    }

    return out.sort((a, b) => a.priority - b.priority).slice(0, 4);
  }

  function _empty(title, msg) {
    return `<div class="panel" style="margin-bottom:0;height:100%">
      <div class="panel-head"><span class="panel-title">${title}</span></div>
      <div class="panel-body"><div class="empty" style="padding:20px 0"><p>${msg}</p></div></div>
    </div>`;
  }

  window.AnalyticsWidgets = {
    /* Registry API */
    register: register, renderWidget: renderWidget, getAll: getAll,
    /* Built-in widgets */
    renderDemandForecast: renderDemandForecast,
    renderDowHeatmap:     renderDowHeatmap,
    renderInsightCards:   renderInsightCards,
  };
})();
