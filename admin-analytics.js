'use strict';

/* ════════════════════════════════════════════════════════
   ADMIN ANALYTICS MODULE
   Analytics period state, KPI rendering, chart drawing
   ════════════════════════════════════════════════════════ */
let _aPeriod = '6m';
let _aFrom   = '';
let _aTo     = '';

const _DOW_JP = ['日','月','火','水','木','金','土'];
const _SVC_SHORT = {
  '単身引越し':'単身引越し',
  'カップル・ご夫婦引越し':'カップル',
  '学生・新生活引越し':'学生引越し',
  '当日・お急ぎ引越し':'当日プラン',
  '不用品回収・処分サービス':'不用品回収',
  '家具組立・分解':'家具組立',
};
const _A_PERIODS = [
  {key:'7d',    label:'過去7日'},
  {key:'30d',   label:'過去30日'},
  {key:'3m',    label:'過去3ヶ月'},
  {key:'6m',    label:'過去6ヶ月'},
  {key:'year',  label:'今年'},
  {key:'all',   label:'全期間'},
  {key:'custom',label:'カスタム'},
];

function getAnalyticsRange() {
  const t = new Date(); t.setHours(0,0,0,0);
  const toStr = todayStr();
  if (_aPeriod === 'custom') return { from: _aFrom || '2020-01-01', to: _aTo || toStr };
  let from = new Date(t);
  if      (_aPeriod === '7d')   from.setDate(t.getDate() - 6);
  else if (_aPeriod === '30d')  from.setDate(t.getDate() - 29);
  else if (_aPeriod === '3m')   from.setMonth(t.getMonth() - 3);
  else if (_aPeriod === '6m')   from.setMonth(t.getMonth() - 6);
  else if (_aPeriod === 'year') from = new Date(t.getFullYear(), 0, 1);
  else                          from = new Date(2020, 0, 1);
  return {
    from: `${from.getFullYear()}-${pad(from.getMonth()+1)}-${pad(from.getDate())}`,
    to: toStr
  };
}

function _aInitFilter() {
  const wrap = document.getElementById('analyticsPeriodBtns');
  if (!wrap) return;
  if (!wrap.dataset.inited) {
    wrap.dataset.inited = '1';
    wrap.innerHTML = _A_PERIODS.map(p =>
      `<button class="btn btn-sm btn-ghost" data-aperiod="${p.key}" onclick="setAnalyticsPeriod('${p.key}')">${p.label}</button>`
    ).join('');
    const r = getAnalyticsRange();
    const af = document.getElementById('aFrom');
    const at = document.getElementById('aTo');
    if (af) af.value = r.from;
    if (at) at.value = r.to;
  }
  _aUpdateBtns();
}

function _aUpdateBtns() {
  document.querySelectorAll('#analyticsPeriodBtns button[data-aperiod]').forEach(btn => {
    btn.className = `btn btn-sm ${btn.dataset.aperiod === _aPeriod ? 'btn-primary' : 'btn-ghost'}`;
  });
  const cr = document.getElementById('analyticsCustomRange');
  if (cr) cr.style.display = _aPeriod === 'custom' ? 'flex' : 'none';
}

function setAnalyticsPeriod(key) {
  _aPeriod = key;
  _aUpdateBtns();
  if (key !== 'custom') renderAnalyticsCharts();
}

function applyAnalyticsCustom() {
  const f = document.getElementById('aFrom')?.value;
  const t = document.getElementById('aTo')?.value;
  if (!f || !t)  { toast('開始日と終了日を選択してください'); return; }
  if (f > t)     { toast('開始日は終了日より前にしてください'); return; }
  _aFrom = f; _aTo = t;
  renderAnalyticsCharts();
}

function renderAnalytics() {
  _aInitFilter();
  renderAnalyticsCharts();
}

