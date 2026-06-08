'use strict';
/* ══════════════════════════════════════════════════════
   WMC Analytics Dashboard — Section 11 (Phase 28)
   Entry point: _wmcRenderAnalytics()
   Depends on: wmcCore.js (_padZ), wmcOverview.js (_wmcCalcSeo)
   Data sources: Adapter bookings/reviews/services/quotes,
                 localStorage hm_blog_posts, hm_seo_history
   ══════════════════════════════════════════════════════ */

/* ── Shared data snapshot ── */
function _waSnap() {
  var bk  = (typeof Adapter !== 'undefined' && Adapter.getBookings)  ? Adapter.getBookings()  : [];
  var rv  = (typeof Adapter !== 'undefined' && Adapter.getReviews)   ? Adapter.getReviews()   : [];
  var sv  = (typeof Adapter !== 'undefined' && Adapter.getServices)  ? Adapter.getServices()  : [];
  var qt  = (typeof Adapter !== 'undefined' && Adapter.getQuotes)    ? Adapter.getQuotes()    : [];
  var bp  = []; try { bp = JSON.parse(localStorage.getItem('hm_blog_posts') || '[]'); } catch (_) {}
  var faq = (typeof Adapter !== 'undefined' && Adapter.getFaq)       ? Adapter.getFaq()       : [];

  /* Monthly bookings — 12 months */
  var now = new Date();
  var monthly = [];
  for (var i = 11; i >= 0; i--) {
    var d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var lbl = (d.getMonth() + 1) + '月';
    var cnt = bk.filter(function (b) {
      var bd = new Date(b.date || b.move_date || '');
      return !isNaN(bd) && bd.getFullYear() === d.getFullYear() && bd.getMonth() === d.getMonth();
    }).length;
    monthly.push({ label: lbl, count: cnt });
  }

  /* Service popularity */
  var sc = {};
  bk.forEach(function (b) { var k = b.service || b.move_type || '不明'; sc[k] = (sc[k] || 0) + 1; });
  var svcRank = Object.keys(sc).map(function (k) { return { name: k, count: sc[k] }; })
    .sort(function (a, b) { return b.count - a.count; }).slice(0, 5);

  /* Revenue */
  var revenue = bk.reduce(function (s, b) { return s + (parseFloat(b.price || b.amount || 0) || 0); }, 0);

  /* Reviews */
  var approved  = rv.filter(function (r) { return r.status === 'approved'; });
  var avgRating = approved.length
    ? approved.reduce(function (s, r) { return s + (parseFloat(r.rating) || 5); }, 0) / approved.length
    : 0;

  /* DOW distribution (Sun=0…Sat=6) */
  var dow = [0, 0, 0, 0, 0, 0, 0];
  bk.forEach(function (b) { var d = new Date(b.date || b.move_date || ''); if (!isNaN(d)) dow[d.getDay()]++; });

  /* Estimated visitors (2% conversion assumption) */
  var visitors = Math.max(bk.length * 50, d && bk.length === 0 ? 0 : 120);
  var totalQt  = qt.length || Math.round(bk.length * 1.6);

  /* SEO */
  var seo = typeof _wmcCalcSeo !== 'undefined' ? _wmcCalcSeo() : { score: 0, checks: [] };
  _waSaveSeoHistory(seo.score);

  return {
    bk: bk, rv: rv, sv: sv, qt: qt, bp: bp, faq: faq,
    monthly: monthly, svcRank: svcRank, revenue: revenue,
    approved: approved, avgRating: avgRating, dow: dow,
    visitors: visitors, totalQt: totalQt, seo: seo,
  };
}

/* Persist SEO score history (max 30 entries) */
function _waSaveSeoHistory(score) {
  if (!score) return;
  var hist = []; try { hist = JSON.parse(localStorage.getItem('hm_seo_history') || '[]'); } catch (_) {}
  var today = new Date().toISOString().slice(0, 10);
  if (hist.length && hist[hist.length - 1].date === today) { hist[hist.length - 1].score = score; }
  else { hist.push({ date: today, score: score }); }
  if (hist.length > 30) hist = hist.slice(-30);
  localStorage.setItem('hm_seo_history', JSON.stringify(hist));
}

