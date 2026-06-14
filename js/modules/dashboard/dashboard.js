'use strict';

/* ════════════════════════════════════════════════════════
   DASHBOARD
   ════════════════════════════════════════════════════════ */

/* ── Growth indicator helper ── */
function _growthHTML(g) {
  if (!g) return '';
  const cls  = g.pct > 0 ? 'kpi-up' : g.pct < 0 ? 'kpi-down' : 'kpi-flat';
  const icon = g.pct > 0 ? '↑' : g.pct < 0 ? '↓' : '→';
  const txt  = g.pct !== 0 ? `${icon} ${Math.abs(g.pct)}% ${g.label}` : `→ 変化なし`;
  return `<div class="kpi-growth ${cls}">${txt}</div>`;
}

/* Render stat grid from StatisticsService stats + optional growth data.
   Falls back to calcStats() values when Supabase is unavailable. */
function renderStatGrid(sbStats, growthStats) {
  const local = calcStats();
  const bk    = Adapter.getBookings();
  const s     = sbStats || {};
  const g     = growthStats || null;

  const today         = s.today          != null ? s.today          : local.todayBk;
  const weekly        = s.weekly         != null ? s.weekly         : local.weekBk;
  const monthly       = s.monthly        != null ? s.monthly        : local.monthBk;
  const pending       = s.pending        != null ? s.pending        : bk.filter(b => b.status === '新規' || b.status === '確認中').length;
  const confirmed     = s.confirmed      != null ? s.confirmed      : bk.filter(b => b.status === '確定').length;
  const cancelled     = s.cancelled      != null ? s.cancelled      : bk.filter(b => b.status === 'キャンセル').length;
  const occupancy     = s.occupancy      != null ? s.occupancy      : 0;
  const avgDaily      = s.avgDaily       != null ? s.avgDaily       : 0;
  const totalCustomers= s.totalCustomers != null ? s.totalCustomers : new Set(bk.map(b=>b.email).filter(Boolean)).size;
  const approvedRevs  = s.approvedReviews!= null ? s.approvedReviews: Adapter.getReviews().filter(r=>r.status==='approved').length;

  document.getElementById('statGrid').innerHTML = `
    <div class="stat-card" style="cursor:pointer" onclick="go('bookings')">
      <div class="stat-label">今日の予約</div>
      <div class="stat-val" style="color:var(--blue)">${today}</div>
      <div class="stat-sub">今日</div>
      ${_growthHTML(g && g.today)}
    </div>
    <div class="stat-card" style="cursor:pointer" onclick="go('bookings')">
      <div class="stat-label">今週の予約</div>
      <div class="stat-val">${weekly}</div>
      <div class="stat-sub">今週</div>
      ${_growthHTML(g && g.week)}
    </div>
    <div class="stat-card" style="cursor:pointer" onclick="go('bookings')">
      <div class="stat-label">今月の予約</div>
      <div class="stat-val">${monthly}</div>
      <div class="stat-sub">今月</div>
      ${_growthHTML(g && g.month)}
    </div>
    <div class="stat-card" style="cursor:pointer" onclick="go('bookings')">
      <div class="stat-label">保留中</div>
      <div class="stat-val" style="color:var(--yellow)">${pending}</div>
      <div class="stat-sub">未確定の予約</div>
    </div>
    <div class="stat-card" style="cursor:pointer" onclick="go('bookings')">
      <div class="stat-label">確定済み</div>
      <div class="stat-val" style="color:var(--green)">${confirmed}</div>
      <div class="stat-sub">確認済み予約</div>
    </div>
    <div class="stat-card" style="cursor:pointer" onclick="go('bookings')">
      <div class="stat-label">キャンセル</div>
      <div class="stat-val" style="color:var(--red)">${cancelled}</div>
      <div class="stat-sub">キャンセル済み</div>
    </div>
    <div class="stat-card" style="cursor:pointer" onclick="go('customers')">
      <div class="stat-label">総顧客数</div>
      <div class="stat-val" style="color:var(--blue)">${totalCustomers}</div>
      <div class="stat-sub">ユニーク顧客</div>
    </div>
    <div class="stat-card" style="cursor:pointer" onclick="go('reviews')">
      <div class="stat-label">承認済みレビュー</div>
      <div class="stat-val" style="color:var(--green)">${approvedRevs}</div>
      <div class="stat-sub">公開レビュー数</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">稼働率</div>
      <div class="stat-val" style="color:${occupancy>=80?'var(--green)':occupancy>=50?'var(--yellow)':'var(--ink)'}">${occupancy}%</div>
      <div class="stat-sub">今月の稼働率</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">日平均予約数</div>
      <div class="stat-val" style="font-size:20px;line-height:1.3">${avgDaily}</div>
      <div class="stat-sub">過去30日間</div>
    </div>
  `;
}