/* ── Analytics helper: KPI grid ── */
function _renderAnalyticsKPIs(bkInRange, qtInRange, prices, periodLabel, calIcon) {
  const activeBkR  = bkInRange.filter(b => b.status !== 'キャンセル');
  const totalBk    = bkInRange.length;
  const totalQt    = qtInRange.length;
  const convRate   = totalQt > 0 ? Math.round((activeBkR.length / totalQt) * 100) : 0;

  const svcCount = {};
  activeBkR.forEach(b => { svcCount[b.service] = (svcCount[b.service]||0) + 1; });
  const topSvcEntry = Object.entries(svcCount).sort((a,b) => b[1]-a[1])[0];

  let periodRevenue = 0;
  activeBkR.forEach(b => {
    const p = prices[b.service];
    periodRevenue += (typeof p === 'number' ? p : (p && p.base) || 0);
  });

  const dowCount = [0,0,0,0,0,0,0];
  activeBkR.forEach(b => { if (b.date) dowCount[new Date(b.date+'T00:00:00').getDay()]++; });
  const maxDow = Math.max(...dowCount);
  const topDow = dowCount.indexOf(maxDow);

  const convColor = convRate >= 50 ? 'var(--green)' : (convRate >= 25 ? 'var(--yellow)' : 'var(--red)');
  const kpis = [
    { label:'総予約数',         val: totalBk,                                                             sub: `確定済み ${bkInRange.filter(b=>b.status==='確定').length}件`, color: '',            sm: false },
    { label:'見積りリクエスト', val: totalQt,                                                             sub: '受付済み合計',                                                color: 'var(--blue)', sm: false },
    { label:'転換率',           val: convRate + '%',                                                      sub: '見積り → 予約 (キャンセル除く)',                              color: convColor,      sm: false },
    { label:'人気サービス',     val: topSvcEntry ? (_SVC_SHORT[topSvcEntry[0]]||topSvcEntry[0]) : '—',  sub: topSvcEntry ? topSvcEntry[1]+'件のご依頼' : 'データなし',      color: '#8b5cf6',     sm: true  },
    { label:'期間売上概算',     val: '¥' + periodRevenue.toLocaleString(),                               sub: '基本料金ベース・キャンセル除く',                               color: 'var(--green)', sm: true  },
    { label:'人気の引越し曜日', val: maxDow > 0 ? _DOW_JP[topDow]+'曜日' : '—',                         sub: maxDow > 0 ? maxDow+'件 最多予約曜日' : 'データなし',            color: 'var(--blue)', sm: true  },
  ];

  document.getElementById('analyticsGrid').innerHTML = kpis.map(k =>
    `<div class="stat-card">
      <div class="stat-label">${k.label}</div>
      <div class="stat-val" style="color:${k.color||'var(--ink)'};${k.sm?'font-size:18px;line-height:1.3;word-break:break-all':''}">${k.val}</div>
      <div class="stat-sub">${k.sub}</div>
      <div class="stat-period">${calIcon}${periodLabel}</div>
    </div>`
  ).join('');
}