/* ── Canvas utilities ── */
function _waCtx(id, w, h) {
  var c = document.getElementById(id);
  if (!c || !c.getContext) return null;
  c.width  = w || (c.offsetWidth || 480);
  c.height = h || 150;
  return c.getContext('2d');
}

function _waRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y,     x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function _waBar(id, labels, vals, color) {
  var ctx = _waCtx(id); if (!ctx) return;
  var W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  var max = Math.max.apply(null, vals) || 1;
  var pL = 6, pR = 6, pT = 14, pB = 26, bW = (W - pL - pR) / vals.length;
  var dark = document.documentElement.classList.contains('dark');
  var tc = dark ? '#6e7681' : '#9ca3af';
  vals.forEach(function (v, i) {
    var bH = (H - pT - pB) * v / max;
    var x  = pL + i * bW + bW * 0.12;
    var bw = bW * 0.76;
    ctx.globalAlpha = 0.88;
    ctx.fillStyle   = color || '#2563eb';
    _waRoundRect(ctx, x, H - pB - bH, bw, bH || 1, 3); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = tc; ctx.font = '8.5px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + bw / 2, H - pB + 12);
    if (v > 0) { ctx.fillStyle = dark ? '#c9d1d9' : '#374151'; ctx.fillText(v, x + bw / 2, H - pB - bH - 3); }
  });
}

function _waLine(id, labels, vals, color) {
  var ctx = _waCtx(id); if (!ctx) return;
  var W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (vals.every(function (v) { return v === 0; })) {
    ctx.fillStyle = '#9ca3af'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('データがありません', W / 2, H / 2); return;
  }
  var max = Math.max.apply(null, vals) || 1;
  var pL = 24, pR = 10, pT = 14, pB = 24;
  var dark = document.documentElement.classList.contains('dark');
  /* Grid */
  ctx.strokeStyle = dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)'; ctx.lineWidth = 1;
  for (var g = 0; g <= 3; g++) {
    var gy = pT + (H - pT - pB) * g / 3;
    ctx.beginPath(); ctx.moveTo(pL, gy); ctx.lineTo(W - pR, gy); ctx.stroke();
    ctx.fillStyle = dark ? '#6e7681' : '#9ca3af'; ctx.font = '8px system-ui'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(max * (3 - g) / 3), pL - 2, gy + 3);
  }
  var pts = vals.map(function (v, i) {
    var n = vals.length - 1 || 1;
    return { x: pL + i * (W - pL - pR) / n, y: pT + (H - pT - pB) * (1 - v / max) };
  });
  /* Fill */
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  pts.slice(1).forEach(function (p) { ctx.lineTo(p.x, p.y); });
  ctx.lineTo(pts[pts.length - 1].x, H - pB); ctx.lineTo(pts[0].x, H - pB); ctx.closePath();
  var g2 = ctx.createLinearGradient(0, pT, 0, H - pB);
  g2.addColorStop(0, (color || '#2563eb') + '40'); g2.addColorStop(1, (color || '#2563eb') + '00');
  ctx.fillStyle = g2; ctx.fill();
  /* Line */
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  pts.slice(1).forEach(function (p) { ctx.lineTo(p.x, p.y); });
  ctx.strokeStyle = color || '#2563eb'; ctx.lineWidth = 2; ctx.stroke();
  /* Dots + x-labels */
  pts.forEach(function (p, i) {
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fillStyle = color || '#2563eb'; ctx.fill();
    ctx.fillStyle = dark ? '#6e7681' : '#9ca3af'; ctx.font = '8px system-ui'; ctx.textAlign = 'center';
    if (i % Math.ceil(labels.length / 6) === 0 || i === labels.length - 1) ctx.fillText(labels[i], p.x, H - pB + 12);
  });
}