/* ── BI trend period state ── */
var _biTrendPeriod = 30;

/* Monotonically-increasing render generation counter.
   Each async BI callback captures the generation at launch time and
   bails out if a newer renderDash() has since started, preventing a
   stale callback from overwriting fresher data. */
var _dashGen = 0;

function renderDash() {
  const gen = ++_dashGen;
  const bk = Adapter.getBookings();

  /* Render immediately with local data so the UI is never blank */
  renderStatGrid(null, null);

  /* Kick off all async BI fetches in parallel */
  if (window.StatisticsService && StatisticsService.supabaseReady) {
    const isActive = () => document.getElementById('view-dashboard').classList.contains('active');
    const isCurrent = () => gen === _dashGen;  // guard against stale callbacks

    Promise.all([
      StatisticsService.getDashboardStats(),
      StatisticsService.getGrowthStats(),
    ]).then(([stats, growth]) => {
      if (!isActive() || !isCurrent()) return;
      renderStatGrid(stats || null, growth || null);
    });

    StatisticsService.getRevenueStats().then(rev  => { if (isActive() && isCurrent()) _renderBIRevenue(rev); });
    StatisticsService.getTrendData(_biTrendPeriod).then(td => { if (isActive() && isCurrent()) _renderBITrendData(td); });
    StatisticsService.getServicePopularity().then(sp => { if (isActive() && isCurrent()) _renderBIService(sp); });
    StatisticsService.getCustomerStats().then(cs  => { if (isActive() && isCurrent()) _renderBICustomer(cs); });
    StatisticsService.getOperationalStats().then(op => { if (isActive() && isCurrent()) _renderBIOperational(op); });
    StatisticsService.getRecentActivity(10).then(act=> { if (isActive() && isCurrent()) _renderBIActivity(act); });
  }

  /* Render BI skeletons immediately so layout doesn't jump */
  _renderBIRevenue(null);
  _renderBITrend();
  _renderBIService(null);
  _renderBICustomer(null);
  _renderBIOperational(null);
  _renderBIExport();

  const recent = bk.slice(0, 5);
  document.getElementById('recentWrap').innerHTML = recent.length ? buildTable(recent, true) : emptyHTML('予約がありません');
  renderQA();
  renderActivity();
  renderObservability();
}

