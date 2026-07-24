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
  reviews:'レビュー管理', services:'サービス管理', faq:'FAQ編集', company:'会社情報編集', footer:'フッター編集', hero:'ヒーロー編集', calendar:'空き枠管理', analytics:'分析',
  capacity:'容量設定', pricing:'料金管理', disposal:'不用品管理', actions:'クイック操作',
  backup:'バックアップ', media:'メディアライブラリ', customers:'顧客管理', 'portal-users':'顧客ポータル管理', line:'LINE通知設定', email:'メール通知設定', changelog:'変更履歴', security:'セキュリティ', health:'システム健全性',
  staff:'スタッフ管理',
  'audit-log':'監査ログ',
  'seo':'SEO センター',
  'blog':'ブログ管理',
  'site-settings':'ウェブサイト設定',
  'overlay-bookings':'フォーム予約一覧',
  'inbox':'受信トレイ',
};

/* Views only accessible to the admin role */
const _ADMIN_ONLY = new Set(['pricing','disposal','services','faq','company','footer','hero','backup','email','line','security','staff','audit-log','portal-users']);

function _applyRoleToSidebar() {
  const role = Auth.getRole ? Auth.getRole() : 'admin';
  document.querySelectorAll('[data-view]').forEach(el => { el.style.display = ''; });
  if (role !== 'admin') {
    _ADMIN_ONLY.forEach(view => {
      const el = document.querySelector(`[data-view="${view}"]`);
      if (el) el.style.display = 'none';
    });
  }
}

/* ════════════════════════════════════════════════════════
   DATA PROVIDER SYNC HELPER
   Routes page-open syncs through DataProvider so FallbackLogger
   captures every API attempt. If DataProvider confirms API
   is reachable, delegates to Adapter for domain mapping + storage.
   ════════════════════════════════════════════════════════ */
/* Per-table in-flight guard: prevents two concurrent _dpSync calls for the same
   table from both firing API fetches that could write different snapshots
   of local storage in an unpredictable order. */
const _dpSyncInFlight = {};

async function _dpSync(table, filters, adapterFn, viewId, rerenderFn) {
  if (_dpSyncInFlight[table]) return;
  _dpSyncInFlight[table] = true;
  try {
    const { source } = await window.DataProvider.read(table, filters || undefined);
    if (source !== 'api') return;
    const ok = await adapterFn();
    if (ok && document.getElementById(viewId)?.classList.contains('active')) rerenderFn();
  } finally {
    _dpSyncInFlight[table] = false;
  }
}

function go(view) {
  if (!Auth.isLoggedIn()) { Auth.logout(); return; }
  // 容量設定 is merged into 空き枠管理 (slot calendar). Alias legacy deep links /
  // quick-actions so go('capacity') lands on the unified availability screen.
  if (view === 'capacity' && window.SlotCalendar && SlotCalendar.enabled && SlotCalendar.enabled()) view = 'calendar';
  if (Auth.mustChangePassword()) { showForceChange(); return; }
  if (_ADMIN_ONLY.has(view) && Auth.getRole && Auth.getRole() !== 'admin') {
    toast('このページへのアクセス権限がありません');
    return;
  }
  Adapter.initializeRealtime(); // no-op if channels already active; re-connects if lost
  const _viewEl = document.getElementById('view-'+view);
  if (!_viewEl) { console.warn('go(): unknown view "'+view+'" — no #view-'+view+' element'); return; }
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.sb-link').forEach(l => l.classList.remove('active'));
  _viewEl.classList.add('active');
  const lnk = document.querySelector(`[data-view="${view}"]`);
  if (lnk) lnk.classList.add('active');
  document.getElementById('topbarTitle').textContent = VIEW_TITLES[view]||'';
  document.getElementById('sidebar').classList.remove('open');
  Auth.touch();
  if (view==='dashboard') renderDash();
  if (view==='bookings') renderBookings();
  if (view==='calendar') {
    // Slot-only 空き枠管理 (flag on, default): render the slot month grid + editor
    // and keep the {max,limited} thresholds fresh. Legacy ○△× grid path runs only
    // when the flag is off (staged-rollout fallback) — it overlays slot_capacity
    // day-closures via _loadSlotCapClosed (PR #122) exactly as before.
    if (window.SlotCalendar && SlotCalendar.enabled && SlotCalendar.enabled()) {
      SlotCalendar.onShow();
      if (typeof _syncCapacityFromApi === 'function') _syncCapacityFromApi();
      renderGCalPanel();
    } else {
      refreshCalendarUI(); renderGCalPanel(); _syncCalendarFromApi();
      if (typeof _loadSlotCapClosed==='function') _loadSlotCapClosed(refreshCalendarUI);
    }
  }
  if (view==='analytics') renderAnalytics();
  if (view==='capacity') { loadCapacity(); _syncCapacityFromApi(); }
  if (view==='pricing') { renderPricing(); _syncPricingFromApi(); }
  if (view==='disposal') { renderDisposal(); _syncDisposalFromApi(); }
  if (view==='quotes') { renderQuotes(); _syncQuotesFromApi(); }
  if (view==='reviews') { renderReviews(); _syncReviewsFromApi(); }
  if (view==='services') { renderServices(); _syncServicesFromApi(); }
  if (view==='faq') { renderFaq(); _syncFaqFromApi(); }
  if (view==='company') { renderCompany(); _syncCompanyFromApi(); }
  if (view==='footer') { renderFooter(); _syncFooterFromApi(); }
  if (view==='hero') { renderHero(); _syncHeroFromApi(); }
  if (view==='backup') renderBackup();
  if (view==='media') renderMedia();
  if (view==='customers') { renderCustomers(); _syncCustomersFromApi(); }
  if (view==='portal-users') renderPortalUsers();
  if (view==='line') renderLine();
  if (view==='email') renderEmail();
  if (view==='changelog') renderChangelog();
  if (view==='security')      renderSecurity();
  if (view==='health')        renderHealth();
  if (view==='staff')         renderStaff();
  if (view==='audit-log')     renderAuditLog();
  if (view==='seo')           { renderSEO(); _syncSEOFromApi(); }
  if (view==='blog')          renderBlog();
  if (view==='site-settings') { renderSiteSettings(); _syncSiteSettingsFromApi(); }
  if (view==='overlay-bookings') renderOverlayBookings();
  if (view==='inbox') renderInbox();
  if (window.I18n) I18n.applyToDOM(document.getElementById('adminApp'));
}

function toggleDark() {
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('hm_theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  if (document.getElementById('view-analytics').classList.contains('active')) renderAnalyticsCharts();
}