function _waDoughnut(id, segs) {
  var c = document.getElementById(id); if (!c || !c.getContext) return;
  var sz = Math.min(c.offsetWidth || 120, 120);
  c.width = sz; c.height = sz;
  var ctx = c.getContext('2d'), cx = sz / 2, cy = sz / 2, r = sz / 2 - 6, inner = r * 0.56;
  var total = segs.reduce(function (s, x) { return s + x.v; }, 0); if (!total) return;
  var a = -Math.PI / 2;
  segs.forEach(function (s) {
    var arc = (s.v / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a + arc); ctx.closePath();
    ctx.fillStyle = s.c; ctx.fill(); a += arc;
  });
  ctx.beginPath(); ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#161b22' : '#f8f9fa'; ctx.fill();
}

/* ── Panel builder ── */
function _waPanel(title, body, opts) {
  opts = opts || {};
  return '<div style="background:var(--bg-soft);border:1px solid var(--line);border-radius:12px;overflow:hidden' + (opts.mb !== false ? ';margin-bottom:16px' : '') + '">' +
    '<div style="padding:11px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">' +
      '<span style="font-weight:700;font-size:13px;color:var(--ink)">' + title + '</span>' +
      (opts.badge ? '<span class="wmc-stat-badge ' + opts.badge.cls + '">' + opts.badge.text + '</span>' : '') +
    '</div>' +
    '<div style="padding:' + (opts.p || '14px 16px') + '">' + body + '</div>' +
  '</div>';
}

function _waKpiCard(icon, label, value, meta, accentColor) {
  return '<div style="background:var(--bg-soft);border:1px solid var(--line);border-radius:12px;padding:14px 16px;position:relative;overflow:hidden">' +
    '<div style="position:absolute;top:0;left:0;right:0;height:2px;background:' + accentColor + '"></div>' +
    '<div style="font-size:20px;margin-bottom:8px">' + icon + '</div>' +
    '<div style="font-size:10px;font-weight:600;color:var(--gray-1);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">' + esc(label) + '</div>' +
    '<div style="font-size:22px;font-weight:700;color:var(--ink);line-height:1">' + esc(String(value)) + '</div>' +
    '<div style="font-size:10px;color:var(--gray-2);margin-top:3px">' + esc(meta) + '</div>' +
  '</div>';
}

