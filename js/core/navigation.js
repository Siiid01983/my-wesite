'use strict';

/* ════════════════════════════════════════════════════════
   STATS
   ════════════════════════════════════════════════════════ */
function calcStats() {
  const bk = Adapter.getBookings();
  const avail = Adapter.getAvail();
  const prices = Adapter.getPrices();
  const today = todayStr();
  const now = new Date(); now.setHours(0,0,0,0);
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const inRange = (ds, from) => ds >= fmtISO(from);
  function fmtISO(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

  const todayBk = bk.filter(b => b.date === today).length;
  const weekBk  = bk.filter(b => b.date >= fmtISO(weekStart)).length;
  const monthBk = bk.filter(b => b.date >= fmtISO(monthStart)).length;
  const fullyBooked = Object.values(avail).filter(v => v === 'booked').length;

  let revenue = 0;
  bk.filter(b => b.status !== 'キャンセル').forEach(b => {
    const p = prices[b.service];
    revenue += (typeof p === 'number' ? p : (p && p.base) || 0);
  });

  return {todayBk, weekBk, monthBk, fullyBooked, revenue};
}

/* ════════════════════════════════════════════════════════
   NAVIGATION
   ════════════════════════════════════════════════════════ */
const VIEW_TITLES = {
  dashboard:'ダッシュボード', bookings:'予約管理', quotes:'見積り管理',
  reviews:'レビュー管理', services:'サービス管理', faq:'FAQ編集', company:'会社情報編集', footer:'フッター編集', hero:'ヒーロー編集', calendar:'カレンダー管理', analytics:'分析',
  capacity:'容量設定', pricing:'料金管理', disposal:'不用品管理', actions:'クイック操作',
  backup:'バックアップ', media:'メディアライブラリ', customers:'顧客管理', line:'LINE通知設定', email:'メール通知設定', changelog:'変更履歴', security:'セキュリティ', health:'システム健全性'
};

/* ════════════════════════════════════════════════════════
   DATA PROVIDER SYNC HELPER
   Routes page-open syncs through DataProvider so FallbackLogger
   captures every Supabase attempt. If DataProvider confirms Supabase
   is reachable, delegates to Adapter for domain mapping + storage.
   ════════════════════════════════════════════════════════ */
async function _dpSync(table, filters, adapterFn, viewId, rerenderFn) {
  const { source } = await window.DataProvider.read(table, filters || undefined);
  if (source !== 'supabase') return;
  const ok = await adapterFn();
  if (ok && document.getElementById(viewId)?.classList.contains('active')) rerenderFn();
}

function go(view) {
  if (!Auth.isLoggedIn()) { Auth.logout(); return; }
  if (Auth.mustChangePassword()) { showForceChange(); return; }
  Adapter.initializeRealtime(); // no-op if channels already active; re-connects if lost
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.sb-link').forEach(l => l.classList.remove('active'));
  document.getElementById('view-'+view).classList.add('active');
  const lnk = document.querySelector(`[data-view="${view}"]`);
  if (lnk) lnk.classList.add('active');
  document.getElementById('topbarTitle').textContent = VIEW_TITLES[view]||'';
  document.getElementById('sidebar').classList.remove('open');
  Auth.touch();
  if (view==='dashboard') renderDash();
  if (view==='bookings') renderBookings();
  if (view==='calendar') { refreshCalendarUI(); _syncCalendarFromSupabase(); }
  if (view==='analytics') renderAnalytics();
  if (view==='capacity') { loadCapacity(); _syncCapacityFromSupabase(); }
  if (view==='pricing') { renderPricing(); _syncPricingFromSupabase(); }
  if (view==='disposal') { renderDisposal(); _syncDisposalFromSupabase(); }
  if (view==='quotes') { renderQuotes(); _syncQuotesFromSupabase(); }
  if (view==='reviews') { renderReviews(); _syncReviewsFromSupabase(); }
  if (view==='services') { renderServices(); _syncServicesFromSupabase(); }
  if (view==='faq') { renderFaq(); _syncFaqFromSupabase(); }
  if (view==='company') { renderCompany(); _syncCompanyFromSupabase(); }
  if (view==='footer') { renderFooter(); _syncFooterFromSupabase(); }
  if (view==='hero') { renderHero(); _syncHeroFromSupabase(); }
  if (view==='backup') renderBackup();
  if (view==='media') renderMedia();
  if (view==='customers') { renderCustomers(); _syncCustomersFromSupabase(); }
  if (view==='line') renderLine();
  if (view==='email') renderEmail();
  if (view==='changelog') renderChangelog();
  if (view==='security')    renderSecurity();
  if (view==='health')      renderHealth();
}

function toggleDark() {
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('hm_theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  if (document.getElementById('view-analytics').classList.contains('active')) renderAnalyticsCharts();
}