/* ── Analytics helper: chart drawing ── */
function _drawAnalyticsCharts(bk, from, to, fromD, toD, days, isDark, chartPeriodLabel) {
  let c1Labels = [], c1Data = [], c1Title = '';

  if (days <= 14) {
    c1Title = `日別予約推移`;
    for (let i = 0; i < days; i++) {
      const d  = new Date(fromD); d.setDate(fromD.getDate() + i);
      const ds = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      c1Labels.push(_DOW_JP[d.getDay()]);
      c1Data.push(bk.filter(b => b.date === ds).length);
    }
  } else if (days <= 84) {
    c1Title = `週別予約推移`;
    const weeks = Math.ceil(days / 7);
    for (let i = 0; i < weeks; i++) {
      const ws  = new Date(fromD); ws.setDate(fromD.getDate() + i * 7);
      const we  = new Date(ws);    we.setDate(ws.getDate() + 6);
      const wsS = `${ws.getFullYear()}-${pad(ws.getMonth()+1)}-${pad(ws.getDate())}`;
      const weS = `${we.getFullYear()}-${pad(we.getMonth()+1)}-${pad(we.getDate())}`;
      c1Labels.push(`${ws.getMonth()+1}/${ws.getDate()}`);
      c1Data.push(bk.filter(b => b.date >= wsS && b.date <= weS).length);
    }
  } else {
    c1Title = `月別予約推移`;
    let cur = new Date(fromD.getFullYear(), fromD.getMonth(), 1);
    const endM = new Date(toD.getFullYear(), toD.getMonth(), 1);
    while (cur <= endM) {
      const ym = `${cur.getFullYear()}-${pad(cur.getMonth()+1)}`;
      const thisYear = cur.getFullYear() === new Date().getFullYear();
      c1Labels.push(thisYear ? `${cur.getMonth()+1}月` : `${cur.getFullYear()}/${cur.getMonth()+1}`);
      c1Data.push(bk.filter(b => b.date && b.date.startsWith(ym)).length);
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  const c2Labels = [], c2Data = [];
  {
    let cur = new Date(fromD.getFullYear(), fromD.getMonth(), 1);
    const endM = new Date(toD.getFullYear(), toD.getMonth(), 1);
    while (cur <= endM) {
      const ym = `${cur.getFullYear()}-${pad(cur.getMonth()+1)}`;
      c2Labels.push(`${cur.getMonth()+1}月`);
      c2Data.push(bk.filter(b => b.date && b.date.startsWith(ym)).length);
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  const c3SvcCount = {};
  bk.filter(b => b.date >= from && b.date <= to && b.status !== 'キャンセル').forEach(b => {
    c3SvcCount[b.service] = (c3SvcCount[b.service] || 0) + 1;
  });
  const svcKeys  = Object.keys(c3SvcCount).sort((a,b) => c3SvcCount[b] - c3SvcCount[a]);
  const c3Labels = svcKeys.map(s => _SVC_SHORT[s] || s.slice(0, 6));
  const c3Data   = svcKeys.map(s => c3SvcCount[s]);

  document.getElementById('analyticsCharts').innerHTML = `
    <div class="chart-card">
      <div class="chart-title">${c1Title}<span style="font-size:10px;color:var(--gray-2);margin-left:6px;font-weight:400">${chartPeriodLabel}</span></div>
      <canvas id="chartC1" class="chart-canvas"></canvas>
    </div>
    <div class="chart-card">
      <div class="chart-title">月別予約数<span style="font-size:10px;color:var(--gray-2);margin-left:6px;font-weight:400">${chartPeriodLabel}</span></div>
      <canvas id="chartC2" class="chart-canvas"></canvas>
    </div>
    <div class="chart-card">
      <div class="chart-title">サービス人気度<span style="font-size:10px;color:var(--gray-2);margin-left:6px;font-weight:400">${chartPeriodLabel}</span></div>
      <canvas id="chartC3" class="chart-canvas"></canvas>
    </div>`;

  requestAnimationFrame(() => {
    drawBarChart('chartC1', c1Labels, c1Data, isDark);
    drawBarChart('chartC2', c2Labels, c2Data, isDark);
    drawHBarChart('chartC3', c3Labels, c3Data, isDark);
  });
}

/* ── Analytics helper: popular dates panel ── */
function _renderAnalyticsPopularDates(bk, from, to) {
  const today = todayStr();
  const dateCount = {};
  bk.filter(b => b.status !== 'キャンセル' && b.date >= from && b.date <= to && b.date >= today).forEach(b => {
    dateCount[b.date] = (dateCount[b.date] || 0) + 1;
  });
  const topDates = Object.entries(dateCount).sort((a,b) => b[1]-a[1]).slice(0, 6);
  const extraEl  = document.getElementById('analyticsExtra');
  if (!extraEl) return;
  if (topDates.length) {
    const rows = topDates.map(([dt, cnt]) => {
      const d  = new Date(dt + 'T00:00:00');
      const dw = d.getDay();
      return `<div class="settings-row">
        <div>
          <div class="settings-label">${dt}</div>
          <div class="settings-sub">${_DOW_JP[dw]}曜日${dw===0||dw===6?' · 週末':''}</div>
        </div>
        <span class="badge badge-confirmed">${cnt}件</span>
      </div>`;
    }).join('');
    extraEl.innerHTML = `<div class="panel"><div class="panel-head"><span class="panel-title">人気の引越し日（期間内・今後）</span></div><div class="panel-body">${rows}</div></div>`;
  } else {
    extraEl.innerHTML = `<div class="panel"><div class="panel-head"><span class="panel-title">人気の引越し日</span></div><div class="panel-body"><div class="empty" style="padding:20px"><p>期間内に今後の予約データがありません</p></div></div></div>`;
  }
}

function renderAnalyticsCharts() {
  const isDark = document.documentElement.classList.contains('dark');
  const { from, to } = getAnalyticsRange();
  const bk    = Adapter.getBookings();
  const quotes = Adapter.getQuotes();
  const prices = Adapter.getPrices();
  const fromD  = new Date(from + 'T00:00:00');
  const toD    = new Date(to   + 'T00:00:00');
  const days   = Math.round((toD - fromD) / 86400000) + 1;

  const periodLabel = _aPeriod === 'custom'
    ? `${from.slice(5)} 〜 ${to.slice(5)}`
    : (_A_PERIODS.find(p => p.key === _aPeriod)?.label || '');
  const calIcon = `<svg viewBox="0 0 24 24" width="10" height="10" style="flex-shrink:0"><path fill="currentColor" d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/></svg>`;
  const chartPeriodLabel = _aPeriod === 'custom'
    ? `${from} 〜 ${to}`
    : (_A_PERIODS.find(p => p.key === _aPeriod)?.label || '');

  const bkInRange = bk.filter(b => b.date >= from && b.date <= to);
  const qtInRange = quotes.filter(q => (q.createdAt||'').slice(0,10) >= from && (q.createdAt||'').slice(0,10) <= to);

  /* Render immediately with local (localStorage) data */
  _renderAnalyticsKPIs(bkInRange, qtInRange, prices, periodLabel, calIcon);
  _drawAnalyticsCharts(bk, from, to, fromD, toD, days, isDark, chartPeriodLabel);
  _renderAnalyticsPopularDates(bk, from, to);

  /* Async: re-render with fresh API data */
  if (window.StatisticsService && StatisticsService.apiReady) {
    StatisticsService.getAnalyticsData(from, to).then(apiBk => {
      if (!apiBk || !document.getElementById('view-analytics').classList.contains('active')) return;
      _renderAnalyticsKPIs(apiBk, qtInRange, prices, periodLabel, calIcon);
      _drawAnalyticsCharts(apiBk, from, to, fromD, toD, days, isDark, chartPeriodLabel);
      _renderAnalyticsPopularDates(apiBk, from, to);
    });
  }
}

/* ── Shared analytics data builder ── */
function _analyticsData() {
  const { from, to } = getAnalyticsRange();
  const bk     = Adapter.getBookings();
  const quotes = Adapter.getQuotes();
  const prices = Adapter.getPrices();
  const fromD  = new Date(from + 'T00:00:00');
  const toD    = new Date(to   + 'T00:00:00');
  const days   = Math.round((toD - fromD) / 86400000) + 1;

  const periodLabel = _aPeriod === 'custom'
    ? `${from} 〜 ${to}`
    : (_A_PERIODS.find(p => p.key === _aPeriod)?.label || '');

  const bkInRange = bk.filter(b => b.date >= from && b.date <= to);
  const qtInRange = quotes.filter(q => (q.createdAt||'').slice(0,10) >= from && (q.createdAt||'').slice(0,10) <= to);
  const activeBkR = bkInRange.filter(b => b.status !== 'キャンセル');
  const convRate  = qtInRange.length > 0 ? Math.round((activeBkR.length / qtInRange.length) * 100) : 0;

  const svcCount = {};
  activeBkR.forEach(b => { svcCount[b.service] = (svcCount[b.service]||0) + 1; });
  const topSvc = Object.entries(svcCount).sort((a,b) => b[1]-a[1])[0];

  let revenue = 0;
  activeBkR.forEach(b => {
    const p = prices[b.service];
    revenue += (typeof p === 'number' ? p : (p && p.base) || 0);
  });

  const dowCount = [0,0,0,0,0,0,0];
  activeBkR.forEach(b => { dowCount[new Date(b.date+'T00:00:00').getDay()]++; });
  const maxDow = Math.max(...dowCount);
  const topDow = dowCount.indexOf(maxDow);

  const kpis = [
    { label:'総予約数',        val: bkInRange.length,             sub:`確定済み ${bkInRange.filter(b=>b.status==='確定').length}件` },
    { label:'見積りリクエスト', val: qtInRange.length,             sub:'受付済み合計' },
    { label:'転換率',          val: convRate+'%',                  sub:'見積り → 予約（キャンセル除く）' },
    { label:'人気サービス',    val: topSvc ? (_SVC_SHORT[topSvc[0]]||topSvc[0]) : '—', sub: topSvc ? topSvc[1]+'件のご依頼' : 'データなし' },
    { label:'期間売上概算',    val: '¥'+revenue.toLocaleString(),  sub:'基本料金ベース・キャンセル除く' },
    { label:'人気の引越し曜日', val: maxDow>0 ? _DOW_JP[topDow]+'曜日' : '—', sub: maxDow>0 ? maxDow+'件 最多予約曜日' : 'データなし' },
  ];

  /* time-series rows (arrays, not CSV strings) */
  const tsHeaders = [];
  const tsRows    = [];
  if (days <= 14) {
    tsHeaders.push('日付','曜日','予約件数');
    for (let i = 0; i < days; i++) {
      const d  = new Date(fromD); d.setDate(fromD.getDate()+i);
      const ds = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      tsRows.push([ds, _DOW_JP[d.getDay()]+'曜日', bk.filter(b=>b.date===ds).length]);
    }
  } else if (days <= 84) {
    tsHeaders.push('週開始日','週終了日','予約件数');
    const weeks = Math.ceil(days/7);
    for (let i = 0; i < weeks; i++) {
      const ws  = new Date(fromD); ws.setDate(fromD.getDate()+i*7);
      const we  = new Date(ws);    we.setDate(ws.getDate()+6);
      const wsS = `${ws.getFullYear()}-${pad(ws.getMonth()+1)}-${pad(ws.getDate())}`;
      const weS = `${we.getFullYear()}-${pad(we.getMonth()+1)}-${pad(we.getDate())}`;
      tsRows.push([wsS, weS, bk.filter(b=>b.date>=wsS&&b.date<=weS).length]);
    }
  } else {
    tsHeaders.push('年月','予約件数');
    let cur = new Date(fromD.getFullYear(), fromD.getMonth(), 1);
    const endM = new Date(toD.getFullYear(), toD.getMonth(), 1);
    while (cur <= endM) {
      const ym = `${cur.getFullYear()}-${pad(cur.getMonth()+1)}`;
      tsRows.push([ym, bk.filter(b=>b.date.startsWith(ym)).length]);
      cur.setMonth(cur.getMonth()+1);
    }
  }

  const serviceRows = Object.entries(svcCount).sort((a,b)=>b[1]-a[1]);

  return { from, to, periodLabel, bkInRange, qtInRange, activeBkR,
           kpis, timeSeries:{headers:tsHeaders, rows:tsRows}, serviceRows };
}

/* ── Analytics CSV export ── */
function exportAnalyticsCSV() {
  const d   = _analyticsData();
  const qe  = v => `"${String(v==null?'':v).replace(/"/g,'""')}"`;
  const row = (...cells) => cells.map(qe).join(',');

  const s1 = [
    row('【分析サマリー】'),
    row('分析期間', d.periodLabel),
    row('出力日時', new Date().toLocaleString('ja-JP')),
    '',
    row('指標','値','補足'),
    ...d.kpis.map(k => row(k.label, k.val, k.sub)),
  ];

  const s2 = [
    row('【時系列データ】'),
    row(...d.timeSeries.headers),
    ...d.timeSeries.rows.map(r => row(...r)),
  ];

  const s3 = [
    row('【サービス別予約数】'),
    row('サービス','件数'),
    ...d.serviceRows.map(([svc,cnt]) => row(svc, cnt)),
  ];

  const s4 = [
    row('【期間内予約一覧】'),
    row('予約番号','ステータス','サービス','引越し日','希望時間帯','お客様名','メール','引越し元','引越し先','備考','受付日時'),
    ...d.bkInRange.map(b => row(b.id,b.status,b.service,b.date,b.time,b.name,b.email,b.fromAddr,b.toAddr,b.notes,b.createdAt)),
  ];

  const csv = '﻿' + [s1,s2,s3,s4].map(s=>s.join('\r\n')).join('\r\n\r\n');
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  a.download = `analytics-${d.from}-${d.to}.csv`;
  a.click();
  toast('分析データをCSVでエクスポートしました');
}

/* ── Analytics print view ── */
function printAnalytics() {
  const d   = _analyticsData();
  const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  /* service bar rows */
  const maxSvc = Math.max(...d.serviceRows.map(r=>r[1]), 1);
  const svcTableRows = d.serviceRows.map(([svc,cnt]) => {
    const pct = Math.round((cnt/maxSvc)*100);
    return `<tr>
      <td>${esc(svc)}</td>
      <td><div style="background:#e5e7eb;border-radius:3px;height:11px;width:160px;position:relative;overflow:hidden"><div style="background:#2563eb;border-radius:3px;height:11px;width:${pct}%;position:absolute;top:0;left:0"></div></div></td>
      <td style="text-align:right;font-weight:600">${cnt}件</td>
    </tr>`;
  }).join('');

  /* booking list rows */
  const bkTableRows = d.bkInRange.map(b => `<tr>
    <td>${esc(b.id)}</td>
    <td>${esc(b.status)}</td>
    <td>${esc(b.service)}</td>
    <td style="white-space:nowrap">${esc(b.date)}</td>
    <td>${esc(b.name)}</td>
    <td>${esc(b.email)}</td>
    <td>${esc(b.fromAddr)}</td>
    <td>${esc(b.toAddr)}</td>
  </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="UTF-8">
<title>分析レポート — Hello Moving</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Hiragino Sans','Meiryo','Yu Gothic',sans-serif;font-size:12px;color:#0b0f17;background:#fff;padding:28px 32px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #0a1f44;margin-bottom:20px}
.brand{display:flex;align-items:center;gap:10px}
.brand-mark{width:36px;height:36px;border-radius:9px;background:#1D9E75;color:#fff;font-size:18px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.brand-name{font-size:16px;font-weight:700;color:#0a1f44;line-height:1.2}
.brand-sub{font-size:10px;color:#6b7280}
.meta{text-align:right;font-size:11px;color:#6b7280;line-height:1.8}
.meta strong{color:#0b0f17;font-weight:600}
h2{font-size:11px;font-weight:700;color:#0a1f44;letter-spacing:.07em;text-transform:uppercase;margin:22px 0 10px;padding-bottom:5px;border-bottom:1px solid #e5e7eb}
.kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:4px}
.kpi-card{border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px}
.kpi-lbl{font-size:9px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px}
.kpi-val{font-size:20px;font-weight:700;line-height:1;margin-bottom:3px}
.kpi-sub{font-size:10px;color:#9ca3af}
.kpi-period{font-size:9px;color:#9ca3af;margin-top:7px;padding-top:6px;border-top:1px solid #f0f2f5;display:flex;align-items:center;gap:3px}
table{width:100%;border-collapse:collapse;font-size:11px}
th{background:#f8f9fa;font-weight:600;text-align:left;padding:7px 10px;border:1px solid #e5e7eb;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}
td{padding:6px 10px;border:1px solid #f0f2f5;vertical-align:middle}
tr:nth-child(even) td{background:#fafafa}
.pg{page-break-before:always}
.footer{margin-top:24px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;display:flex;justify-content:space-between}
@media print{body{padding:0}@page{margin:14mm 12mm;size:A4 portrait}}
</style></head><body>

<div class="hdr">
  <div class="brand">
    <div class="brand-mark">H</div>
    <div><div class="brand-name">Hello Moving</div><div class="brand-sub">分析レポート</div></div>
  </div>
  <div class="meta">
    <div><strong>分析期間</strong>　${esc(d.periodLabel)}</div>
    <div>${esc(d.from)} 〜 ${esc(d.to)}</div>
    <div>出力日時　${new Date().toLocaleString('ja-JP')}</div>
  </div>
</div>

<h2>KPI サマリー</h2>
<div class="kpi-grid">${d.kpis.map(k=>`
  <div class="kpi-card">
    <div class="kpi-lbl">${esc(k.label)}</div>
    <div class="kpi-val">${esc(k.val)}</div>
    <div class="kpi-sub">${esc(k.sub)}</div>
    <div class="kpi-period">&#128197; ${esc(d.periodLabel)}</div>
  </div>`).join('')}
</div>

<h2>時系列データ</h2>
<table>
  <thead><tr>${d.timeSeries.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead>
  <tbody>${d.timeSeries.rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
</table>

<h2>サービス別予約数</h2>
<table>
  <thead><tr><th>サービス</th><th>グラフ</th><th style="text-align:right">件数</th></tr></thead>
  <tbody>${svcTableRows || '<tr><td colspan="3" style="color:#9ca3af;text-align:center">データなし</td></tr>'}</tbody>
</table>

${d.bkInRange.length ? `<div class="pg">
<h2 style="margin-top:0">期間内予約一覧（${d.bkInRange.length}件）</h2>
<table>
  <thead><tr><th>予約番号</th><th>ステータス</th><th>サービス</th><th>引越し日</th><th>お客様名</th><th>メール</th><th>引越し元</th><th>引越し先</th></tr></thead>
  <tbody>${bkTableRows}</tbody>
</table>
</div>` : ''}

<div class="footer">
  <span>Hello Moving — 管理システム</span>
  <span>${esc(d.from)} 〜 ${esc(d.to)}</span>
</div>

<script>window.onload=function(){setTimeout(function(){window.print();},350);window.onafterprint=function(){window.close();}}<\/script>
</body></html>`;

  const w = window.open('','_blank','width=960,height=760');
  if (!w) { toast('ポップアップをブロックしています。許可してから再試行してください'); return; }
  w.document.write(html);
  w.document.close();
}

async function downloadPDFAnalytics() {
  const h = _capturePrintHtml(printAnalytics);
  if (h) await _pdfDownload(h, '分析レポート.pdf');
}

/* ── Vertical bar chart ── */
function drawBarChart(id, labels, data, dark) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || 280;
  const H = 180;
  canvas.width        = W * dpr;
  canvas.height       = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const mg = { t:14, r:8, b:30, l:26 };
  const cW = W - mg.l - mg.r;
  const cH = H - mg.t - mg.b;
  const maxVal = Math.max(...data, 1);

  const barFill = dark ? 'rgba(96,165,250,0.85)'  : 'rgba(37,99,235,0.82)';
  const gridCol = dark ? 'rgba(255,255,255,0.06)'  : 'rgba(0,0,0,0.06)';
  const lblCol  = dark ? '#8b949e' : '#9ca3af';
  const valCol  = dark ? '#c9d1d9' : '#374151';

  ctx.clearRect(0, 0, W, H);

  /* horizontal grid + y-axis labels */
  const steps = 4;
  ctx.strokeStyle = gridCol;
  ctx.lineWidth = 1;
  for (let i = 0; i <= steps; i++) {
    const y = mg.t + (cH / steps) * (steps - i);
    ctx.beginPath(); ctx.moveTo(mg.l, y); ctx.lineTo(mg.l + cW, y); ctx.stroke();
    if (i > 0) {
      ctx.fillStyle = lblCol;
      ctx.font = '9px Inter,system-ui,sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.round((maxVal / steps) * i), mg.l - 3, y);
    }
  }

  /* bars */
  const n   = labels.length;
  const gap = Math.max(4, cW / (n * 5));
  const bw  = (cW - gap * (n + 1)) / n;

  labels.forEach((lbl, i) => {
    const bh = (data[i] / maxVal) * cH;
    const x  = mg.l + gap * (i + 1) + bw * i;
    const y  = mg.t + cH - bh;
    const r  = bh > 0 ? Math.min(4, bw / 2, bh) : 0;

    if (bh > 0) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + bw - r, y);
      ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
      ctx.lineTo(x + bw, y + bh);
      ctx.lineTo(x, y + bh);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fillStyle = barFill;
      ctx.fill();

      if (bw > 10) {
        ctx.fillStyle = valCol;
        ctx.font = `600 ${Math.max(9, Math.min(11, bw / 2))}px Inter,system-ui,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(data[i], x + bw / 2, y - 3);
      }
    }

    ctx.fillStyle = lblCol;
    ctx.font = '10px Inter,system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(lbl, x + bw / 2, H - 4);
  });
}

/* ── Horizontal bar chart ── */
function drawHBarChart(id, labels, data, dark) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (!labels.length) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const dpr  = window.devicePixelRatio || 1;
  const W    = canvas.offsetWidth || 280;
  const rowH = 30;
  const H    = Math.max(180, labels.length * rowH + 24);
  canvas.width        = W * dpr;
  canvas.height       = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const PALETTE = dark
    ? ['rgba(96,165,250,.85)','rgba(52,211,153,.8)','rgba(251,191,36,.8)','rgba(167,139,250,.8)','rgba(251,113,133,.8)','rgba(45,212,191,.8)']
    : ['rgba(37,99,235,.8)','rgba(16,185,129,.8)','rgba(245,158,11,.8)','rgba(139,92,246,.8)','rgba(239,68,68,.8)','rgba(20,184,166,.8)'];

  const mg     = { t:10, r:30, b:8, l:60 };
  const cW     = W - mg.l - mg.r;
  const maxVal = Math.max(...data, 1);
  const lblCol = dark ? '#8b949e' : '#9ca3af';
  const valCol = dark ? '#c9d1d9' : '#374151';
  const gridCol = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

  ctx.clearRect(0, 0, W, H);

  /* vertical grid */
  ctx.strokeStyle = gridCol;
  ctx.lineWidth = 1;
  [0.25, 0.5, 0.75, 1].forEach(f => {
    const x = mg.l + cW * f;
    ctx.beginPath(); ctx.moveTo(x, mg.t); ctx.lineTo(x, H - mg.b); ctx.stroke();
  });

  labels.forEach((lbl, i) => {
    const bh = Math.max(10, rowH - 10);
    const bw = (data[i] / maxVal) * cW;
    const y  = mg.t + i * rowH;
    const by = y + (rowH - bh) / 2;
    const r  = bw > 0 ? Math.min(3, bh / 2, bw) : 0;

    if (bw > 0) {
      ctx.beginPath();
      ctx.moveTo(mg.l, by + r);
      ctx.quadraticCurveTo(mg.l, by, mg.l + r, by);
      ctx.lineTo(mg.l + bw - r, by);
      ctx.quadraticCurveTo(mg.l + bw, by, mg.l + bw, by + r);
      ctx.lineTo(mg.l + bw, by + bh - r);
      ctx.quadraticCurveTo(mg.l + bw, by + bh, mg.l + bw - r, by + bh);
      ctx.lineTo(mg.l + r, by + bh);
      ctx.quadraticCurveTo(mg.l, by + bh, mg.l, by + bh - r);
      ctx.closePath();
      ctx.fillStyle = PALETTE[i % PALETTE.length];
      ctx.fill();
    }

    ctx.fillStyle = lblCol;
    ctx.font = '10px Inter,system-ui,sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(lbl, mg.l - 6, y + rowH / 2);

    ctx.fillStyle = valCol;
    ctx.font = '600 10px Inter,system-ui,sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(data[i], mg.l + cW + 6, y + rowH / 2);
  });
}

/* ════════════════════════════════════════════════════════
   QUOTE MANAGEMENT
   ════════════════════════════════════════════════════════ */