/* ── Tab: Overview ── */
function _waTabOverview(s) {
  var pane = document.getElementById('waPane-overview'); if (!pane) return;
  var convRate = s.totalQt > 0 ? (s.bk.length / s.totalQt * 100).toFixed(1) + '%' : '—';
  var kpis =
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:11px;margin-bottom:16px">' +
      _waKpiCard('👥', '推定月間訪問者', s.visitors.toLocaleString(), '予約数ベース推計 (÷2%)', '#2563eb') +
      _waKpiCard('🎯', 'コンバージョン率', convRate, '見積り→予約', '#10b981') +
      _waKpiCard('📊', 'SEOスコア', s.seo.score + '/100', 'コンテンツ品質指数', s.seo.score >= 75 ? '#10b981' : s.seo.score >= 50 ? '#f59e0b' : '#ef4444') +
      _waKpiCard('⭐', '平均レビュー評価', s.avgRating ? s.avgRating.toFixed(1) : '—', s.approved.length + '件の承認済みレビュー', '#f59e0b') +
      _waKpiCard('📅', '総予約数', s.bk.length, '累計受付件数', '#7c3aed') +
      _waKpiCard('📝', 'ブログ投稿', s.bp.length, '公開中の記事', '#0891b2') +
    '</div>';

  var charts =
    '<div style="display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-bottom:16px">' +
      _waPanel('月別予約数（直近12ヶ月）', '<canvas id="waLineMain" style="width:100%;display:block"></canvas>', { mb: false }) +
      _waPanel('サービス人気ランキング', '<div id="waSvcRank"></div>', { mb: false }) +
    '</div>';

  var recent = s.bk.slice(0, 6);
  var feed = _waPanel('最近のウェブサイト活動',
    recent.length === 0
      ? '<div style="color:var(--gray-2);font-size:12px;padding:4px 0">データがありません</div>'
      : recent.map(function (b) {
          return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line-2)">' +
            '<div style="width:26px;height:26px;border-radius:50%;background:rgba(37,99,235,.1);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0">📅</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:12px;font-weight:500;color:var(--ink)">' + esc(b.customer_name || b.name || '顧客') + ' — ' + esc(b.service || b.move_type || 'サービス') + '</div>' +
              '<div style="font-size:10px;color:var(--gray-2)">' + esc(b.date || b.move_date || '') + '</div>' +
            '</div>' +
            '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:rgba(16,185,129,.1);color:#059669;flex-shrink:0">' + esc(b.status || '確定') + '</span>' +
          '</div>';
        }).join(''), { p: '0 14px' });

  pane.innerHTML = kpis + charts + feed;
  setTimeout(function () {
    _waLine('waLineMain', s.monthly.map(function (m) { return m.label; }), s.monthly.map(function (m) { return m.count; }), '#2563eb');
    var rk = document.getElementById('waSvcRank');
    if (!rk) return;
    if (!s.svcRank.length) { rk.innerHTML = '<div style="color:var(--gray-2);font-size:12px">予約データがありません</div>'; return; }
    var mx = s.svcRank[0].count || 1;
    var pal = ['#2563eb','#10b981','#f59e0b','#ef4444','#7c3aed'];
    rk.innerHTML = s.svcRank.map(function (x, i) {
      return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;margin-bottom:3px"><span style="font-size:11px;font-weight:500;color:var(--ink)">' + esc(x.name) + '</span><span style="font-size:10px;color:var(--gray-2)">' + x.count + '件</span></div>' +
        '<div style="height:5px;background:var(--bg-soft-2);border-radius:3px;overflow:hidden"><div style="height:100%;width:' + Math.round(x.count / mx * 100) + '%;background:' + pal[i % pal.length] + ';border-radius:3px;transition:.5s"></div></div></div>';
    }).join('');
  }, 60);
}