function renderObservability() {
  const el = document.getElementById('obsPanel');
  if (!el) return;

  const m   = window.DataProvider ? DataProvider.getMetrics()  : null;
  const cs  = window.DataProvider ? DataProvider.cacheStatus() : [];
  const fl  = window.FallbackLogger ? FallbackLogger.getAll()  : [];
  const sbOk = !!(window.Adapter && Adapter.supabaseReady);

  const hitRate    = m ? m.hitRate : 0;
  const hitColor   = hitRate >= 70 ? 'var(--green)' : hitRate >= 40 ? 'var(--yellow)' : 'var(--ink)';
  const latColor   = !m?.lastLatencyMs ? 'var(--ink)'
                   : m.lastLatencyMs < 500  ? 'var(--green)'
                   : m.lastLatencyMs < 2000 ? 'var(--yellow)'
                   : 'var(--red)';
  const latStr     = m?.lastLatencyMs != null ? m.lastLatencyMs + 'ms' : '—';
  const syncAgo    = m?.lastSyncTs
                   ? _obsAgo(m.lastSyncTs)
                   : '—';
  const flCount    = fl.length;
  const flColor    = flCount === 0 ? 'var(--green)' : flCount < 5 ? 'var(--yellow)' : 'var(--red)';
  const fbColor    = !m || m.fallbacks === 0 ? 'var(--green)' : 'var(--red)';

  const cacheRows = cs.length ? cs.map(s => {
    const ageStr = s.age_s != null ? (s.age_s < 60 ? s.age_s + 's' : Math.round(s.age_s/60) + 'm') : '—';
    const ttlStr = s.ttl_s != null ? Math.round(s.ttl_s/60) + 'm' : '—';
    const badge  = s.valid
      ? `<span class="badge badge-confirmed">有効</span>`
      : `<span class="badge badge-cancel">期限切</span>`;
    return `<tr>
      <td style="font-family:monospace;font-size:12px">${s.table}</td>
      <td style="text-align:center">${s.rows}</td>
      <td style="text-align:center">${ageStr}</td>
      <td style="text-align:center">${ttlStr}</td>
      <td style="text-align:center">${badge}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--gray-1);padding:12px">キャッシュなし</td></tr>`;

  el.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <span class="panel-title">システム監視</span>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-2)">
            <span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${sbOk ? 'var(--green)' : 'var(--red)'};display:inline-block"></span>
            Supabase&nbsp;${sbOk ? 'オンライン' : 'オフライン'}
          </span>
          <button class="btn btn-ghost btn-sm" onclick="renderObservability()">状態更新</button>
          <button class="btn btn-ghost btn-sm" onclick="_refreshAllCaches()" title="期限切れキャッシュをすべてSupabaseから再取得します">キャッシュ更新</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;padding:16px 16px 8px">
        <div class="stat-card" style="margin:0;padding:14px 16px">
          <div class="stat-label">キャッシュヒット率</div>
          <div class="stat-val" style="color:${hitColor};font-size:22px">${hitRate}%</div>
          <div class="stat-sub" style="margin-top:4px">${m ? m.cacheHits + ' / ' + m.reads : '—'} reads</div>
        </div>
        <div class="stat-card" style="margin:0;padding:14px 16px">
          <div class="stat-label">Supabaseリクエスト</div>
          <div class="stat-val" style="font-size:22px">${m ? m.supabaseReads : '—'}</div>
          <div class="stat-sub" style="margin-top:4px">直接フェッチ</div>
        </div>
        <div class="stat-card" style="margin:0;padding:14px 16px">
          <div class="stat-label">最終レイテンシ</div>
          <div class="stat-val" style="color:${latColor};font-size:22px">${latStr}</div>
          <div class="stat-sub" style="margin-top:4px">最後のレスポンス</div>
        </div>
        <div class="stat-card" style="margin:0;padding:14px 16px">
          <div class="stat-label">最終同期</div>
          <div class="stat-val" style="font-size:18px;line-height:1.3">${syncAgo}</div>
          <div class="stat-sub" style="margin-top:4px">Supabase読込</div>
        </div>
        <div class="stat-card" style="margin:0;padding:14px 16px">
          <div class="stat-label">フォールバックログ</div>
          <div class="stat-val" style="color:${flColor};font-size:22px">${flCount}</div>
          <div class="stat-sub" style="margin-top:4px">FallbackLoggerエントリ</div>
        </div>
        <div class="stat-card" style="margin:0;padding:14px 16px">
          <div class="stat-label">フォールバック失敗</div>
          <div class="stat-val" style="color:${fbColor};font-size:22px">${m ? m.fallbacks : '—'}</div>
          <div class="stat-sub" style="margin-top:4px">キャッシュミス</div>
        </div>
        <div class="stat-card" style="margin:0;padding:14px 16px">
          <div class="stat-label">リトライ回数</div>
          <div class="stat-val" style="color:${m?.retries > 0 ? 'var(--yellow)' : 'var(--green)'};font-size:22px">${m ? m.retries : '—'}</div>
          <div class="stat-sub" style="margin-top:4px">自動再試行 (バックオフ)</div>
        </div>
      </div>

      <div style="padding:0 16px 16px">
        <div class="stat-label" style="margin-bottom:8px">キャッシュ状態</div>
        <div class="table-wrap">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="border-bottom:1px solid var(--line)">
                <th style="text-align:left;padding:6px 10px;font-weight:600;color:var(--gray-1)">テーブル</th>
                <th style="text-align:center;padding:6px 10px;font-weight:600;color:var(--gray-1)">件数</th>
                <th style="text-align:center;padding:6px 10px;font-weight:600;color:var(--gray-1)">経過</th>
                <th style="text-align:center;padding:6px 10px;font-weight:600;color:var(--gray-1)">TTL</th>
                <th style="text-align:center;padding:6px 10px;font-weight:600;color:var(--gray-1)">状態</th>
              </tr>
            </thead>
            <tbody>${cacheRows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function _obsAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60)   return s + '秒前';
  if (s < 3600) return Math.round(s / 60) + '分前';
  return Math.round(s / 3600) + '時間前';
}

async function _refreshAllCaches() {
  if (!window.Adapter || !Adapter.supabaseReady) {
    toast('Supabaseがオフラインのためキャッシュを更新できません');
    return;
  }
  if (window.DataProvider) DataProvider.clearAllCache();
  await Adapter.syncFromSupabase();
  renderObservability();
  toast('キャッシュをSupabaseから再取得しました');
}

/* Refresh stat grid when Realtime fires a change */
document.addEventListener('dashboard:stats-updated', function (e) {
  const isActive = document.getElementById('view-dashboard').classList.contains('active');
  if (!isActive) return;
  renderStatGrid(e.detail);
  if (window.StatisticsService && StatisticsService.supabaseReady) {
    StatisticsService.getGrowthStats().then(g => { if (g) renderStatGrid(e.detail, g); });
    StatisticsService.getRevenueStats().then(r => _renderBIRevenue(r));
    StatisticsService.getOperationalStats().then(o => _renderBIOperational(o));
  }
});

function renderActivity() {
  const bk      = Adapter.getBookings();
  const quotes  = Adapter.getQuotes();
  const reviews = Adapter.getReviews();

  const items = [];

  bk.slice(0, 3).forEach(b => items.push({
    icon: 'ai-blue',
    svg: '<path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/>',
    title: `新規予約を受信しました — ${esc(b.name||'—')}`,
    meta: fmtDT(b.createdAt) + '　' + esc(b.service||''),
    ts: new Date(b.createdAt||0).getTime()
  }));

  quotes.slice(0, 2).forEach(q => items.push({
    icon: 'ai-yellow',
    svg: '<path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>',
    title: `見積りリクエストが届きました — ${esc(q.name||'—')}`,
    meta: fmtDT(q.createdAt),
    ts: new Date(q.createdAt||0).getTime()
  }));

  reviews.slice(0, 2).forEach(r => items.push({
    icon: 'ai-purple',
    svg: '<path fill="currentColor" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>',
    title: `レビューを受信しました — ${esc(r.name||'—')}`,
    meta: fmtDT(r.createdAt) + '　★'.repeat(r.rating||5).trim(),
    ts: new Date(r.createdAt||0).getTime()
  }));

  items.sort((a, b) => b.ts - a.ts);

  if (!items.length) {
    document.getElementById('activityWrap').innerHTML = `<div class="empty" style="padding:24px 0"><p>アクティビティはありません</p></div>`;
    return;
  }

  document.getElementById('activityWrap').innerHTML = items.slice(0, 8).map(it => `
    <div class="activity-item">
      <div class="activity-icon ${it.icon}">
        <svg viewBox="0 0 24 24" width="16" height="16">${it.svg}</svg>
      </div>
      <div class="activity-body">
        <div class="activity-title">${it.title}</div>
        <div class="activity-meta">${it.meta}</div>
      </div>
    </div>`).join('');
}

/* ════════════════════════════════════════════════════════
   BI DASHBOARD — Phase 13 render functions
   ════════════════════════════════════════════════════════ */

/* ── 1. Revenue Analytics ── */
function _renderBIRevenue(rev) {
  const el = document.getElementById('biRevenuePanel');
  if (!el) return;
  const fmt = n => n != null ? '¥' + n.toLocaleString() : '—';
  const r = rev || {};

  el.innerHTML = `
    <div class="panel" style="margin-bottom:0;height:100%">
      <div class="panel-head">
        <span class="panel-title">売上分析</span>
        <span style="font-size:11px;color:var(--gray-2)">基本料金ベース</span>
      </div>
      <div class="panel-body">
        <div class="bi-metric-row">
          <span class="bi-metric-label">今日の売上</span>
          <span class="bi-metric-val green">${fmt(r.todayRevenue)}</span>
        </div>
        <div class="bi-metric-row">
          <span class="bi-metric-label">今週の売上</span>
          <span class="bi-metric-val">${fmt(r.weeklyRevenue)}</span>
        </div>
        <div class="bi-metric-row">
          <span class="bi-metric-label">今月の売上</span>
          <span class="bi-metric-val blue">${fmt(r.monthlyRevenue)}</span>
        </div>
        <div class="bi-metric-row">
          <span class="bi-metric-label">平均予約単価</span>
          <span class="bi-metric-val">${fmt(r.averageBookingValue)}</span>
        </div>
        <div class="bi-metric-row">
          <span class="bi-metric-label">今月の予測売上</span>
          <span class="bi-metric-val" style="color:var(--yellow)">${fmt(r.projectedMonthlyRevenue)}</span>
        </div>
        <div class="bi-metric-row">
          <span class="bi-metric-label">売上累計</span>
          <span class="bi-metric-val">${fmt(r.totalRevenue)}</span>
        </div>
      </div>
    </div>`;
}

/* ── 2. Booking Trend Chart ── */
function _renderBITrend() {
  const el = document.getElementById('biTrendPanel');
  if (!el) return;
  const p = _biTrendPeriod;
  el.innerHTML = `
    <div class="panel" style="margin-bottom:0;height:100%">
      <div class="panel-head">
        <span class="panel-title">予約トレンド</span>
        <div class="bi-trend-btns">
          ${[7,30,90].map(d => `<button class="bi-trend-btn${d===p?' active':''}" onclick="biSetTrend(${d})">${d}日</button>`).join('')}
        </div>
      </div>
      <div class="panel-body">
        <canvas id="biTrendCanvas" class="bi-chart-canvas"></canvas>
        <div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap">
          <div style="flex:1;text-align:center">
            <div class="stat-val" id="biTrendTotal" style="font-size:20px;line-height:1.2">—</div>
            <div class="stat-sub">総予約数</div>
          </div>
          <div style="flex:1;text-align:center">
            <div class="stat-val" id="biTrendAvg" style="font-size:20px;line-height:1.2">—</div>
            <div class="stat-sub">日平均</div>
          </div>
          <div style="flex:1;text-align:center">
            <div class="stat-val" id="biTrendGrowth" style="font-size:20px;line-height:1.2">—</div>
            <div class="stat-sub">期間成長率</div>
          </div>
        </div>
      </div>
    </div>`;
}

function _renderBITrendData(td) {
  if (!td) return;
  window._biLastTrendData = td;
  const isDark = document.documentElement.classList.contains('dark');
  const DOW = ['日','月','火','水','木','金','土'];

  const n      = td.trend.length;
  const step   = n <= 14 ? 1 : n <= 31 ? 3 : 7;
  const labels = td.trend.map((r, i) => {
    if (i % step !== 0) return '';
    const d = new Date(r.date + 'T00:00:00');
    return td.days <= 7 ? DOW[d.getDay()] : `${d.getMonth()+1}/${d.getDate()}`;
  });
  const data = td.trend.map(r => r.count);

  drawBarChart('biTrendCanvas', labels, data, isDark);

  const totalEl  = document.getElementById('biTrendTotal');
  const avgEl    = document.getElementById('biTrendAvg');
  const growthEl = document.getElementById('biTrendGrowth');

  if (totalEl)  totalEl.textContent  = td.total;
  if (avgEl)    avgEl.textContent    = td.avgDay + '件';
  if (growthEl) {
    const pct = td.growth;
    growthEl.textContent   = pct > 0 ? `↑ ${pct}%` : pct < 0 ? `↓ ${Math.abs(pct)}%` : '→ 0%';
    growthEl.style.color   = pct > 0 ? 'var(--green)' : pct < 0 ? 'var(--red)' : 'var(--gray-1)';
  }
}

function biSetTrend(days) {
  _biTrendPeriod = days;
  _renderBITrend();
  if (window.StatisticsService && StatisticsService.supabaseReady) {
    StatisticsService.getTrendData(days).then(td => {
      if (document.getElementById('view-dashboard')?.classList.contains('active')) _renderBITrendData(td);
    });
  }
}

/* ── 3. Service Popularity ── */
function _renderBIService(sp) {
  const el = document.getElementById('biServicePanel');
  if (!el) return;

  const _SVC_SHORT2 = {
    '単身引越し':'単身', 'カップル・ご夫婦引越し':'カップル', '学生・新生活引越し':'学生',
    '当日・お急ぎ引越しプラン':'当日', '不用品回収・処分':'不用品', '不用品回収・処分サービス':'不用品',
    '家具組立・分解':'家具', 'その他':'その他',
  };
  const colors = ['c1','c2','c3','c4','c5'];

  const rows = (sp && sp.length)
    ? sp.slice(0, 5).map((s, i) => `
        <div class="bi-svc-bar-wrap">
          <div class="bi-svc-bar-label">
            <span>${esc(_SVC_SHORT2[s.service] || s.service || 'その他')}</span>
            <span>${s.count}件 (${s.percentage}%)</span>
          </div>
          <div class="bi-svc-bar-track">
            <div class="bi-svc-bar-fill ${colors[i]}" style="width:${s.percentage}%"></div>
          </div>
        </div>`).join('')
    : `<div class="empty" style="padding:20px 0"><p>${sp === null ? '読み込み中…' : 'データなし'}</p></div>`;

  el.innerHTML = `
    <div class="panel" style="margin-bottom:0;height:100%">
      <div class="panel-head">
        <span class="panel-title">サービス人気度</span>
        <span style="font-size:11px;color:var(--gray-2)">過去30日間</span>
      </div>
      <div class="panel-body">${rows}</div>
    </div>`;
}

/* ── 4. Customer Analytics ── */
function _renderBICustomer(cs) {
  const el = document.getElementById('biCustomerPanel');
  if (!el) return;

  const initials = name => {
    const parts = (name || '—').split(/[\s　]+/);
    return parts.map(p => p[0] || '').join('').slice(0, 2).toUpperCase() || '—';
  };

  const topList = cs && cs.topCustomers && cs.topCustomers.length
    ? cs.topCustomers.slice(0, 4).map(c => `
        <div class="bi-customer-row">
          <div class="bi-customer-avatar">${esc(initials(c.name))}</div>
          <div style="flex:1;min-width:0">
            <div class="bi-customer-name">${esc(c.name || '—')}</div>
            <div class="bi-customer-sub">${c.bookings}件の予約</div>
          </div>
        </div>`).join('')
    : '';

  const metrics = cs ? `
    <div class="bi-metric-row"><span class="bi-metric-label">総顧客数</span><span class="bi-metric-val blue">${cs.totalCustomers}</span></div>
    <div class="bi-metric-row"><span class="bi-metric-label">今日の新規</span><span class="bi-metric-val">${cs.newToday}</span></div>
    <div class="bi-metric-row"><span class="bi-metric-label">今月の新規</span><span class="bi-metric-val">${cs.newThisMonth}</span></div>
    <div class="bi-metric-row"><span class="bi-metric-label">リピーター</span><span class="bi-metric-val">${cs.returningCustomers}</span></div>
    <div class="bi-metric-row"><span class="bi-metric-label">リテンション率</span>
      <span class="bi-metric-val" style="color:${cs.retentionRate>=50?'var(--green)':cs.retentionRate>=20?'var(--yellow)':'var(--red)'}">${cs.retentionRate}%</span>
    </div>` : `<div class="empty" style="padding:20px 0"><p>読み込み中…</p></div>`;

  el.innerHTML = `
    <div class="panel" style="margin-bottom:0;height:100%">
      <div class="panel-head">
        <span class="panel-title">顧客分析</span>
        <button class="btn btn-ghost btn-sm" onclick="go('customers')">一覧 →</button>
      </div>
      <div class="panel-body">
        ${metrics}
        ${topList ? `<div class="bi-section-header" style="margin-top:14px">トップ顧客</div>${topList}` : ''}
      </div>
    </div>`;
}

/* ── 5. Operational Analytics ── */
function _renderBIOperational(op) {
  const el = document.getElementById('biOperationalPanel');
  if (!el) return;

  if (!op) {
    el.innerHTML = `
      <div class="panel">
        <div class="panel-head"><span class="panel-title">稼働状況（今月）</span></div>
        <div class="panel-body"><div class="empty" style="padding:16px 0"><p>読み込み中…</p></div></div>
      </div>`;
    return;
  }

  const total = op.daysInMonth || 1;
  const availPct   = Math.round((op.availableDays / total) * 100);
  const limitedPct = Math.round((op.limitedDays / total) * 100);
  const bookedPct  = Math.round((op.bookedDays / total) * 100);

  el.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <span class="panel-title">稼働状況（今月）</span>
        <span style="font-size:11px;color:var(--gray-2)">${op.daysInMonth}日間</span>
      </div>
      <div class="panel-body">
        <div style="margin-bottom:8px;font-size:12px;color:var(--gray-1)">稼働率 <strong style="color:${op.utilisationRate>=80?'var(--green)':op.utilisationRate>=50?'var(--yellow)':'var(--ink)'}">${op.utilisationRate}%</strong></div>
        <div class="bi-occ-bar" style="margin-bottom:16px">
          ${bookedPct > 0  ? `<div class="bi-occ-seg" style="width:${bookedPct}%;background:#ef4444">${bookedPct>8?bookedPct+'%':''}</div>` : ''}
          ${limitedPct > 0 ? `<div class="bi-occ-seg" style="width:${limitedPct}%;background:#f59e0b">${limitedPct>8?limitedPct+'%':''}</div>` : ''}
          ${availPct > 0   ? `<div class="bi-occ-seg" style="width:${availPct}%;background:#10b981">${availPct>8?availPct+'%':''}</div>` : ''}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px">
          <div class="stat-card" style="margin:0;padding:12px 14px">
            <div class="stat-label">満了日数</div>
            <div class="stat-val" style="font-size:22px;color:var(--red)">${op.bookedDays}</div>
            <div class="stat-sub">${bookedPct}% of month</div>
          </div>
          <div class="stat-card" style="margin:0;padding:12px 14px">
            <div class="stat-label">残りわずか</div>
            <div class="stat-val" style="font-size:22px;color:var(--yellow)">${op.limitedDays}</div>
            <div class="stat-sub">${limitedPct}% of month</div>
          </div>
          <div class="stat-card" style="margin:0;padding:12px 14px">
            <div class="stat-label">空き日数</div>
            <div class="stat-val" style="font-size:22px;color:var(--green)">${op.availableDays}</div>
            <div class="stat-sub">${availPct}% of month</div>
          </div>
          <div class="stat-card" style="margin:0;padding:12px 14px">
            <div class="stat-label">今月の予約数</div>
            <div class="stat-val" style="font-size:22px">${op.totalBookingsMonth}</div>
            <div class="stat-sub">カレンダー登録</div>
          </div>
        </div>
        <div style="display:flex;gap:12px;margin-top:10px;font-size:11px;color:var(--gray-2)">
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#ef4444;margin-right:4px"></span>満了</span>
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#f59e0b;margin-right:4px"></span>残りわずか</span>
          <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#10b981;margin-right:4px"></span>空き</span>
        </div>
      </div>
    </div>`;
}

/* ── 6. Live Activity Feed (Supabase) ── */
function _renderBIActivity(items) {
  const el = document.getElementById('activityWrap');
  if (!el || !items || !items.length) return;

  const iconMap = {
    booking: { cls: 'ai-blue',   svg: '<path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/>' },
    review:  { cls: 'ai-purple', svg: '<path fill="currentColor" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>' },
  };

  el.innerHTML = items.map(it => {
    const ic   = iconMap[it.type] || iconMap.booking;
    const tsStr = it.ts ? fmtDT(it.ts) : '—';
    return `
      <div class="activity-item">
        <div class="activity-icon ${ic.cls}">
          <svg viewBox="0 0 24 24" width="16" height="16">${ic.svg}</svg>
        </div>
        <div class="activity-body">
          <div class="activity-title">${esc(it.action)} — ${esc(it.name)}</div>
          <div class="activity-meta">${tsStr}${it.detail ? '　' + esc(it.detail) : ''}</div>
        </div>
      </div>`;
  }).join('');
}

/* ── 7. Export Panel ── */
function _renderBIExport() {
  const el = document.getElementById('biExportPanel');
  if (!el) return;
  el.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <span class="panel-title">データエクスポート</span>
      </div>
      <div class="panel-body">
        <div class="bi-export-grid">
          <button class="btn btn-ghost" onclick="exportCSV()" style="justify-content:flex-start">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            予約 CSV
          </button>
          <button class="btn btn-ghost" onclick="exportBookingsJSON()" style="justify-content:flex-start">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            予約 JSON
          </button>
          <button class="btn btn-ghost" onclick="exportCustomersCSV()" style="justify-content:flex-start">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            顧客 CSV
          </button>
          <button class="btn btn-ghost" onclick="exportStatisticsJSON()" style="justify-content:flex-start">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            統計 JSON
          </button>
        </div>
      </div>
    </div>`;
}

function renderQA() {
  document.getElementById('qaGrid').innerHTML = `
  <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--gray-2);margin-bottom:10px">クイックアクション</div>
  <div class="qa-grid">
    <button class="qa-btn" onclick="go('services');setTimeout(openSvcModal,60)">
      <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>
      <div><div style="font-weight:600">新しいサービス</div><div style="font-size:11px;color:var(--gray-2);margin-top:1px">サービスを追加</div></div>
    </button>
    <button class="qa-btn" onclick="go('reviews');setTimeout(openRevModal,60)">
      <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
      <div><div style="font-weight:600">レビューを追加</div><div style="font-size:11px;color:var(--gray-2);margin-top:1px">お客様の声を登録</div></div>
    </button>
    <button class="qa-btn" onclick="toast('メディアマネージャーは準備中です')">
      <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
      <div><div style="font-weight:600">メディアをアップロード</div><div style="font-size:11px;color:var(--gray-2);margin-top:1px">画像・ファイル管理</div></div>
    </button>
    <button class="qa-btn" onclick="go('hero')">
      <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
      <div><div style="font-weight:600">ホームページを編集</div><div style="font-size:11px;color:var(--gray-2);margin-top:1px">ヒーローコンテンツ</div></div>
    </button>
  </div>`;
}
