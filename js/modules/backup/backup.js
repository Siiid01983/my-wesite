'use strict';

/* ════════════════════════════════════════════════════════
   BACKUP CENTER
   ════════════════════════════════════════════════════════ */
function _dlJSON(filename, obj) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], {type:'application/json'}));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportBookingsJSON() {
  _dlJSON(`hm-bookings-${todayStr()}.json`, Adapter.getBookings());
  toast('予約データをエクスポートしました');
}
function exportQuotesJSON() {
  _dlJSON(`hm-quotes-${todayStr()}.json`, Adapter.getQuotes());
  toast('見積りデータをエクスポートしました');
}
function exportReviewsJSON() {
  _dlJSON(`hm-reviews-${todayStr()}.json`, Adapter.getReviews());
  toast('レビューデータをエクスポートしました');
}
function exportFullBackup() {
  const backup = {version:1, exportedAt:new Date().toISOString(), data:{}};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('hm_')) {
      try { backup.data[key] = JSON.parse(localStorage.getItem(key)); }
      catch { backup.data[key] = localStorage.getItem(key); }
    }
  }
  _dlJSON(`hm-backup-${todayStr()}.json`, backup);
  toast('フルバックアップをエクスポートしました');
}

/* ── BI Export helpers ── */
function exportCustomersCSV() {
  const bk = Adapter.getBookings();
  if (!bk.length) { toast('顧客データがありません'); return; }

  const byEmail = {};
  bk.forEach(b => {
    const key = (b.email || '').toLowerCase() || '__' + b.name;
    if (!byEmail[key]) byEmail[key] = { name: b.name, email: b.email, phone: b.phone, bookings: 0, firstDate: b.createdAt, lastDate: b.createdAt };
    byEmail[key].bookings++;
    if ((b.createdAt || '') < byEmail[key].firstDate) byEmail[key].firstDate = b.createdAt;
    if ((b.createdAt || '') > byEmail[key].lastDate)  byEmail[key].lastDate  = b.createdAt;
  });

  const h = ['お客様名','メール','電話','予約件数','初回予約日','最終予約日'];
  const rows = Object.values(byEmail).map(c =>
    [c.name, c.email, c.phone, c.bookings, c.firstDate, c.lastDate]
    .map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')
  );
  const csv = '﻿' + [h.join(','), ...rows].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = `hm-customers-${todayStr()}.csv`;
  a.click();
  toast('顧客CSVをエクスポートしました');
}

async function exportStatisticsJSON() {
  const local  = calcStats();
  const bk     = Adapter.getBookings();
  const prices = Adapter.getPrices();

  const svcCount = {};
  bk.filter(b => b.status !== 'キャンセル').forEach(b => { svcCount[b.service] = (svcCount[b.service]||0) + 1; });

  const payload = {
    exportedAt:       new Date().toISOString(),
    period:           todayStr(),
    kpi: {
      todayBookings:   local.todayBk,
      weeklyBookings:  local.weekBk,
      monthlyBookings: local.monthBk,
      totalBookings:   bk.length,
      pending:         bk.filter(b => b.status === '新規' || b.status === '確認中').length,
      confirmed:       bk.filter(b => b.status === '確定').length,
      cancelled:       bk.filter(b => b.status === 'キャンセル').length,
      estimatedRevenue:local.revenue,
    },
    serviceBreakdown: Object.entries(svcCount).sort((a,b)=>b[1]-a[1]).map(([s,n])=>({service:s,count:n})),
    uniqueCustomers:  new Set(bk.map(b=>b.email).filter(Boolean)).size,
  };

  if (window.StatisticsService && StatisticsService.supabaseReady) {
    try {
      const [growth, rev, op] = await Promise.all([
        StatisticsService.getGrowthStats(),
        StatisticsService.getRevenueStats(),
        StatisticsService.getOperationalStats(),
      ]);
      if (growth) payload.growth = growth;
      if (rev)    payload.revenue = rev;
      if (op)     payload.operational = op;
    } catch(e) { console.warn('[Export] Supabase stats unavailable:', e.message); }
  }

  _dlJSON(`hm-statistics-${todayStr()}.json`, payload);
  toast('統計データをエクスポートしました');
}

function _setImportMsg(id, type, msg) {
  const el = document.getElementById(id + 'Msg');
  if (!el) return;
  el.textContent = msg;
  el.className = 'import-msg ' + (type === 'ok' ? 'import-ok' : 'import-err');
}

function handleImport(inputId, type) {
  const input = document.getElementById(inputId);
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    let parsed;
    try { parsed = JSON.parse(ev.target.result); }
    catch { _setImportMsg(inputId, 'err', 'エラー: 無効なJSONファイルです'); input.value = ''; return; }
    if (type === 'bookings')     _doImportBookings(parsed, inputId);
    else if (type === 'reviews') _doImportReviews(parsed, inputId);
    else if (type === 'backup')  _doImportBackup(parsed, inputId);
    input.value = '';
  };
  reader.readAsText(file, 'UTF-8');
}

function _doImportBookings(data, inputId) {
  if (!Array.isArray(data))
    return _setImportMsg(inputId, 'err', 'エラー: 配列形式が必要です');
  if (!data.every(b => b && b.id && b.name))
    return _setImportMsg(inputId, 'err', 'エラー: id・name フィールドが必要です');
  localStorage.setItem('hm_admin_bookings', JSON.stringify(data));
  _setImportMsg(inputId, 'ok', `✓ ${data.length}件をインポートしました`);
  toast('予約データをインポートしました'); renderDash();
}

function _doImportReviews(data, inputId) {
  if (!Array.isArray(data))
    return _setImportMsg(inputId, 'err', 'エラー: 配列形式が必要です');
  if (!data.every(r => r && r.id && r.name && typeof r.rating === 'number'))
    return _setImportMsg(inputId, 'err', 'エラー: id・name・rating フィールドが必要です');
  localStorage.setItem('hm_reviews', JSON.stringify(data));
  _setImportMsg(inputId, 'ok', `✓ ${data.length}件をインポートしました`);
  toast('レビューデータをインポートしました');
}

function _doImportBackup(data, inputId) {
  if (!data || typeof data.data !== 'object')
    return _setImportMsg(inputId, 'err', 'エラー: 有効なバックアップファイルではありません');
  let count = 0;
  Object.entries(data.data).forEach(([key, val]) => {
    if (key.startsWith('hm_')) {
      try { localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)); count++; }
      catch {}
    }
  });
  if (!count) return _setImportMsg(inputId, 'err', 'エラー: 復元できるデータがありません');
  _setImportMsg(inputId, 'ok', `✓ ${count}種類のデータを復元しました`);
  toast('バックアップを復元しました'); renderDash();
}

function renderBackup() {
  ['impBookings', 'impReviews', 'impBackup'].forEach(id => {
    const el = document.getElementById(id + 'Msg');
    if (el) { el.textContent = ''; el.className = 'import-msg'; }
  });
}