/* ── Tab: Traffic ── */
function _waTabTraffic(s) {
  var pane = document.getElementById('waPane-traffic'); if (!pane) return;
  var sources = [
    { label: '直接アクセス', v: 45, c: '#2563eb' }, { label: '検索エンジン', v: 35, c: '#10b981' },
    { label: '参照サイト',   v: 15, c: '#f59e0b' }, { label: 'SNS',          v:  5, c: '#7c3aed' },
  ];
  var dowLbls = ['日', '月', '火', '水', '木', '金', '土'];
  var pageTbl =
    [['トップページ', s.bk.length*28], ['サービス一覧', s.bk.length*18], ['料金・見積もり', s.bk.length*12], ['よくある質問', s.bk.length*8], ['お問い合わせ', s.bk.length*5]].map(function (r) {
      return '<tr style="border-bottom:1px solid var(--line-2)"><td style="padding:9px 14px;font-size:12px;color:var(--ink)">' + r[0] + '</td><td style="padding:9px 14px;font-size:12px;color:var(--ink)">' + (r[1]||0).toLocaleString() + '</td><td style="padding:9px 14px;font-size:11px;color:var(--gray-2)">推計</td></tr>';
    }).join('');

  pane.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;padding:9px 13px;background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.22);border-radius:8px;margin-bottom:16px;font-size:12px;color:var(--ink)"><span>📊</span><span>トラフィックデータは予約数から推計したものです。実計測はフェーズ29で追加予定です。</span></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">' +
      _waPanel('曜日別アクセス分布', '<canvas id="waDow" style="width:100%;display:block"></canvas>', { mb: false }) +
      _waPanel('流入元（推計）',
        '<div style="display:flex;align-items:center;gap:14px">' +
          '<canvas id="waPie" style="width:110px;height:110px;flex-shrink:0"></canvas>' +
          '<div>' + sources.map(function (s) {
            return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:7px"><div style="width:9px;height:9px;border-radius:50%;background:' + s.c + ';flex-shrink:0"></div><span style="font-size:11px;color:var(--ink);flex:1">' + s.label + '</span><span style="font-size:11px;font-weight:600;color:var(--gray-1)">' + s.v + '%</span></div>';
          }).join('') + '</div>' +
        '</div>', { mb: false }) +
    '</div>' +
    _waPanel('ページ別パフォーマンス（推計）',
      '<table style="width:100%;border-collapse:collapse"><thead><tr style="background:var(--bg-soft-2)">' +
        ['ページ','推定PV','メモ'].map(function (h) { return '<th style="padding:8px 14px;text-align:left;font-size:10px;font-weight:600;color:var(--gray-1);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line)">' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' + pageTbl + '</tbody></table>', { p: '0' });

  setTimeout(function () { _waBar('waDow', dowLbls, s.dow, '#2563eb'); _waDoughnut('waPie', sources); }, 60);
}

/* ── Tab: Conversion ── */
function _waTabConversion(s) {
  var pane = document.getElementById('waPane-conversion'); if (!pane) return;
  var steps = [
    { label: '訪問者', value: s.visitors, pct: 100, c: '#2563eb' },
    { label: '見積依頼', value: s.totalQt, pct: s.visitors > 0 ? +(s.totalQt / s.visitors * 100).toFixed(1) : 0, c: '#10b981' },
    { label: '予約確定', value: s.bk.length, pct: s.visitors > 0 ? +(s.bk.length / s.visitors * 100).toFixed(2) : 0, c: '#f59e0b' },
  ];
  var funnel = steps.map(function (st, i) {
    var w = 100 - i * 18;
    return '<div style="margin-bottom:13px">' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:5px"><span style="font-size:12px;font-weight:600;color:var(--ink)">' + esc(st.label) + '</span><span style="font-size:12px;color:var(--gray-1)">' + st.value.toLocaleString() + ' <span style="font-size:10px;color:var(--gray-2)">(' + st.pct + '%)</span></span></div>' +
      '<div style="height:30px;background:var(--bg-soft-2);border-radius:6px;overflow:hidden"><div style="height:100%;width:' + w + '%;background:' + st.c + ';border-radius:6px;display:flex;align-items:center;padding-left:10px;transition:.6s"><span style="font-size:11px;font-weight:700;color:#fff">' + st.pct + '%</span></div></div>' +
    '</div>';
  }).join('');

  pane.innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">' +
      _waPanel('コンバージョンファネル', funnel, { mb: false }) +
      _waPanel('月別予約数トレンド', '<canvas id="waConvChart" style="width:100%;display:block"></canvas>', { mb: false }) +
    '</div>' +
    _waPanel('コンバージョン指標',
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">' +
        [
          { label: '訪問→見積り', value: s.visitors > 0 ? (s.totalQt / s.visitors * 100).toFixed(1) + '%' : '—', desc: '見積り依頼率' },
          { label: '見積り→予約', value: s.totalQt > 0 ? (s.bk.length / s.totalQt * 100).toFixed(1) + '%' : '—', desc: '成約率' },
          { label: '訪問→予約',  value: s.visitors > 0 ? (s.bk.length / s.visitors * 100).toFixed(2) + '%' : '—', desc: '最終転換率' },
        ].map(function (m) {
          return '<div style="background:var(--bg-soft-2);border-radius:8px;padding:12px 14px;text-align:center">' +
            '<div style="font-size:10px;font-weight:600;color:var(--gray-1);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">' + m.label + '</div>' +
            '<div style="font-size:22px;font-weight:700;color:var(--ink)">' + m.value + '</div>' +
            '<div style="font-size:10px;color:var(--gray-2);margin-top:2px">' + m.desc + '</div>' +
          '</div>';
        }).join('') +
      '</div>');

  setTimeout(function () { _waBar('waConvChart', s.monthly.map(function (m) { return m.label; }), s.monthly.map(function (m) { return m.count; }), '#10b981'); }, 60);
}

/* ── Tab: Content ── */
function _waTabContent(s) {
  var pane = document.getElementById('waPane-content'); if (!pane) return;
  var rows = [
    { icon: '🏠', name: 'トップページ',   status: '公開中', health: s.seo.score >= 60 ? '良好' : '要改善', ok: s.seo.score >= 60 },
    { icon: '⚙️', name: 'サービスページ', status: '公開中', health: s.sv.length >= 3 ? '良好' : '要追加',  ok: s.sv.length >= 3 },
    { icon: '❓', name: 'FAQページ',      status: '公開中', health: s.faq.length >= 3 ? '良好' : '要追加', ok: s.faq.length >= 3 },
    { icon: '🔗', name: 'フッター',        status: '公開中', health: '良好', ok: true },
  ].concat(s.bp.map(function (p) {
    return { icon: '📝', name: p.title || '(タイトル未設定)', status: p.status === 'published' ? '公開中' : '下書き', health: p.status === 'published' ? '公開中' : '下書き', ok: p.status === 'published' };
  }));

  pane.innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:11px;margin-bottom:16px">' +
      [
        { icon: '📄', label: 'コンテンツ総数', val: rows.length, c: '#2563eb' },
        { icon: '⚙️', label: 'サービス数',     val: s.sv.length,  c: '#10b981' },
        { icon: '📝', label: 'ブログ投稿',     val: s.bp.length,  c: '#7c3aed' },
        { icon: '✅', label: '公開中',          val: rows.filter(function(r){ return r.status === '公開中'; }).length, c: '#10b981' },
      ].map(function (k) {
        return '<div style="background:var(--bg-soft);border:1px solid var(--line);border-radius:12px;padding:13px 15px"><div style="font-size:10px;font-weight:600;color:var(--gray-1);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">' + k.icon + ' ' + esc(k.label) + '</div><div style="font-size:24px;font-weight:700;color:var(--ink)">' + k.val + '</div></div>';
      }).join('') +
    '</div>' +
    _waPanel('コンテンツインベントリ',
      rows.map(function (r) {
        var hc = r.ok ? '#059669' : '#b45309';
        return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line-2)">' +
          '<span style="font-size:16px;flex-shrink:0">' + r.icon + '</span>' +
          '<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:500;color:var(--ink)">' + esc(r.name) + '</div></div>' +
          '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:rgba(16,185,129,.1);color:#059669;flex-shrink:0">' + r.status + '</span>' +
          '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:' + hc + '18;color:' + hc + ';flex-shrink:0">' + r.health + '</span>' +
        '</div>';
      }).join(''), { p: '0 14px' });
}

/* ── Tab: SEO ── */
function _waTabSeo(s) {
  var pane = document.getElementById('waPane-seo'); if (!pane) return;
  var seo  = s.seo;
  var hist = []; try { hist = JSON.parse(localStorage.getItem('hm_seo_history') || '[]'); } catch (_) {}
  var sc = seo.score;
  var ring = '<svg viewBox="0 0 110 110" style="width:100px;height:100px">' +
    '<circle cx="55" cy="55" r="46" fill="none" stroke="var(--line)" stroke-width="8"/>' +
    '<circle cx="55" cy="55" r="46" fill="none" stroke-width="8" stroke-linecap="round" transform="rotate(-90 55 55)" ' +
      'stroke="' + (sc >= 75 ? '#10b981' : sc >= 50 ? '#f59e0b' : '#ef4444') + '" ' +
      'stroke-dasharray="289" stroke-dashoffset="' + (289 * (1 - sc / 100)).toFixed(1) + '"/>' +
    '<text x="55" y="52" text-anchor="middle" style="font-size:20px;font-weight:700;fill:var(--ink)">' + sc + '</text>' +
    '<text x="55" y="66" text-anchor="middle" style="font-size:10px;fill:var(--gray-2)">/100</text>' +
  '</svg>';

  var checks = seo.checks.map(function (c) {
    var cl = c.pass ? '#10b981' : c.warn ? '#f59e0b' : '#ef4444';
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-2)">' +
      '<div style="width:20px;height:20px;border-radius:50%;background:' + cl + '18;color:' + cl + ';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">' + (c.pass ? '✓' : c.warn ? '!' : '✕') + '</div>' +
      '<span style="flex:1;font-size:12px;color:var(--ink)">' + esc(c.label) + '</span>' +
      '<span style="font-size:10px;color:var(--gray-2);font-weight:600">' + c.pts + 'pt</span>' +
    '</div>';
  }).join('');

  var histHtml = hist.length > 1
    ? _waPanel('スコア推移', '<canvas id="waSeoHist" style="width:100%;display:block"></canvas>')
    : '';

  pane.innerHTML =
    _waPanel('SEOスコア',
      '<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap"><div style="flex-shrink:0">' + ring + '</div>' +
      '<div style="flex:1;min-width:160px"><div style="font-size:16px;font-weight:700;color:' + (sc >= 75 ? '#10b981' : sc >= 50 ? '#f59e0b' : '#ef4444') + ';margin-bottom:4px">' + (sc >= 90 ? 'A+ 優秀' : sc >= 75 ? 'B 良好' : sc >= 55 ? 'C 普通' : sc >= 35 ? 'D 要改善' : 'F 要対応') + '</div>' +
      '<div style="font-size:12px;color:var(--gray-1);line-height:1.5">コンテンツ品質に基づいて計算されます。<br>承認済みレビュー・FAQ・サービス情報を充実させるとスコアが上がります。</div></div></div>') +
    _waPanel('チェック項目', checks, { p: '0 14px' }) +
    histHtml;

  if (hist.length > 1) {
    setTimeout(function () {
      _waLine('waSeoHist', hist.map(function (h) { return h.date.slice(5); }), hist.map(function (h) { return h.score; }), '#10b981');
    }, 60);
  }
}

/* ── Tab routing ── */
var _waTabRendered = {};

function _waShowTab(tab, s) {
  if (_waTabRendered[tab]) return; /* already rendered */
  _waTabRendered[tab] = true;
  if (tab === 'overview')   _waTabOverview(s);
  if (tab === 'traffic')    _waTabTraffic(s);
  if (tab === 'conversion') _waTabConversion(s);
  if (tab === 'content')    _waTabContent(s);
  if (tab === 'seo')        _waTabSeo(s);
}

/* ── Main entry ── */
function _wmcRenderAnalytics() {
  _waTabRendered = {}; /* reset on each navigation to analytics */
  var view = document.getElementById('wmc-view-analytics'); if (!view) return;
  var snap = _waSnap();

  /* Wire tabs once (idempotent via .wa-tab-wired flag) */
  if (!view.dataset.tabWired) {
    view.dataset.tabWired = '1';
    view.querySelectorAll('.wa-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        view.querySelectorAll('.wa-tab').forEach(function (t)  { t.classList.remove('active'); });
        view.querySelectorAll('.wa-pane').forEach(function (p) { p.classList.remove('active'); });
        tab.classList.add('active');
        var p = document.getElementById('waPane-' + tab.dataset.tab);
        if (p) p.classList.add('active');
        _waShowTab(tab.dataset.tab, snap);
      });
    });
  }

  _waShowTab('overview', snap);
  if (typeof WMCPermissions !== 'undefined') WMCPermissions.audit('other', 'wmc_analytics', 'view', 'アナリティクスダッシュボードを表示');
}
